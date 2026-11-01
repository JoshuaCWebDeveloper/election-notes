import type { Candidate, Database, Id } from '../types';
import { replaceAllStores } from '../repositories/indexedDb';
import { validateDatabase } from './database';

export function previewCandidateMerge(db: Database, keepId: Id, removeId: Id) {
  if (keepId === removeId) throw new Error('Select two different candidates.');
  const keep = db.candidates.find(candidate => candidate.id === keepId);
  const remove = db.candidates.find(candidate => candidate.id === removeId);
  if (!keep || !remove) throw new Error('Both candidates must exist.');
  const contests = db.contests.filter(contest => contest.candidateIds.includes(keepId) || contest.candidateIds.includes(removeId));
  const elections = contests.map(contest => ({ contest, election: db.elections.find(election => election.id === contest.electionId) }))
    .filter((entry): entry is { contest: Database['contests'][number]; election: Database['elections'][number] } => Boolean(entry.election))
    .sort((a,b) => (Date.parse(b.election.date ?? '') || 0) - (Date.parse(a.election.date ?? '') || 0) || a.election.name.localeCompare(b.election.name));
  return { keep, remove, elections };
}

export function mergeCandidateData(db: Database, keepId: Id, removeId: Id): Database {
  previewCandidateMerge(db, keepId, removeId);
  const next = structuredClone(db);
  next.candidates = next.candidates.filter(candidate => candidate.id !== removeId);
  next.contests = next.contests.map(contest => ({
    ...contest,
    candidateIds: [...new Set(contest.candidateIds.map(id => id === removeId ? keepId : id))],
    selectedCandidateIds: [...new Set((contest.selectedCandidateIds ?? []).map(id => id === removeId ? keepId : id))]
  }));
  next.stances = next.stances.map(stance => stance.candidate === removeId ? { ...stance, candidate: keepId } : stance);
  return validateDatabase(next);
}

export async function mergeCandidates(db: Database, keepId: Id, removeId: Id): Promise<Database> {
  const next = mergeCandidateData(db, keepId, removeId);
  await replaceAllStores(next);
  return next;
}
