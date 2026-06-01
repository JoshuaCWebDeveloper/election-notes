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
import { candidateFromInlineName, duplicateElection, duplicateElectionContests, issueFromInlineName } from './elections';
import { countStanceFacts, getAvailableFactsForStance, getCandidateContestRows, getReportPanelData, reportDashboards, scoreElection } from './reports';

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
    elections: [],
    contests: []
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
    elections: sortRowsById(data.elections),
    contests: sortRowsById(data.contests)
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

function createLegacyIssueDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 5);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('issues', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('issues', 'readwrite');
      transaction.objectStore('issues').put({ id: 1, name: 'Legacy issue', description: null, stancesCount: 9 });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  });
}

function createLegacyElectionIssueDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 6);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('elections', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('elections', 'readwrite');
      transaction.objectStore('elections').put({
        id: 1,
        name: 'Legacy election',
        date: null,
        description: null,
        issues: [{ issueId: 10, points: 80, confidence: 70 }]
      });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  });
}

function createLegacyElectionUpdatedDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 7);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('elections', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('elections', 'readwrite');
      transaction.objectStore('elections').put({
        id: 1,
        name: 'Legacy election',
        date: null,
        description: null,
        issues: []
      });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  });
}

function createLegacyStanceDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 8);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('stances', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('stances', 'readwrite');
      transaction.objectStore('stances').put({
        id: 1,
        date_created: null,
        date_updated: null,
        title: 'Legacy stance',
        candidate: null,
        issue: null,
        rating: null,
        points: 12,
        confidence: null,
        label: 'Legacy label',
        description: null
      });
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  });
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
      expect(db.version).toBe(9);
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
    data.issues.push({ id: 1, name: 'Taxes', description: null });
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

  it('migrates legacy IndexedDB issue rows by removing stored stances counts', async () => {
    await createLegacyIssueDatabase();

    const db = await openDatabase();
    db.close();

    expect((await loadAllStores()).issues).toEqual([{ id: 1, name: 'Legacy issue', description: null }]);
  });

  it('migrates legacy IndexedDB election issue rows by removing stored confidence', async () => {
    await createLegacyElectionIssueDatabase();

    const db = await openDatabase();
    db.close();

    expect((await loadAllStores()).elections).toEqual([{
      id: 1,
      name: 'Legacy election',
      date: null,
      date_updated: null,
      description: null,
      issues: [{ issueId: 10, points: 80 }]
    }]);
  });

  it('migrates legacy IndexedDB election rows by adding a null updated date', async () => {
    await createLegacyElectionUpdatedDatabase();

    const db = await openDatabase();
    db.close();

    expect((await loadAllStores()).elections).toEqual([{
      id: 1,
      name: 'Legacy election',
      date: null,
      date_updated: null,
      description: null,
      issues: []
    }]);
  });

  it('migrates legacy IndexedDB stance rows by removing stored points and labels', async () => {
    await createLegacyStanceDatabase();

    const db = await openDatabase();
    db.close();

    expect((await loadAllStores()).stances).toEqual([{
      id: 1,
      date_created: null,
      date_updated: null,
      title: 'Legacy stance',
      candidate: null,
      issue: null,
      rating: null,
      confidence: null,
      description: null
    }]);
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
    const legacyJson = {
      ...legacy,
      elections: [{ id: 201, name: 'Legacy election', date: null, description: null, candidateIds: [101], issues: [] }]
    };
    delete (legacyJson as { contests?: unknown }).contests;
    const expected = {
      ...legacy,
      elections: [{ id: 201, name: 'Legacy election', date: null, date_updated: null, description: null, issues: [] }],
      contests: [{ id: 1, electionId: 201, name: 'Legacy election contest', candidateIds: [101] }]
    };
    localStorage.setItem(legacyStorageKey, JSON.stringify(legacyJson));

    const loaded = await loadDatabase();

    expect(loaded).toEqual(expected);
    expect(await loadAllStores()).toEqual(expected);
    expect(localStorage.getItem(legacyStorageKey)).toBeNull();
    expect(await isDatabaseInitialized()).toBe(true);
  });

  it('normalizes mixed legacy backups by creating default contests only where needed', () => {
    const mixedBackup = {
      ...emptyDatabase(),
      elections: [
        { id: 1, name: 'Already migrated', date: null, description: null, candidateIds: [10], issues: [] },
        { id: 2, name: 'Needs migration', date: null, description: null, candidateIds: [20], issues: [] }
      ],
      contests: [
        { id: 5, electionId: 1, name: 'Existing contest', candidateIds: [10] }
      ]
    };

    expect(validateDatabase(mixedBackup)).toMatchObject({
      elections: [
        { id: 1, name: 'Already migrated', date: null, date_updated: null, description: null, issues: [] },
        { id: 2, name: 'Needs migration', date: null, date_updated: null, description: null, issues: [] }
      ],
      contests: [
        { id: 5, electionId: 1, name: 'Existing contest', candidateIds: [10] },
        { id: 6, electionId: 2, name: 'Needs migration contest', candidateIds: [20] }
      ]
    });
  });

  it('normalizes legacy issue default points, confidence, and stances count out of backups', () => {
    const backup = {
      ...emptyDatabase(),
      issues: [{ id: 1, name: 'Legacy weighted issue', description: null, points: 99, confidence: 50, stancesCount: 2 }]
    };

    expect(validateDatabase(backup).issues).toEqual([
      { id: 1, name: 'Legacy weighted issue', description: null }
    ]);
  });

  it('normalizes legacy stance points and labels out of backups', () => {
    const backup = {
      ...emptyDatabase(),
      stances: [{
        id: 1,
        date_created: null,
        date_updated: null,
        title: 'Legacy stance',
        candidate: null,
        issue: null,
        rating: null,
        points: 50,
        confidence: null,
        label: 'Legacy label',
        description: null
      }]
    };

    expect(validateDatabase(backup).stances).toEqual([{
      id: 1,
      date_created: null,
      date_updated: null,
      title: 'Legacy stance',
      candidate: null,
      issue: null,
      rating: null,
      confidence: null,
      description: null
    }]);
  });

  it('normalizes legacy election issue confidence out of backups', () => {
    const backup = {
      ...emptyDatabase(),
      elections: [{ id: 1, name: 'Legacy election', date: null, description: null, issues: [{ issueId: 10, points: 80, confidence: 40 }] }]
    };

    expect(validateDatabase(backup).elections[0].issues).toEqual([
      { issueId: 10, points: 80 }
    ]);
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
      date_updated: '2026-06-01T12:00:00.000Z',
      description: null,
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
  it('counts facts linked to a stance', () => {
    const data = emptyDatabase();
    data.stanceFacts.push(
      { id: 1, stance: 10, fact: 20 },
      { id: 2, stance: 10, fact: 21 },
      { id: 3, stance: 11, fact: 22 },
      { id: 4, stance: null, fact: 23 }
    );

    expect(countStanceFacts(data, 10)).toBe(2);
    expect(countStanceFacts(data, 11)).toBe(1);
    expect(countStanceFacts(data, 12)).toBe(0);
  });

  it('returns only facts not already linked to a stance', () => {
    const data = emptyDatabase();
    data.facts.push(
      { id: 20, date_created: null, date_updated: null, Summary: 'Linked', description: null },
      { id: 21, date_created: null, date_updated: null, Summary: 'Available', description: null },
      { id: 22, date_created: null, date_updated: null, Summary: 'Other stance', description: null }
    );
    data.stanceFacts.push(
      { id: 1, stance: 10, fact: 20 },
      { id: 2, stance: 10, fact: null },
      { id: 3, stance: 11, fact: 22 }
    );

    expect(getAvailableFactsForStance(data, 10).map((fact) => fact.id)).toEqual([21, 22]);
  });

  it('maps the db-directus.sql dashboard panels to computed chart rows', () => {
    const data = emptyDatabase();
    data.candidates.push(
      { id: 1, firstName: 'Ada', middleName: null, lastName: 'Alpha', score: 25, confidence: 75.5, stancesCount: 2, confidenceScoreProduct: 1887.5 },
      { id: 2, firstName: 'Ben', middleName: null, lastName: 'Beta', score: 10, confidence: null, stancesCount: 1, confidenceScoreProduct: null }
    );
    data.issues.push(
      { id: 3, name: 'High confidence', description: null },
      { id: 4, name: 'Low confidence', description: null }
    );
    data.stances.push(
      { id: 5, date_created: null, date_updated: null, title: 'Known confidence', candidate: 1, issue: 3, rating: 50, confidence: 88.84, description: null },
      { id: 6, date_created: null, date_updated: null, title: 'Missing confidence', candidate: 2, issue: 4, rating: null, confidence: null, description: null }
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
    expect(getReportPanelData(stancesDashboard.panels[2], data)).toEqual([]);
    expect(getReportPanelData(stancesDashboard.panels[3], data)).toEqual([
      { id: 3, label: 'High confidence', value: 1, color: '#2ECDA7' },
      { id: 4, label: 'Low confidence', value: 1, color: '#2ECDA7' }
    ]);
  });

  it('computes candidate contest rows from election-specific issue weights', () => {
    const data = emptyDatabase();
    data.candidates.push(
      { id: 1, firstName: 'Ada', middleName: null, lastName: 'Alpha', score: 5, confidence: null, stancesCount: null, confidenceScoreProduct: null },
      { id: 2, firstName: 'Ben', middleName: null, lastName: 'Beta', score: 50, confidence: null, stancesCount: null, confidenceScoreProduct: null }
    );
    data.issues.push({ id: 10, name: 'Privacy', description: null });
    data.stances.push(
      { id: 20, date_created: null, date_updated: null, title: null, candidate: 1, issue: 10, rating: 100, confidence: null, description: null },
      { id: 21, date_created: null, date_updated: null, title: null, candidate: 2, issue: 10, rating: 25, confidence: null, description: null }
    );
    data.elections.push({ id: 30, name: 'General', date: null, date_updated: null, description: null, issues: [{ issueId: 10, points: 80 }] });
    data.contests.push({ id: 31, electionId: 30, name: 'General contest', candidateIds: [1, 2] });

    expect(scoreElection(data.elections[0], data).map((row) => [row.candidate.id, row.score])).toEqual([[1, 80], [2, 20]]);
    expect(getCandidateContestRows(data)).toEqual([{ contest: data.contests[0], candidates: scoreElection(data.elections[0], data) }]);

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
      { id: 10, name: 'Privacy', description: null },
      { id: 11, name: 'Transit', description: null }
    );
    data.stances.push(
      { id: 20, date_created: null, date_updated: null, title: 'Included', candidate: 1, issue: 10, rating: 100, confidence: 80, description: null },
      { id: 21, date_created: null, date_updated: null, title: 'Ignored null', candidate: 2, issue: 10, rating: 50, confidence: null, description: null },
      { id: 22, date_created: null, date_updated: null, title: 'Runoff', candidate: 3, issue: 10, rating: 100, confidence: 20, description: null },
      { id: 23, date_created: null, date_updated: null, title: 'Excluded issue', candidate: 3, issue: 11, rating: 100, confidence: 90, description: null }
    );
    const election = { id: 30, name: 'General', date: null, date_updated: null, description: null, issues: [{ issueId: 10, points: 80 }] };
    data.contests.push({ id: 31, electionId: 30, name: 'General contest', candidateIds: [1, 2] });
    data.contests.push({ id: 32, electionId: 30, name: 'Runoff contest', candidateIds: [3] });

    const candidatesDashboard = reportDashboards.find((dashboard) => dashboard.name === 'Candidates')!;
    expect(getReportPanelData(candidatesDashboard.panels[0], data, election, data.contests[0]).map((item) => item.id)).toEqual([1, 2]);
    expect(getReportPanelData(candidatesDashboard.panels[0], data, election, data.contests[1]).map((item) => item.id)).toEqual([3]);

    const stancesDashboard = reportDashboards.find((dashboard) => dashboard.name === 'Stances')!;
    expect(getReportPanelData(stancesDashboard.panels[0], data, election).map((item) => item.label)).toEqual(['Included', 'Runoff']);
    expect(getReportPanelData(stancesDashboard.panels[2], data, election)).toEqual([{ id: 10, label: 'Privacy', value: 50, color: '#6644FF' }]);
    expect(getReportPanelData(stancesDashboard.panels[2], data, election, data.contests[0])).toEqual([{ id: 10, label: 'Privacy', value: 80, color: '#6644FF' }]);
    expect(getReportPanelData(stancesDashboard.panels[2], data, election, data.contests[1])).toEqual([{ id: 10, label: 'Privacy', value: 20, color: '#6644FF' }]);
    expect(getReportPanelData(stancesDashboard.panels[3], data, election)).toEqual([{ id: 10, label: 'Privacy', value: 3, color: '#2ECDA7' }]);
    expect(getCandidateContestRows(data, election)).toEqual([
      { contest: data.contests[0], candidates: scoreElection(election, { ...data, contests: [data.contests[0]] }) },
      { contest: data.contests[1], candidates: scoreElection(election, { ...data, contests: [data.contests[1]] }) }
    ]);
  });

  it('computes election candidate metrics and fallback stance labels from election rows', () => {
    const data = emptyDatabase();
    data.candidates.push({
      id: 10,
      firstName: 'Chase',
      middleName: 'Russell',
      lastName: 'Oliver',
      score: null,
      confidence: null,
      stancesCount: null,
      confidenceScoreProduct: null
    });
    data.issues.push(
      { id: 20, name: 'Ballot access', description: null },
      { id: 21, name: 'Civil liberties', description: null },
      { id: 22, name: 'Out of scope', description: null }
    );
    data.stances.push(
      { id: 30, date_created: null, date_updated: null, title: '', candidate: 10, issue: 20, rating: 100, confidence: 80, description: null },
      { id: 31, date_created: null, date_updated: null, title: null, candidate: 10, issue: 21, rating: 70, confidence: 60, description: null },
      { id: 32, date_created: null, date_updated: null, title: 'Ignored issue', candidate: 10, issue: 22, rating: 100, confidence: 10, description: null }
    );
    const election = {
      id: 40,
      name: 'General',
      date: null,
      date_updated: null,
      description: null,
      issues: [{ issueId: 20, points: 3500 }, { issueId: 21, points: 6000 }]
    };
    const contest = { id: 41, electionId: 40, name: 'General contest', candidateIds: [10] };
    data.contests.push(contest);

    const candidatesDashboard = reportDashboards.find((dashboard) => dashboard.name === 'Candidates')!;
    expect(getReportPanelData(candidatesDashboard.panels[0], data, election, contest)).toEqual([
      { id: 10, label: 'Oliver', value: 7700, color: '#E35169' }
    ]);
    expect(getReportPanelData(candidatesDashboard.panels[1], data, election, contest)).toEqual([
      { id: 10, label: 'Oliver', value: 70, color: '#6644FF' }
    ]);
    expect(getReportPanelData(candidatesDashboard.panels[2], data, election, contest)).toEqual([
      { id: 10, label: 'Oliver', value: 2, color: '#2ECDA7' }
    ]);
    expect(getReportPanelData(candidatesDashboard.panels[3], data, election, contest)).toEqual([
      { id: 10, label: 'Oliver', value: 539000, color: '#FFA439' }
    ]);

    const stancesDashboard = reportDashboards.find((dashboard) => dashboard.name === 'Stances')!;
    expect(getReportPanelData(stancesDashboard.panels[0], data, election).map((item) => item.label)).toEqual([
      'Chase Russell Oliver - Ballot access',
      'Chase Russell Oliver - Civil liberties'
    ]);
  });
});

describe('election UX helpers', () => {
  it('duplicates elections and their contests with new ids while preserving weighted issues', () => {
    const data = emptyDatabase();
    const election = {
      id: 3,
      name: 'Primary',
      date: '2026-06-01T00:00:00.000Z',
      date_updated: '2026-05-01T00:00:00.000Z',
      description: 'Original notes',
      issues: [{ issueId: 5, points: 25 }]
    };
    data.elections.push({ ...election }, { ...election, id: 7, name: 'Other' });
    data.contests.push({ id: 10, electionId: 3, name: 'Mayor', candidateIds: [1, 2] });

    const copy = duplicateElection(election, data, '2026-05-02T00:00:00.000Z');
    const contests = duplicateElectionContests(election.id, copy.id, data);

    expect(copy).toMatchObject({
      id: 8,
      name: 'Primary (copy)',
      date: '2026-06-02T00:00:00.000Z',
      date_updated: '2026-05-02T00:00:00.000Z',
      description: 'Copied from Primary.\n\nOriginal notes',
      issues: [{ issueId: 5, points: 25 }]
    });
    expect(contests).toEqual([{ id: 11, electionId: 8, name: 'Mayor', candidateIds: [1, 2] }]);
    expect(copy).not.toBe(election);
    expect(copy.issues).not.toBe(election.issues);
  });

  it('builds inline candidate and issue records with new ids', () => {
    const data = emptyDatabase();
    data.candidates.push({ id: 2, firstName: 'Existing', middleName: null, lastName: 'Candidate', score: null, confidence: null, stancesCount: null, confidenceScoreProduct: null });
    data.issues.push({ id: 4, name: 'Existing issue', description: null });

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
      description: null
    });
  });
});
