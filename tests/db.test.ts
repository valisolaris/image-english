import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAllProgress, getMeta, getReviewLog, openDB, putProgress, saveRating, setMeta } from '../src/db';
import { introduce, rate } from '../src/srs';

let n = 0;
let db: IDBDatabase;

beforeEach(async () => {
  // テストごとに別の DB を使って前のテストの影響を受けないようにする
  db = await openDB(`test-${n++}`);
});

describe('IndexedDB 層(D9)', () => {
  it('3つのストアができる', () => {
    expect([...db.objectStoreNames].sort()).toEqual(['meta', 'progress', 'reviewLog']);
  });

  it('progress: 保存 → 読み出しが一致し、上書きもできる', async () => {
    const p = introduce('apple-noun', '2026-09-26');
    await putProgress(db, p);
    expect((await getAllProgress(db)).get('apple-noun')).toEqual(p);

    const next = rate(p, 2, '2026-09-26').progress;
    await putProgress(db, next);
    const all = await getAllProgress(db);
    expect(all.size).toBe(1);
    expect(all.get('apple-noun')).toEqual(next);
  });

  it('saveRating: progress と reviewLog を一緒に保存し、ログは自動採番', async () => {
    const before = introduce('dog-noun', '2026-09-26');
    const after = rate(before, 3, '2026-09-26').progress;
    const log = {
      cardId: 'dog-noun',
      day: '2026-09-26',
      rating: 3 as const,
      intervalBefore: before.interval,
      intervalAfter: after.interval,
      easeBefore: before.ease,
      easeAfter: after.ease,
    };
    await saveRating(db, after, log);
    await saveRating(db, after, { ...log, day: '2026-09-30' });

    expect((await getAllProgress(db)).get('dog-noun')).toEqual(after);
    const logs = await getReviewLog(db);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ ...log, id: 1 });
    expect(logs[1].id).toBe(2);
  });

  it('meta: 未設定なら debugDayOffset は 0、保存した値が読み出せる', async () => {
    expect(await getMeta(db, 'debugDayOffset')).toBe(0);
    await setMeta(db, 'debugDayOffset', 3);
    expect(await getMeta(db, 'debugDayOffset')).toBe(3);
  });

  it('開き直しても残っている', async () => {
    const name = `test-reopen-${n++}`;
    const first = await openDB(name);
    await putProgress(first, introduce('car-noun', '2026-09-26'));
    first.close();
    const second = await openDB(name);
    expect((await getAllProgress(second)).has('car-noun')).toBe(true);
  });
});
