// アプリアイコン(ホーム画面用)を作る。開発時に1回だけ実行する:
//   node scripts/make-icons.mjs
// 出力: public/icons/icon-192.png, icon-512.png, apple-touch-icon.png(180px)
// 文字は中央 60% に収め、Android の maskable(丸く切り抜かれる)でも欠けないようにする。

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'icons');
const BG = '#2563eb';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <text x="256" y="256" dy="0.35em" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="220" fill="#ffffff">Ie</text>
</svg>`;

await mkdir(OUT, { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(OUT, name));
  console.log(`wrote public/icons/${name}`);
}
