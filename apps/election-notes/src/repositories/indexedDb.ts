import { seedData } from '../seed';
import type { Database, Id } from '../types';

export type StoreName = keyof Database;

export const storeNames: StoreName[] = [
  'candidates',
  'issues',
  'stances',
  'facts',
  'stanceFacts',
  'firstRecords',
  'elections'
];

const databaseName = 'election-notes';
const databaseVersion = 2;
const metadataStoreName = 'metadata';
const legacyStorageKey = 'election-notes-db-v1';
const initializedKey = 'initialized';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of storeNames) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      }
      if (!db.objectStoreNames.contains(metadataStoreName)) {
        db.createObjectStore(metadataStoreName, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another open Election Notes tab.'));
  });
}

export async function loadAllStores(): Promise<Database> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(storeNames, 'readonly');
    const complete = transactionComplete(transaction);
    const stores = await Promise.all(
      storeNames.map(async (storeName) => [
        storeName,
        await requestToPromise(transaction.objectStore(storeName).getAll())
      ] as const)
    );
    await complete;
    return Object.fromEntries(stores) as Database;
  } finally {
    db.close();
  }
}

export async function replaceAllStores(data: Database): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction([...storeNames, metadataStoreName], 'readwrite');
    const complete = transactionComplete(transaction);
    for (const storeName of storeNames) {
      const store = transaction.objectStore(storeName);
      store.clear();
      for (const row of data[storeName]) {
        store.put(row);
      }
    }
    transaction.objectStore(metadataStoreName).put({ key: initializedKey, value: true });
    await complete;
  } finally {
    db.close();
  }
}

export async function putRecord<TStore extends StoreName>(storeName: TStore, row: Database[TStore][number]): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(storeName, 'readwrite');
    const complete = transactionComplete(transaction);
    transaction.objectStore(storeName).put(row);
    await complete;
  } finally {
    db.close();
  }
}

export async function deleteRecord(storeName: StoreName, id: Id): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(storeName, 'readwrite');
    const complete = transactionComplete(transaction);
    transaction.objectStore(storeName).delete(id);
    await complete;
  } finally {
    db.close();
  }
}

export function readLegacyLocalStorage(): Database | null {
  const saved = localStorage.getItem(legacyStorageKey);
  if (!saved) return null;
  return JSON.parse(saved) as Database;
}

export function removeLegacyLocalStorage(): void {
  localStorage.removeItem(legacyStorageKey);
}

export function hasRecords(data: Database): boolean {
  return storeNames.some((storeName) => data[storeName].length > 0);
}

export function hasSeedData(): boolean {
  return storeNames.every((storeName) => Array.isArray(seedData[storeName]));
}

export function cloneSeedData(): Database {
  return structuredClone(seedData);
}

export async function isDatabaseInitialized(): Promise<boolean> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(metadataStoreName, 'readonly');
    const complete = transactionComplete(transaction);
    const row = await requestToPromise<{ key: string; value: boolean } | undefined>(
      transaction.objectStore(metadataStoreName).get(initializedKey)
    );
    await complete;
    return row?.value === true;
  } finally {
    db.close();
  }
}

export async function markDatabaseInitialized(): Promise<void> {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(metadataStoreName, 'readwrite');
    const complete = transactionComplete(transaction);
    transaction.objectStore(metadataStoreName).put({ key: initializedKey, value: true });
    await complete;
  } finally {
    db.close();
  }
}
