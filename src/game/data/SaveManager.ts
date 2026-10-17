/** IndexedDB 键值存储：存档、设置、统计、排行榜。IndexedDB 不可用时退回 localStorage，再不行则仅保存在内存。 */
const DB_NAME = 'one-line-battle';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(`${DB_NAME}:${key}`);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* localStorage 不可用 */
    }
    return memory.get(key) as T | undefined;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  // 先序列化，去掉响应式代理与不可克隆的数据
  const plain = JSON.parse(JSON.stringify(value));
  memory.set(key, plain);
  const db = await openDb();
  if (!db) {
    try {
      localStorage.setItem(`${DB_NAME}:${key}`, JSON.stringify(plain));
    } catch {
      /* 忽略 */
    }
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(plain, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function dbDelete(key: string): Promise<void> {
  memory.delete(key);
  const db = await openDb();
  if (!db) {
    try {
      localStorage.removeItem(`${DB_NAME}:${key}`);
    } catch {
      /* 忽略 */
    }
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export const SaveKeys = {
  run: 'save:run',
  settings: 'settings',
  stats: 'stats',
  leaderboard: 'leaderboard',
  seen: 'seen',
} as const;
