import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'fundflow-db';
const DB_VERSION = 1;

export interface QueueItem {
  id: string; // client-generated UUID
  type: 'disburse_to_worker' | 'transfer_to_supervisor' | 'log_expense' | 'confirm_transaction' | 'dispute_transaction' | 'create_worker' | 'update_worker';
  payload: any;
  createdAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof window === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sync-queue')) {
          db.createObjectStore('sync-queue', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache');
        }
      },
    });
  }
  return dbPromise;
}

// Sync Queue Operations
export async function getSyncQueue(): Promise<QueueItem[]> {
  const db = await getDB();
  if (!db) return [];
  const tx = db.transaction('sync-queue', 'readonly');
  const store = tx.objectStore('sync-queue');
  const items = await store.getAll();
  return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function addToSyncQueue(item: Omit<QueueItem, 'createdAt'>): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction('sync-queue', 'readwrite');
  const store = tx.objectStore('sync-queue');
  await store.put({
    ...item,
    createdAt: new Date().toISOString(),
  });
  await tx.done;
}

export async function removeFromSyncQueue(id: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction('sync-queue', 'readwrite');
  const store = tx.objectStore('sync-queue');
  await store.delete(id);
  await tx.done;
}

export async function clearSyncQueue(): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction('sync-queue', 'readwrite');
  const store = tx.objectStore('sync-queue');
  await store.clear();
  await tx.done;
}

// Cache Operations for Offline Reading (Bypassed - Caching disabled per requirements)
export async function setOfflineCache<T>(_key: string, _data: T): Promise<void> {
  // Caching disabled to guarantee fresh online data fetches
  return;
}

export async function getOfflineCache<T>(_key: string): Promise<T | null> {
  // Caching disabled to guarantee fresh online data fetches
  return null;
}
