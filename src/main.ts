import './style.css';
import { blankSentence, splitSentence, type Card, type Deck } from './card';
import { getAllProgress, getMeta, openDB, putProgress, saveRating, setMeta } from './db';
import { speak, stopSpeaking } from './speech';
import {
  buildTodayPlan,
  introduce,
  rate,
  requeueAfter,
  studyDay,
  type Progress,
  type QueueItem,
  type Rating,
} from './srs';

// フェーズ1は設定画面を作らないので固定値(spec D2)
const AUTO_SPEAK = true;

const RATINGS: { rating: Rating; label: string; cls: string }[] = [
  { rating: 0, label: '言えなかった', cls: 'r0' },
  { rating: 1, label: '迷った', cls: 'r1' },
  { rating: 2, label: '言えた', cls: 'r2' },
  { rating: 3, label: '楽勝', cls: 'r3' },
];

const BASE = import.meta.env.BASE_URL;
const app = document.querySelector<HTMLDivElement>('#app')!;

let db: IDBDatabase;
let deck: Card[] = [];
let cardById = new Map<string, Card>();
let progress = new Map<string, Progress>();
let dayOffset = 0;

// 学習中の状態
let queue: QueueItem[] = [];
let pos = 0;
// 「始める」を押したときの学習日。4時をまたいで続けても、その回の記録はこの日付で残す
let sessionDay = '';

// ---- 小さな DOM ヘルパー ----

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

function screen(...children: Child[]): void {
  app.replaceChildren(...children.filter((c): c is Node | string => !!c));
  window.scrollTo(0, 0);
}

function today(): string {
  return studyDay(new Date(), dayOffset);
}

// ---- 部品 ----

function imageBox(card: Card): HTMLElement {
  if (!card.image) return h('div', { class: 'image image-none' }, '(画像なし)');
  return h(
    'figure',
    { class: 'image' },
    h('img', { src: `${BASE}images/${card.image}`, alt: '' }),
    card.image_credit &&
      h(
        'figcaption',
        {},
        'Image: ',
        h('a', { href: card.image_credit.pageURL, target: '_blank', rel: 'noopener' }, card.image_credit.user),
        ' / Pixabay',
      ),
  );
}

function sentence(card: Card): HTMLElement {
  const p = h('p', { class: 'sentence', lang: 'en' });
  for (const part of splitSentence(card.sentence_en, card.target_form)) {
    p.append(part.target ? h('mark', {}, part.text) : part.text);
  }
  return p;
}

function speakButton(label: string, text: string): HTMLButtonElement {
  return button(`🔊 ${label}`, () => speak(text), 'speak');
}

function progressLabel(): HTMLElement {
  return h('div', { class: 'counter' }, `${pos + 1} / ${queue.length}`);
}

function actionBar(...buttons: HTMLElement[]): HTMLElement {
  return h('div', { class: 'actions' }, ...buttons);
}

// ---- ホーム ----

function renderHome(): void {
  stopSpeaking();
  const day = today();
  const plan = buildTodayPlan(
    deck.map((c) => c.id),
    progress,
    day,
  );
  const devSlot = h('div', {});

  screen(
    h(
      'main',
      { class: 'home' },
      h('h1', {}, 'Image English'),
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'num' }, String(plan.reviewCount)), '今日の復習'),
        h('div', { class: 'stat' }, h('span', { class: 'num' }, String(plan.newCount)), '新しい単語'),
      ),
      plan.queue.length === 0 && h('p', { class: 'done-msg' }, '今日の学習は終わりました。また明日!'),
      devSlot,
    ),
    plan.queue.length > 0 &&
      actionBar(
        button(
          '始める',
          () => {
            queue = plan.queue;
            pos = 0;
            sessionDay = day;
            renderCurrent();
          },
          'primary',
        ),
      ),
  );

  // 開発時だけ「日付を1日進める」を出す。本番ビルドではこのブロックごと消える(T9)
  if (import.meta.env.DEV) {
    void import('./dev').then(({ devPanel }) => {
      devSlot.replaceChildren(
        devPanel(day, dayOffset, async () => {
          dayOffset += 1;
          await setMeta(db, 'debugDayOffset', dayOffset);
          renderHome();
        }),
      );
    });
  }
}

// ---- 学習の進行 ----

function renderCurrent(): void {
  const item = queue[pos];
  if (!item) {
    renderFinished();
    return;
  }
  const card = cardById.get(item.id)!;
  if (item.mode === 'learn') renderLearn(card);
  else renderRecall(card);
}

function next(): void {
  pos += 1;
  renderCurrent();
}

/** 保存の失敗は画面を止めずに知らせる */
function persist(p: Promise<void>): void {
  p.catch((e) => {
    console.error(e);
    alert('学習記録の保存に失敗しました。');
  });
}

// ---- 4-1 新しい単語 ----

function renderLearn(card: Card): void {
  screen(
    progressLabel(),
    h(
      'main',
      { class: 'card learn' },
      h('div', { class: 'badge' }, '新しい単語'),
      imageBox(card),
      h('div', { class: 'word-row' }, h('h2', { class: 'word', lang: 'en' }, card.word), speakButton('単語', card.word)),
      h('div', { class: 'sentence-row' }, sentence(card), speakButton('例文', card.sentence_en)),
      h(
        'details',
        { class: 'notes', open: true },
        h('summary', {}, '日本語の意味・解説'),
        h('p', { class: 'meaning' }, card.meaning_ja),
        h('p', {}, card.sentence_ja),
        card.note_ja && h('p', { class: 'note' }, card.note_ja),
      ),
      h('p', { class: 'prompt' }, '声に出して言ってみよう'),
    ),
    actionBar(
      button(
        '次へ',
        () => {
          if (!progress.has(card.id)) {
            const p = introduce(card.id, sessionDay);
            progress.set(card.id, p);
            persist(putProgress(db, p));
          }
          next();
        },
        'primary',
      ),
    ),
  );
  if (AUTO_SPEAK) speak(card.word, card.sentence_en);
}

// ---- 4-2 思い出す ----

function renderRecall(card: Card): void {
  const hasImage = !!card.image;
  const hintArea = h('div', { class: 'hints' });
  const answerArea = h('div', { class: 'answer' });
  const bottom = h('div', { class: 'actions' });

  // 画像のないカードは、日本語の意味と穴埋め例文そのものを問題にする(SPEC 4-2 の5)
  const question = hasImage
    ? imageBox(card)
    : h(
        'div',
        { class: 'no-image-question' },
        h('p', { class: 'meaning' }, card.meaning_ja),
        h('p', { class: 'sentence', lang: 'en' }, blankSentence(card.sentence_en, card.target_form)),
      );

  let hintLevel = 0;
  const hint1 = () => h('p', { class: 'hint' }, 'ヒント1: ', card.meaning_ja);
  const hint2 = () =>
    h('p', { class: 'hint', lang: 'en' }, 'ヒント2: ', blankSentence(card.sentence_en, card.target_form));
  const hintButton = button('ヒント', () => {
    hintLevel += 1;
    hintArea.append(hintLevel === 1 ? hint1() : hint2());
    if (hintLevel >= 2) hintButton.remove();
  });

  const showAnswer = () => {
    hintButton.remove();
    answerArea.replaceChildren(
      h('div', { class: 'word-row' }, h('h2', { class: 'word', lang: 'en' }, card.word), speakButton('単語', card.word)),
      h('div', { class: 'sentence-row' }, sentence(card), speakButton('例文', card.sentence_en)),
      h('p', { class: 'meaning small' }, `${card.meaning_ja} / ${card.sentence_ja}`),
    );
    bottom.replaceChildren(
      h(
        'div',
        { class: 'ratings' },
        ...RATINGS.map((r) => button(r.label, () => onRate(card, r.rating), `rating ${r.cls}`)),
      ),
    );
    speak(card.word, card.sentence_en);
  };

  bottom.append(...(hasImage ? [hintButton] : []), button('答えを見る', showAnswer, 'primary'));

  screen(
    progressLabel(),
    h(
      'main',
      { class: 'card recall' },
      h('div', { class: 'badge' }, '思い出す'),
      question,
      h('p', { class: 'prompt' }, '英語で言ってみよう'),
      hintArea,
      answerArea,
    ),
    bottom,
  );
}

function onRate(card: Card, rating: Rating): void {
  const day = sessionDay;
  const before = progress.get(card.id) ?? introduce(card.id, day);
  const { progress: after, requeue } = rate(before, rating, day);
  progress.set(card.id, after);
  persist(
    saveRating(db, after, {
      cardId: card.id,
      day,
      rating,
      intervalBefore: before.interval,
      intervalAfter: after.interval,
      easeBefore: before.ease,
      easeAfter: after.ease,
    }),
  );
  if (requeue) queue = requeueAfter(queue, pos, { id: card.id, mode: 'recall' });
  // 読み上げがタップ操作の中で始まるように、次の画面は同期的に描く
  next();
}

// ---- 終了 ----

function renderFinished(): void {
  stopSpeaking();
  screen(
    h('main', { class: 'home' }, h('h1', {}, 'おつかれさま!'), h('p', { class: 'done-msg' }, '今日の分が終わりました。')),
    actionBar(button('ホームへ', renderHome, 'primary')),
  );
}

// ---- 起動 ----

async function start(): Promise<void> {
  try {
    const res = await fetch(`${BASE}data/deck.json`);
    if (!res.ok) throw new Error(`deck.json を読み込めません(HTTP ${res.status})`);
    const data = (await res.json()) as Deck;
    deck = data.cards;
    cardById = new Map(deck.map((c) => [c.id, c]));
    db = await openDB();
    progress = await getAllProgress(db);
    dayOffset = import.meta.env.DEV ? await getMeta(db, 'debugDayOffset') : 0;
    renderHome();
  } catch (e) {
    console.error(e);
    screen(h('main', { class: 'home' }, h('p', { class: 'error' }, `読み込みに失敗しました: ${String(e)}`)));
  }
}

void start();
