import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Copy, Download, Menu, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { canRestoreSeedData, createBackupJson, deleteEntity, loadDatabase, restoreDatabaseFromJson, restoreDatabaseFromSeed, saveEntity, type EntityKey } from './services/database';
import { candidateFromInlineName, contestFromInlineName, duplicateElection, duplicateElectionContests, issueFromInlineName, nextId } from './services/elections';
import { averageIssueConfidence, countIssueStances, countStanceFacts, getAvailableFactsForStance, getCandidateContestRows, getElectionCandidateCount, getElectionContestCount, getElectionContests, getReportPanelData, reportDashboards, type ReportDatum, type ReportPanel } from './services/reports';
import type { Candidate, Contest, Database, Election, ElectionIssue, Fact, First, Id, Issue, Stance, StanceFact } from './types';

type Tab = {
  key: EntityKey;
  label: string;
  summary: (row: never, db: Database) => string;
  blank: (db: Database) => Database[EntityKey][number];
  fields: Field[];
};

type Field = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'electionContests' | 'electionIssues';
  entity?: EntityKey;
  nullable?: boolean;
};

type ConfirmableDeleteButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  onConfirm: () => void | Promise<void>;
};

type CandidateReportSort = 'name' | 'value';

const autoSaveDelayMs = 700;

function useDebouncedAutoSave<T>(value: T, onSave: (value: T) => void | Promise<void>, delay = autoSaveDelayMs) {
  const isInitialValue = useRef(true);
  const latestSave = useRef(onSave);
  const latestValue = useRef(value);
  const pending = useRef(false);
  const timerRef = useRef<number | null>(null);

  function flush() {
    if (!pending.current) return;
    pending.current = false;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void latestSave.current(latestValue.current);
  }

  useEffect(() => {
    latestSave.current = onSave;
  }, [onSave]);

  useEffect(() => {
    latestValue.current = value;
  }, [value]);

  useEffect(() => {
    if (isInitialValue.current) {
      isInitialValue.current = false;
      return;
    }

    pending.current = true;
    timerRef.current = window.setTimeout(() => {
      pending.current = false;
      timerRef.current = null;
      void latestSave.current(value);
    }, delay);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [delay, value]);

  useEffect(() => {
    function flushWhenHidden() {
      if (document.visibilityState === 'hidden') flush();
    }

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      flush();
    };
  }, []);

  return {
    flush,
    cancel() {
      pending.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  };
}

function getScrollableParent(element: HTMLElement) {
  let parent = element.parentElement;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function isElementInScrollView(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const scrollParent = getScrollableParent(element);
  const viewport = scrollParent?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  return rect.bottom > viewport.top && rect.top < viewport.bottom;
}

function ConfirmableDeleteButton({ children, className, onConfirm, type = 'button', ...props }: ConfirmableDeleteButtonProps) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);

  function clearArmTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function arm() {
    clearArmTimer();
    setArmed(true);
    timerRef.current = window.setTimeout(() => {
      setArmed(false);
      timerRef.current = null;
    }, 3000);
  }

  useEffect(() => clearArmTimer, []);

  return (
    <button
      {...props}
      type={type}
      className={['confirmable-delete', className, armed ? 'armed' : ''].filter(Boolean).join(' ')}
      onClick={() => {
        if (!armed) {
          arm();
          return;
        }
        clearArmTimer();
        setArmed(false);
        void onConfirm();
      }}
    >
      <Trash2 className="confirmable-delete-icon" size={16} />
      {children}
    </button>
  );
}

function candidateName(candidate?: Candidate | null) {
  if (!candidate) return 'Unassigned';
  return [candidate.firstName, candidate.middleName, candidate.lastName].filter(Boolean).join(' ') || `Candidate #${candidate.id}`;
}

function candidateLastWord(candidate: Candidate) {
  const name = candidateName(candidate).trim();
  const words = name.split(/\s+/).filter(Boolean);
  return words.at(-1) ?? name;
}

function compareCandidatesByLastWord(left: Candidate, right: Candidate) {
  return candidateLastWord(left).localeCompare(candidateLastWord(right), undefined, { sensitivity: 'base' }) ||
    candidateName(left).localeCompare(candidateName(right), undefined, { sensitivity: 'base' }) ||
    left.id - right.id;
}

function issueName(issue?: Issue | null) {
  return issue?.name || `Issue #${issue?.id ?? 'none'}`;
}

function stanceName(stance?: Stance | null) {
  return stance?.title || `Stance #${stance?.id ?? 'none'}`;
}

function factName(fact?: Fact | null) {
  return fact?.Summary || `Fact #${fact?.id ?? 'none'}`;
}

function recordName(entity: EntityKey, id: Id | null, db: Database) {
  if (id === null) return 'None';
  if (entity === 'candidates') return candidateName(db.candidates.find((row) => row.id === id));
  if (entity === 'issues') return issueName(db.issues.find((row) => row.id === id));
  if (entity === 'stances') return stanceName(db.stances.find((row) => row.id === id));
  if (entity === 'facts') return factName(db.facts.find((row) => row.id === id));
  const row = db[entity].find((item) => item.id === id);
  return row ? `${entity} #${row.id}` : `Missing #${id}`;
}

const tabs: Tab[] = [
  {
    key: 'elections',
    label: 'Elections',
    summary: (row, db) => {
      const election = row as Election;
      return `${getElectionContestCount(db, election.id)} contests, ${getElectionCandidateCount(db, election.id)} candidates, ${election.issues.length} weighted issues, updated ${formatUpdatedDate(election.date_updated)}`;
    },
    blank: (db) => ({ id: nextId(db.elections), name: 'New election', date: null, date_updated: null, description: null, issues: [] }),
    fields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'date', label: 'Date', type: 'date', nullable: true },
      { key: 'description', label: 'Description', type: 'textarea', nullable: true },
      { key: 'contests', label: 'Contests', type: 'electionContests', entity: 'candidates' },
      { key: 'issues', label: 'Election issue weights', type: 'electionIssues', entity: 'issues' }
    ]
  },
  {
    key: 'candidates',
    label: 'Candidates',
    summary: (row) => `Score ${formatScore((row as Candidate).score)} with confidence ${formatScore((row as Candidate).confidence)}`,
    blank: (db) => ({ id: nextId(db.candidates), firstName: '', middleName: null, lastName: '', score: null, confidence: null, stancesCount: null, confidenceScoreProduct: null }),
    fields: [
      { key: 'firstName', label: 'First name', type: 'text', nullable: true },
      { key: 'middleName', label: 'Middle name', type: 'text', nullable: true },
      { key: 'lastName', label: 'Last name', type: 'text', nullable: true },
      { key: 'score', label: 'Legacy score', type: 'number', nullable: true },
      { key: 'confidence', label: 'Confidence', type: 'number', nullable: true },
      { key: 'stancesCount', label: 'Stances count', type: 'number', nullable: true },
      { key: 'confidenceScoreProduct', label: 'Confidence score product', type: 'number', nullable: true }
    ]
  },
  {
    key: 'issues',
    label: 'Issues',
    summary: (row, db) => `${formatScore(countIssueStances(db, (row as Issue).id))} stances, ${getIssueElectionCount(db, (row as Issue).id)} elections`,
    blank: (db) => ({ id: nextId(db.issues), name: '', description: null }),
    fields: [
      { key: 'name', label: 'Name', type: 'text', nullable: true },
      { key: 'description', label: 'Description', type: 'textarea', nullable: true }
    ]
  },
  {
    key: 'stances',
    label: 'Stances',
    summary: (row, db) => `${candidateName(db.candidates.find((c) => c.id === (row as Stance).candidate))} on ${issueName(db.issues.find((i) => i.id === (row as Stance).issue))}`,
    blank: (db) => ({ id: nextId(db.stances), date_created: new Date().toISOString(), date_updated: null, title: '', candidate: null, issue: null, rating: null, confidence: null, description: null }),
    fields: [
      { key: 'title', label: 'Title', type: 'text', nullable: true },
      { key: 'candidate', label: 'Candidate', type: 'select', entity: 'candidates', nullable: true },
      { key: 'issue', label: 'Issue', type: 'select', entity: 'issues', nullable: true },
      { key: 'rating', label: 'Rating', type: 'number', nullable: true },
      { key: 'confidence', label: 'Confidence', type: 'number', nullable: true },
      { key: 'description', label: 'Description', type: 'textarea', nullable: true },
      { key: 'date_created', label: 'Created', type: 'date', nullable: true },
      { key: 'date_updated', label: 'Updated', type: 'date', nullable: true }
    ]
  },
  {
    key: 'facts',
    label: 'Facts',
    summary: (row) => (row as Fact).date_created || 'No date',
    blank: (db) => ({ id: nextId(db.facts), date_created: new Date().toISOString(), date_updated: null, Summary: '', description: null }),
    fields: [
      { key: 'Summary', label: 'Summary', type: 'text', nullable: true },
      { key: 'description', label: 'Description / markdown notes', type: 'textarea', nullable: true },
      { key: 'date_created', label: 'Created', type: 'date', nullable: true },
      { key: 'date_updated', label: 'Updated', type: 'date', nullable: true }
    ]
  },
  {
    key: 'stanceFacts',
    label: 'Stance-Fact Links',
    summary: (row, db) => `${stanceName(db.stances.find((s) => s.id === (row as StanceFact).stance))} -> ${factName(db.facts.find((f) => f.id === (row as StanceFact).fact))}`,
    blank: (db) => ({ id: nextId(db.stanceFacts), stance: null, fact: null }),
    fields: [
      { key: 'stance', label: 'Stance', type: 'select', entity: 'stances', nullable: true },
      { key: 'fact', label: 'Fact', type: 'select', entity: 'facts', nullable: true }
    ]
  },
  {
    key: 'firstRecords',
    label: 'First Records',
    summary: (row) => `${(row as First).status} / ${(row as First).name || 'Untitled'}`,
    blank: (db) => ({ id: nextId(db.firstRecords), status: 'draft', sort: null, user_created: null, date_created: new Date().toISOString(), user_updated: null, date_updated: null, name: null }),
    fields: [
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'sort', label: 'Sort', type: 'number', nullable: true },
      { key: 'user_created', label: 'User created', type: 'text', nullable: true },
      { key: 'date_created', label: 'Created', type: 'date', nullable: true },
      { key: 'user_updated', label: 'User updated', type: 'text', nullable: true },
      { key: 'date_updated', label: 'Updated', type: 'date', nullable: true },
      { key: 'name', label: 'Name', type: 'text', nullable: true }
    ]
  }
];

type RouteState = {
  tabKey: EntityKey;
  selectedId: Id | null;
  expandedCandidateId: Id | null;
  expandedStanceId: Id | null;
  isKnownPath: boolean;
};

const tabPathByKey: Partial<Record<EntityKey, string>> = {
  elections: 'elections',
  candidates: 'candidates',
  issues: 'issues',
  stances: 'stances',
  facts: 'facts',
  stanceFacts: 'stance-fact-links',
  firstRecords: 'first-records'
};

function parseRoute(pathname: string): RouteState {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { tabKey: 'elections', selectedId: null, expandedCandidateId: null, expandedStanceId: null, isKnownPath: true };
  }

  const tab = tabs.find((item) => tabPathByKey[item.key] === segments[0]);
  if (!tab) {
    return { tabKey: 'elections', selectedId: null, expandedCandidateId: null, expandedStanceId: null, isKnownPath: false };
  }

  return {
    tabKey: tab.key,
    selectedId: parseIdSegment(segments[1]),
    expandedCandidateId: tab.key === 'elections' && segments[2] === 'candidates' ? parseIdSegment(segments[3]) : null,
    expandedStanceId: tab.key === 'elections' && segments[2] === 'candidates' && segments[4] === 'stances' ? parseIdSegment(segments[5]) : null,
    isKnownPath: true
  };
}

function pathForSelection(tabKey: EntityKey, selectedId: Id | null, expandedCandidateId: Id | null = null, expandedStanceId: Id | null = null) {
  const base = `/${tabPathByKey[tabKey] ?? 'elections'}`;
  if (selectedId === null) return base;
  if (tabKey !== 'elections' || expandedCandidateId === null) return `${base}/${selectedId}`;
  const candidatePath = `${base}/${selectedId}/candidates/${expandedCandidateId}`;
  return expandedStanceId === null ? candidatePath : `${candidatePath}/stances/${expandedStanceId}`;
}

function parseIdSegment(segment: string | undefined) {
  if (segment === undefined) return null;
  const id = Number(segment);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [db, setDb] = useState<Database | null>(null);
  const route = useMemo(() => parseRoute(location.pathname), [location.pathname]);
  const activeKey = route.tabKey;
  const active = tabs.find((tab) => tab.key === activeKey)!;
  const rows = db?.[active.key] ?? [];
  const visibleRows = useMemo(() => db ? sortRowsForTab(rows, active.key, db) : rows, [active.key, db, rows]);
  const selectedId = route.selectedId ?? (active.key === 'elections' ? null : visibleRows[0]?.id ?? null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [electionMenuOpen, setElectionMenuOpen] = useState(false);
  const [restoreUseSeed, setRestoreUseSeed] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const seedRestoreAvailable = canRestoreSeedData();
  const selected = db
    ? selectedId === null
      ? active.key === 'elections' ? null : visibleRows[0] ?? active.blank(db)
      : rows.find((row) => row.id === selectedId) ?? (active.key === 'elections' ? null : visibleRows[0] ?? active.blank(db))
    : null;

  useEffect(() => {
    let cancelled = false;
    loadDatabase().then((data) => {
      if (cancelled) return;
      setDb(data);
    }).catch((error: unknown) => {
      console.error('Failed to load IndexedDB database', error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!db) return;
    const tabRows = sortRowsForTab(db[active.key], active.key, db);
    if (!route.isKnownPath) {
      navigate('/elections', { replace: true });
      return;
    }

    if (active.key !== 'elections') {
      const hasSelectedRoute = route.selectedId !== null && tabRows.some((row) => row.id === route.selectedId);
      if (!hasSelectedRoute) {
        navigate(pathForSelection(active.key, tabRows[0]?.id ?? null), { replace: true });
      }
      return;
    }

    if (route.selectedId === null) return;

    const hasSelectedElection = tabRows.some((row) => row.id === route.selectedId);
    if (!hasSelectedElection) {
      navigate('/elections', { replace: true });
      return;
    }

    if (active.key === 'elections' && route.selectedId !== null) {
      const election = tabRows.find((row) => row.id === route.selectedId) as Election | undefined;
      if (!election) return;
      const candidateIds = new Set(getCandidateContestRows(db, election).flatMap((contestScore) => contestScore.candidates.map((score) => score.candidate.id)));
      if (route.expandedCandidateId !== null && !candidateIds.has(route.expandedCandidateId)) {
        navigate(pathForSelection('elections', route.selectedId), { replace: true });
        return;
      }
      const stance = route.expandedStanceId === null ? null : db.stances.find((item) => item.id === route.expandedStanceId) ?? null;
      if (
        route.expandedCandidateId !== null &&
        route.expandedStanceId !== null &&
        (stance === null || stance.candidate !== route.expandedCandidateId || !election.issues.some((issue) => issue.issueId === stance.issue))
      ) {
        navigate(pathForSelection('elections', route.selectedId, route.expandedCandidateId), { replace: true });
      }
    }
  }, [active.key, db, navigate, route.expandedCandidateId, route.expandedStanceId, route.isKnownPath, route.selectedId]);

  useEffect(() => {
    setElectionMenuOpen(false);
  }, [location.pathname]);

  function navigateToSelection(tabKey: EntityKey, id: Id | null, options?: { replace?: boolean }) {
    navigate(pathForSelection(tabKey, id), { replace: options?.replace ?? false });
  }

  function navigateToElectionExpansion(electionId: Id, candidateId: Id | null, stanceId: Id | null = null) {
    navigate(pathForSelection('elections', electionId, candidateId, stanceId));
  }

  async function save(row: Database[EntityKey][number]) {
    if (!db) return;
    const rowToSave = active.key === 'elections' ? withUpdatedDate(row as Election) : row;
    await saveEntity(active.key, rowToSave);
    setDb((current) => {
      if (!current) return current;
      const currentRows = current[active.key];
      const nextRows = currentRows.some((item) => item.id === row.id)
        ? currentRows.map((item) => item.id === row.id ? rowToSave : item)
        : [...currentRows, rowToSave];
      return { ...current, [active.key]: nextRows };
    });
    if (route.selectedId !== rowToSave.id) navigateToSelection(active.key, rowToSave.id, { replace: true });
  }

  async function saveToStore<TStore extends EntityKey>(storeName: TStore, row: Database[TStore][number]) {
    if (!db) return;
    const touchedElection = storeName === 'contests' ? touchElectionForContest(row as Contest, db) : null;
    await saveEntity(storeName, row);
    if (touchedElection) await saveEntity('elections', touchedElection);
    setDb((current) => {
      if (!current) return current;
      const nextRows = current[storeName].some((item) => item.id === row.id)
        ? current[storeName].map((item) => item.id === row.id ? row : item)
        : [...current[storeName], row];
      const nextElections = touchedElection
        ? current.elections.map((election) => election.id === touchedElection.id ? touchedElection : election)
        : current.elections;
      return { ...current, [storeName]: nextRows, elections: nextElections };
    });
  }

  async function saveToElectionStore<TStore extends EntityKey>(storeName: TStore, row: Database[TStore][number], electionId: Id) {
    if (!db) return;
    const election = db.elections.find((item) => item.id === electionId);
    const touchedElection = election ? withUpdatedDate(election) : null;
    await saveEntity(storeName, row);
    if (touchedElection) await saveEntity('elections', touchedElection);
    setDb((current) => {
      if (!current) return current;
      const nextRows = current[storeName].some((item) => item.id === row.id)
        ? current[storeName].map((item) => item.id === row.id ? row : item)
        : [...current[storeName], row];
      return {
        ...current,
        [storeName]: nextRows,
        elections: touchedElection
          ? current.elections.map((item) => item.id === touchedElection.id ? touchedElection : item)
          : current.elections
      };
    });
  }

  async function deleteFromStore<TStore extends EntityKey>(storeName: TStore, id: Id) {
    if (!db) return;
    const deletedContest = storeName === 'contests' ? db.contests.find((contest) => contest.id === id) ?? null : null;
    const touchedElection = deletedContest ? touchElectionForContest(deletedContest, db) : null;
    await deleteEntity(storeName, id);
    if (touchedElection) await saveEntity('elections', touchedElection);
    setDb((current) => {
      if (!current) return current;
      return {
        ...current,
        [storeName]: current[storeName].filter((item) => item.id !== id),
        elections: touchedElection
          ? current.elections.map((election) => election.id === touchedElection.id ? touchedElection : election)
          : current.elections
      };
    });
  }

  async function deleteFromElectionStore<TStore extends EntityKey>(storeName: TStore, id: Id, electionId: Id) {
    if (!db) return;
    const election = db.elections.find((item) => item.id === electionId);
    const touchedElection = election ? withUpdatedDate(election) : null;
    await deleteEntity(storeName, id);
    if (touchedElection) await saveEntity('elections', touchedElection);
    setDb((current) => {
      if (!current) return current;
      return {
        ...current,
        [storeName]: current[storeName].filter((item) => item.id !== id),
        elections: touchedElection
          ? current.elections.map((item) => item.id === touchedElection.id ? touchedElection : item)
          : current.elections
      };
    });
  }

  async function duplicateSelectedElection() {
    if (!db || active.key !== 'elections' || !selected) return;
    const copy = duplicateElection(selected as Election, db);
    await saveEntity('elections', copy);
    const contests = duplicateElectionContests((selected as Election).id, copy.id, db);
    await Promise.all(contests.map((contest) => saveEntity('contests', contest)));
    setDb((current) => current ? { ...current, elections: [...current.elections, copy], contests: [...current.contests, ...contests] } : current);
    navigateToSelection('elections', copy.id);
  }

  async function remove(id: Id) {
    if (!db) return;
    const nextRows = rows.filter((row) => row.id !== id);
    await deleteEntity(active.key, id);
    if (active.key === 'elections') {
      const contestIds = db.contests.filter((contest) => contest.electionId === id).map((contest) => contest.id);
      await Promise.all(contestIds.map((contestId) => deleteEntity('contests', contestId)));
      setDb((current) => current ? {
        ...current,
        elections: current.elections.filter((election) => election.id !== id),
        contests: current.contests.filter((contest) => contest.electionId !== id)
      } : current);
    } else {
      setDb((current) => current ? { ...current, [active.key]: current[active.key].filter((row) => row.id !== id) } : current);
    }
    navigateToSelection(active.key, active.key === 'elections' ? null : nextRows[0]?.id ?? null, { replace: true });
  }

  async function backup() {
    const json = await createBackupJson();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `election-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function restore() {
    setRestoreError(null);
    if (!restoreUseSeed && !restoreFile) {
      setRestoreError('Choose a JSON backup file or use the bundled seed data.');
      return;
    }

    try {
      setRestoreBusy(true);
      const data = restoreUseSeed ? await restoreDatabaseFromSeed() : await restoreDatabaseFromJson(await restoreFile!.text());
      setDb(data);
      navigateToSelection(active.key, active.key === 'elections' ? null : sortRowsForTab(data[active.key], active.key, data)[0]?.id ?? null, { replace: true });
      setRestoreOpen(false);
      setRestoreUseSeed(false);
      setRestoreFile(null);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : 'Restore failed.');
    } finally {
      setRestoreBusy(false);
    }
  }

  if (!db) {
    return (
      <main>
        <aside>
          <div className="brand">
            <h1>Election Notes</h1>
            <p>Local CRUD workspace for db-ui.sql models</p>
          </div>
        </aside>
        <section className="workspace loading">Loading local database...</section>
      </main>
    );
  }

  return (
    <main>
      <aside>
        <div className="brand">
          <h1>Election Notes</h1>
          <p>Local CRUD workspace for db-ui.sql models</p>
        </div>
        <nav>
          {tabs.map((tab) => (
            <button className={tab.key === active.key ? 'active' : ''} key={tab.key} onClick={() => navigateToSelection(tab.key, tab.key === 'elections' ? null : sortRowsForTab(db[tab.key], tab.key, db)[0]?.id ?? null)}>
              {tab.label}<span>{db[tab.key].length}</span>
            </button>
          ))}
        </nav>
        <button className="backup" onClick={backup}><Download size={16} /> Backup</button>
        <button className="restore" onClick={() => { setRestoreOpen(true); setRestoreError(null); }}><RotateCcw size={16} /> Restore</button>
      </aside>
      {restoreOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title">
            <div>
              <h2 id="restore-title">Restore database</h2>
              <p>Replace every local store from a full JSON backup.</p>
            </div>
            <label>
              JSON backup file
              <input
                type="file"
                accept="application/json,.json"
                disabled={restoreUseSeed}
                onChange={(event) => {
                  setRestoreFile(event.target.files?.[0] ?? null);
                  setRestoreError(null);
                }}
              />
            </label>
            {seedRestoreAvailable && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={restoreUseSeed}
                  onChange={(event) => {
                    setRestoreUseSeed(event.target.checked);
                    setRestoreError(null);
                  }}
                />
                Use bundled seedData file
              </label>
            )}
            {restoreError && <p className="modal-error">{restoreError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => { setRestoreOpen(false); setRestoreError(null); }} disabled={restoreBusy}>Cancel</button>
              <button type="button" className="danger" onClick={restore} disabled={restoreBusy}>
                <Upload size={16} /> {restoreBusy ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </section>
        </div>
      )}
      <section className="workspace">
        {active.key === 'elections' && selected === null ? (
          <>
            <header>
              <div>
                <h2>{active.label}</h2>
                <p>Choose an election to open its full scoring, stance, fact, and report workspace.</p>
              </div>
              <div className="header-actions">
                <button onClick={() => { const row = active.blank(db); void save(row); }}><Plus size={16} /> New</button>
              </div>
            </header>
            <ElectionCardList
              db={db}
              elections={visibleRows as Election[]}
              onSelect={(id) => navigateToSelection('elections', id)}
            />
          </>
        ) : active.key === 'elections' && selected !== null ? (
          <>
            <header>
              <div className="election-header-title">
                <button
                  type="button"
                  className="menu-button"
                  aria-expanded={electionMenuOpen}
                  aria-label="Open election list"
                  onClick={() => setElectionMenuOpen(true)}
                >
                  <Menu size={18} />
                </button>
                <div>
                  <h2>{rowTitle(active.key, selected, db)}</h2>
                  <p>Election issue points are stored per election and used for scoring.</p>
                </div>
              </div>
              <div className="header-actions">
                <button onClick={duplicateSelectedElection}><Copy size={16} /> Duplicate</button>
                <button onClick={() => { const row = active.blank(db); void save(row); }}><Plus size={16} /> New</button>
              </div>
            </header>
            {electionMenuOpen && (
              <div className="election-menu-backdrop" role="presentation" onClick={() => setElectionMenuOpen(false)}>
                <aside className="election-menu" aria-label="Election list" onClick={(event) => event.stopPropagation()}>
                  <div className="election-menu-heading">
                    <h3>Elections</h3>
                    <button type="button" aria-label="Close election list" onClick={() => setElectionMenuOpen(false)}><X size={16} /></button>
                  </div>
                  <ElectionCardList
                    db={db}
                    elections={visibleRows as Election[]}
                    selectedId={selected.id}
                    onSelect={(id) => {
                      setElectionMenuOpen(false);
                      navigateToSelection('elections', id);
                    }}
                  />
                </aside>
              </div>
            )}
            <div className="content election-full-content">
              <Editor
                key={`${active.key}-${selected.id}`}
                db={db}
                tab={active}
                row={selected}
                onCreateCandidate={async (name) => {
                  const candidate = candidateFromInlineName(name, db);
                  await saveToStore('candidates', candidate);
                  return candidate.id;
                }}
                onCreateIssue={async (name) => {
                  const issue = issueFromInlineName(name, db);
                  await saveToStore('issues', issue);
                  return issue.id;
                }}
                onCreateContest={async (name, electionId) => {
                  const contest = contestFromInlineName(name, electionId, db);
                  await saveToStore('contests', contest);
                  return contest;
                }}
                onSaveContest={(contest) => saveToStore('contests', contest)}
                onDeleteContest={(id) => deleteFromStore('contests', id)}
                onSaveElectionStore={saveToElectionStore}
                onDeleteElectionStore={deleteFromElectionStore}
                expandedCandidateId={route.expandedCandidateId}
                expandedStanceId={route.expandedStanceId}
                onElectionExpansionChange={(candidateId, stanceId) => navigateToElectionExpansion(selected.id, candidateId, stanceId)}
                onSave={save}
                onDelete={remove}
              />
            </div>
          </>
        ) : selected !== null ? (
          <>
            <header>
              <div>
                <h2>{active.label}</h2>
                <p>Create, edit, delete, and connect SQL-derived records.</p>
              </div>
              <div className="header-actions">
                <button onClick={() => { const row = active.blank(db); void save(row); }}><Plus size={16} /> New</button>
              </div>
            </header>
            <div className="content">
              <div className="list">
                {visibleRows.map((row) => (
                  <button className={row.id === selected.id ? 'selected' : ''} key={row.id} onClick={() => navigateToSelection(active.key, row.id)}>
                    <strong>{rowTitle(active.key, row, db)}</strong>
                    {active.key === 'issues' ? (
                      <>
                        <span>{(row as Issue).description || 'No description.'}</span>
                        <span>{active.summary(row as never, db)}</span>
                      </>
                    ) : (
                      <span>{active.summary(row as never, db)}</span>
                    )}
                  </button>
                ))}
              </div>
              <Editor
                key={`${active.key}-${selected.id}`}
                db={db}
                tab={active}
                row={selected}
                onCreateCandidate={async (name) => {
                  const candidate = candidateFromInlineName(name, db);
                  await saveToStore('candidates', candidate);
                  return candidate.id;
                }}
                onCreateIssue={async (name) => {
                  const issue = issueFromInlineName(name, db);
                  await saveToStore('issues', issue);
                  return issue.id;
                }}
                onCreateContest={async (name, electionId) => {
                  const contest = contestFromInlineName(name, electionId, db);
                  await saveToStore('contests', contest);
                  return contest;
                }}
                onSaveContest={(contest) => saveToStore('contests', contest)}
                onDeleteContest={(id) => deleteFromStore('contests', id)}
                onSaveElectionStore={saveToElectionStore}
                onDeleteElectionStore={deleteFromElectionStore}
                expandedCandidateId={route.expandedCandidateId}
                expandedStanceId={route.expandedStanceId}
                onElectionExpansionChange={(candidateId, stanceId) => navigateToElectionExpansion(selected.id, candidateId, stanceId)}
                onSave={save}
                onDelete={remove}
              />
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

function ElectionCardList({
  db,
  elections,
  selectedId,
  onSelect
}: {
  db: Database;
  elections: Election[];
  selectedId?: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <div className="election-card-list">
      {elections.length === 0 && <p className="empty-report">No elections created.</p>}
      <div className="election-card-grid">
        {elections.map((election) => (
          <button
            className={election.id === selectedId ? 'election-card selected' : 'election-card'}
            key={election.id}
            onClick={() => onSelect(election.id)}
          >
            <span className="election-card-title">{election.name}</span>
            <span>{tabs[0].summary(election as never, db)}</span>
            <span>{election.description || 'No description.'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReportsView({ db, election }: { db: Database; election: Election }) {
  const contests = getElectionContests(db, election.id);
  const contestDashboards = reportDashboards
    .map((dashboard) => ({ ...dashboard, panels: dashboard.panels.filter(isContestSpecificPanel) }))
    .filter((dashboard) => dashboard.panels.length > 0);
  const generalDashboards = reportDashboards
    .map((dashboard) => ({ ...dashboard, panels: dashboard.panels.filter((panel) => !isContestSpecificPanel(panel)) }))
    .filter((dashboard) => dashboard.panels.length > 0);

  return (
    <section className="reports" aria-labelledby="reports-title">
      <div className="reports-heading">
        <div>
          <h2 id="reports-title">Reports</h2>
        </div>
      </div>
      <div className="dashboard-grid">
        {contests.length === 0 && contestDashboards.length > 0 && (
          <article className="report-panel wide-panel">
            <h3>Contest Reports</h3>
            <p className="empty-report">No contests created.</p>
          </article>
        )}
        {contests.map((contest) => (
          <section className="contest-report-group" key={contest.id}>
            <h3>{contest.name}</h3>
            <div className="dashboard-grid">
              {contestDashboards.map((dashboard) => (
                <section className="dashboard" key={dashboard.id}>
                  <h4 className="dashboard-title">{dashboard.name}</h4>
                  <div className="panel-grid">
                    {dashboard.panels.map((panel) => (
                      <ReportPanelView contest={contest} db={db} election={election} key={panel.id} panel={panel} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        ))}
        {generalDashboards.map((dashboard) => (
          <section className="dashboard" key={dashboard.id}>
            <h3>{dashboard.name}</h3>
            <div className="panel-grid">
              {dashboard.panels.map((panel) => (
                <ReportPanelView db={db} election={election} key={panel.id} panel={panel} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function isContestSpecificPanel(panel: ReportPanel) {
  return panel.type === 'candidate-contest' || panel.collection !== undefined;
}

function ReportPanelView({ contest, db, election, panel }: { contest?: Contest; db: Database; election: Election; panel: ReportPanel }) {
  const [candidateSort, setCandidateSort] = useState<CandidateReportSort>('value');
  const [isSortMenuOpen, setSortMenuOpen] = useState(false);
  const isCandidateReport = panel.type === 'candidate-contest' || panel.collection === 'candidate';
  const valueSortLabel = candidateReportValueLabel(panel);
  const sortControl = isCandidateReport ? (
    <CandidateReportSortControl
      isOpen={isSortMenuOpen}
      onOpenChange={setSortMenuOpen}
      onSortChange={setCandidateSort}
      sort={candidateSort}
      valueLabel={valueSortLabel}
    />
  ) : null;

  if (panel.type === 'candidate-contest') {
    const contestRows = contest
      ? getCandidateContestRows(db, election).filter((contestRow) => contestRow.contest?.id === contest.id)
      : getCandidateContestRows(db, election);
    const sortedContestRows = contestRows.map((contestRow) => ({
      ...contestRow,
      candidates: sortCandidateContestRows(contestRow.candidates, candidateSort)
    }));
    return (
      <article className="report-panel wide-panel">
        <div className="report-panel-heading">
          <h4>{panel.name}</h4>
          {sortControl}
        </div>
        <div className="contest-grid">
          {sortedContestRows.map((contestRow) => (
            <div key={contestRow.contest?.id ?? 'legacy'}>
              {!contest && <strong>{contestRow.contest?.name ?? 'Legacy candidate scores'}</strong>}
              <div className="contest-candidate-list">
                {contestRow.candidates.map((row, index) => (
                  <div className="contest-row" key={row.candidate.id}>
                    <span>{index + 1}. {candidateName(row.candidate)}</span>
                    <b>{formatScore(row.score)}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </article>
    );
  }

  const data = getReportPanelData(panel, db, election, contest);
  const sortedData = isCandidateReport ? sortCandidateReportData(data, db, candidateSort) : data;
  if (panel.type === 'list') {
    return (
      <article className="report-panel">
        <div className="report-panel-heading">
          <h4>{panel.name}</h4>
          {sortControl}
        </div>
        <ul className="report-list">
          {sortedData.map((item) => <li key={item.id}>{item.label}</li>)}
        </ul>
      </article>
    );
  }

  return (
    <article className="report-panel">
      <div className="report-panel-heading">
        <h4>{panel.name}</h4>
        {sortControl}
      </div>
      <BarChart data={sortedData} horizontal={panel.horizontal === true} />
    </article>
  );
}

function CandidateReportSortControl({
  isOpen,
  onOpenChange,
  onSortChange,
  sort,
  valueLabel
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSortChange: (sort: CandidateReportSort) => void;
  sort: CandidateReportSort;
  valueLabel: string;
}) {
  const activeLabel = sort === 'name' ? 'Name (A-Z)' : valueLabel;

  function selectSort(nextSort: CandidateReportSort) {
    onSortChange(nextSort);
    onOpenChange(false);
  }

  return (
    <div className="report-sort">
      <button type="button" aria-expanded={isOpen} className="report-sort-trigger" onClick={() => onOpenChange(!isOpen)}>
        Sort: {activeLabel} <ChevronDown size={14} />
      </button>
      {isOpen && (
        <div className="report-sort-menu">
          <button type="button" className={sort === 'name' ? 'selected' : ''} onClick={() => selectSort('name')}>Name (A-Z)</button>
          <button type="button" className={sort === 'value' ? 'selected' : ''} onClick={() => selectSort('value')}>{valueLabel}</button>
        </div>
      )}
    </div>
  );
}

function sortCandidateReportData(data: ReportDatum[], db: Database, sort: CandidateReportSort) {
  const candidates = new Map(db.candidates.map((candidate) => [candidate.id, candidate]));
  return [...data].sort((left, right) => {
    if (sort === 'value') return compareNullableNumbersDesc(left.value, right.value) || compareReportCandidateNames(left, right, candidates);
    return compareReportCandidateNames(left, right, candidates);
  });
}

function sortCandidateContestRows(rows: Array<{ candidate: Candidate; score: number }>, sort: CandidateReportSort) {
  return [...rows].sort((left, right) => {
    if (sort === 'value') return right.score - left.score || compareCandidatesByLastWord(left.candidate, right.candidate);
    return compareCandidatesByLastWord(left.candidate, right.candidate);
  });
}

function compareReportCandidateNames(left: ReportDatum, right: ReportDatum, candidates: Map<Id, Candidate>) {
  const leftCandidate = candidates.get(left.id);
  const rightCandidate = candidates.get(right.id);
  if (leftCandidate && rightCandidate) return compareCandidatesByLastWord(leftCandidate, rightCandidate);
  return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }) || left.id - right.id;
}

function compareNullableNumbersDesc(left: number | null, right: number | null) {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function candidateReportValueLabel(panel: ReportPanel) {
  if (panel.type === 'candidate-contest') return 'Score';
  if (panel.yAxis === 'score') return 'Score';
  if (panel.yAxis === 'confidence') return 'Confidence';
  if (panel.yAxis === 'stancesCount') return 'Stances';
  if (panel.yAxis === 'confidenceScoreProduct') return 'Confidence Score Product';
  return panel.name;
}

function BarChart({ data, horizontal }: { data: ReportDatum[]; horizontal: boolean }) {
  const max = Math.max(1, ...data.map((item) => Math.abs(item.value ?? 0)));
  if (data.length === 0) return <p className="empty-report">No report data.</p>;
  if (!horizontal) {
    return (
      <div className="column-chart">
        <div className="chart-plot">
          {data.map((item) => {
            const percent = Math.max(1, Math.abs(item.value ?? 0) / max * 100);
            return (
              <div className="chart-column" key={item.id}>
                <b>{formatScore(item.value)}</b>
                <i
                  aria-label={`${item.label}: ${formatScore(item.value)}`}
                  style={{
                    '--bar-percent': `${percent}%`,
                    background: item.color ?? '#176b87'
                  } as CSSProperties}
                />
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="bar-chart">
      {data.map((item) => {
        const percent = Math.max(1, Math.abs(item.value ?? 0) / max * 100);
        return (
          <div className="bar-row" key={item.id}>
            <span>{item.label}</span>
            <div className="bar-axis">
              <i
                aria-label={`${item.label}: ${formatScore(item.value)}`}
                style={{
                  '--bar-percent': `${percent}%`,
                  background: item.color ?? '#176b87'
                } as CSSProperties}
              />
            </div>
            <b>{formatScore(item.value)}</b>
          </div>
        );
      })}
    </div>
  );
}

function Editor({
  db,
  tab,
  row,
  onCreateCandidate,
  onCreateIssue,
  onCreateContest,
  onSaveContest,
  onDeleteContest,
  onSaveElectionStore,
  onDeleteElectionStore,
  expandedCandidateId,
  expandedStanceId,
  onElectionExpansionChange,
  onSave,
  onDelete
}: {
  db: Database;
  tab: Tab;
  row: Database[EntityKey][number];
  onCreateCandidate: (name: string) => Promise<Id>;
  onCreateIssue: (name: string) => Promise<Id>;
  onCreateContest: (name: string, electionId: Id) => Promise<Contest>;
  onSaveContest: (contest: Contest) => void | Promise<void>;
  onDeleteContest: (id: Id) => void;
  onSaveElectionStore: <TStore extends EntityKey>(storeName: TStore, row: Database[TStore][number], electionId: Id) => Promise<void>;
  onDeleteElectionStore: <TStore extends EntityKey>(storeName: TStore, id: Id, electionId: Id) => Promise<void>;
  expandedCandidateId: Id | null;
  expandedStanceId: Id | null;
  onElectionExpansionChange: (candidateId: Id | null, stanceId?: Id | null) => void;
  onSave: (row: Database[EntityKey][number]) => void | Promise<void>;
  onDelete: (id: Id) => void;
}) {
  const [draft, setDraft] = useState(row);
  const contestScores = useMemo(() => tab.key === 'elections' ? getCandidateContestRows(db, draft as Election).map((contestScore) => ({
    ...contestScore,
    candidates: [...contestScore.candidates].sort((left, right) => compareCandidatesByLastWord(left.candidate, right.candidate))
  })) : [], [db, draft, tab.key]);

  function update(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }) as typeof row);
  }

  const autoSave = useDebouncedAutoSave(draft, onSave);

  return (
    <form className="editor" onSubmit={(event) => event.preventDefault()}>
      <div className="editor-title">
        <div>
          <span>ID {draft.id}</span>
          <h3>{rowTitle(tab.key, draft, db)}</h3>
        </div>
        <div className="actions">
          <ConfirmableDeleteButton className="danger" onConfirm={() => { autoSave.cancel(); onDelete(draft.id); }}>Delete</ConfirmableDeleteButton>
        </div>
      </div>
      {tab.key === 'elections' ? (
        <>
          <div className="form-grid">
            {tab.fields.filter((field) => field.type !== 'electionContests' && field.type !== 'electionIssues').map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={(draft as Record<string, unknown>)[field.key]}
                db={db}
                electionId={draft.id}
                onCreateCandidate={onCreateCandidate}
                onCreateIssue={onCreateIssue}
                onCreateContest={onCreateContest}
                onSaveContest={onSaveContest}
                onDeleteContest={onDeleteContest}
                onChange={(value) => update(field.key, value)}
              />
            ))}
          </div>
          <div className="election-editor-columns">
            {tab.fields.filter((field) => field.type === 'electionContests' || field.type === 'electionIssues').map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={(draft as Record<string, unknown>)[field.key]}
                db={db}
                electionId={draft.id}
                onCreateCandidate={onCreateCandidate}
                onCreateIssue={onCreateIssue}
                onCreateContest={onCreateContest}
                onSaveContest={onSaveContest}
                onDeleteContest={onDeleteContest}
                onChange={(value) => update(field.key, value)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="form-grid">
          {tab.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={(draft as Record<string, unknown>)[field.key]}
              db={db}
              electionId={null}
              onCreateCandidate={onCreateCandidate}
              onCreateIssue={onCreateIssue}
              onCreateContest={onCreateContest}
              onSaveContest={onSaveContest}
              onDeleteContest={onDeleteContest}
              onChange={(value) => update(field.key, value)}
            />
          ))}
        </div>
      )}
      {tab.key === 'elections' && (
        <>
          <section className="scores">
            <h4>Election scoring</h4>
            <div className="score-contest-grid">
              {contestScores.length === 0 && <p>No contests created.</p>}
              {contestScores.map((contestScore) => (
                <div className="score-contest" key={contestScore.contest?.id ?? 'legacy'}>
                  <strong>{contestScore.contest?.name ?? 'Legacy candidate scores'}</strong>
                  <div className="score-grid">
                    {contestScore.candidates.map((score) => (
                      <button
                        className={expandedCandidateId === score.candidate.id ? 'score-card expanded' : 'score-card'}
                        key={score.candidate.id}
                        type="button"
                        onClick={() => onElectionExpansionChange(expandedCandidateId === score.candidate.id ? null : score.candidate.id)}
                      >
                        {expandedCandidateId === score.candidate.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span>
                          <strong>{candidateName(score.candidate)}</strong>
                          <b>{formatScore(score.score)} points</b>
                        </span>
                      </button>
                    ))}
                  </div>
                  {contestScore.candidates.map((score) => expandedCandidateId === score.candidate.id ? (
                    <CandidateStanceEditor
                      candidate={score.candidate}
                      db={db}
                      election={draft as Election}
                      expandedStanceId={expandedStanceId}
                      key={`stances-${score.candidate.id}`}
                      onDeleteEntity={onDeleteElectionStore}
                      onExpandedStanceChange={(stanceId) => onElectionExpansionChange(score.candidate.id, stanceId)}
                      onSaveEntity={onSaveElectionStore}
                    />
                  ) : null)}
                </div>
              ))}
            </div>
          </section>
          <ReportsView db={db} election={draft as Election} />
        </>
      )}
    </form>
  );
}

function CandidateStanceEditor({
  candidate,
  db,
  election,
  expandedStanceId,
  onSaveEntity,
  onDeleteEntity,
  onExpandedStanceChange
}: {
  candidate: Candidate;
  db: Database;
  election: Election;
  expandedStanceId: Id | null;
  onSaveEntity: <TStore extends EntityKey>(storeName: TStore, row: Database[TStore][number], electionId: Id) => Promise<void>;
  onDeleteEntity: <TStore extends EntityKey>(storeName: TStore, id: Id, electionId: Id) => Promise<void>;
  onExpandedStanceChange: (stanceId: Id | null) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const electionIssues = election.issues
    .map((electionIssue) => ({
      electionIssue,
      issue: db.issues.find((issue) => issue.id === electionIssue.issueId) ?? null,
      stance: db.stances.find((stance) => stance.candidate === candidate.id && stance.issue === electionIssue.issueId) ?? null
    }))
    .filter((item) => item.issue !== null)
    .sort((a, b) => {
      const pointsDiff = b.electionIssue.points - a.electionIssue.points;
      if (pointsDiff !== 0) return pointsDiff;
      return issueName(a.issue).localeCompare(issueName(b.issue), undefined, { sensitivity: 'base' });
    });

  async function createStance(issueId: Id) {
    const now = new Date().toISOString();
    const stance: Stance = {
      id: nextId(db.stances),
      date_created: now,
      date_updated: now,
      title: '',
      candidate: candidate.id,
      issue: issueId,
      rating: null,
      confidence: null,
      description: null
    };
    await onSaveEntity('stances', stance, election.id);
    onExpandedStanceChange(stance.id);
  }

  async function toggleStanceRow(stance: Stance | null, issueId: Id, isExpanded: boolean) {
    if (stance) {
      onExpandedStanceChange(isExpanded ? null : stance.id);
      return;
    }
    await createStance(issueId);
  }

  useEffect(() => {
    if (expandedStanceId !== null) return;
    const frame = window.requestAnimationFrame(() => {
      if (!panelRef.current || isElementInScrollView(panelRef.current)) return;
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [candidate.id, expandedStanceId]);

  return (
    <section className="candidate-stance-panel" ref={panelRef}>
      <h5>{candidateName(candidate)} stances</h5>
      <div className="stance-list">
        {electionIssues.length === 0 && <p>No election issues selected. Add an issue to create candidate stances.</p>}
        {electionIssues.map(({ electionIssue, issue, stance }) => {
          const isExpanded = stance !== null && expandedStanceId === stance.id;
          const factCount = stance ? countStanceFacts(db, stance.id) : 0;
          return (
            <article className="stance-row" key={electionIssue.issueId}>
              <div className="stance-row-summary">
                <button
                  type="button"
                  onClick={() => { void toggleStanceRow(stance, electionIssue.issueId, isExpanded); }}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <span>
                    <strong>{issueName(issue)}</strong>
                    <small>{stance ? `${stanceName(stance)} · rating ${formatScore(stance.rating)} · confidence ${formatScore(stance.confidence)} · ${formatScore(factCount)} linked facts` : 'No stance yet. Click to create and expand.'}</small>
                  </span>
                </button>
              </div>
              {stance && isExpanded && (
                <StanceDetailEditor
                  db={db}
                  electionId={election.id}
                  onDeleteEntity={onDeleteEntity}
                  onSaveEntity={onSaveEntity}
                  stance={stance}
                />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StanceDetailEditor({
  db,
  electionId,
  stance,
  onSaveEntity,
  onDeleteEntity
}: {
  db: Database;
  electionId: Id;
  stance: Stance;
  onSaveEntity: <TStore extends EntityKey>(storeName: TStore, row: Database[TStore][number], electionId: Id) => Promise<void>;
  onDeleteEntity: <TStore extends EntityKey>(storeName: TStore, id: Id, electionId: Id) => Promise<void>;
}) {
  const detailRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(stance);
  const [addOpen, setAddOpen] = useState(false);
  const [isCreatingFact, setIsCreatingFact] = useState(false);
  const [createdFactId, setCreatedFactId] = useState<Id | null>(null);
  const [factSearch, setFactSearch] = useState('');
  const linkedRows = db.stanceFacts
    .filter((link) => link.stance === stance.id)
    .map((link) => ({ link, fact: db.facts.find((fact) => fact.id === link.fact) ?? null }))
    .filter((item): item is { link: StanceFact; fact: Fact } => item.fact !== null);
  const availableFacts = getAvailableFactsForStance(db, stance.id);
  const filteredFacts = filterByName(availableFacts, factName, factSearch)
    .sort((left, right) => factName(left).localeCompare(factName(right), undefined, { sensitivity: 'base' }) || left.id - right.id);
  const newFactSummary = factSearch.trim();

  useEffect(() => {
    setDraft(stance);
  }, [stance.id]);

  useDebouncedAutoSave(draft, (nextDraft) => onSaveEntity('stances', { ...nextDraft, date_updated: new Date().toISOString() }, electionId));

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stanceRow = detailRef.current?.closest<HTMLElement>('.stance-row') ?? detailRef.current;
      stanceRow?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [stance.id]);

  async function createFact(summary: string) {
    const now = new Date().toISOString();
    const fact: Fact = { id: nextId(db.facts), date_created: now, date_updated: now, Summary: summary, description: null };
    const link: StanceFact = { id: nextId(db.stanceFacts), stance: stance.id, fact: fact.id };
    setIsCreatingFact(true);
    try {
      await Promise.all([
        onSaveEntity('facts', fact, electionId),
        onSaveEntity('stanceFacts', link, electionId)
      ]);
      setCreatedFactId(fact.id);
      setFactSearch('');
      setAddOpen(false);
    } finally {
      setIsCreatingFact(false);
    }
  }

  async function linkFact(fact: Fact) {
    const link: StanceFact = { id: nextId(db.stanceFacts), stance: stance.id, fact: fact.id };
    await onSaveEntity('stanceFacts', link, electionId);
    setCreatedFactId(null);
    setFactSearch('');
    setAddOpen(false);
  }

  return (
    <div className="stance-detail" ref={detailRef}>
      <div className="stance-form-grid">
        <label>Title<input value={draft.title ?? ''} onChange={(event) => setDraft({ ...draft, title: event.target.value || null })} /></label>
        <label>Rating<input type="number" step="any" value={draft.rating ?? ''} onChange={(event) => setDraft({ ...draft, rating: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label>Confidence<input type="number" step="any" value={draft.confidence ?? ''} onChange={(event) => setDraft({ ...draft, confidence: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label className="wide">Description<textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} /></label>
      </div>
      <section className="stance-facts">
        <div className="stance-facts-heading">
          <h6>Linked facts</h6>
        </div>
        <div className="fact-editor-list">
          {linkedRows.length === 0 && <p>No facts linked.</p>}
          {linkedRows.map(({ link, fact }) => (
            <FactInlineEditor
              fact={fact}
              key={link.id}
              focusDescription={fact.id === createdFactId}
              onDescriptionFocused={() => setCreatedFactId(null)}
              onSave={(nextFact) => onSaveEntity('facts', nextFact, electionId)}
              onDelete={async () => {
                await onDeleteEntity('stanceFacts', link.id, electionId);
                await onDeleteEntity('facts', fact.id, electionId);
              }}
            />
          ))}
        </div>
        {addOpen && (
          <div className="add-menu stance-fact-add-menu">
            <label>
              Fact
              <input
                value={factSearch}
                placeholder="Search existing facts or type a new fact"
                onChange={(event) => setFactSearch(event.target.value)}
              />
            </label>
            <div className="add-options">
              {filteredFacts.length === 0 && <p>No available facts match.</p>}
              {filteredFacts.map((fact) => (
                <button type="button" key={fact.id} onClick={() => { void linkFact(fact); }}>
                  <div className="fact-option-copy">
                    <strong>{factName(fact)}</strong>
                    <span>{fact.description || 'No description.'}</span>
                  </div>
                </button>
              ))}
            </div>
            <button type="button" className="create-option" disabled={!newFactSummary || isCreatingFact} onClick={() => createFact(newFactSummary)}>
              <Plus size={16} />
              <span>{isCreatingFact ? 'Creating fact...' : newFactSummary ? `Create fact "${newFactSummary}"` : 'Create fact'}</span>
            </button>
          </div>
        )}
        <button type="button" className="add-trigger stance-fact-add-trigger" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>
          <Plus size={16} /> Add fact
        </button>
      </section>
    </div>
  );
}

function FactInlineEditor({
  fact,
  focusDescription = false,
  onDescriptionFocused,
  onSave,
  onDelete
}: {
  fact: Fact;
  focusDescription?: boolean;
  onDescriptionFocused?: () => void;
  onSave: (fact: Fact) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  const editorRef = useRef<HTMLElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(fact);

  useEffect(() => {
    setDraft(fact);
  }, [fact.id]);

  const autoSave = useDebouncedAutoSave(draft, (nextDraft) => onSave({ ...nextDraft, date_updated: new Date().toISOString() }));

  useEffect(() => {
    if (!focusDescription) return;
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      descriptionRef.current?.focus({ preventScroll: true });
      onDescriptionFocused?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusDescription, onDescriptionFocused]);

  return (
    <section className="fact-inline-editor" ref={editorRef}>
      <label>Summary<input value={draft.Summary ?? ''} onChange={(event) => setDraft({ ...draft, Summary: event.target.value || null })} /></label>
      <label>Description<textarea ref={descriptionRef} value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} /></label>
      <div className="fact-actions">
        <ConfirmableDeleteButton className="danger" onConfirm={() => { autoSave.cancel(); return onDelete(); }}>Delete</ConfirmableDeleteButton>
      </div>
    </section>
  );
}

function FieldInput({
  field,
  value,
  db,
  electionId,
  onCreateCandidate,
  onCreateIssue,
  onCreateContest,
  onSaveContest,
  onDeleteContest,
  onChange
}: {
  field: Field;
  value: unknown;
  db: Database;
  electionId: Id | null;
  onCreateCandidate: (name: string) => Promise<Id>;
  onCreateIssue: (name: string) => Promise<Id>;
  onCreateContest: (name: string, electionId: Id) => Promise<Contest>;
  onSaveContest: (contest: Contest) => void | Promise<void>;
  onDeleteContest: (id: Id) => void;
  onChange: (value: unknown) => void;
}) {
  const textValue = value === null || value === undefined ? '' : String(value);
  if (field.type === 'textarea') {
    return <label className="wide">{field.label}<textarea value={textValue} onChange={(event) => onChange(nullable(event.target.value, field))} /></label>;
  }
  if (field.type === 'number') {
    return <label>{field.label}<input type="number" step="any" value={textValue} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} /></label>;
  }
  if (field.type === 'date') {
    return <label>{field.label}<input type="datetime-local" value={toDateInput(textValue)} onChange={(event) => onChange(event.target.value ? new Date(event.target.value).toISOString() : null)} /></label>;
  }
  if (field.type === 'select' && field.entity) {
    return (
      <label>{field.label}
        <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
          <option value="">None</option>
          {db[field.entity].map((row) => <option key={row.id} value={row.id}>{recordName(field.entity!, row.id, db)}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === 'electionContests' && electionId !== null) {
    return (
      <ElectionContestEditor
        candidates={db.candidates}
        contests={db.contests.filter((contest) => contest.electionId === electionId)}
        electionId={electionId}
        onCreateCandidate={onCreateCandidate}
        onCreateContest={onCreateContest}
        onSaveContest={onSaveContest}
        onDeleteContest={onDeleteContest}
      />
    );
  }
  if (field.type === 'electionIssues') {
    return <ElectionIssueEditor db={db} electionId={electionId} issues={db.issues} value={value as ElectionIssue[] ?? []} onCreateIssue={onCreateIssue} onChange={onChange} />;
  }
  return <label>{field.label}<input value={textValue} onChange={(event) => onChange(nullable(event.target.value, field))} /></label>;
}

function ElectionContestEditor({
  candidates,
  contests,
  electionId,
  onCreateCandidate,
  onCreateContest,
  onSaveContest,
  onDeleteContest
}: {
  candidates: Candidate[];
  contests: Contest[];
  electionId: Id;
  onCreateCandidate: (name: string) => Promise<Id>;
  onCreateContest: (name: string, electionId: Id) => Promise<Contest>;
  onSaveContest: (contest: Contest) => void | Promise<void>;
  onDeleteContest: (id: Id) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');

  async function addContest(name: string) {
    await onCreateContest(name, electionId);
    setSearch('');
    setAddOpen(false);
  }

  return (
    <fieldset className="wide included-editor">
      <legend>Contests in this election</legend>
      <div className="contest-editor-list">
        {contests.length === 0 && <p>No contests created.</p>}
        {contests.map((contest) => (
          <ContestEditor
            candidates={candidates}
            contest={contest}
            key={contest.id}
            onCreateCandidate={onCreateCandidate}
            onSaveContest={onSaveContest}
            onDeleteContest={onDeleteContest}
          />
        ))}
      </div>
      <SearchAddPopover
        buttonLabel="Add contest"
        createLabel="Create contest"
        isOpen={addOpen}
        onOpenChange={setAddOpen}
        search={search}
        onSearchChange={setSearch}
        placeholder="Type a contest"
        emptyText=""
        showResults={false}
        onCreate={addContest}
      />
    </fieldset>
  );
}

function ContestEditor({
  candidates,
  contest,
  onCreateCandidate,
  onSaveContest,
  onDeleteContest
}: {
  candidates: Candidate[];
  contest: Contest;
  onCreateCandidate: (name: string) => Promise<Id>;
  onSaveContest: (contest: Contest) => void | Promise<void>;
  onDeleteContest: (id: Id) => void;
}) {
  const [draft, setDraft] = useState(contest);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const included = candidates.filter((candidate) => draft.candidateIds.includes(candidate.id));
  const available = candidates.filter((candidate) => !draft.candidateIds.includes(candidate.id));
  const filtered = filterByName(available, candidateName, search);

  useEffect(() => {
    setDraft(contest);
  }, [contest.id]);

  const autoSave = useDebouncedAutoSave(draft, onSaveContest);

  function updateContest(nextContest: Contest) {
    setDraft(nextContest);
  }

  async function addCandidate(name: string) {
    const id = await onCreateCandidate(name);
    updateContest({ ...draft, candidateIds: [...draft.candidateIds, id] });
    setSearch('');
    setAddOpen(false);
  }

  return (
    <section className="contest-editor">
      <div className="contest-editor-heading">
        <input
          aria-label="Contest name"
          value={draft.name}
          onChange={(event) => updateContest({ ...draft, name: event.target.value })}
        />
        <ConfirmableDeleteButton className="danger" aria-label={`Delete ${draft.name}`} onConfirm={() => { autoSave.cancel(); onDeleteContest(draft.id); }} />
      </div>
      <div className="included-list">
        {included.length === 0 && <p>No candidates selected.</p>}
        {included.map((candidate) => (
          <div className="included-row" key={candidate.id}>
            <span>{candidateName(candidate)}</span>
            <button type="button" aria-label={`Remove ${candidateName(candidate)}`} onClick={() => updateContest({ ...draft, candidateIds: draft.candidateIds.filter((id) => id !== candidate.id) })}><X size={16} /></button>
          </div>
        ))}
      </div>
      <SearchAddPopover
        buttonLabel="Add candidate"
        createLabel="Create candidate"
        isOpen={addOpen}
        onOpenChange={setAddOpen}
        search={search}
        onSearchChange={setSearch}
        placeholder="Search or type a candidate"
        results={filtered}
        getResultKey={(candidate) => candidate.id}
        renderResult={(candidate) => candidateName(candidate)}
        emptyText="No available candidates match."
        onSelect={(candidate) => {
          updateContest({ ...draft, candidateIds: [...draft.candidateIds, candidate.id] });
          setSearch('');
          setAddOpen(false);
        }}
        onCreate={addCandidate}
      />
    </section>
  );
}

function ElectionIssueEditor({
  db,
  electionId,
  issues,
  value,
  onCreateIssue,
  onChange
}: {
  db: Database;
  electionId: Id | null;
  issues: Issue[];
  value: ElectionIssue[];
  onCreateIssue: (name: string) => Promise<Id>;
  onChange: (value: ElectionIssue[]) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const included = value
    .map((item) => ({ ...item, issue: issues.find((issue) => issue.id === item.issueId) ?? null }))
    .filter((item) => item.issue !== null)
    .sort((a, b) => b.points - a.points || issueName(a.issue).localeCompare(issueName(b.issue)));
  const selected = new Set(value.map((item) => item.issueId));
  const available = issues.filter((issue) => !selected.has(issue.id));
  const filtered = filterByName(available, issueName, search);
  const candidateIds = electionId === null ? undefined : new Set(getElectionContests(db, electionId).flatMap((contest) => contest.candidateIds));

  async function addIssue(name: string) {
    const id = await onCreateIssue(name);
    onChange([...value, { issueId: id, points: 0 }]);
    setSearch('');
    setAddOpen(false);
  }

  return (
    <fieldset className="wide included-editor">
      <legend>Issues in this election</legend>
      <div className="included-list">
        {included.length === 0 && <p>No issues selected.</p>}
        {included.map((item) => (
          <div className="included-row issue-row" key={item.issueId}>
            <div className="issue-card-copy">
              <strong>{issueName(item.issue)}</strong>
              <span>{item.issue?.description || 'No description.'}</span>
              <span>Confidence: {formatScore(averageIssueConfidence(db, item.issueId, candidateIds))}</span>
            </div>
            <label className="points-input">
              <span>Points</span>
              <input aria-label={`${issueName(item.issue)} points`} type="number" step="any" value={item.points} onFocus={(event) => event.target.select()} onChange={(event) => onChange(value.map((row) => row.issueId === item.issueId ? { ...row, points: Number(event.target.value) } : row))} />
            </label>
            <button type="button" aria-label={`Remove ${issueName(item.issue)}`} onClick={() => onChange(value.filter((row) => row.issueId !== item.issueId))}><X size={16} /></button>
          </div>
        ))}
      </div>
      <SearchAddPopover
        buttonLabel="Add issue"
        createLabel="Create issue"
        isOpen={addOpen}
        onOpenChange={setAddOpen}
        search={search}
        onSearchChange={setSearch}
        placeholder="Search or type an issue"
        results={filtered}
        getResultKey={(issue) => issue.id}
        renderResult={(issue) => issueName(issue)}
        renderOption={(issue) => (
          <div className="issue-card-copy">
            <strong>{issueName(issue)}</strong>
            <span>{issue.description || 'No description.'}</span>
            <span>{formatScore(countIssueStances(db, issue.id))} stances, {getIssueElectionCount(db, issue.id)} elections</span>
          </div>
        )}
        emptyText="No available issues match."
        onSelect={(issue) => {
          onChange([...value, { issueId: issue.id, points: 0 }]);
          setSearch('');
          setAddOpen(false);
        }}
        onCreate={addIssue}
      />
    </fieldset>
  );
}

function SearchAddPopover<TItem>({
  buttonLabel,
  createLabel,
  isOpen,
  onOpenChange,
  search,
  onSearchChange,
  placeholder,
  results = [],
  getResultKey,
  renderResult,
  renderOption,
  renderMeta,
  emptyText,
  showResults = true,
  onSelect,
  onCreate
}: {
  buttonLabel: string;
  createLabel: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  results?: TItem[];
  getResultKey?: (item: TItem) => Id;
  renderResult?: (item: TItem) => string;
  renderOption?: (item: TItem) => ReactNode;
  renderMeta?: (item: TItem) => string;
  emptyText: string;
  showResults?: boolean;
  onSelect?: (item: TItem) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createName = search.trim();

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  return (
    <div className="add-popover" ref={containerRef}>
      <button type="button" className="add-trigger" aria-expanded={isOpen} onClick={() => onOpenChange(!isOpen)}>
        <Plus size={16} /> {buttonLabel}
      </button>
      {isOpen && (
        <div className="add-menu">
          <input
            ref={searchRef}
            value={search}
            placeholder={placeholder}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {showResults && (
            <div className="add-options">
              {results.length === 0 && <p>{emptyText}</p>}
              {results.map((item) => (
                <button type="button" key={getResultKey?.(item)} onClick={() => onSelect?.(item)}>
                  {renderOption ? renderOption(item) : (
                    <>
                      <span>{renderResult?.(item)}</span>
                      {renderMeta && <small>{renderMeta(item)}</small>}
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="create-option" disabled={!createName} onClick={() => onCreate(createName)}>
            <Plus size={16} />
            <span>{createName ? `${createLabel} "${createName}"` : createLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function filterByName<TItem>(items: TItem[], getName: (item: TItem) => string, search: string) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  if (!normalizedSearch) return items;
  return items.filter((item) => getName(item).toLocaleLowerCase().includes(normalizedSearch));
}

function rowTitle(entity: EntityKey, row: Database[EntityKey][number], db: Database) {
  if (entity === 'candidates') return candidateName(row as Candidate);
  if (entity === 'issues') return issueName(row as Issue);
  if (entity === 'stances') return stanceName(row as Stance);
  if (entity === 'facts') return factName(row as Fact);
  if (entity === 'elections') return (row as Election).name;
  if (entity === 'firstRecords') return (row as First).name || `First #${row.id}`;
  if (entity === 'stanceFacts') return `Link #${row.id}`;
  return `Record #${row.id}`;
}

function getIssueElectionCount(db: Database, issueId: Id) {
  return db.elections.filter((election) => election.issues.some((issue) => issue.issueId === issueId)).length;
}

function sortRowsForTab<TStore extends EntityKey>(rows: Database[TStore], entity: TStore, db: Database): Database[TStore] {
  if (entity === 'elections') {
    return [...rows].sort((left, right) => compareUpdatedDates(left as Election, right as Election)) as Database[TStore];
  }
  if (entity === 'issues') {
    return [...rows].sort((left, right) => (
      countIssueStances(db, (right as Issue).id) - countIssueStances(db, (left as Issue).id) ||
      issueName(left as Issue).localeCompare(issueName(right as Issue))
    )) as Database[TStore];
  }
  return rows;
}

function compareUpdatedDates(left: Election, right: Election) {
  return dateValue(right.date_updated) - dateValue(left.date_updated) || left.name.localeCompare(right.name);
}

function dateValue(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Number.NEGATIVE_INFINITY : date.getTime();
}

function withUpdatedDate(election: Election): Election {
  return { ...election, date_updated: new Date().toISOString() };
}

function touchElectionForContest(contest: Contest, db: Database): Election | null {
  const election = db.elections.find((row) => row.id === contest.electionId);
  return election ? withUpdatedDate(election) : null;
}

function formatUpdatedDate(value: string | null) {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function nullable(value: string, field: Field) {
  return value === '' && field.nullable ? null : value;
}

function toDateInput(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16);
}

function formatScore(value: number | null | undefined) {
  return value === null || value === undefined || Number.isNaN(value) ? 'n/a' : new Intl.NumberFormat().format(Math.round(value * 100) / 100);
}
