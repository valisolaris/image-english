// Pixabay から各カードの画像を取得して public/images/ に保存する(開発時だけ使う)。
// 規則は docs/SPEC.md 7章③と spec D1・D7:
//   image_query で検索 → 上位3件を候補として記録 → 1件目を採用
//   見つからなければ単語で再検索 → それでもなければ image: null
//   safesearch 有効、幅480px の WebP(50KB 目安)、出典(ページURL・投稿者名)を記録
//
// 使い方:
//   node scripts/fetch-images.mjs                     まだ取得していないカードだけ取得
//   node scripts/fetch-images.mjs --word apple-noun   1語だけ取り直す(image_query を直したあとなど)
//   node scripts/fetch-images.mjs --word apple-noun --pick 2   候補の2番目に切り替える
//   node scripts/fetch-images.mjs --word apple-noun --pixabay-id 12345   候補のうちその画像IDに切り替える
//                                                                        (画像チェック画面から使う)
//
// APIキーは .env の PIXABAY_API_KEY から読む。キーを画面やファイルに出さないこと。

import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, CANDIDATES, loadKey, createPixabay } from './lib/pixabay.mjs';

const CARDS_DIR = path.join(ROOT, 'data', 'cards');
const RESULT_FILE = path.join(ROOT, 'data', 'images.json');
const IMAGE_DIR = path.join(ROOT, 'public', 'images');

const WIDTH = 480;
const TARGET_BYTES = 50 * 1024;

const { redact, searchForCard } = createPixabay(loadKey());

function parseArgs(argv) {
  const args = { word: null, pick: 1, pixabayId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--word') args.word = argv[++i];
    else if (argv[i] === '--pick') args.pick = Number(argv[++i]);
    else if (argv[i] === '--pixabay-id') args.pixabayId = Number(argv[++i]);
    else {
      console.error(`知らない引数です: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(args.pick) || args.pick < 1 || args.pick > CANDIDATES) {
    console.error(`--pick は 1〜${CANDIDATES} で指定してください。`);
    process.exit(1);
  }
  if ((args.pick !== 1 || args.pixabayId != null) && !args.word) {
    console.error('--pick / --pixabay-id は --word と一緒に使ってください。');
    process.exit(1);
  }
  if (args.pixabayId != null && !Number.isInteger(args.pixabayId)) {
    console.error('--pixabay-id は数字で指定してください。');
    process.exit(1);
  }
  return args;
}

async function loadCards() {
  const files = (await readdir(CARDS_DIR)).filter((f) => f.endsWith('.json')).sort();
  const cards = [];
  for (const f of files) {
    cards.push(...JSON.parse(await readFile(path.join(CARDS_DIR, f), 'utf8')));
  }
  return cards;
}

async function loadResults() {
  if (!existsSync(RESULT_FILE)) return {};
  return JSON.parse(await readFile(RESULT_FILE, 'utf8'));
}

async function saveResults(results) {
  const sorted = Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(RESULT_FILE, JSON.stringify(sorted, null, 2) + '\n');
}

/**
 * 画像のファイル名。Pixabay の画像IDを含める(SPEC 7章③)。
 * iPhone は同じ名前の画像をずっと保存するので、差し替えたら名前も変わるようにするため。
 * "ice cream-noun" や "Mr.-noun" のような id もあるので、英数字とハイフン以外は "-" にする。
 */
function imageFileName(cardId, pixabayId) {
  const slug = cardId.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${pixabayId}.webp`;
}

/** 画像を幅480px の WebP にし、50KB 以下になるまで画質を下げる */
async function toWebp(buf) {
  let out;
  for (let quality = 80; quality >= 40; quality -= 10) {
    out = await sharp(buf).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality }).toBuffer();
    if (out.length <= TARGET_BYTES) break;
  }
  return out;
}

async function fetchCard(card, { pick, pixabayId }, hasImage) {
  const { usedQuery, hits } = await searchForCard(card);

  const candidates = hits.map((h) => ({ pixabayId: h.id, pageURL: h.pageURL, user: h.user, tags: h.tags }));
  const base = { image_query: card.image_query, usedQuery, candidates };

  if (hits.length === 0) {
    // 取り直しで0件になっても、今ある画像は消さない(記録を書き換えずに止める)
    if (hasImage) throw new Error('候補が0件でした。今の画像はそのまま残します');
    return { ...base, picked: null, image: null, image_credit: null };
  }
  // 画像IDで選ぶ場合は、検索結果の並びが変わっていても同じ画像を選べる(画像チェック画面から使う)
  if (pixabayId != null) pick = hits.findIndex((h) => h.id === pixabayId) + 1;
  const hit = hits[pick - 1];
  if (!hit) {
    // 今の画像を消さないように、記録を書き換えずに止める
    throw new Error(
      pixabayId != null
        ? `画像ID ${pixabayId} は今の候補にありません`
        : `候補は ${hits.length} 件しかありません(--pick ${pick})`,
    );
  }

  const res = await fetch(hit.webformatURL);
  if (!res.ok) throw new Error(`画像のダウンロードに失敗しました(HTTP ${res.status})`);
  const webp = await toWebp(Buffer.from(await res.arrayBuffer()));
  const file = imageFileName(card.id, hit.id);
  await writeFile(path.join(IMAGE_DIR, file), webp);

  return {
    ...base,
    picked: pick,
    image: file,
    image_credit: { pageURL: hit.pageURL, user: hit.user },
    bytes: webp.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(IMAGE_DIR, { recursive: true });
  const cards = await loadCards();
  const results = await loadResults();

  let targets;
  if (args.word) {
    targets = cards.filter((c) => c.id === args.word);
    if (targets.length === 0) {
      console.error(`カードが見つかりません: ${args.word}`);
      process.exit(1);
    }
  } else {
    // 処理済みはスキップ(途中で止まっても再開できるように)
    targets = cards.filter((c) => !(c.id in results));
  }

  console.log(`対象 ${targets.length} 語(全 ${cards.length} 語)`);
  let ok = 0;
  let none = 0;
  for (const card of targets) {
    try {
      const oldFile = results[card.id]?.image;
      const r = await fetchCard(card, args, Boolean(oldFile));
      results[card.id] = r;
      // 1語ごとに保存する
      await saveResults(results);
      // 取り直しで名前が変わったら、古い画像ファイルを消す(公開物に残さない)。
      // 記録を保存してから消すので、消せなくても新しい画像が参照されないまま残ることはない
      if (oldFile && oldFile !== r.image) {
        await rm(path.join(IMAGE_DIR, oldFile), { force: true }).catch((e) =>
          console.error(`WARN ${card.id}  古い画像 ${oldFile} を消せませんでした。手で消してください: ${e.message}`),
        );
      }
      if (r.image) {
        ok++;
        const fallback = r.usedQuery === card.image_query ? '' : ' (単語で再検索)';
        console.log(`OK   ${card.id}  ${Math.round(r.bytes / 1024)}KB  by ${r.image_credit.user}${fallback}`);
      } else {
        none++;
        console.log(`NONE ${card.id}  候補が見つかりません(image: null)`);
      }
    } catch (e) {
      console.error(`ERR  ${card.id}  ${redact(e.message)}`);
      process.exitCode = 1;
    }
  }
  console.log(`完了: 画像あり ${ok} / 画像なし ${none} / 対象 ${targets.length}`);
}

main().catch((e) => {
  console.error(redact(e.stack ?? e));
  process.exit(1);
});
