// 画像チェック画面(開発用・公開版には含めない。SPEC 7章④)。
// カードごとに今の画像と例文を並べ、気になるものは候補3枚から選び直す。
//
// 使い方: npm run check-images → ブラウザで http://127.0.0.1:5174 を開く
//
// - このパソコンの中からしか開けない(127.0.0.1 だけで待ち受ける)
// - APIキーはサーバー側だけで使い、ブラウザには渡さない
// - 画像の差し替えは fetch-images.mjs --word ID --pixabay-id N を呼ぶ(保存の処理を1か所にするため)
// - 確認の状態は data/image-check.json に保存する(途中でやめても続きから再開できる)
// - 差し替えたあとは npm run build-deck(または node scripts/build-deck.mjs)で deck.json を作り直す

import http from 'node:http';
import { readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { ROOT, loadKey, createPixabay } from '../lib/pixabay.mjs';

const HOST = '127.0.0.1';
const PORT = 5174;
const CARDS_DIR = path.join(ROOT, 'data', 'cards');
const IMAGES_FILE = path.join(ROOT, 'data', 'images.json');
const STATUS_FILE = path.join(ROOT, 'data', 'image-check.json');
const DECK_FILE = path.join(ROOT, 'public', 'data', 'deck.json');
const IMAGE_DIR = path.join(ROOT, 'public', 'images');
const PAGE_FILE = path.join(import.meta.dirname, 'index.html');
const STATUSES = ['ok', 'ng'];

const { redact, search, searchForCard } = createPixabay(loadKey());

const readJson = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback);

async function loadCards() {
  const files = (await readdir(CARDS_DIR)).filter((f) => f.endsWith('.json')).sort();
  const cards = [];
  for (const f of files) cards.push(...JSON.parse(await readFile(path.join(CARDS_DIR, f), 'utf8')));
  return cards;
}

/** 学習の出題順(deck.json の順)に並べ、画像と確認状態を付ける */
async function listCards() {
  const [cards, images, status, deck] = await Promise.all([
    loadCards(),
    readJson(IMAGES_FILE, {}),
    readJson(STATUS_FILE, {}),
    readJson(DECK_FILE, { cards: [] }),
  ]);
  const order = new Map(deck.cards.map((c, i) => [c.id, i]));
  return cards
    .map((c) => ({
      id: c.id,
      word: c.word,
      pos: c.pos,
      level: c.level,
      sentence_en: c.sentence_en,
      sentence_ja: c.sentence_ja,
      image_query: c.image_query,
      imageability: c.imageability,
      image: images[c.id]?.image ?? null,
      usedQuery: images[c.id]?.usedQuery ?? null,
      status: status[c.id] ?? null,
    }))
    .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
}

// 同じカードの候補を何度も検索しないように覚えておく(サーバーを止めると消える)
const candidateCache = new Map();

/** query を渡すと、そのキーワードで検索する(候補が全部ダメなとき用)。渡さなければカードの image_query */
async function candidates(id, query) {
  const cacheKey = `${id}\n${query ?? ''}`;
  if (candidateCache.has(cacheKey)) return candidateCache.get(cacheKey);
  const card = (await loadCards()).find((c) => c.id === id);
  if (!card) throw new HttpError(404, `カードが見つかりません: ${id}`);
  const { usedQuery, hits } = query ? { usedQuery: query, hits: await search(query) } : await searchForCard(card);
  const result = {
    usedQuery,
    candidates: hits.map((h) => ({
      pixabayId: h.id,
      previewURL: h.webformatURL,
      pageURL: h.pageURL,
      user: h.user,
      tags: h.tags,
    })),
  };
  candidateCache.set(cacheKey, result);
  return result;
}

/**
 * カードの image_query を書き換える(data/cards/*.json)。元の値を返す。
 * fetch-images.mjs はカードの image_query で検索し直すので、新しいキーワードで選んだ画像を
 * 差し替えるには先にここを書き換えておく必要がある。ファイルの書き方(1行1枚 / 字下げ)はそのまま保つ。
 */
async function setImageQuery(id, query) {
  for (const f of (await readdir(CARDS_DIR)).filter((f) => f.endsWith('.json'))) {
    const file = path.join(CARDS_DIR, f);
    const text = await readFile(file, 'utf8');
    const cards = JSON.parse(text);
    const card = cards.find((c) => c.id === id);
    if (!card) continue;
    const old = card.image_query;
    card.image_query = query;
    const oneLine = !text.includes('\n  {');
    await writeFileSafely(
      file,
      oneLine ? '[\n' + cards.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n' : JSON.stringify(cards, null, 2) + '\n',
    );
    return old;
  }
  throw new HttpError(404, `カードが見つかりません: ${id}`);
}

// ファイル(images.json・カード・image-check.json)を同時に書き換えないよう、書き込みは1件ずつ順番に行う
let queue = Promise.resolve();

function serial(fn) {
  const job = queue.then(fn, fn);
  queue = job.catch(() => {});
  return job;
}

function pick(id, pixabayId, query) {
  const fetchImage = () =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(ROOT, 'scripts', 'fetch-images.mjs'), '--word', id, '--pixabay-id', String(pixabayId)],
        { cwd: ROOT },
        (err, stdout, stderr) => {
          if (err) reject(new HttpError(500, redact(`${stdout}\n${stderr}`.trim())));
          else resolve(stdout);
        },
      );
    });
  // 新しいキーワードで選んだ場合は、先に image_query を書き換え、失敗したら元に戻す
  return serial(async () => {
    if (query) {
      const old = await setImageQuery(id, query);
      try {
        await fetchImage();
      } catch (e) {
        await setImageQuery(id, old);
        throw e;
      }
    } else {
      await fetchImage();
    }
    // 候補の検索結果は差し替え前のキーワードのものなので、このカードの分は捨てる
    for (const key of candidateCache.keys()) if (key.startsWith(`${id}\n`)) candidateCache.delete(key);
    await writeStatus({ [id]: 'ok' });
  });
}

/** 一時ファイルに書いてから置き換える(途中で失敗しても元のファイルが壊れないように) */
async function writeFileSafely(file, text) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

async function writeStatus(updates) {
  const status = await readJson(STATUS_FILE, {});
  for (const [id, value] of Object.entries(updates)) {
    if (value === null) delete status[id];
    else if (STATUSES.includes(value)) status[id] = value;
    else throw new HttpError(400, `状態が不正です: ${value}`);
  }
  const sorted = Object.fromEntries(Object.entries(status).sort(([a], [b]) => a.localeCompare(b)));
  await writeFileSafely(STATUS_FILE, JSON.stringify(sorted, null, 2) + '\n');
}

const setStatus = (updates) => serial(() => writeStatus(updates));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  // 別のサイトのページから勝手に POST されないように、JSON 以外は受け付けない
  // (ブラウザは他サイトからの JSON 送信の前に確認(プリフライト)を行い、このサーバーはそれに応じない)
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type: application/json で送ってください');
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const json = (res, data) => send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data));

async function handle(req, res) {
  // 別のドメイン名を 127.0.0.1 に向け直す手口(DNS リバインディング)を防ぐため、宛先名を確かめる
  if (req.headers.host !== `${HOST}:${PORT}` && req.headers.host !== `localhost:${PORT}`) {
    throw new HttpError(403, `http://${HOST}:${PORT} から開いてください`);
  }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, 'text/html; charset=utf-8', await readFile(PAGE_FILE));
  }
  if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
    // ファイル名だけを使い、public/images の外は読ませない
    const file = path.join(IMAGE_DIR, path.basename(decodeURIComponent(url.pathname)));
    if (!existsSync(file)) throw new HttpError(404, '画像がありません');
    return send(res, 200, 'image/webp', await readFile(file));
  }
  if (req.method === 'GET' && url.pathname === '/api/cards') {
    return json(res, await listCards());
  }
  if (req.method === 'GET' && url.pathname === '/api/candidates') {
    return json(res, await candidates(url.searchParams.get('id'), url.searchParams.get('q')?.trim() || null));
  }
  if (req.method === 'POST' && url.pathname === '/api/pick') {
    const { id, pixabayId, query } = await readBody(req);
    if (typeof id !== 'string' || !Number.isInteger(pixabayId)) throw new HttpError(400, 'id と pixabayId が必要です');
    if (query != null && (typeof query !== 'string' || !query.trim())) throw new HttpError(400, 'query が不正です');
    await pick(id, pixabayId, query?.trim() || null);
    const images = await readJson(IMAGES_FILE, {});
    return json(res, { image: images[id]?.image ?? null });
  }
  if (req.method === 'POST' && url.pathname === '/api/status') {
    await setStatus(await readBody(req));
    return json(res, { ok: true });
  }
  throw new HttpError(404, 'ページがありません');
}

http
  .createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(redact(e.stack ?? e));
      send(res, status, 'text/plain; charset=utf-8', redact(e.message));
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`画像チェック画面: http://${HOST}:${PORT}  (止めるときは Ctrl+C)`);
  });
