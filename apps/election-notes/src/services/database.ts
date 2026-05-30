import { exportBackup } from '../repositories/backup';
import {
  cloneSeedData,
  deleteRecord,
  hasRecords,
  isDatabaseInitialized,
  loadAllStores,
  markDatabaseInitialized,
  putRecord,
  readLegacyLocalStorage,
  removeLegacyLocalStorage,
  replaceAllStores,
  type StoreName
} from '../repositories/indexedDb';
import type { Database, Id } from '../types';

export type EntityKey = StoreName;

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
  return initial;
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
  return data;
}

export async function createBackupJson(): Promise<string> {
  const data = await exportBackup();
  return JSON.stringify(data, null, 2);
}
