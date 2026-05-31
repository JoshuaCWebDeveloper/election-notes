export type Id = number;

export type Candidate = {
  id: Id;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  score: number | null;
  confidence: number | null;
  stancesCount: number | null;
  confidenceScoreProduct: number | null;
};

export type Issue = {
  id: Id;
  name: string | null;
  description: string | null;
  stancesCount: number | null;
};

export type Stance = {
  id: Id;
  date_created: string | null;
  date_updated: string | null;
  title: string | null;
  candidate: Id | null;
  issue: Id | null;
  rating: number | null;
  points: number | null;
  confidence: number | null;
  label: string | null;
  description: string | null;
};

export type Fact = {
  id: Id;
  date_created: string | null;
  date_updated: string | null;
  Summary: string | null;
  description: string | null;
};

export type StanceFact = {
  id: Id;
  stance: Id | null;
  fact: Id | null;
};

export type First = {
  id: Id;
  status: string;
  sort: number | null;
  user_created: string | null;
  date_created: string | null;
  user_updated: string | null;
  date_updated: string | null;
  name: string | null;
};

export type ElectionIssue = {
  issueId: Id;
  points: number;
  confidence: number | null;
};

export type Election = {
  id: Id;
  name: string;
  date: string | null;
  description: string | null;
  issues: ElectionIssue[];
};

export type Contest = {
  id: Id;
  electionId: Id;
  name: string;
  candidateIds: Id[];
};

export type Database = {
  candidates: Candidate[];
  issues: Issue[];
  stances: Stance[];
  facts: Fact[];
  stanceFacts: StanceFact[];
  firstRecords: First[];
  elections: Election[];
  contests: Contest[];
};
