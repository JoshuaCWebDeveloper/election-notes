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
import { canRestoreSeedData, createBackupJson, loadDatabase, resetDatabase, restoreDatabaseFromJson, restoreDatabaseFromSeed, saveEntity, deleteEntity, validateDatabase } from './database';
import { candidateFromInlineName, duplicateElection, issueFromInlineName } from './elections';
import { getCandidateContestRows, getReportPanelData, reportDashboards, scoreElection } from './reports';

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

    expect(loaded).toEqual(idSortedDatabase(seedData));
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
    expect(reset).toEqual(idSortedDatabase(seedData));
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

  it('validates full backup shape before restoring from JSON', async () => {
    const data = emptyDatabase();
    data.candidates.push({
      id: 11,
      firstName: 'Import',
      middleName: null,
      lastName: 'Candidate',
      score: null,
      confidence: null,
      stancesCount: null,
      confidenceScoreProduct: null
    });

    await replaceAllStores(seedData);

    await expect(restoreDatabaseFromJson('{bad json')).rejects.toThrow('Backup file must be valid JSON.');
    await expect(restoreDatabaseFromJson(JSON.stringify({ candidates: [] }))).rejects.toThrow('Backup must contain exactly these stores');
    await expect(restoreDatabaseFromJson(JSON.stringify({ ...data, candidates: [{ id: 1 }] }))).rejects.toThrow('does not match the expected shape');
    expect(await loadAllStores()).toEqual(idSortedDatabase(seedData));

    const restored = await restoreDatabaseFromJson(JSON.stringify(data));
    expect(restored).toEqual(data);
    expect(await loadAllStores()).toEqual(data);
  });

  it('restores exactly from bundled seed data when available', async () => {
    await replaceAllStores(emptyDatabase());
    localStorage.setItem(legacyStorageKey, JSON.stringify(emptyDatabase()));

    expect(canRestoreSeedData()).toBe(true);
    expect(validateDatabase(seedData)).toEqual(seedData);

    const restored = await restoreDatabaseFromSeed();

    expect(restored).toEqual(idSortedDatabase(seedData));
    expect(await loadAllStores()).toEqual(idSortedDatabase(seedData));
    expect(localStorage.getItem(legacyStorageKey)).toBeNull();
  });
});

describe('Directus report data operations', () => {
  it('maps the db-directus.sql dashboard panels to computed chart rows', () => {
    const data = emptyDatabase();
    data.candidates.push(
      { id: 1, firstName: 'Ada', middleName: null, lastName: 'Alpha', score: 25, confidence: 75.5, stancesCount: 2, confidenceScoreProduct: 1887.5 },
      { id: 2, firstName: 'Ben', middleName: null, lastName: 'Beta', score: 10, confidence: null, stancesCount: 1, confidenceScoreProduct: null }
    );
    data.issues.push(
      { id: 3, name: 'High points', description: null, points: 100, confidence: 12, stancesCount: 4 },
      { id: 4, name: 'Low points', description: null, points: 1, confidence: 99, stancesCount: 1 }
    );
    data.stances.push(
      { id: 5, date_created: null, date_updated: null, title: 'Known', candidate: 1, issue: 3, rating: 50, points: null, confidence: 88.84, label: 'Known confidence', description: null },
      { id: 6, date_created: null, date_updated: null, title: 'Unknown', candidate: 2, issue: 4, rating: null, points: null, confidence: null, label: 'Missing confidence', description: null }
    );

    const candidatesDashboard = reportDashboards.find((dashboard) => dashboard.name === 'Candidates')!;
    const scores = getReportPanelData(candidatesDashboard.panels[0], data);
    expect(scores).toEqual([
      { id: 1, label: 'Alpha', value: 25, color: '#E35169' },
      { id: 2, label: 'Beta', value: 10, color: '#E35169' }
    ]);

    const stancesDashboard = reportDashboards.find((dashboard) => dashboard.name === 'Stances')!;
    expect(getReportPanelData(stancesDashboard.panels[0], data)).toEqual([
      { id: 5, label: 'Known confidence', value: 88.8, color: '#3399FF' }
    ]);
    expect(getReportPanelData(stancesDashboard.panels[1], data)).toEqual([
      { id: 6, label: 'Missing confidence', value: null, color: null }
    ]);
    expect(getReportPanelData(stancesDashboard.panels[2], data).map((item) => item.label)).toEqual(['High points', 'Low points']);
  });

  it('computes candidate contest rows from election-specific issue weights', () => {
    const data = emptyDatabase();
    data.candidates.push(
      { id: 1, firstName: 'Ada', middleName: null, lastName: 'Alpha', score: 5, confidence: null, stancesCount: null, confidenceScoreProduct: null },
      { id: 2, firstName: 'Ben', middleName: null, lastName: 'Beta', score: 50, confidence: null, stancesCount: null, confidenceScoreProduct: null }
    );
    data.issues.push({ id: 10, name: 'Privacy', description: null, points: 100, confidence: null, stancesCount: null });
    data.stances.push(
      { id: 20, date_created: null, date_updated: null, title: null, candidate: 1, issue: 10, rating: 100, points: null, confidence: null, label: null, description: null },
      { id: 21, date_created: null, date_updated: null, title: null, candidate: 2, issue: 10, rating: 25, points: null, confidence: null, label: null, description: null }
    );
    data.elections.push({ id: 30, name: 'General', date: null, description: null, candidateIds: [1, 2], issues: [{ issueId: 10, points: 80 }] });

    expect(scoreElection(data.elections[0], data).map((row) => [row.candidate.id, row.score])).toEqual([[1, 80], [2, 20]]);
    expect(getCandidateContestRows(data)).toEqual([{ election: data.elections[0], candidates: scoreElection(data.elections[0], data) }]);

    data.elections = [];
    expect(getCandidateContestRows(data)[0].candidates.map((row) => row.candidate.id)).toEqual([2, 1]);
  });

  it('filters report panels to selected election membership', () => {
    const data = emptyDatabase();
    data.candidates.push(
      { id: 1, firstName: 'Ada', middleName: null, lastName: 'Alpha', score: 25, confidence: 75.5, stancesCount: 2, confidenceScoreProduct: 1887.5 },
      { id: 2, firstName: 'Ben', middleName: null, lastName: 'Beta', score: 10, confidence: null, stancesCount: 1, confidenceScoreProduct: null },
      { id: 3, firstName: 'Cid', middleName: null, lastName: 'Gamma', score: 90, confidence: 95, stancesCount: 1, confidenceScoreProduct: 8550 }
    );
    data.issues.push(
      { id: 10, name: 'Privacy', description: null, points: 100, confidence: 70, stancesCount: 2 },
      { id: 11, name: 'Transit', description: null, points: 50, confidence: 90, stancesCount: 1 }
    );
    data.stances.push(
      { id: 20, date_created: null, date_updated: null, title: null, candidate: 1, issue: 10, rating: 100, points: null, confidence: 80, label: 'Included', description: null },
      { id: 21, date_created: null, date_updated: null, title: null, candidate: 3, issue: 11, rating: 100, points: null, confidence: 90, label: 'Excluded', description: null }
    );
    const election = { id: 30, name: 'General', date: null, description: null, candidateIds: [1, 2], issues: [{ issueId: 10, points: 80 }] };

    const candidatesDashboard = reportDashboards.find((dashboard) => dashboard.name === 'Candidates')!;
    expect(getReportPanelData(candidatesDashboard.panels[0], data, election).map((item) => item.id)).toEqual([1, 2]);

    const stancesDashboard = reportDashboards.find((dashboard) => dashboard.name === 'Stances')!;
    expect(getReportPanelData(stancesDashboard.panels[0], data, election).map((item) => item.label)).toEqual(['Included']);
    expect(getReportPanelData(stancesDashboard.panels[2], data, election).map((item) => item.label)).toEqual(['Privacy']);
    expect(getCandidateContestRows(data, election)).toEqual([{ election, candidates: scoreElection(election, data) }]);
  });
});

describe('election UX helpers', () => {
  it('duplicates elections with a new id while preserving selected candidates and weighted issues', () => {
    const data = emptyDatabase();
    const election = {
      id: 3,
      name: 'Primary',
      date: '2026-06-01T00:00:00.000Z',
      description: 'Original notes',
      candidateIds: [1, 2],
      issues: [{ issueId: 5, points: 25 }]
    };
    data.elections.push({ ...election }, { ...election, id: 7, name: 'Other' });

    const copy = duplicateElection(election, data);

    expect(copy).toMatchObject({
      id: 8,
      name: 'Primary (copy)',
      date: '2026-06-02T00:00:00.000Z',
      description: 'Copied from Primary.\n\nOriginal notes',
      candidateIds: [1, 2],
      issues: [{ issueId: 5, points: 25 }]
    });
    expect(copy).not.toBe(election);
    expect(copy.issues).not.toBe(election.issues);
  });

  it('builds inline candidate and issue records with new ids', () => {
    const data = emptyDatabase();
    data.candidates.push({ id: 2, firstName: 'Existing', middleName: null, lastName: 'Candidate', score: null, confidence: null, stancesCount: null, confidenceScoreProduct: null });
    data.issues.push({ id: 4, name: 'Existing issue', description: null, points: 10, confidence: null, stancesCount: null });

    expect(candidateFromInlineName('Ada Lovelace', data)).toEqual({
      id: 3,
      firstName: 'Ada',
      middleName: null,
      lastName: 'Lovelace',
      score: null,
      confidence: null,
      stancesCount: null,
      confidenceScoreProduct: null
    });
    expect(issueFromInlineName('Ballot access', data)).toEqual({
      id: 5,
      name: 'Ballot access',
      description: null,
      points: 0,
      confidence: null,
      stancesCount: null
    });
  });
});
