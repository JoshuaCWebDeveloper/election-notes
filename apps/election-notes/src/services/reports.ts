import type { Candidate, Database, Election, Id, Issue, Stance } from '../types';

export type ReportCollection = 'candidate' | 'issue' | 'stance';
export type ReportPanelType = 'bar-chart' | 'ordered-bar-chart' | 'list' | 'candidate-contest';

export type ReportDashboard = {
  id: string;
  name: string;
  icon: string;
  color: string | null;
  panels: ReportPanel[];
};

export type ReportPanel = {
  id: string;
  dashboardId: string;
  name: string;
  type: ReportPanelType;
  color: string | null;
  collection?: ReportCollection;
  xAxis?: string;
  yAxis?: string;
  horizontal?: boolean;
  sortField?: string;
  sortOrder?: '-' | 'desc' | 'asc';
  filter?: 'confidence-null' | 'confidence-not-null';
  decimals?: number;
};

export type ReportDatum = {
  id: Id;
  label: string;
  value: number | null;
  color: string | null;
};

export type CandidateContestRow = {
  election: Election | null;
  candidates: Array<{ candidate: Candidate; score: number }>;
};

export const reportDashboards: ReportDashboard[] = [
  {
    id: 'e7fc9a1f-0c5c-40cb-8a0d-7ab9e55faa9d',
    name: 'Candidates',
    icon: 'bar_chart_4_bars',
    color: '#E35169',
    panels: [
      { id: '06d2d47d-906f-4a50-8234-2afcc58078d6', dashboardId: 'e7fc9a1f-0c5c-40cb-8a0d-7ab9e55faa9d', name: 'Scores', type: 'bar-chart', color: '#E35169', collection: 'candidate', xAxis: 'lastName', yAxis: 'score' },
      { id: '54e8ff09-1798-4dcc-b210-03ee703cef87', dashboardId: 'e7fc9a1f-0c5c-40cb-8a0d-7ab9e55faa9d', name: 'Confidences', type: 'bar-chart', color: '#6644FF', collection: 'candidate', xAxis: 'lastName', yAxis: 'confidence' },
      { id: '192a9a66-bb15-4b5a-91bc-e2efb8d48146', dashboardId: 'e7fc9a1f-0c5c-40cb-8a0d-7ab9e55faa9d', name: 'Stances', type: 'bar-chart', color: '#2ECDA7', collection: 'candidate', xAxis: 'lastName', yAxis: 'stancesCount' },
      { id: 'bd97bf14-f86a-4058-b7bf-5e4a8bd62986', dashboardId: 'e7fc9a1f-0c5c-40cb-8a0d-7ab9e55faa9d', name: 'Confidence Score Product', type: 'bar-chart', color: '#FFA439', collection: 'candidate', xAxis: 'lastName', yAxis: 'confidenceScoreProduct' }
    ]
  },
  {
    id: '9ccac6c8-bb2a-477c-a2b9-233ecb9f0925',
    name: 'Candidate Contest',
    icon: 'space_dashboard',
    color: null,
    panels: [
      { id: 'e96f2fca-24bb-49c5-91d0-8a94336e6d1e', dashboardId: '9ccac6c8-bb2a-477c-a2b9-233ecb9f0925', name: 'Candidate Contest', type: 'candidate-contest', color: null }
    ]
  },
  {
    id: 'ff2322a9-e257-4d27-80b6-e1d841f4f3fd',
    name: 'Stances',
    icon: 'full_stacked_bar_chart',
    color: '#3399FF',
    panels: [
      { id: 'f3229cd6-5b4c-4635-ab65-a0e203dd066d', dashboardId: 'ff2322a9-e257-4d27-80b6-e1d841f4f3fd', name: 'Confidences', type: 'ordered-bar-chart', color: '#3399FF', collection: 'stance', xAxis: 'label', yAxis: 'confidence', horizontal: true, filter: 'confidence-not-null', decimals: 1, sortField: 'confidence', sortOrder: '-' },
      { id: '43becb8c-d286-4d2c-ab6e-eac98de8b9c1', dashboardId: 'ff2322a9-e257-4d27-80b6-e1d841f4f3fd', name: 'Missing Confidence', type: 'list', color: null, collection: 'stance', xAxis: 'label', yAxis: 'confidence', filter: 'confidence-null', sortField: 'confidence', sortOrder: '-' },
      { id: '2ed2444f-ca71-4b2f-86f0-5639437661c6', dashboardId: 'ff2322a9-e257-4d27-80b6-e1d841f4f3fd', name: 'Issue Confidences', type: 'ordered-bar-chart', color: '#6644FF', collection: 'issue', xAxis: 'name', yAxis: 'confidence', horizontal: true, sortField: 'points', sortOrder: '-' },
      { id: '836c9762-3d1d-4733-bb08-f5b0557c47fe', dashboardId: 'ff2322a9-e257-4d27-80b6-e1d841f4f3fd', name: 'Issue Stances', type: 'ordered-bar-chart', color: '#2ECDA7', collection: 'issue', xAxis: 'name', yAxis: 'stancesCount', horizontal: true, sortField: 'points', sortOrder: '-' }
    ]
  }
];

export function getReportPanelData(panel: ReportPanel, db: Database, election?: Election | null): ReportDatum[] {
  if (!panel.collection || !panel.xAxis || !panel.yAxis) return [];
  const xAxis = panel.xAxis;
  const yAxis = panel.yAxis;
  const rows = getCollectionRows(panel.collection, db, election).filter((row) => matchesFilter(row, panel.filter));
  const sorted = [...rows].sort((left, right) => compareRows(left, right, panel.sortField, panel.sortOrder));
  return sorted.map((row) => ({
    id: row.id,
    label: String(readField(row, xAxis) ?? `#${row.id}`),
    value: normalizeNumber(readField(row, yAxis), panel.decimals),
    color: panel.color
  }));
}

export function getCandidateContestRows(db: Database, election?: Election | null): CandidateContestRow[] {
  if (election) return [{ election, candidates: scoreElection(election, db) }];

  if (db.elections.length === 0) {
    return [{
      election: null,
      candidates: [...db.candidates]
        .sort((left, right) => (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY))
        .map((candidate) => ({ candidate, score: candidate.score ?? 0 }))
    }];
  }

  return db.elections.map((election) => ({ election, candidates: scoreElection(election, db) }));
}

export function scoreElection(election: Election, db: Database): Array<{ candidate: Candidate; score: number }> {
  return election.candidateIds
    .map((candidateId) => {
      const candidate = db.candidates.find((row) => row.id === candidateId);
      if (!candidate) return null;
      const score = election.issues.reduce((total, electionIssue) => {
        const stance = db.stances.find((row) => row.candidate === candidateId && row.issue === electionIssue.issueId);
        return total + electionIssue.points * ((stance?.rating ?? 0) / 100);
      }, 0);
      return { candidate, score };
    })
    .filter((row): row is { candidate: Candidate; score: number } => row !== null)
    .sort((left, right) => right.score - left.score);
}

function getCollectionRows(collection: ReportCollection, db: Database, election?: Election | null): Array<Candidate | Issue | Stance> {
  if (!election) {
    if (collection === 'candidate') return db.candidates;
    if (collection === 'issue') return db.issues;
    return db.stances;
  }

  const candidateIds = new Set(election.candidateIds);
  const issueIds = new Set(election.issues.map((issue) => issue.issueId));
  if (collection === 'candidate') return db.candidates.filter((candidate) => candidateIds.has(candidate.id));
  if (collection === 'issue') return db.issues.filter((issue) => issueIds.has(issue.id));
  return db.stances.filter((stance) => (
    stance.candidate !== null &&
    stance.issue !== null &&
    candidateIds.has(stance.candidate) &&
    issueIds.has(stance.issue)
  ));
}

function matchesFilter(row: Candidate | Issue | Stance, filter: ReportPanel['filter']): boolean {
  if (filter === 'confidence-null') return row.confidence === null;
  if (filter === 'confidence-not-null') return row.confidence !== null;
  return true;
}

function compareRows(left: Candidate | Issue | Stance, right: Candidate | Issue | Stance, field: string | undefined, order: ReportPanel['sortOrder']): number {
  if (!field) return 0;
  const leftValue = readField(left, field);
  const rightValue = readField(right, field);
  const direction = order === '-' || order === 'desc' ? -1 : 1;
  if (typeof leftValue === 'number' && typeof rightValue === 'number') return (leftValue - rightValue) * direction;
  return String(leftValue ?? '').localeCompare(String(rightValue ?? '')) * direction;
}

function readField(row: Candidate | Issue | Stance, field: string): string | number | null {
  return (row as unknown as Record<string, string | number | null>)[field] ?? null;
}

function normalizeNumber(value: string | number | null, decimals: number | undefined): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (decimals === undefined) return value;
  return Number(value.toFixed(decimals));
}
