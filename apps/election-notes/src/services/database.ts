import { exportBackup } from '../repositories/backup';
import {
  cloneSeedData,
  deleteRecord,
  hasSeedData,
  hasRecords,
  isDatabaseInitialized,
  loadAllStores,
  markDatabaseInitialized,
  putRecord,
  readLegacyLocalStorage,
  removeLegacyLocalStorage,
  replaceAllStores,
  storeNames,
  type StoreName
} from '../repositories/indexedDb';
import type { Database, Id } from '../types';

export type EntityKey = StoreName;

type ValidationRule = 'string' | 'requiredString' | 'number' | 'requiredNumber' | 'idArray' | 'electionIssues';

const rowShape: Record<EntityKey, Record<string, ValidationRule>> = {
  candidates: {
    id: 'requiredNumber',
    firstName: 'string',
    middleName: 'string',
    lastName: 'string',
    score: 'number',
    confidence: 'number',
    stancesCount: 'number',
    confidenceScoreProduct: 'number'
  },
  issues: {
    id: 'requiredNumber',
    name: 'string',
    description: 'string',
    points: 'number',
    confidence: 'number',
    stancesCount: 'number'
  },
  stances: {
    id: 'requiredNumber',
    date_created: 'string',
    date_updated: 'string',
    title: 'string',
    candidate: 'number',
    issue: 'number',
    rating: 'number',
    points: 'number',
    confidence: 'number',
    label: 'string',
    description: 'string'
  },
  facts: {
    id: 'requiredNumber',
    date_created: 'string',
    date_updated: 'string',
    Summary: 'string',
    description: 'string'
  },
  stanceFacts: {
    id: 'requiredNumber',
    stance: 'number',
    fact: 'number'
  },
  firstRecords: {
    id: 'requiredNumber',
    status: 'requiredString',
    sort: 'number',
    user_created: 'string',
    date_created: 'string',
    user_updated: 'string',
    date_updated: 'string',
    name: 'string'
  },
  elections: {
    id: 'requiredNumber',
    name: 'requiredString',
    date: 'string',
    description: 'string',
    candidateIds: 'idArray',
    issues: 'electionIssues'
  }
};

export async function loadDatabase(): Promise<Database> {
  const current = await loadAllStores();
  if (await isDatabaseInitialized()) return current;
  if (hasRecords(current)) {
    await markDatabaseInitialized();
    return current;
  }

  const legacy = readLegacyLocalStorage();
  const initial = legacy ?? cloneSeedData();
  await replaceAllStores(initial);
  if (legacy) removeLegacyLocalStorage();
  return loadAllStores();
}

export async function saveEntity<TStore extends EntityKey>(storeName: TStore, row: Database[TStore][number]): Promise<void> {
  await putRecord(storeName, row);
}

export async function deleteEntity(storeName: EntityKey, id: Id): Promise<void> {
  await deleteRecord(storeName, id);
}

export async function resetDatabase(): Promise<Database> {
  const data = cloneSeedData();
  await replaceAllStores(data);
  removeLegacyLocalStorage();
  return loadAllStores();
}

export function canRestoreSeedData(): boolean {
  return hasSeedData();
}

export async function restoreDatabaseFromSeed(): Promise<Database> {
  const data = cloneSeedData();
  validateDatabase(data);
  await replaceAllStores(data);
  removeLegacyLocalStorage();
  return loadAllStores();
}

export async function restoreDatabaseFromJson(json: string): Promise<Database> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Backup file must be valid JSON.');
  }

  const data = validateDatabase(parsed);
  await replaceAllStores(data);
  removeLegacyLocalStorage();
  return loadAllStores();
}

export async function createBackupJson(): Promise<string> {
  const data = await exportBackup();
  return JSON.stringify(data, null, 2);
}

export function validateDatabase(value: unknown): Database {
  if (!isRecord(value)) {
    throw new Error('Backup must be a JSON object.');
  }

  const topLevelKeys = Object.keys(value).sort();
  const expectedKeys = [...storeNames].sort();
  if (topLevelKeys.length !== expectedKeys.length || topLevelKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`Backup must contain exactly these stores: ${storeNames.join(', ')}.`);
  }

  for (const storeName of storeNames) {
    const rows = value[storeName];
    if (!Array.isArray(rows)) {
      throw new Error(`Store "${storeName}" must be an array.`);
    }

    rows.forEach((row, index) => validateRow(storeName, row, index));
  }

  return structuredClone(value) as Database;
}

function validateRow(storeName: EntityKey, value: unknown, index: number): void {
  if (!isRecord(value)) {
    throw new Error(`Store "${storeName}" row ${index + 1} must be an object.`);
  }

  const shape = rowShape[storeName];
  const rowKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(shape).sort();
  if (rowKeys.length !== expectedKeys.length || rowKeys.some((key, keyIndex) => key !== expectedKeys[keyIndex])) {
    throw new Error(`Store "${storeName}" row ${index + 1} does not match the expected shape.`);
  }

  for (const [key, rule] of Object.entries(shape)) {
    if (!isValidValue(value[key], rule)) {
      throw new Error(`Store "${storeName}" row ${index + 1} has an invalid "${key}" value.`);
    }
  }
}

function isValidValue(value: unknown, rule: ValidationRule): boolean {
  if (rule === 'string') return value === null || typeof value === 'string';
  if (rule === 'requiredString') return typeof value === 'string';
  if (rule === 'number') return value === null || typeof value === 'number';
  if (rule === 'requiredNumber') return typeof value === 'number';
  if (rule === 'idArray') return Array.isArray(value) && value.every((item) => typeof item === 'number');
  return Array.isArray(value) && value.every((item) => (
    isRecord(item) &&
    Object.keys(item).sort().join('|') === 'issueId|points' &&
    typeof item.issueId === 'number' &&
    typeof item.points === 'number'
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
