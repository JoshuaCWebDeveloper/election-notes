import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { canRestoreSeedData, createBackupJson, deleteEntity, loadDatabase, restoreDatabaseFromJson, restoreDatabaseFromSeed, saveEntity, type EntityKey } from './services/database';
import type { Candidate, Database, Election, ElectionIssue, Fact, First, Id, Issue, Stance, StanceFact } from './types';

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
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'electionIssues';
  entity?: EntityKey;
  nullable?: boolean;
};

function nextId(rows: { id: Id }[]) {
  return Math.max(0, ...rows.map((row) => row.id)) + 1;
}

function candidateName(candidate?: Candidate | null) {
  if (!candidate) return 'Unassigned';
  return [candidate.firstName, candidate.middleName, candidate.lastName].filter(Boolean).join(' ') || `Candidate #${candidate.id}`;
}

function issueName(issue?: Issue | null) {
  return issue?.name || `Issue #${issue?.id ?? 'none'}`;
}

function stanceName(stance?: Stance | null) {
  return stance?.label || stance?.title || `Stance #${stance?.id ?? 'none'}`;
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
      return `${election.candidateIds.length} candidates, ${election.issues.length} weighted issues, top score ${formatScore(scoreElection(election, db)[0]?.score)}`;
    },
    blank: (db) => ({ id: nextId(db.elections), name: 'New election', date: null, description: null, candidateIds: [], issues: [] }),
    fields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'date', label: 'Date', type: 'date', nullable: true },
      { key: 'description', label: 'Description', type: 'textarea', nullable: true },
      { key: 'candidateIds', label: 'Candidates', type: 'multiselect', entity: 'candidates' },
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
    summary: (row) => `Global points ${formatScore((row as Issue).points)}; election weights are edited on Elections`,
    blank: (db) => ({ id: nextId(db.issues), name: '', description: null, points: null, confidence: null, stancesCount: null }),
    fields: [
      { key: 'name', label: 'Name', type: 'text', nullable: true },
      { key: 'description', label: 'Description', type: 'textarea', nullable: true },
      { key: 'points', label: 'Global/default points', type: 'number', nullable: true },
      { key: 'confidence', label: 'Confidence', type: 'number', nullable: true },
      { key: 'stancesCount', label: 'Stances count', type: 'number', nullable: true }
    ]
  },
  {
    key: 'stances',
    label: 'Stances',
    summary: (row, db) => `${candidateName(db.candidates.find((c) => c.id === (row as Stance).candidate))} on ${issueName(db.issues.find((i) => i.id === (row as Stance).issue))}`,
    blank: (db) => ({ id: nextId(db.stances), date_created: new Date().toISOString(), date_updated: null, title: '', candidate: null, issue: null, rating: null, points: null, confidence: null, label: null, description: null }),
    fields: [
      { key: 'title', label: 'Title', type: 'text', nullable: true },
      { key: 'candidate', label: 'Candidate', type: 'select', entity: 'candidates', nullable: true },
      { key: 'issue', label: 'Issue', type: 'select', entity: 'issues', nullable: true },
      { key: 'rating', label: 'Rating', type: 'number', nullable: true },
      { key: 'points', label: 'Legacy stance points', type: 'number', nullable: true },
      { key: 'confidence', label: 'Confidence', type: 'number', nullable: true },
      { key: 'label', label: 'Label', type: 'text', nullable: true },
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
  const [selectedId, setSelectedId] = useState<Id>(rows[0]?.id ?? 0);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreUseSeed, setRestoreUseSeed] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const seedRestoreAvailable = canRestoreSeedData();
  const selected = db ? rows.find((row) => row.id === selectedId) ?? rows[0] ?? active.blank(db) : null;

  useEffect(() => {
    let cancelled = false;
    loadDatabase().then((data) => {
      if (cancelled) return;
      setDb(data);
      setSelectedId(data[activeKey][0]?.id ?? 0);
    }).catch((error: unknown) => {
      console.error('Failed to load IndexedDB database', error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(row: Database[EntityKey][number]) {
    if (!db) return;
    const nextRows = rows.some((item) => item.id === row.id)
      ? rows.map((item) => item.id === row.id ? row : item)
      : [...rows, row];
    await saveEntity(active.key, row);
    setDb({ ...db, [active.key]: nextRows });
    setSelectedId(row.id);
  }

  async function remove(id: Id) {
    if (!db) return;
    const nextRows = rows.filter((row) => row.id !== id);
    await deleteEntity(active.key, id);
    setDb({ ...db, [active.key]: nextRows });
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
            <button className={tab.key === active.key ? 'active' : ''} key={tab.key} onClick={() => { setActiveKey(tab.key); setSelectedId(db[tab.key][0]?.id ?? 0); }}>
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
          <button onClick={() => { const row = active.blank(db); save(row); }}><Plus size={16} /> New</button>
        </header>
        <div className="content">
          <div className="list">
            {rows.map((row) => (
              <button className={row.id === selected.id ? 'selected' : ''} key={row.id} onClick={() => setSelectedId(row.id)}>
                <strong>{rowTitle(active.key, row, db)}</strong>
                <span>{active.summary(row as never, db)}</span>
              </button>
            ))}
          </div>
          <Editor key={`${active.key}-${selected.id}`} db={db} tab={active} row={selected} onSave={save} onDelete={remove} />
        </div>
      </section>
    </main>
  );
}

function Editor({ db, tab, row, onSave, onDelete }: { db: Database; tab: Tab; row: Database[EntityKey][number]; onSave: (row: Database[EntityKey][number]) => void; onDelete: (id: Id) => void }) {
  const [draft, setDraft] = useState(row);
  const scores = useMemo(() => tab.key === 'elections' ? scoreElection(draft as Election, db) : [], [db, draft, tab.key]);

  function update(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }) as typeof row);
  }

  return (
    <form className="editor" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <div className="editor-title">
        <div>
          <span>ID {draft.id}</span>
          <h3>{rowTitle(tab.key, draft, db)}</h3>
        </div>
        <div className="actions">
          <button type="submit"><Save size={16} /> Save</button>
          <button type="button" className="danger" onClick={() => onDelete(draft.id)}><Trash2 size={16} /> Delete</button>
        </div>
      </div>
      <div className="form-grid">
        {tab.fields.map((field) => (
          <FieldInput key={field.key} field={field} value={(draft as Record<string, unknown>)[field.key]} db={db} onChange={(value) => update(field.key, value)} />
        ))}
      </div>
      {tab.key === 'elections' && (
        <section className="scores">
          <h4>Election scoring</h4>
          <div className="score-grid">
            {scores.map((score) => (
              <div key={score.candidate.id}>
                <strong>{candidateName(score.candidate)}</strong>
                <span>{formatScore(score.score)} points</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </form>
  );
}

function FieldInput({ field, value, db, onChange }: { field: Field; value: unknown; db: Database; onChange: (value: unknown) => void }) {
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
  if (field.type === 'multiselect' && field.entity) {
    const selected = new Set(value as Id[] ?? []);
    return (
      <fieldset className="wide checklist">
        <legend>{field.label}</legend>
        {db[field.entity].map((row) => (
          <label key={row.id}><input type="checkbox" checked={selected.has(row.id)} onChange={(event) => {
            const ids = new Set(selected);
            if (event.target.checked) ids.add(row.id); else ids.delete(row.id);
            onChange([...ids]);
          }} /> {recordName(field.entity!, row.id, db)}</label>
        ))}
      </fieldset>
    );
  }
  if (field.type === 'electionIssues') {
    return <ElectionIssueEditor issues={db.issues} value={value as ElectionIssue[] ?? []} onChange={onChange} />;
  }
  return <label>{field.label}<input value={textValue} onChange={(event) => onChange(nullable(event.target.value, field))} /></label>;
}

function ElectionIssueEditor({ issues, value, onChange }: { issues: Issue[]; value: ElectionIssue[]; onChange: (value: ElectionIssue[]) => void }) {
  const selected = new Set(value.map((item) => item.issueId));
  return (
    <fieldset className="wide issue-weights">
      <legend>Election-specific issue points</legend>
      {issues.map((issue) => {
        const item = value.find((row) => row.issueId === issue.id);
        return (
          <div key={issue.id}>
            <label><input type="checkbox" checked={selected.has(issue.id)} onChange={(event) => {
              onChange(event.target.checked ? [...value, { issueId: issue.id, points: issue.points ?? 0 }] : value.filter((row) => row.issueId !== issue.id));
            }} /> {issueName(issue)}</label>
            <input type="number" step="any" disabled={!item} value={item?.points ?? ''} onChange={(event) => onChange(value.map((row) => row.issueId === issue.id ? { ...row, points: Number(event.target.value) } : row))} />
          </div>
        );
      })}
    </fieldset>
  );
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

function scoreElection(election: Election, db: Database) {
  return election.candidateIds.map((candidateId) => {
    const candidate = db.candidates.find((row) => row.id === candidateId)!;
    const score = election.issues.reduce((total, electionIssue) => {
      const stance = db.stances.find((row) => row.candidate === candidateId && row.issue === electionIssue.issueId);
      const rating = stance?.rating ?? 0;
      return total + electionIssue.points * (rating / 100);
    }, 0);
    return { candidate, score };
  }).sort((a, b) => b.score - a.score);
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
