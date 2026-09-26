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
//
// APIキーは .env の PIXABAY_API_KEY から読む。キーを画面やファイルに出さないこと。

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CARDS_DIR = path.join(ROOT, 'data', 'cards');
const RESULT_FILE = path.join(ROOT, 'data', 'images.json');
const IMAGE_DIR = path.join(ROOT, 'public', 'images');

const WIDTH = 480;
const TARGET_BYTES = 50 * 1024;
const CANDIDATES = 3;
// Pixabay の上限は 60秒で100リクエスト。余裕をもって間を空ける。
const WAIT_MS = 800;

function loadKey() {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    // .env が無い場合は下でまとめてエラーにする
  }
  const key = process.env.PIXABAY_API_KEY;
  if (!key) {
    console.error('PIXABAY_API_KEY が見つかりません。プロジェクト直下の .env に PIXABAY_API_KEY=... と書いてください。');
    process.exit(1);
  }
  return key;
}

const KEY = loadKey();

/** 念のため、表示する文字列からキーを消す */
function redact(s) {
  return String(s).split(KEY).join('***');
}

function parseArgs(argv) {
  const args = { word: null, pick: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--word') args.word = argv[++i];
    else if (argv[i] === '--pick') args.pick = Number(argv[++i]);
    else {
      console.error(`知らない引数です: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(args.pick) || args.pick < 1 || args.pick > CANDIDATES) {
    console.error(`--pick は 1〜${CANDIDATES} で指定してください。`);
    process.exit(1);
  }
  if (args.pick !== 1 && !args.word) {
    console.error('--pick は --word と一緒に使ってください。');
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(query) {
  const params = new URLSearchParams({
    key: KEY,
    q: query.slice(0, 100),
    image_type: 'photo',
    safesearch: 'true',
    per_page: String(CANDIDATES),
  });
  const res = await fetch(`https://pixabay.com/api/?${params}`);
  await sleep(WAIT_MS);
  if (!res.ok) {
    throw new Error(`Pixabay 検索に失敗しました(HTTP ${res.status}): ${redact(await res.text())}`);
  }
  const data = await res.json();
  return data.hits.slice(0, CANDIDATES);
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

async function fetchCard(card, pick) {
  let usedQuery = card.image_query;
  let hits = await search(usedQuery);
  if (hits.length === 0) {
    usedQuery = card.word;
    hits = await search(usedQuery);
  }

  const candidates = hits.map((h) => ({ pixabayId: h.id, pageURL: h.pageURL, user: h.user, tags: h.tags }));
  const base = { image_query: card.image_query, usedQuery, candidates };

  if (hits.length === 0) {
    return { ...base, picked: null, image: null, image_credit: null };
  }
  const hit = hits[pick - 1];
  if (!hit) {
    // 今の画像を消さないように、記録を書き換えずに止める
    throw new Error(`候補は ${hits.length} 件しかありません(--pick ${pick})`);
  }

  const res = await fetch(hit.webformatURL);
  if (!res.ok) throw new Error(`画像のダウンロードに失敗しました(HTTP ${res.status})`);
  const webp = await toWebp(Buffer.from(await res.arrayBuffer()));
  const file = `${card.id}.webp`;
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
      const r = await fetchCard(card, args.pick);
      results[card.id] = r;
      // 1語ごとに保存する
      await saveResults(results);
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
