import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedData } from '../seed';
import type { Database } from '../types';
import {
  deleteRecord,
  isDatabaseInitialized,
  loadAllStores,
  markDatabaseInitialized,
  openDatabase,
  putRecord,
  replaceAllStores,
  storeNames
} from '../repositories/indexedDb';
import { exportBackup } from '../repositories/backup';
import { createBackupJson, loadDatabase, resetDatabase, saveEntity, deleteEntity } from './database';

const databaseName = 'election-notes';
const legacyStorageKey = 'election-notes-db-v1';

function emptyDatabase(): Database {
  return {
    candidates: [],
    issues: [],
    stances: [],
    facts: [],
    stanceFacts: [],
    firstRecords: [],
    elections: []
  };
}

function cloneDatabase(data: Database): Database {
  return structuredClone(data);
}

function sortRowsById<T extends { id: number }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id - right.id);
}

function idSortedDatabase(data: Database): Database {
  return {
    candidates: sortRowsById(data.candidates),
    issues: sortRowsById(data.issues),
    stances: sortRowsById(data.stances),
    facts: sortRowsById(data.facts),
    stanceFacts: sortRowsById(data.stanceFacts),
    firstRecords: sortRowsById(data.firstRecords),
    elections: sortRowsById(data.elections)
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Test database deletion was blocked.'));
  });
}

function createLocalStorage(): Storage {
  let entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => {
      entries = new Map();
    },
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    }
  };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', createLocalStorage());
  localStorage.clear();
  await deleteDatabase();
});

describe.sequential('IndexedDB repository data operations', () => {
  it('creates the expected database version, object stores, and uninitialized metadata state', async () => {
    const db = await openDatabase();
    try {
      expect(db.name).toBe(databaseName);
      expect(db.version).toBe(2);
      expect(Array.from(db.objectStoreNames).sort()).toEqual([...storeNames, 'metadata'].sort());
    } finally {
      db.close();
    }

    expect(await isDatabaseInitialized()).toBe(false);
    await markDatabaseInitialized();
    expect(await isDatabaseInitialized()).toBe(true);
  });

  it('replaces and loads every application store while marking the database initialized', async () => {
    const data = cloneDatabase(seedData);

    await replaceAllStores(data);

    expect(await loadAllStores()).toEqual(idSortedDatabase(data));
    expect(await isDatabaseInitialized()).toBe(true);
  });

  it('saves and deletes individual records without changing unrelated stores', async () => {
    const data = emptyDatabase();
    data.issues.push({ id: 1, name: 'Taxes', description: null, points: 10, confidence: 80, stancesCount: 0 });
    await replaceAllStores(data);

    const candidate = {
      id: 7,
      firstName: 'Ada',
      middleName: null,
      lastName: 'Example',
      score: null,
      confidence: null,
      stancesCount: null,
      confidenceScoreProduct: null
    };

    await putRecord('candidates', candidate);
    expect(await loadAllStores()).toEqual({ ...data, candidates: [candidate] });

    const updated = { ...candidate, score: 42 };
    await putRecord('candidates', updated);
    expect((await loadAllStores()).candidates).toEqual([updated]);

    await deleteRecord('candidates', candidate.id);
    expect(await loadAllStores()).toEqual(data);
  });
});

describe.sequential('database service data operations', () => {
  it('loads seed data on first run when IndexedDB and legacy storage are empty', async () => {
    const loaded = await loadDatabase();

    expect(loaded).toEqual(seedData);
    expect(await loadAllStores()).toEqual(idSortedDatabase(seedData));
    expect(await isDatabaseInitialized()).toBe(true);
  });

  it('migrates legacy localStorage data on first run and removes the legacy key', async () => {
    const legacy = emptyDatabase();
    legacy.candidates.push({
      id: 101,
      firstName: 'Legacy',
      middleName: null,
      lastName: 'Candidate',
      score: 9,
      confidence: 8,
      stancesCount: 1,
      confidenceScoreProduct: 72
    });
    localStorage.setItem(legacyStorageKey, JSON.stringify(legacy));

    const loaded = await loadDatabase();

    expect(loaded).toEqual(legacy);
    expect(await loadAllStores()).toEqual(legacy);
    expect(localStorage.getItem(legacyStorageKey)).toBeNull();
    expect(await isDatabaseInitialized()).toBe(true);
  });

  it('preserves an intentionally empty initialized database', async () => {
    const empty = emptyDatabase();
    await replaceAllStores(empty);

    const loaded = await loadDatabase();

    expect(loaded).toEqual(empty);
    expect(await loadAllStores()).toEqual(empty);
  });

  it('marks existing non-empty IndexedDB data as initialized without seeding over it', async () => {
    const existing = emptyDatabase();
    existing.facts.push({ id: 5, date_created: null, date_updated: null, Summary: 'Existing', description: null });
    await putRecord('facts', existing.facts[0]);

    const loaded = await loadDatabase();

    expect(loaded).toEqual(existing);
    expect(await isDatabaseInitialized()).toBe(true);
  });

  it('saves records, deletes records, resets to seed data, and clears legacy storage', async () => {
    await replaceAllStores(emptyDatabase());

    const election = {
      id: 10,
      name: 'Special election',
      date: '2026-06-01',
      description: null,
      candidateIds: [],
      issues: []
    };
    await saveEntity('elections', election);
    expect((await loadAllStores()).elections).toEqual([election]);

    await deleteEntity('elections', election.id);
    expect((await loadAllStores()).elections).toEqual([]);

    localStorage.setItem(legacyStorageKey, JSON.stringify(emptyDatabase()));
    const reset = await resetDatabase();
    expect(reset).toEqual(seedData);
    expect(await loadAllStores()).toEqual(idSortedDatabase(seedData));
    expect(localStorage.getItem(legacyStorageKey)).toBeNull();
  });

  it('exports backup data as repository data and formatted service JSON', async () => {
    const data = emptyDatabase();
    data.firstRecords.push({
      id: 1,
      status: 'published',
      sort: 1,
      user_created: null,
      date_created: null,
      user_updated: null,
      date_updated: null,
      name: 'First'
    });
    await replaceAllStores(data);

    expect(await exportBackup()).toEqual(data);
    expect(JSON.parse(await createBackupJson())).toEqual(data);
    expect(await createBackupJson()).toBe(JSON.stringify(data, null, 2));
  });
});
