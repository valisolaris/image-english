// 学習記録の保存先(IndexedDB)。構造は spec D9 に従う。
import type { Progress, Rating } from './srs';

export const DB_NAME = 'image-english';
const DB_VERSION = 1;

export interface ReviewLogEntry {
  id?: number;
  cardId: string;
  day: string;
  rating: Rating;
  intervalBefore: number;
  intervalAfter: number;
  easeBefore: number;
  easeAfter: number;
}

export interface Meta {
  debugDayOffset: number;
}

const META_DEFAULTS: Meta = { debugDayOffset: 0 };

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function openDB(name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('reviewLog')) {
        const log = db.createObjectStore('reviewLog', { keyPath: 'id', autoIncrement: true });
        log.createIndex('cardId', 'cardId');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllProgress(db: IDBDatabase): Promise<Map<string, Progress>> {
  const tx = db.transaction('progress', 'readonly');
  const all = await promisify(tx.objectStore('progress').getAll() as IDBRequest<Progress[]>);
  return new Map(all.map((p) => [p.id, p]));
}

export async function putProgress(db: IDBDatabase, p: Progress): Promise<void> {
  const tx = db.transaction('progress', 'readwrite');
  tx.objectStore('progress').put(p);
  await done(tx);
}

/** 評価の結果と記録を1つのトランザクションで保存する(片方だけ残らないように) */
export async function saveRating(db: IDBDatabase, p: Progress, log: ReviewLogEntry): Promise<void> {
  const tx = db.transaction(['progress', 'reviewLog'], 'readwrite');
  tx.objectStore('progress').put(p);
  tx.objectStore('reviewLog').add(log);
  await done(tx);
}

export async function getReviewLog(db: IDBDatabase): Promise<ReviewLogEntry[]> {
  const tx = db.transaction('reviewLog', 'readonly');
  return promisify(tx.objectStore('reviewLog').getAll() as IDBRequest<ReviewLogEntry[]>);
}

export async function getMeta<K extends keyof Meta>(db: IDBDatabase, key: K): Promise<Meta[K]> {
  const tx = db.transaction('meta', 'readonly');
  const v = await promisify(tx.objectStore('meta').get(key) as IDBRequest<Meta[K] | undefined>);
  return v ?? META_DEFAULTS[key];
}

export async function setMeta<K extends keyof Meta>(db: IDBDatabase, key: K, value: Meta[K]): Promise<void> {
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(value, key);
  await done(tx);
}
