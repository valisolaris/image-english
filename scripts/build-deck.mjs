// data/cards/*.json と data/images.json をまとめて public/data/deck.json を作る(開発時だけ使う)。
// 形は spec D9: { version: 1, cards: [ SPEC 3章の項目 + id + target_form ] }
// 検査に1件でも失敗したら deck.json を書かずに終了コード1で止まる。
//
// 使い方: node scripts/build-deck.mjs

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CARDS_DIR = path.join(ROOT, 'data', 'cards');
const IMAGES_FILE = path.join(ROOT, 'data', 'images.json');
const IMAGE_DIR = path.join(ROOT, 'public', 'images');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'deck.json');
const WORDS_FILE = path.join(ROOT, 'data', 'words.json');

const REQUIRED = ['id', 'word', 'pos', 'level', 'meaning_ja', 'sentence_en', 'sentence_ja', 'target_form', 'image_query', 'imageability'];
const IMAGEABILITY = ['high', 'medium', 'low'];
const LEVELS = ['A1', 'A2'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** src/card.ts の targetPattern と同じ規則(語の端が英数字のときだけ、その側に境界を求める) */
function targetPattern(targetForm) {
  const left = /^[A-Za-z0-9]/.test(targetForm) ? '(^|[^A-Za-z0-9])' : '()';
  const right = /[A-Za-z0-9]$/.test(targetForm) ? '(?![A-Za-z0-9])' : '';
  return new RegExp(`${left}(${escapeRegExp(targetForm)})${right}`);
}

/** 見つかった問題を文字列の配列で返す(空なら合格) */
function check(card, images) {
  const errors = [];
  for (const key of REQUIRED) {
    if (typeof card[key] !== 'string' || card[key].trim() === '') errors.push(`${key} が空です`);
  }
  if (errors.length) return errors;

  if (card.id !== `${card.word}-${card.pos}`) errors.push(`id は ${card.word}-${card.pos} にしてください`);
  if (!LEVELS.includes(card.level)) errors.push(`level が不正です: ${card.level}`);
  if (!IMAGEABILITY.includes(card.imageability)) errors.push(`imageability が不正です: ${card.imageability}`);
  if (!targetPattern(card.target_form).test(card.sentence_en)) {
    errors.push(`target_form "${card.target_form}" が sentence_en に単語として出てきません`);
  }

  const img = images[card.id];
  if (img?.image) {
    if (!existsSync(path.join(IMAGE_DIR, img.image))) errors.push(`画像ファイルがありません: ${img.image}`);
    if (!img.image_credit?.pageURL || !img.image_credit?.user) errors.push('画像の出典(pageURL・user)がありません');
    else if (!img.image_credit.pageURL.startsWith('https://pixabay.com/')) errors.push(`出典URLが Pixabay ではありません: ${img.image_credit.pageURL}`);
  }
  return errors;
}

async function main() {
  const files = (await readdir(CARDS_DIR)).filter((f) => f.endsWith('.json')).sort();
  const images = existsSync(IMAGES_FILE) ? JSON.parse(await readFile(IMAGES_FILE, 'utf8')) : {};

  const cards = [];
  const seen = new Set();
  let failed = 0;
  let missingImage = 0;

  for (const f of files) {
    for (const card of JSON.parse(await readFile(path.join(CARDS_DIR, f), 'utf8'))) {
      const errors = check(card, images);
      if (seen.has(card.id)) errors.push('id が重複しています');
      seen.add(card.id);
      if (errors.length) {
        failed++;
        for (const e of errors) console.error(`NG ${f} ${card.id ?? '(id なし)'}: ${e}`);
        continue;
      }

      const img = images[card.id];
      if (!img) missingImage++;
      cards.push({
        id: card.id,
        word: card.word,
        pos: card.pos,
        level: card.level,
        meaning_ja: card.meaning_ja,
        sentence_en: card.sentence_en,
        sentence_ja: card.sentence_ja,
        note_ja: card.note_ja ?? null,
        target_form: card.target_form,
        image_query: card.image_query,
        imageability: card.imageability,
        image: img?.image ?? null,
        image_credit: img?.image ? img.image_credit : null,
      });
    }
  }

  if (failed) {
    console.error(`検査に失敗: ${failed} 枚。deck.json は書き出していません。`);
    process.exit(1);
  }

  // 新しい単語はこの順番で出題される(SPEC 2章): A1 → A2、各レベルの中は imageability high → medium → low、
  // 同じ組の中は CEFR-J の並び(data/words.json の順)
  const wordOrder = existsSync(WORDS_FILE)
    ? new Map(JSON.parse(await readFile(WORDS_FILE, 'utf8')).map((w, i) => [w.id, i]))
    : new Map();
  const orderOf = (c) => wordOrder.get(c.id) ?? Number.MAX_SAFE_INTEGER;
  cards.sort(
    (a, b) =>
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
      IMAGEABILITY.indexOf(a.imageability) - IMAGEABILITY.indexOf(b.imageability) ||
      orderOf(a) - orderOf(b),
  );

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify({ version: 1, cards }, null, 2) + '\n');
  const withImage = cards.filter((c) => c.image).length;
  console.log(`deck.json を書き出しました: ${cards.length} 枚(画像あり ${withImage})`);
  if (missingImage) console.log(`注意: 画像をまだ取得していないカードが ${missingImage} 枚あります(image: null で出力)`);
}

main();
