// カードデータ(public/data/deck.json)の型と、例文の強調・穴埋めの処理。

export interface Card {
  id: string;
  word: string;
  pos: string;
  level: string;
  meaning_ja: string;
  sentence_en: string;
  sentence_ja: string;
  note_ja: string | null;
  target_form: string;
  image_query: string;
  imageability: 'high' | 'medium' | 'low';
  image: string | null;
  image_credit: { pageURL: string; user: string } | null;
}

export interface Deck {
  version: number;
  cards: Card[];
}

export interface SentencePart {
  text: string;
  target: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 例文を「対象の語」とそれ以外に分ける(単語境界で一致したものだけ対象にする) */
export function splitSentence(sentence: string, targetForm: string): SentencePart[] {
  const re = new RegExp(`\\b${escapeRegExp(targetForm)}\\b`, 'g');
  const parts: SentencePart[] = [];
  let last = 0;
  for (const m of sentence.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push({ text: sentence.slice(last, i), target: false });
    parts.push({ text: m[0], target: true });
    last = i + m[0].length;
  }
  if (last < sentence.length) parts.push({ text: sentence.slice(last), target: false });
  return parts;
}

/** ヒント2の穴埋め: 対象の語を「最初の1文字 + ____」にする */
export function blankSentence(sentence: string, targetForm: string): string {
  const blank = `${targetForm[0]}____`;
  return splitSentence(sentence, targetForm)
    .map((p) => (p.target ? blank : p.text))
    .join('');
}
