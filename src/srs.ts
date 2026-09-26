// 復習(間隔反復)のロジック。IndexedDB や画面に依存しない純粋関数だけを置く。
// 規則は docs/spec/20260926-phase1-prototype/spec.md の D3・D6・P4 に従う。

/** 自己評価。0=言えなかった 1=迷った 2=言えた 3=楽勝 */
export type Rating = 0 | 1 | 2 | 3;

export type CardState = 'new' | 'learning' | 'review';

export interface Progress {
  id: string;
  /** new=4-1 を見ただけ / learning=当日「言えなかった」で再出題待ち / review=次回日が決まった */
  state: CardState;
  /** 次に出す学習日(YYYY-MM-DD) */
  due: string;
  /** 日数 */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  introducedOn: string;
  lastReviewedOn: string | null;
}

export const INITIAL_EASE = 2.5;
export const MIN_EASE = 1.3;
export const DAY_START_HOUR = 4;
/** 「言えなかった」を何枚後に差し込むか(D6) */
export const REQUEUE_GAP = 3;

const EASE_DELTA: Record<Rating, number> = { 0: -0.2, 1: -0.15, 2: 0, 3: 0.15 };

// ---- 学習日 ----

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD に n 日足す(端末の現地時刻で計算) */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d + n));
}

/** 学習日 = 現地時刻から4時間引いた日付 + debugDayOffset(P4・D9) */
export function studyDay(now: Date, debugDayOffset = 0): string {
  const shifted = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours() - DAY_START_HOUR,
    now.getMinutes(),
  );
  return addDays(formatDate(shifted), debugDayOffset);
}

// ---- 評価 ----

/** 4-1 で初めて見たときの記録 */
export function introduce(id: string, today: string): Progress {
  return {
    id,
    state: 'new',
    due: today,
    interval: 0,
    ease: INITIAL_EASE,
    reps: 0,
    lapses: 0,
    introducedOn: today,
    lastReviewedOn: null,
  };
}

function clampEase(ease: number): number {
  // 0.15 刻みの足し引きで出る 2.3499999 のような誤差を丸める
  return Math.max(MIN_EASE, Math.round(ease * 100) / 100);
}

/** 浮動小数の誤差で 20.000001 が 21 にならないように切り上げる */
function ceilDays(x: number): number {
  return Math.ceil(x - 1e-9);
}

export interface RateResult {
  progress: Progress;
  /** true なら当日の出題列に差し込み直す */
  requeue: boolean;
}

export function rate(p: Progress, rating: Rating, today: string): RateResult {
  const base = { ...p, reps: p.reps + 1, lastReviewedOn: today };

  // 当日「言えなかった」あとの再出題。ease はすでに下げてあるので変えない。
  // 言えたら(迷った・楽勝も含む)1日後(D3・D6)。
  if (p.state === 'learning') {
    if (rating === 0) {
      return { progress: { ...base, due: today }, requeue: true };
    }
    return {
      progress: { ...base, state: 'review', interval: 1, due: addDays(today, 1) },
      requeue: false,
    };
  }

  const ease = clampEase(p.ease + EASE_DELTA[rating]);

  if (rating === 0) {
    const lapses = p.state === 'review' ? p.lapses + 1 : p.lapses;
    return {
      progress: { ...base, state: 'learning', interval: 1, ease, lapses, due: today },
      requeue: true,
    };
  }

  let interval: number;
  if (p.state === 'new') {
    interval = rating === 3 ? 4 : 1;
  } else if (rating === 1) {
    interval = Math.max(1, ceilDays(p.interval * 1.2));
  } else {
    // 計算には評価前の ease を使う
    const factor = rating === 3 ? p.ease * 1.3 : p.ease;
    interval = Math.max(p.interval + 1, ceilDays(p.interval * factor));
  }

  return {
    progress: { ...base, state: 'review', interval, ease, due: addDays(today, interval) },
    requeue: false,
  };
}

// ---- 出題列 ----

export type QueueMode = 'learn' | 'recall';

export interface QueueItem {
  id: string;
  /** learn=4-1 新しい単語 / recall=4-2 思い出す */
  mode: QueueMode;
}

export interface QueueLimits {
  newPerDay: number;
  reviewLimit: number;
}

export const DEFAULT_LIMITS: QueueLimits = { newPerDay: 10, reviewLimit: 100 };

export interface TodayPlan {
  queue: QueueItem[];
  reviewCount: number;
  newCount: number;
}

/**
 * 今日の出題列: 復習(上限100)→ 新しい単語(4-1)→ 新しい単語の思い出す(4-2)。
 * 途中でアプリを閉じても、開き直したときに残りから再開できるように progress から毎回作り直す。
 */
export function buildTodayPlan(
  deckIds: string[],
  progress: Map<string, Progress>,
  today: string,
  limits: QueueLimits = DEFAULT_LIMITS,
): TodayPlan {
  const reviews: Progress[] = [];
  const seenToday: string[] = [];
  // 今日の新語枠を使った数: 今日 4-1 を見た語と、以前に 4-1 だけ見て 4-2 が済んでいない語
  let usedNew = 0;

  for (const id of deckIds) {
    const p = progress.get(id);
    if (!p) continue;
    if (p.state === 'new') {
      // 4-1 は見たが 4-2 がまだ
      seenToday.push(id);
      usedNew++;
    } else {
      if (p.introducedOn === today) usedNew++;
      if (p.due <= today) {
        // 期日の来た復習と、当日「言えなかった」で再出題待ちのもの
        reviews.push(p);
      }
    }
  }

  // 当日「言えなかった」(learning)を先頭に置き、上限で削られないようにする。残りは期日の古い順
  const rank = (p: Progress) => (p.state === 'learning' ? 0 : 1);
  reviews.sort((a, b) => rank(a) - rank(b) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const reviewItems = reviews
    .slice(0, limits.reviewLimit)
    .map((p): QueueItem => ({ id: p.id, mode: 'recall' }));

  const freshCount = Math.max(0, limits.newPerDay - usedNew);
  const fresh = deckIds.filter((id) => !progress.has(id)).slice(0, freshCount);

  const queue: QueueItem[] = [
    ...reviewItems,
    ...fresh.map((id): QueueItem => ({ id, mode: 'learn' })),
    ...[...seenToday, ...fresh].map((id): QueueItem => ({ id, mode: 'recall' })),
  ];

  return { queue, reviewCount: reviewItems.length, newCount: fresh.length + seenToday.length };
}

/**
 * 「言えなかった」カードを current の3枚後に差し込む。残りが3枚未満なら最後に置く(D6)。
 * 元の配列は変えずに新しい配列を返す。
 */
export function requeueAfter(queue: QueueItem[], current: number, item: QueueItem): QueueItem[] {
  const remaining = queue.length - (current + 1);
  const at = remaining >= REQUEUE_GAP ? current + 1 + REQUEUE_GAP : queue.length;
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}
