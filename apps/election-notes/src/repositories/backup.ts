import type { Database } from '../types';
import { loadAllStores } from './indexedDb';

export async function exportBackup(): Promise<Database> {
  return loadAllStores();
}
