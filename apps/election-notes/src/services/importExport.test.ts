import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { seedData } from '../seed';
import type { Database } from '../types';
import { loadAllStores, replaceAllStores } from '../repositories/indexedDb';
import { importDatabaseJson, selectElectionData } from './importExport';

const empty = (): Database => ({ candidates: [], issues: [], stances: [], facts: [], stanceFacts: [], firstRecords: [], elections: [], contests: [] });

beforeEach(async () => { await replaceAllStores(empty()); });

describe('import', () => {
  it('upserts matching names without removing other records', async () => {
    const original = structuredClone(seedData);
    await replaceAllStores(original);
    const patch = empty();
    patch.elections = original.elections.slice(0, 1).map(e => ({ ...e, description: 'Updated description' }));
    const updated = await importDatabaseJson(JSON.stringify(patch));
    expect(updated.elections.find(e => e.id === patch.elections[0].id)?.description).toBe('Updated description');
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
  it('remaps temporary IDs to existing names across relationships', async () => {
    const existing = empty();
    existing.elections = [{ id: 55, name: 'Same election', date: null, date_updated: null, description: null, issues: [] }];
    existing.candidates = [{ id: 73, firstName: 'Alex', middleName: null, lastName: 'Example', score: null, confidence: null, stancesCount: null, confidenceScoreProduct: null }];
    await replaceAllStores(existing);
    const source = empty();
    source.elections = [{ ...existing.elections[0], id: 1, description: 'Updated' }];
    source.candidates = [{ ...existing.candidates[0], id: 2, score: 9 }];
    source.contests = [{ id: 3, electionId: 1, name: 'Office', notes: null, candidateIds: [2] }];
    const result = await importDatabaseJson(JSON.stringify(source));
    expect(result.elections).toHaveLength(1);
    expect(result.elections[0].id).toBe(55);
    expect(result.elections[0].description).toBe('Updated');
    expect(result.candidates[0].id).toBe(73);
    expect(result.contests[0].electionId).toBe(55);
    expect(result.contests[0].candidateIds).toEqual([73]);
  });
  it('reuses an existing stance-fact link and creates only missing pairs', async () => {
    const db = empty();
    db.candidates = [{ id: 20, firstName: 'Alex', middleName: null, lastName: 'Example', score: null, confidence: null, stancesCount: null, confidenceScoreProduct: null }];
    db.issues = [{ id: 30, name: 'Roads', description: null }];
    db.stances = [{ id: 40, date_created: null, date_updated: null, title: 'Support', candidate: 20, issue: 30, rating: null, confidence: null, description: null }];
    db.facts = [
      { id: 50, date_created: null, date_updated: null, Summary: 'Existing fact', description: null },
      { id: 51, date_created: null, date_updated: null, Summary: 'Another fact', description: null }
    ];
    db.stanceFacts = [{ id: 60, stance: 40, fact: 50 }];
    await replaceAllStores(db);
    const batch = empty();
    batch.candidates = [{ ...db.candidates[0], id: 1 }];
    batch.issues = [{ ...db.issues[0], id: 2 }];
    batch.stances = [{ ...db.stances[0], id: 3, candidate: 1, issue: 2 }];
    batch.facts = [{ ...db.facts[0], id: 4 }, { ...db.facts[1], id: 5 }];
    batch.stanceFacts = [{ id: 6, stance: 3, fact: 4 }, { id: 7, stance: 3, fact: 5 }];
    const result = await importDatabaseJson(JSON.stringify(batch));
    expect(result.stanceFacts).toHaveLength(2);
    expect(result.stanceFacts).toContainEqual({ id: 60, stance: 40, fact: 50 });
    expect(result.stanceFacts).toContainEqual({ id: 1, stance: 40, fact: 51 });
  });
  it('preserves contest candidate selections across import and export', async () => {
    const batch = empty();
    batch.elections = [{ id: 5, name: 'Selection test', date: null, date_updated: null, description: null, issues: [] }];
    batch.candidates = [{ id: 6, firstName: 'A', middleName: null, lastName: 'B', score: null, confidence: null, stancesCount: null, confidenceScoreProduct: null }];
    batch.contests = [{ id: 7, electionId: 5, name: 'Contest', notes: null, candidateIds: [6], selectedCandidateIds: [6] }];
    const result = await importDatabaseJson(JSON.stringify(batch));
    expect(result.contests[0].selectedCandidateIds).toEqual([result.candidates[0].id]);
    expect(selectElectionData(result, [result.elections[0].id]).contests[0].selectedCandidateIds).toEqual([result.candidates[0].id]);
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
