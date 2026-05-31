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
  'elections',
  'contests'
];

const databaseName = 'election-notes';
const databaseVersion = 8;
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

    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (const storeName of storeNames) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      }
      if (!db.objectStoreNames.contains(metadataStoreName)) {
        db.createObjectStore(metadataStoreName, { keyPath: 'key' });
      }

      if (event.oldVersion > 0 && event.oldVersion < 3) {
        migrateLegacyElectionCandidates(request.transaction);
      }
      if (event.oldVersion > 0 && event.oldVersion < 4) {
        migrateIssueDefaultPoints(request.transaction);
      }
      if (event.oldVersion > 0 && event.oldVersion < 5) {
        migrateIssueConfidence(request.transaction);
      }
      if (event.oldVersion > 0 && event.oldVersion < 6) {
        migrateIssueStancesCount(request.transaction);
      }
      if (event.oldVersion > 0 && event.oldVersion < 7) {
        migrateElectionIssueConfidence(request.transaction, event.oldVersion < 8);
      } else if (event.oldVersion > 0 && event.oldVersion < 8) {
        migrateElectionDateUpdated(request.transaction);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another open Election Notes tab.'));
  });
}

function migrateLegacyElectionCandidates(transaction: IDBTransaction | null): void {
  if (!transaction) return;
  const elections = transaction.objectStore('elections');
  const contests = transaction.objectStore('contests');
  const request = elections.openCursor();
  let nextContestId = 1;

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;

    const election = cursor.value as { id: Id; name?: string; candidateIds?: unknown; issues?: unknown };
    const candidateIds = Array.isArray(election.candidateIds)
      ? election.candidateIds.filter((id): id is Id => typeof id === 'number')
      : [];

    if (candidateIds.length > 0) {
      contests.put({
        id: nextContestId++,
        electionId: election.id,
        name: `${election.name || 'Election'} contest`,
        candidateIds
      });
    }

    const { candidateIds: _candidateIds, ...nextElection } = election;
    cursor.update(nextElection);
    cursor.continue();
  };
}

function migrateIssueDefaultPoints(transaction: IDBTransaction | null): void {
  if (!transaction) return;
  const issues = transaction.objectStore('issues');
  const request = issues.openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;

    const { points: _points, ...nextIssue } = cursor.value as Record<string, unknown>;
    cursor.update(nextIssue);
    cursor.continue();
  };
}

function migrateIssueConfidence(transaction: IDBTransaction | null): void {
  if (!transaction) return;
  const issues = transaction.objectStore('issues');
  const request = issues.openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;

    const { confidence: _confidence, ...nextIssue } = cursor.value as Record<string, unknown>;
    cursor.update(nextIssue);
    cursor.continue();
  };
}

function migrateIssueStancesCount(transaction: IDBTransaction | null): void {
  if (!transaction) return;
  const issues = transaction.objectStore('issues');
  const request = issues.openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;

    const { stancesCount: _stancesCount, ...nextIssue } = cursor.value as Record<string, unknown>;
    cursor.update(nextIssue);
    cursor.continue();
  };
}

function migrateElectionIssueConfidence(transaction: IDBTransaction | null, addDateUpdated = false): void {
  if (!transaction) return;
  const elections = transaction.objectStore('elections');
  const request = elections.openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;

    const election = cursor.value as Record<string, unknown>;
    const issues = Array.isArray(election.issues)
      ? election.issues.map((issue) => {
        if (!isRecord(issue)) return issue;
        const { confidence: _confidence, ...nextIssue } = issue;
        return nextIssue;
      })
      : election.issues;
    cursor.update({
      ...election,
      ...(addDateUpdated ? { date_updated: typeof election.date_updated === 'string' ? election.date_updated : null } : {}),
      issues
    });
    cursor.continue();
  };
}

function migrateElectionDateUpdated(transaction: IDBTransaction | null): void {
  if (!transaction) return;
  const elections = transaction.objectStore('elections');
  const request = elections.openCursor();

  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;

    const election = cursor.value as Record<string, unknown>;
    cursor.update({
      ...election,
      date_updated: typeof election.date_updated === 'string' ? election.date_updated : null
    });
    cursor.continue();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
