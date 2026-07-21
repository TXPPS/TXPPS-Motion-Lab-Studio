/**
 * Thin promise wrapper over IndexedDB. Projects and preferences only —
 * demo media is procedural, so no audio blobs are stored (and nothing large
 * ever goes to localStorage).
 */
import { diagLog } from '../state/diagnostics';

export const DB_NAME = 'txpps-motionlab';
export const DB_VERSION = 1;
export const STORE_PROJECTS = 'projects';
export const STORE_PREFS = 'prefs';

export type DbStatus = 'ok' | 'unavailable' | 'error';

let dbPromise: Promise<IDBDatabase> | null = null;
let status: DbStatus = 'unavailable';
let statusDetail = 'not initialized';

export function getDbStatus(): { status: DbStatus; detail: string } {
  return { status, detail: statusDetail };
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      status = 'unavailable';
      statusDetail = 'IndexedDB not available in this browser';
      reject(new Error(statusDetail));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        db.createObjectStore(STORE_PREFS);
      }
    };
    req.onsuccess = () => {
      status = 'ok';
      statusDetail = `open (v${DB_VERSION})`;
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        diagLog('warn', 'IndexedDB closed due to version change in another tab');
      };
      resolve(db);
    };
    req.onerror = () => {
      status = 'error';
      statusDetail = req.error?.message ?? 'open failed';
      diagLog('error', `IndexedDB open failed: ${statusDetail}`);
      reject(req.error ?? new Error('IndexedDB open failed'));
    };
    req.onblocked = () => {
      diagLog('warn', 'IndexedDB open blocked by another tab');
    };
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function idbPut(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const req =
    key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).put(value);
  await requestToPromise(req);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted (storage quota?)'));
  });
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  await requestToPromise(tx.objectStore(store).delete(key));
}

/** For tests. */
export function resetDbConnection(): void {
  dbPromise = null;
  status = 'unavailable';
  statusDetail = 'not initialized';
}
