import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { seedData } from '../seed';
import type { Database } from '../types';
import { loadAllStores, replaceAllStores } from '../repositories/indexedDb';
import { importDatabaseJson, selectElectionData } from './importExport';

const empty = (): Database => ({ candidates: [], issues: [], stances: [], facts: [], stanceFacts: [], firstRecords: [], elections: [], contests: [] });

beforeEach(async () => { await replaceAllStores(empty()); });

describe('import', () => {
  it('upserts matching IDs without removing other records', async () => {
    const original = structuredClone(seedData);
    await replaceAllStores(original);
    const patch = empty();
    patch.elections = original.elections.slice(0, 1).map(e => ({ ...e, name: 'Imported name' }));
    const updated = await importDatabaseJson(JSON.stringify(patch));
    expect(updated.elections.find(e => e.id === patch.elections[0].id)?.name).toBe('Imported name');
    expect(updated.candidates).toEqual(original.candidates);
    expect(await loadAllStores()).toEqual(updated);
  });
  it('generates collision-free IDs when new records omit id', async () => {
    const original = empty();
    original.issues = [{ id: 1, name: 'Existing', description: null }];
    await replaceAllStores(original);
    const batch = empty() as Record<string, unknown>;
    batch.issues = [
      { name: 'New without ID', description: null },
      { id: 3, name: 'Explicit ID', description: null },
      { name: 'Another new record', description: null }
    ];
    const imported = await importDatabaseJson(JSON.stringify(batch));
    expect(imported.issues).toEqual([
      { id: 1, name: 'Existing', description: null },
      { id: 2, name: 'New without ID', description: null },
      { id: 3, name: 'Explicit ID', description: null },
      { id: 4, name: 'Another new record', description: null }
    ]);
  });
  it('rejects malformed JSON without altering data', async () => {
    await expect(importDatabaseJson('{broken')).rejects.toThrow('valid JSON');
    expect(await loadAllStores()).toEqual(empty());
  });
});

describe('selected export', () => {
  it('excludes other elections and retains relationships', () => {
    const db = structuredClone(seedData);
    db.elections.push({ ...db.elections[0], id: 999, name: 'Unselected' });
    const selected = selectElectionData(db, [db.elections[0].id]);
    expect(selected.elections.map(e => e.id)).toEqual([db.elections[0].id]);
    expect(selected.contests.every(c => c.electionId === db.elections[0].id)).toBe(true);
    expect(selected.firstRecords).toEqual([]);
    expect(selected.candidates.every(c => selected.contests.some(co => co.candidateIds.includes(c.id)) || selected.stances.some(s => s.candidate === c.id))).toBe(true);
  });
});
