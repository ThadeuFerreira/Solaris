// SQLite storage (Node's built-in node:sqlite, no native dependency).
//
// What lives here:
//  - ANEEL tariffs and tariff flags, refreshed daily from the open data portal
//  - NASA POWER climatologies, cached per rounded location (they don't change)
//  - Saved simulations, so a drawn roof and its settings can be shared by link

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FlagStatus, TariffPoint } from '../src/api/aneel';

const MIGRATIONS = [
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE tariffs (
    distributor TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    tusd REAL NOT NULL,
    te REAL NOT NULL,
    resolution TEXT NOT NULL,
    PRIMARY KEY (distributor, start_date)
  );
  CREATE TABLE tariff_flags (
    month TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    raw_name TEXT NOT NULL,
    surcharge REAL NOT NULL,
    surcharge_from_api INTEGER NOT NULL
  );
  CREATE TABLE solar_climatology (
    location_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE simulations (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
];

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** Replaces the whole tariff table with a fresh download. */
  replaceTariffs(byDistributor: Map<string, TariffPoint[]>, fetchedAt: string): void {
    transaction(this.db, () => {
      this.db.exec('DELETE FROM tariffs');
      const insert = this.db.prepare(
        'INSERT INTO tariffs (distributor, start_date, end_date, tusd, te, resolution) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const [distributor, points] of byDistributor) {
        for (const p of points) insert.run(distributor, p.start, p.end, p.tusd, p.te, p.resolution);
      }
      this.setMeta('tariffs_fetched_at', fetchedAt);
    });
  }

  readTariffs(): Map<string, TariffPoint[]> {
    const rows = this.db
      .prepare('SELECT distributor, start_date, end_date, tusd, te, resolution FROM tariffs ORDER BY distributor, start_date')
      .all() as { distributor: string; start_date: string; end_date: string; tusd: number; te: number; resolution: string }[];
    const result = new Map<string, TariffPoint[]>();
    for (const r of rows) {
      let list = result.get(r.distributor);
      if (!list) result.set(r.distributor, (list = []));
      list.push({ start: r.start_date, end: r.end_date, tusd: r.tusd, te: r.te, total: r.tusd + r.te, resolution: r.resolution });
    }
    return result;
  }

  /** Upserts flags so months that dropped out of the latest download are kept. */
  saveFlags(flags: FlagStatus[], fetchedAt: string): void {
    transaction(this.db, () => {
      const upsert = this.db.prepare(
        `INSERT INTO tariff_flags (month, name, raw_name, surcharge, surcharge_from_api) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(month) DO UPDATE SET name = excluded.name, raw_name = excluded.raw_name,
           surcharge = excluded.surcharge, surcharge_from_api = excluded.surcharge_from_api`,
      );
      for (const f of flags) upsert.run(f.month, f.name, f.rawName, f.surcharge, f.surchargeFromApi ? 1 : 0);
      this.setMeta('flags_fetched_at', fetchedAt);
    });
  }

  readFlags(): FlagStatus[] {
    const rows = this.db
      .prepare('SELECT month, name, raw_name, surcharge, surcharge_from_api FROM tariff_flags ORDER BY month DESC')
      .all() as { month: string; name: FlagStatus['name']; raw_name: string; surcharge: number; surcharge_from_api: number }[];
    return rows.map((r) => ({
      month: r.month,
      name: r.name,
      rawName: r.raw_name,
      surcharge: r.surcharge,
      surchargeFromApi: r.surcharge_from_api === 1,
    }));
  }

  getSolar(locationKey: string): { payload: unknown; fetchedAt: string } | null {
    const row = this.db
      .prepare('SELECT payload, fetched_at FROM solar_climatology WHERE location_key = ?')
      .get(locationKey) as { payload: string; fetched_at: string } | undefined;
    return row ? { payload: JSON.parse(row.payload), fetchedAt: row.fetched_at } : null;
  }

  saveSolar(locationKey: string, payload: unknown, fetchedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO solar_climatology (location_key, payload, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(location_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
      )
      .run(locationKey, JSON.stringify(payload), fetchedAt);
  }

  saveSimulation(id: string, payload: unknown, createdAt: string): void {
    this.db.prepare('INSERT INTO simulations (id, payload, created_at) VALUES (?, ?, ?)').run(id, JSON.stringify(payload), createdAt);
  }

  getSimulation(id: string): { payload: unknown; createdAt: string } | null {
    const row = this.db.prepare('SELECT payload, created_at FROM simulations WHERE id = ?').get(id) as
      | { payload: string; created_at: string }
      | undefined;
    return row ? { payload: JSON.parse(row.payload), createdAt: row.created_at } : null;
  }
}
