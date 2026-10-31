import { createApiHandler, type ApiHandler } from './api';
import { openDatabase, Store } from './db';

/** The API wired to a SQLite file; shared by the Vite plugin and server/index.ts. */
export function createSolarisApi(dbPath: string): ApiHandler {
  return createApiHandler({ store: new Store(openDatabase(dbPath)) });
}
