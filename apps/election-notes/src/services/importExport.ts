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

// File IDs are local references within the import, never destination record IDs.
// Match existing records by their human-readable identity (or relationship key).
export async function importDatabaseJson(json: string): Promise<Database> {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Import must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Import must be a JSON object.');
  const raw = parsed as Record<string, unknown>;
  const sourceIds: Partial<Record<keyof Database, Set<number>>> = {};
  const source: Record<string, Array<Record<string, unknown>>> = {};
  const current = await loadAllStores();
  for (const store of storeNames) {
    if (!Array.isArray(raw[store])) throw new Error(`Store "${store}" must be an array.`);
    const seen = new Set<number>();
    sourceIds[store] = seen;
    source[store] = (raw[store] as unknown[]).map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${store} row ${index + 1} must be an object.`);
      const row = structuredClone(value) as Record<string, unknown>;
      if (Object.hasOwn(row, 'id')) {
        if (!Number.isSafeInteger(row.id) || (row.id as number) < 0) throw new Error(`${store} row ${index + 1}: invalid id.`);
        if (seen.has(row.id as number)) throw new Error(`${store}: duplicate import id ${row.id}.`);
        seen.add(row.id as number);
      }
      return row;
    });
  }
  if (Object.keys(raw).length !== storeNames.length) throw new Error('Import must contain exactly the eight collections.');

  // Run the existing strict format validator before doing any writes.
  const validationCopy = structuredClone(raw) as Record<string, unknown>;
  for (const store of storeNames) {
    let placeholder = -1;
    for (const row of validationCopy[store] as Array<Record<string, unknown>>) {
      if (!Object.hasOwn(row, 'id')) row.id = placeholder--;
    }
  }
  validateDatabase(validationCopy);

  const result = structuredClone(current);
  const electionIssueRows = new Map<number, Array<{issueId: number; points: number}>>();
  const idMaps = Object.fromEntries(storeNames.map(store => [store, new Map<number, number>()])) as Record<keyof Database, Map<number, number>>;
  const order: Array<keyof Database> = ['elections', 'candidates', 'issues', 'facts', 'firstRecords', 'contests', 'stances', 'stanceFacts'];
  const referenced = (store: keyof Database, id: unknown): number | null => {
    if (id === null) return null;
    if (typeof id !== 'number') throw new Error(`Invalid ${store} reference.`);
    const translated = idMaps[store].get(id);
    if (translated !== undefined) return translated;
    // Only trust references already in the destination if not declared in the file.
    if (!sourceIds[store]?.has(id) && result[store].some(row => row.id === id)) return id;
    throw new Error(`Unresolved ${store} reference ${id}. Include the referenced record in the import.`);
  };
  const textKey = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().toLocaleLowerCase() : null;
  const keyFor = (store: keyof Database, row: Record<string, unknown>): string | null => {
    if (store === 'candidates') {
      const pieces = [row.firstName, row.middleName, row.lastName].filter(v => typeof v === 'string' && v.trim());
      return pieces.length ? pieces.map(v => textKey(v)).join(' ') : null;
    }
    if (store === 'stances') {
      const title = textKey(row.title);
      return title && row.candidate !== null && row.issue !== null ? JSON.stringify([title, row.candidate, row.issue]) : null;
    }
    if (store === 'facts') return textKey(row.Summary);
    if (store === 'stanceFacts') return row.stance !== null && row.fact !== null ? JSON.stringify([row.stance, row.fact]) : null;
    if (store === 'contests') {
      const name = textKey(row.name);
      return name ? JSON.stringify([row.electionId, name]) : null;
    }
    return textKey(row.name);
  };

  for (const store of order) {
    const existingRows = result[store] as Array<{id: number}>;
    const used = new Set(existingRows.map(row => row.id));
    let nextId = 1;
    for (const row of source[store]) {
      const originalId = row.id as number | undefined;
      if (store === 'contests') {
        row.electionId = referenced('elections', row.electionId);
        row.candidateIds = (row.candidateIds as number[]).map(id => referenced('candidates', id));
      } else if (store === 'stances') {
        row.candidate = referenced('candidates', row.candidate);
        row.issue = referenced('issues', row.issue);
      } else if (store === 'stanceFacts') {
        row.stance = referenced('stances', row.stance);
        row.fact = referenced('facts', row.fact);
      }
      const key = keyFor(store, row);
      const matches = key === null ? [] : existingRows.filter(item => keyFor(store, item as Record<string, unknown>) === key);
      if (matches.length > 1) throw new Error(`Ambiguous ${store} identity: ${key}.`);
      const destinationId = matches.length ? matches[0].id : (() => { while (used.has(nextId)) nextId++; return nextId++; })();
      used.add(destinationId);
      if (store === 'elections') electionIssueRows.set(destinationId, row.issues as Array<{issueId: number; points: number}>);
      row.id = destinationId;
      if (originalId !== undefined) idMaps[store].set(originalId, destinationId);
      const existingIndex = existingRows.findIndex(item => item.id === destinationId);
      if (existingIndex >= 0) existingRows[existingIndex] = row as {id: number};
      else existingRows.push(row as {id: number});
    }
  }
  // Remap issue references for elections, including elections without source IDs.
  for (const [electionId, issues] of electionIssueRows) {
    const saved = result.elections.find(item => item.id === electionId);
    if (saved) saved.issues = issues.map(issue => ({ ...issue, issueId: referenced('issues', issue.issueId)! }));
  }
  validateDatabase(result);
  const database = await openDatabase();
  try {
    const tx = database.transaction(storeNames, 'readwrite');
    const complete = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Import transaction aborted.'));
      tx.onerror = () => reject(tx.error ?? new Error('Import failed.'));
    });
    for (const store of storeNames) {
      for (const row of result[store]) tx.objectStore(store).put(row);
    }
    await complete;
  } finally { database.close(); }
  return loadAllStores();
}
