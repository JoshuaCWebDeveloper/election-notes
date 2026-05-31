import type { Candidate, Contest, Database, Election, Id, Issue } from '../types';

export function nextId(rows: { id: Id }[]) {
  return Math.max(0, ...rows.map((row) => row.id)) + 1;
}

export function duplicateElection(election: Election, db: Database): Election {
  const copiedDate = election.date ? bumpDateByOneDay(election.date) : null;
  return {
    ...structuredClone(election),
    id: nextId(db.elections),
    name: copyName(election.name),
    date: copiedDate,
    description: election.description ? `Copied from ${election.name}.\n\n${election.description}` : `Copied from ${election.name}.`
  };
}

export function duplicateElectionContests(sourceElectionId: Id, targetElectionId: Id, db: Database): Contest[] {
  const sourceContests = db.contests.filter((contest) => contest.electionId === sourceElectionId);
  let nextContestId = nextId(db.contests);
  return sourceContests.map((contest) => ({
    ...structuredClone(contest),
    id: nextContestId++,
    electionId: targetElectionId
  }));
}

export function candidateFromInlineName(name: string, db: Database): Candidate {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts.pop()! : parts[0] ?? '';
  return {
    id: nextId(db.candidates),
    firstName: parts.join(' ') || null,
    middleName: null,
    lastName,
    score: null,
    confidence: null,
    stancesCount: null,
    confidenceScoreProduct: null
  };
}

export function issueFromInlineName(name: string, db: Database): Issue {
  return {
    id: nextId(db.issues),
    name: name.trim(),
    description: null,
    stancesCount: null
  };
}

export function contestFromInlineName(name: string, electionId: Id, db: Database): Contest {
  return {
    id: nextId(db.contests),
    electionId,
    name: name.trim() || 'New contest',
    candidateIds: []
  };
}

function copyName(name: string) {
  return /\(copy(?: \d+)?\)$/i.test(name) ? name.replace(/\)$/i, ' 2)') : `${name} (copy)`;
}

function bumpDateByOneDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}
