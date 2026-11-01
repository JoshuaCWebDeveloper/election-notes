import { describe, expect, it } from 'vitest';
import type { Database } from '../types';
import { mergeCandidateData, previewCandidateMerge } from './mergeCandidates';

const candidate = (id: number, lastName: string) => ({ id, firstName: 'Alex', middleName: null, lastName, score: null, confidence: null, stancesCount: null, confidenceScoreProduct: null });
const db: Database = {
  candidates: [candidate(1, 'Example'), candidate(2, 'Example Jr')],
  elections: [{id: 3, name: 'General', date: '2026-11-03', date_updated: null, description: null, issues: []}],
  contests: [{id: 4, electionId: 3, name: 'Mayor', notes: null, candidateIds: [1, 2], selectedCandidateIds: [2]}],
  issues: [{id: 5, name: 'Roads', description: null}],
  stances: [{id: 6, date_created: null, date_updated: null, title: 'Supports roads', candidate: 2, issue: 5, rating: null, confidence: null, description: null}],
  facts: [{id: 7, date_created: null, date_updated: null, Summary: 'Source', description: null}],
  stanceFacts: [{id: 8, stance: 6, fact: 7}], firstRecords: []
};
describe('candidate merge', () => {
  it('previews one deduplicated contest', () => {
    expect(previewCandidateMerge(db, 1, 2).elections.map(row => row.contest.name)).toEqual(['Mayor']);
  });
  it('retains chosen candidate and remaps all references without changing unrelated records', () => {
    const next = mergeCandidateData(db, 1, 2);
    expect(next.candidates.map(row => row.id)).toEqual([1]);
    expect(next.contests[0].candidateIds).toEqual([1]);
    expect(next.contests[0].selectedCandidateIds).toEqual([1]);
    expect(next.stances[0].candidate).toBe(1);
    expect(next.stanceFacts).toEqual(db.stanceFacts);
    expect(db.candidates).toHaveLength(2);
  });
  it('rejects invalid candidate pairs', () => {
    expect(() => mergeCandidateData(db, 1, 1)).toThrow();
    expect(() => mergeCandidateData(db, 1, 100)).toThrow();
  });
});
