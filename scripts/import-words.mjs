// CEFR-J Wordlist(data/source/*.xlsx)から A1・A2 を取り出して data/words.json を作る(開発時だけ使う)。
// 規則は docs/SPEC.md 2章・7章①:
//   シート "A1" "A2" を使う(1行 = 1項目。同じ単語でも品詞が違えば別項目)
//   "color/colour" のように書き方が複数ある項目は最初の書き方を word にし、残りを variants に残す
//   品詞のスペースはハイフンにする(modal auxiliary → modal-auxiliary)。id は "単語-品詞"
//
// 使い方: node scripts/import-words.mjs

import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'data', 'source');
const OUT_FILE = path.join(ROOT, 'data', 'words.json');
const LEVELS = ['A1', 'A2'];

async function findSource() {
  const files = (await readdir(SOURCE_DIR)).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$'));
  if (files.length !== 1) {
    console.error(`data/source/ に .xlsx が ${files.length} 個あります。1個だけにしてください。`);
    process.exit(1);
  }
  return path.join(SOURCE_DIR, files[0]);
}

/** セルの値を文字列にする(リッチテキストのセルにも対応) */
function text(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();
  return String(v).trim();
}

async function main() {
  const file = await findSource();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const words = [];
  const seen = new Set();
  for (const level of LEVELS) {
    const ws = wb.getWorksheet(level);
    if (!ws) {
      console.error(`シート "${level}" が見つかりません。`);
      process.exit(1);
    }
    const header = [1, 2, 3].map((i) => text(ws.getRow(1).getCell(i)));
    if (header.join(',') !== 'headword,pos,CEFR') {
      console.error(`シート "${level}" の見出しが想定と違います: ${header.join(', ')}`);
      process.exit(1);
    }

    let count = 0;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const headword = text(row.getCell(1));
      const pos = text(row.getCell(2)).replace(/\s+/g, '-');
      const cefr = text(row.getCell(3));
      if (!headword) return;
      if (cefr !== level) {
        console.error(`シート "${level}" の ${n} 行目のレベルが ${cefr} です。`);
        process.exit(1);
      }
      const [word, ...variants] = headword.split('/').map((s) => s.trim());
      const id = `${word}-${pos}`;
      if (seen.has(id)) {
        console.error(`id が重複しています: ${id}(シート "${level}" の ${n} 行目)`);
        process.exit(1);
      }
      seen.add(id);
      words.push({ id, word, pos, level, variants, headword });
      count++;
    });
    console.log(`${level}: ${count} 項目`);
  }

  await writeFile(OUT_FILE, JSON.stringify(words, null, 2) + '\n');
  console.log(`data/words.json に ${words.length} 項目を書きました。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
