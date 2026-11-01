import type { Database, Id } from '../types';
import { loadAllStores, openDatabase, storeNames } from '../repositories/indexedDb';
import { validateDatabase } from './database';

export function selectElectionData(db: Database, ids: Id[]): Database {
  const selected = new Set(ids);
  const elections = db.elections.filter(e => selected.has(e.id));
  const contests = db.contests.filter(c => selected.has(c.electionId));
  const candidateIds = new Set(contests.flatMap(c => c.candidateIds));
  const issueIds = new Set(elections.flatMap(e => e.issues.map(i => i.issueId)));
  const stances = db.stances.filter(s => (s.candidate !== null && candidateIds.has(s.candidate)) || (s.issue !== null && issueIds.has(s.issue)));
  for (const s of stances) {
    if (s.candidate !== null) candidateIds.add(s.candidate);
    if (s.issue !== null) issueIds.add(s.issue);
  }
  const stanceIds = new Set(stances.map(s => s.id));
  const stanceFacts = db.stanceFacts.filter(link => link.stance !== null && stanceIds.has(link.stance));
  const factIds = new Set(stanceFacts.map(link => link.fact));
  return {
    elections, contests, stances, stanceFacts,
    candidates: db.candidates.filter(c => candidateIds.has(c.id)),
    issues: db.issues.filter(i => issueIds.has(i.id)),
    facts: db.facts.filter(f => factIds.has(f.id)),
    firstRecords: []
  };
}

export async function exportElectionJson(ids: Id[] | null): Promise<string> {
  const db = await loadAllStores();
  return JSON.stringify(ids === null ? db : selectElectionData(db, ids), null, 2);
}

export async function importDatabaseJson(json: string): Promise<Database> {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Import must be valid JSON.'); }
  // ID-less records are inserts. Reserve IDs already present in storage or
  // explicitly supplied in the import, so generated IDs cannot overwrite them.
  const current = await loadAllStores();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Import must be a JSON object.');
  }
  const input = parsed as Record<string, unknown>;
  for (const storeName of storeNames) {
    const rows = input[storeName];
    if (!Array.isArray(rows)) continue; // validateDatabase reports missing/invalid arrays.
    const reserved = new Set<number>([
      ...current[storeName].map(row => row.id),
      ...rows.filter(row => typeof row === 'object' && row !== null && !Array.isArray(row) && typeof row.id === 'number').map(row => row.id as number)
    ]);
    let nextId = 1;
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || Array.isArray(row) || Object.hasOwn(row, 'id')) continue;
      while (reserved.has(nextId)) nextId++;
      row.id = nextId;
      reserved.add(nextId++);
    }
  }
  const data = validateDatabase(parsed);
  const database = await openDatabase();
  try {
    const tx = database.transaction(storeNames, 'readwrite');
    const complete = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Import transaction aborted.'));
      tx.onerror = () => reject(tx.error ?? new Error('Import failed.'));
    });
    for (const storeName of storeNames) {
      const store = tx.objectStore(storeName);
      for (const row of data[storeName]) store.put(row);
    }
    await complete;
  } finally { database.close(); }
  return loadAllStores();
}
