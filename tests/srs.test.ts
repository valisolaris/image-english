import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildTodayPlan,
  introduce,
  rate,
  requeueAfter,
  studyDay,
  type Progress,
  type QueueItem,
} from '../src/srs';

const TODAY = '2026-09-26';

function reviewCard(interval: number, ease = 2.5): Progress {
  return { ...introduce('x-noun', '2026-09-01'), state: 'review', interval, ease, due: TODAY, reps: 3 };
}

describe('学習日(4時区切り・P4)', () => {
  it('3:59 は前日、4:00 は当日', () => {
    expect(studyDay(new Date(2026, 8, 26, 3, 59))).toBe('2026-09-25');
    expect(studyDay(new Date(2026, 8, 26, 4, 0))).toBe('2026-09-26');
    expect(studyDay(new Date(2026, 8, 26, 23, 59))).toBe('2026-09-26');
  });

  it('月をまたぐ深夜は前月末日', () => {
    expect(studyDay(new Date(2026, 9, 1, 2, 0))).toBe('2026-09-30');
  });

  it('debugDayOffset の分だけ進む', () => {
    expect(studyDay(new Date(2026, 8, 26, 10, 0), 1)).toBe('2026-09-27');
    expect(studyDay(new Date(2026, 8, 26, 3, 0), 2)).toBe('2026-09-27');
  });

  it('addDays は年またぎも扱う', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('D3: 新しい単語(初回)', () => {
  const p = introduce('apple-noun', TODAY);

  it('言えなかった → 当日もう一度、ease −0.20', () => {
    const r = rate(p, 0, TODAY);
    expect(r.requeue).toBe(true);
    expect(r.progress).toMatchObject({ state: 'learning', due: TODAY, ease: 2.3, lapses: 0 });
  });

  it('迷った → 1日後、ease −0.15', () => {
    const r = rate(p, 1, TODAY);
    expect(r.requeue).toBe(false);
    expect(r.progress).toMatchObject({ state: 'review', interval: 1, due: '2026-09-27', ease: 2.35 });
  });

  it('言えた → 1日後、ease ±0', () => {
    expect(rate(p, 2, TODAY).progress).toMatchObject({ interval: 1, due: '2026-09-27', ease: 2.5 });
  });

  it('楽勝 → 4日後、ease +0.15', () => {
    expect(rate(p, 3, TODAY).progress).toMatchObject({ interval: 4, due: '2026-09-30', ease: 2.65 });
  });

  it('言えなかったあと、次に言えたら1日後', () => {
    const failed = rate(p, 0, TODAY).progress;
    const r = rate(failed, 2, TODAY);
    expect(r.requeue).toBe(false);
    expect(r.progress).toMatchObject({ state: 'review', interval: 1, due: '2026-09-27', ease: 2.3 });
  });

  it('再出題で楽勝でも新しい単語は1日後(D6)', () => {
    const failed = rate(p, 0, TODAY).progress;
    expect(rate(failed, 3, TODAY).progress).toMatchObject({ interval: 1, due: '2026-09-27' });
  });

  it('再出題でまた言えなかったら、もう一度差し込む(ease はさらに下げない)', () => {
    const failed = rate(p, 0, TODAY).progress;
    const r = rate(failed, 0, TODAY);
    expect(r.requeue).toBe(true);
    expect(r.progress).toMatchObject({ state: 'learning', due: TODAY, ease: 2.3 });
  });
});

describe('D3: 復習中の単語', () => {
  it('言えなかった → 当日もう一度、間隔1日にリセット、ease −0.20、lapses +1', () => {
    const r = rate(reviewCard(10), 0, TODAY);
    expect(r.requeue).toBe(true);
    expect(r.progress).toMatchObject({ state: 'learning', interval: 1, ease: 2.3, lapses: 1, due: TODAY });
    // 再出題で言えたら1日後
    expect(rate(r.progress, 2, TODAY).progress).toMatchObject({ interval: 1, due: '2026-09-27' });
  });

  it('迷った → 間隔 × 1.2(切り上げ)、ease −0.15', () => {
    expect(rate(reviewCard(10), 1, TODAY).progress).toMatchObject({ interval: 12, ease: 2.35, due: '2026-10-08' });
    expect(rate(reviewCard(1), 1, TODAY).progress).toMatchObject({ interval: 2 });
  });

  it('言えた → 間隔 × ease、ease ±0', () => {
    expect(rate(reviewCard(10), 2, TODAY).progress).toMatchObject({ interval: 25, ease: 2.5 });
  });

  it('楽勝 → 間隔 × ease × 1.3(切り上げ)、ease +0.15', () => {
    expect(rate(reviewCard(10), 3, TODAY).progress).toMatchObject({ interval: 33, ease: 2.65 });
  });

  it('ease の下限は 1.3', () => {
    let p = reviewCard(5, 1.4);
    p = rate(p, 0, TODAY).progress;
    expect(p.ease).toBe(1.3);
    p = rate({ ...p, state: 'review' }, 1, TODAY).progress;
    expect(p.ease).toBe(1.3);
  });

  it('ease が下限でも「言えた」は前回より最低1日伸びる', () => {
    expect(rate(reviewCard(1, 1.3), 2, TODAY).progress.interval).toBe(2);
    expect(rate(reviewCard(2, 1.3), 2, TODAY).progress.interval).toBe(3);
  });

  it('「言えた」連続で 1→3→8→20→50 日', () => {
    let p = introduce('apple-noun', TODAY);
    let day = TODAY;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      p = rate(p, 2, day).progress;
      intervals.push(p.interval);
      day = p.due;
    }
    expect(intervals).toEqual([1, 3, 8, 20, 50]);
  });
});

describe('D6: 「言えなかった」の差し込み', () => {
  const q = (ids: string[]): QueueItem[] => ids.map((id) => ({ id, mode: 'recall' }));
  const failed: QueueItem = { id: 'X', mode: 'recall' };

  it('3枚後に差し込む', () => {
    const out = requeueAfter(q(['A', 'B', 'C', 'D', 'E', 'F']), 0, failed);
    expect(out.map((i) => i.id)).toEqual(['A', 'B', 'C', 'D', 'X', 'E', 'F']);
  });

  it('残りがちょうど3枚なら最後', () => {
    const out = requeueAfter(q(['A', 'B', 'C', 'D']), 0, failed);
    expect(out.map((i) => i.id)).toEqual(['A', 'B', 'C', 'D', 'X']);
  });

  it('残りが3枚未満なら最後', () => {
    expect(requeueAfter(q(['A', 'B', 'C']), 1, failed).map((i) => i.id)).toEqual(['A', 'B', 'C', 'X']);
    expect(requeueAfter(q(['A']), 0, failed).map((i) => i.id)).toEqual(['A', 'X']);
  });

  it('元の配列は変えない', () => {
    const orig = q(['A', 'B']);
    requeueAfter(orig, 0, failed);
    expect(orig).toHaveLength(2);
  });
});

describe('今日の出題列', () => {
  const deck = Array.from({ length: 20 }, (_, i) => `w${i}-noun`);

  it('初日: 新しい単語10語の 4-1 → 同じ10語の 4-2', () => {
    const plan = buildTodayPlan(deck, new Map(), TODAY);
    expect(plan.reviewCount).toBe(0);
    expect(plan.newCount).toBe(10);
    expect(plan.queue).toHaveLength(20);
    expect(plan.queue.slice(0, 10).every((i) => i.mode === 'learn')).toBe(true);
    expect(plan.queue.slice(10).map((i) => i.id)).toEqual(deck.slice(0, 10));
    expect(plan.queue.slice(10).every((i) => i.mode === 'recall')).toBe(true);
  });

  it('復習が先、上限100で切る', () => {
    const big = Array.from({ length: 130 }, (_, i) => `r${i}-noun`);
    const progress = new Map<string, Progress>();
    for (const id of big.slice(0, 120)) {
      progress.set(id, { ...reviewCard(3), id, due: '2026-09-20' });
    }
    const plan = buildTodayPlan(big, progress, TODAY);
    expect(plan.reviewCount).toBe(100);
    expect(plan.queue.slice(0, 100).every((i) => i.mode === 'recall' && i.id.startsWith('r'))).toBe(true);
    expect(plan.queue[100]).toEqual({ id: 'r120-noun', mode: 'learn' });
  });

  it('上限で切るとき、当日「言えなかった」カードは削らない', () => {
    const big = Array.from({ length: 101 }, (_, i) => `r${i}-noun`);
    const progress = new Map<string, Progress>();
    for (const id of big.slice(0, 100)) progress.set(id, { ...reviewCard(3), id, due: '2026-09-20' });
    const failed = rate({ ...reviewCard(3), id: 'r100-noun' }, 0, TODAY).progress;
    progress.set('r100-noun', failed);
    const plan = buildTodayPlan(big, progress, TODAY);
    expect(plan.reviewCount).toBe(100);
    expect(plan.queue[0]).toEqual({ id: 'r100-noun', mode: 'recall' });
  });

  it('前日に 4-1 だけ見た語も新語枠に数え、合計10語を超えない', () => {
    const progress = new Map<string, Progress>();
    for (const id of deck.slice(0, 3)) progress.set(id, introduce(id, '2026-09-25'));
    const plan = buildTodayPlan(deck, progress, TODAY);
    expect(plan.newCount).toBe(10);
    expect(plan.queue.filter((i) => i.mode === 'learn')).toHaveLength(7);
    expect(plan.queue.filter((i) => i.mode === 'recall')).toHaveLength(10);
  });

  it('期日前の復習は出さない', () => {
    const progress = new Map([['w0-noun', { ...reviewCard(3), id: 'w0-noun', due: '2026-09-27' }]]);
    const plan = buildTodayPlan(deck, progress, TODAY);
    expect(plan.reviewCount).toBe(0);
  });

  it('途中で閉じても再開できる: 4-1 を見た語は 4-2 だけ、新語は合計10語まで', () => {
    const progress = new Map<string, Progress>();
    for (const id of deck.slice(0, 4)) progress.set(id, introduce(id, TODAY));
    const plan = buildTodayPlan(deck, progress, TODAY);
    expect(plan.newCount).toBe(10);
    const learn = plan.queue.filter((i) => i.mode === 'learn').map((i) => i.id);
    expect(learn).toEqual(deck.slice(4, 10));
    const recall = plan.queue.filter((i) => i.mode === 'recall').map((i) => i.id);
    expect(recall).toEqual(deck.slice(0, 10));
  });

  it('翌日: 前日に学んだ語が復習に出て、新しい単語は次の10語', () => {
    const progress = new Map<string, Progress>();
    for (const id of deck.slice(0, 10)) {
      progress.set(id, rate(introduce(id, TODAY), 2, TODAY).progress);
    }
    const tomorrow = addDays(TODAY, 1);
    const plan = buildTodayPlan(deck, progress, tomorrow);
    expect(plan.reviewCount).toBe(10);
    expect(plan.newCount).toBe(10);
    expect(plan.queue.filter((i) => i.mode === 'learn').map((i) => i.id)).toEqual(deck.slice(10, 20));
    // 当日のうちは復習にも新語にも出ない
    expect(buildTodayPlan(deck, progress, TODAY).queue).toHaveLength(0);
  });
});
