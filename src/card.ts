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

/**
 * 対象の語を探す正規表現。前後が英数字に続いていないものだけ一致させる。
 * \b だと "a.m." (記号で終わる)や "I'm" の "'m" (記号で始まる)を見つけられないため、
 * 語の端が英数字のときだけ、その側に境界を求める。scripts/build-deck.mjs の検査も同じ規則。
 * 左側は後読み (?<!...) を使わず、1つ目のグループで「文頭か英数字以外の1文字」を受け取る
 * (後読みは iOS 16.4 より前の Safari で動かないため)。対象の語そのものは2つ目のグループ。
 */
export function targetPattern(targetForm: string): RegExp {
  const left = /^[A-Za-z0-9]/.test(targetForm) ? '(^|[^A-Za-z0-9])' : '()';
  const right = /[A-Za-z0-9]$/.test(targetForm) ? '(?![A-Za-z0-9])' : '';
  return new RegExp(`${left}(${escapeRegExp(targetForm)})${right}`, 'g');
}

/** 例文を「対象の語」とそれ以外に分ける(単語境界で一致したものだけ対象にする) */
export function splitSentence(sentence: string, targetForm: string): SentencePart[] {
  const re = targetPattern(targetForm);
  const parts: SentencePart[] = [];
  let last = 0;
  for (const m of sentence.matchAll(re)) {
    const i = (m.index ?? 0) + m[1].length;
    if (i > last) parts.push({ text: sentence.slice(last, i), target: false });
    parts.push({ text: m[2], target: true });
    last = i + m[2].length;
  }
  if (last < sentence.length) parts.push({ text: sentence.slice(last), target: false });
  return parts;
}

/**
 * ヒント2の穴埋め: 対象の語を「最初の1文字 + ____」にする。
 * "'m" のように記号で始まる語(短縮形)は、記号だけ残して文字は見せない(I'____)。
 */
export function blankSentence(sentence: string, targetForm: string): string {
  const prefix = /^[^A-Za-z0-9]+/.exec(targetForm)?.[0] ?? targetForm[0];
  const blank = `${prefix}____`;
  return splitSentence(sentence, targetForm)
    .map((p) => (p.target ? blank : p.text))
    .join('');
}
