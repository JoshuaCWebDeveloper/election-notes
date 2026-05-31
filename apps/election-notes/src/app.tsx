import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Copy, Download, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { canRestoreSeedData, createBackupJson, deleteEntity, loadDatabase, restoreDatabaseFromJson, restoreDatabaseFromSeed, saveEntity, type EntityKey } from './services/database';
import { candidateFromInlineName, contestFromInlineName, duplicateElection, duplicateElectionContests, issueFromInlineName, nextId } from './services/elections';
import { averageIssueConfidence, countIssueStances, getCandidateContestRows, getElectionCandidateCount, getElectionContestCount, getElectionContests, getReportPanelData, reportDashboards, type ReportDatum, type ReportPanel } from './services/reports';
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

const autoSaveDelayMs = 700;

function useDebouncedAutoSave<T>(value: T, onSave: (value: T) => void | Promise<void>, delay = autoSaveDelayMs) {
  const isInitialValue = useRef(true);
  const latestSave = useRef(onSave);
  const latestValue = useRef(value);
  const pending = useRef(false);
  const timerRef = useRef<number | null>(null);

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

  useEffect(() => () => {
    if (pending.current) {
      pending.current = false;
      void latestSave.current(latestValue.current);
    }
  }, []);

  return {
    cancel() {
      pending.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  };
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

export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [activeKey, setActiveKey] = useState<EntityKey>('elections');
  const active = tabs.find((tab) => tab.key === activeKey)!;
  const rows = db?.[active.key] ?? [];
  const visibleRows = useMemo(() => db ? sortRowsForTab(rows, active.key, db) : rows, [active.key, db, rows]);
  const [selectedId, setSelectedId] = useState<Id>(visibleRows[0]?.id ?? 0);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreUseSeed, setRestoreUseSeed] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const seedRestoreAvailable = canRestoreSeedData();
  const selected = db ? rows.find((row) => row.id === selectedId) ?? visibleRows[0] ?? active.blank(db) : null;

  useEffect(() => {
    let cancelled = false;
    loadDatabase().then((data) => {
      if (cancelled) return;
      setDb(data);
      setSelectedId(sortRowsForTab(data[activeKey], activeKey, data)[0]?.id ?? 0);
    }).catch((error: unknown) => {
      console.error('Failed to load IndexedDB database', error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(row: Database[EntityKey][number]) {
    if (!db) return;
    const rowToSave = active.key === 'elections' ? withUpdatedDate(row as Election) : row;
    const nextRows = rows.some((item) => item.id === row.id)
      ? rows.map((item) => item.id === row.id ? rowToSave : item)
      : [...rows, rowToSave];
    await saveEntity(active.key, rowToSave);
    setDb({ ...db, [active.key]: nextRows });
    setSelectedId(rowToSave.id);
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
    if (!db || active.key !== 'elections') return;
    const copy = duplicateElection(selected as Election, db);
    await saveEntity('elections', copy);
    const contests = duplicateElectionContests((selected as Election).id, copy.id, db);
    await Promise.all(contests.map((contest) => saveEntity('contests', contest)));
    setDb({ ...db, elections: [...db.elections, copy], contests: [...db.contests, ...contests] });
    setSelectedId(copy.id);
  }

  async function remove(id: Id) {
    if (!db) return;
    const nextRows = rows.filter((row) => row.id !== id);
    await deleteEntity(active.key, id);
    if (active.key === 'elections') {
      const contestIds = db.contests.filter((contest) => contest.electionId === id).map((contest) => contest.id);
      await Promise.all(contestIds.map((contestId) => deleteEntity('contests', contestId)));
      setDb({ ...db, elections: nextRows as Election[], contests: db.contests.filter((contest) => contest.electionId !== id) });
    } else {
      setDb({ ...db, [active.key]: nextRows });
    }
    setSelectedId(nextRows[0]?.id ?? 0);
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
      setSelectedId(data[active.key][0]?.id ?? 0);
      setRestoreOpen(false);
      setRestoreUseSeed(false);
      setRestoreFile(null);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : 'Restore failed.');
    } finally {
      setRestoreBusy(false);
    }
  }

  if (!db || !selected) {
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
            <button className={tab.key === active.key ? 'active' : ''} key={tab.key} onClick={() => { setActiveKey(tab.key); setSelectedId(sortRowsForTab(db[tab.key], tab.key, db)[0]?.id ?? 0); }}>
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
        <header>
          <div>
            <h2>{active.label}</h2>
            <p>{active.key === 'elections' ? 'Election issue points are stored per election and used for scoring.' : 'Create, edit, delete, and connect SQL-derived records.'}</p>
          </div>
          <div className="header-actions">
            {active.key === 'elections' && <button onClick={duplicateSelectedElection}><Copy size={16} /> Duplicate</button>}
            <button onClick={() => { const row = active.blank(db); save(row); }}><Plus size={16} /> New</button>
          </div>
        </header>
        <div className="content">
          <div className="list">
            {visibleRows.map((row) => (
              <button className={row.id === selected.id ? 'selected' : ''} key={row.id} onClick={() => setSelectedId(row.id)}>
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
            onSave={save}
            onDelete={remove}
          />
        </div>
      </section>
    </main>
  );
}

function ReportsView({ db, election }: { db: Database; election: Election }) {
  return (
    <section className="reports" aria-labelledby="reports-title">
      <div className="reports-heading">
        <div>
          <h2 id="reports-title">Directus Reports</h2>
          <p>Dashboards and panels recovered from db-directus.sql for {election.name}.</p>
        </div>
      </div>
      <div className="dashboard-grid">
        {reportDashboards.map((dashboard) => (
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

function ReportPanelView({ db, election, panel }: { db: Database; election: Election; panel: ReportPanel }) {
  if (panel.type === 'candidate-contest') {
    return (
      <article className="report-panel wide-panel">
        <h4>{panel.name}</h4>
        <div className="contest-grid">
          {getCandidateContestRows(db, election).map((contestRow) => (
            <div key={contestRow.contest?.id ?? 'legacy'}>
              <strong>{contestRow.contest?.name ?? 'Legacy candidate scores'}</strong>
              {contestRow.candidates.slice(0, 6).map((row, index) => (
                <div className="contest-row" key={row.candidate.id}>
                  <span>{index + 1}. {candidateName(row.candidate)}</span>
                  <b>{formatScore(row.score)}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
      </article>
    );
  }

  if (panel.collection === 'candidate') {
    const contests = getElectionContests(db, election.id);
    return (
      <>
        {contests.length === 0 && (
          <article className="report-panel">
            <h4>{panel.name}</h4>
            <p className="empty-report">No contests created.</p>
          </article>
        )}
        {contests.map((contest) => (
          <article className="report-panel" key={contest.id}>
            <h4>{panel.name}: {contest.name}</h4>
            <BarChart data={getReportPanelData(panel, db, election, contest)} horizontal={panel.horizontal === true} />
          </article>
        ))}
      </>
    );
  }

  const data = getReportPanelData(panel, db, election);
  if (panel.type === 'list') {
    return (
      <article className="report-panel">
        <h4>{panel.name}</h4>
        <ul className="report-list">
          {data.map((item) => <li key={item.id}>{item.label}</li>)}
        </ul>
      </article>
    );
  }

  return (
    <article className="report-panel">
      <h4>{panel.name}</h4>
      <BarChart data={data} horizontal={panel.horizontal === true} />
    </article>
  );
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
  onSave: (row: Database[EntityKey][number]) => void | Promise<void>;
  onDelete: (id: Id) => void;
}) {
  const [draft, setDraft] = useState(row);
  const [expandedCandidateId, setExpandedCandidateId] = useState<Id | null>(null);
  const contestScores = useMemo(() => tab.key === 'elections' ? getCandidateContestRows(db, draft as Election) : [], [db, draft, tab.key]);

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
      <div className="form-grid">
        {tab.fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={(draft as Record<string, unknown>)[field.key]}
            db={db}
            electionId={tab.key === 'elections' ? draft.id : null}
            onCreateCandidate={onCreateCandidate}
            onCreateIssue={onCreateIssue}
            onCreateContest={onCreateContest}
            onSaveContest={onSaveContest}
            onDeleteContest={onDeleteContest}
            onChange={(value) => update(field.key, value)}
          />
        ))}
      </div>
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
                        onClick={() => setExpandedCandidateId(expandedCandidateId === score.candidate.id ? null : score.candidate.id)}
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
                      key={`stances-${score.candidate.id}`}
                      onDeleteEntity={onDeleteElectionStore}
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
  onSaveEntity,
  onDeleteEntity
}: {
  candidate: Candidate;
  db: Database;
  election: Election;
  onSaveEntity: <TStore extends EntityKey>(storeName: TStore, row: Database[TStore][number], electionId: Id) => Promise<void>;
  onDeleteEntity: <TStore extends EntityKey>(storeName: TStore, id: Id, electionId: Id) => Promise<void>;
}) {
  const [expandedStanceId, setExpandedStanceId] = useState<Id | null>(null);
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
    setExpandedStanceId(stance.id);
  }

  async function toggleStanceRow(stance: Stance | null, issueId: Id, isExpanded: boolean) {
    if (stance) {
      setExpandedStanceId(isExpanded ? null : stance.id);
      return;
    }
    await createStance(issueId);
  }

  return (
    <section className="candidate-stance-panel">
      <h5>{candidateName(candidate)} stances</h5>
      <div className="stance-list">
        {electionIssues.length === 0 && <p>No election issues selected. Add an issue to create candidate stances.</p>}
        {electionIssues.map(({ electionIssue, issue, stance }) => {
          const isExpanded = stance !== null && expandedStanceId === stance.id;
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
                    <small>{stance ? `${stanceName(stance)} · rating ${formatScore(stance.rating)} · confidence ${formatScore(stance.confidence)}` : 'No stance yet. Click to create and expand.'}</small>
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
  const [draft, setDraft] = useState(stance);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const linkedRows = db.stanceFacts
    .filter((link) => link.stance === stance.id)
    .map((link) => ({ link, fact: db.facts.find((fact) => fact.id === link.fact) ?? null }))
    .filter((item): item is { link: StanceFact; fact: Fact } => item.fact !== null);
  const newFactSummary = search.trim();

  useEffect(() => {
    setDraft(stance);
  }, [stance.id]);

  useDebouncedAutoSave(draft, (nextDraft) => onSaveEntity('stances', { ...nextDraft, date_updated: new Date().toISOString() }, electionId));

  async function createFact(summary: string) {
    const now = new Date().toISOString();
    const fact: Fact = { id: nextId(db.facts), date_created: now, date_updated: now, Summary: summary, description: null };
    const link: StanceFact = { id: nextId(db.stanceFacts), stance: stance.id, fact: fact.id };
    await onSaveEntity('facts', fact, electionId);
    await onSaveEntity('stanceFacts', link, electionId);
    setSearch('');
    setAddOpen(false);
  }

  return (
    <div className="stance-detail">
      <div className="stance-form-grid">
        <label>Title<input value={draft.title ?? ''} onChange={(event) => setDraft({ ...draft, title: event.target.value || null })} /></label>
        <label>Rating<input type="number" step="any" value={draft.rating ?? ''} onChange={(event) => setDraft({ ...draft, rating: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label>Confidence<input type="number" step="any" value={draft.confidence ?? ''} onChange={(event) => setDraft({ ...draft, confidence: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label className="wide">Description<textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} /></label>
      </div>
      <section className="stance-facts">
        <div className="stance-facts-heading">
          <h6>Linked facts</h6>
          <div className="add-popover">
            <button type="button" className="add-trigger" aria-expanded={addOpen} onClick={() => setAddOpen(!addOpen)}>
              <Plus size={16} /> Add fact
            </button>
            {addOpen && (
              <div className="add-menu">
                <input
                  value={search}
                  placeholder="Type a fact summary"
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button type="button" className="create-option" disabled={!newFactSummary} onClick={() => createFact(newFactSummary)}>
                  <Plus size={16} />
                  <span>{newFactSummary ? `Create fact "${newFactSummary}"` : 'Create fact'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="fact-editor-list">
          {linkedRows.length === 0 && <p>No facts linked.</p>}
          {linkedRows.map(({ link, fact }) => (
            <FactInlineEditor
              fact={fact}
              key={link.id}
              onSave={(nextFact) => onSaveEntity('facts', nextFact, electionId)}
              onDelete={async () => {
                await onDeleteEntity('stanceFacts', link.id, electionId);
                await onDeleteEntity('facts', fact.id, electionId);
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function FactInlineEditor({ fact, onSave, onDelete }: { fact: Fact; onSave: (fact: Fact) => void | Promise<void>; onDelete: () => void | Promise<void> }) {
  const [draft, setDraft] = useState(fact);

  useEffect(() => {
    setDraft(fact);
  }, [fact.id]);

  const autoSave = useDebouncedAutoSave(draft, (nextDraft) => onSave({ ...nextDraft, date_updated: new Date().toISOString() }));

  return (
    <section className="fact-inline-editor">
      <label>Summary<input value={draft.Summary ?? ''} onChange={(event) => setDraft({ ...draft, Summary: event.target.value || null })} /></label>
      <label>Description<textarea value={draft.description ?? ''} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} /></label>
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
  const filteredContests = filterByName(contests, (contest) => contest.name, search);

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
        placeholder="Search or type a contest"
        results={filteredContests}
        getResultKey={(contest) => contest.id}
        renderResult={(contest) => contest.name}
        renderMeta={(contest) => `${contest.candidateIds.length} candidates`}
        emptyText="No contests match."
        onSelect={(contest) => {
          const name = window.prompt('Rename contest', contest.name);
          if (name?.trim()) onSaveContest({ ...contest, name: name.trim() });
          setSearch('');
          setAddOpen(false);
        }}
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
      <legend>Election-specific issue points</legend>
      <div className="included-list">
        {included.length === 0 && <p>No issues selected.</p>}
        {included.map((item) => (
          <div className="included-row issue-row" key={item.issueId}>
            <div className="issue-card-copy">
              <strong>{issueName(item.issue)}</strong>
              <span>{item.issue?.description || 'No description.'}</span>
              <span>Confidence: {formatScore(averageIssueConfidence(db, item.issueId, candidateIds))}</span>
            </div>
            <label>
              Points
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
  results,
  getResultKey,
  renderResult,
  renderOption,
  renderMeta,
  emptyText,
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
  results: TItem[];
  getResultKey: (item: TItem) => Id;
  renderResult: (item: TItem) => string;
  renderOption?: (item: TItem) => ReactNode;
  renderMeta?: (item: TItem) => string;
  emptyText: string;
  onSelect: (item: TItem) => void;
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
          <div className="add-options">
            {results.length === 0 && <p>{emptyText}</p>}
            {results.map((item) => (
              <button type="button" key={getResultKey(item)} onClick={() => onSelect(item)}>
                {renderOption ? renderOption(item) : (
                  <>
                    <span>{renderResult(item)}</span>
                    {renderMeta && <small>{renderMeta(item)}</small>}
                  </>
                )}
              </button>
            ))}
          </div>
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
