// Pixabay 検索の共通部分(開発時だけ使う)。fetch-images.mjs と画像チェック画面の両方から使う。
// 候補の並びを両者でそろえるため、「image_query で検索 → 0件なら単語で再検索」もここにまとめる。
// APIキーは .env の PIXABAY_API_KEY から読む。キーを画面やファイルに出さないこと。

import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const CANDIDATES = 3;
// Pixabay の上限は 60秒で100リクエスト。余裕をもって間を空ける。
const WAIT_MS = 800;

export function loadKey() {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createPixabay(key) {
  /** 念のため、表示する文字列からキーを消す */
  const redact = (s) => String(s).split(key).join('***');

  async function search(query) {
    const params = new URLSearchParams({
      key,
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

  /** カードの候補を探す: image_query で検索し、0件なら単語で再検索(SPEC 7章③) */
  async function searchForCard(card) {
    let usedQuery = card.image_query;
    let hits = await search(usedQuery);
    if (hits.length === 0) {
      usedQuery = card.word;
      hits = await search(usedQuery);
    }
    return { usedQuery, hits };
  }

  return { redact, search, searchForCard };
}
