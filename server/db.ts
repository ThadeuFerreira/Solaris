// SQLite storage (Node's built-in node:sqlite, no native dependency).
//
// What lives here:
//  - ANEEL tariffs and tariff flags, refreshed daily from the open data portal
//  - NASA POWER climatologies, cached per rounded location (they don't change)
//  - Saved simulations, so a drawn roof and its settings can be shared by link

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FlagStatus, TariffPoint } from '../src/api/aneel';
import { resolutionDate, TARIFF_DATASET_URL, TARIFF_RESOURCE_ID } from '../src/api/aneel';
import type { HistoricalTariff } from './energyHistory';
import type { AnnualTariffAverage } from '../src/api/samp';

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
  readFileSync(new URL('./migrations/002-energy-history.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('./migrations/003-tariff-resolutions.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('./migrations/004-samp-quality.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('./migrations/005-samp-methodology.sql', import.meta.url), 'utf8'),
];

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
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

  /** Preserve periods missing from a later upstream response. */
  saveTariffs(byDistributor: Map<string, TariffPoint[]>, fetchedAt: string): void {
    transaction(this.db, () => {
      const insert = this.db.prepare(
        `INSERT INTO tariffs (distributor, start_date, end_date, tusd, te, resolution) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(distributor, start_date) DO UPDATE SET end_date=excluded.end_date,
           tusd=excluded.tusd, te=excluded.te, resolution=excluded.resolution`,
      );
      for (const [distributor, points] of byDistributor) {
        for (const p of points) insert.run(distributor, p.start, p.end, p.tusd, p.te, p.resolution);
      }
      this.setMeta('tariffs_fetched_at', fetchedAt);
    });
  }

  startEnergyImport(dataset: string, resourceId: string, startedAt: string): number {
    const result = this.db.prepare(
      "INSERT INTO energy_import_runs (dataset, resource_id, started_at, status) VALUES (?, ?, ?, 'running')",
    ).run(dataset, resourceId, startedAt);
    return Number(result.lastInsertRowid);
  }

  finishEnergyImport(id: number, result: {
    status: 'completed' | 'failed'; finishedAt: string; received?: number; saved?: number;
    sourceDate?: string; snapshotPath?: string; sha256?: string; error?: string;
  }): void {
    this.db.prepare(`UPDATE energy_import_runs SET status=?, finished_at=?, records_received=?, records_saved=?,
      source_date=?, snapshot_path=?, snapshot_sha256=?, error=? WHERE id=?`).run(
      result.status, result.finishedAt, result.received ?? null, result.saved ?? null, result.sourceDate ?? null,
      result.snapshotPath ?? null, result.sha256 ?? null, result.error ?? null, id,
    );
  }

  /** Import validated B1 rows and the API-compatible cache in one transaction. */
  saveTariffHistory(rows: HistoricalTariff[], fetchedAt: string): void {
    transaction(this.db, () => {
      const identity = this.db.prepare(`INSERT INTO distributors (cnpj, agent_code, source_url, source_date, fetched_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(cnpj) DO UPDATE SET agent_code=excluded.agent_code,
        source_date=excluded.source_date, fetched_at=excluded.fetched_at RETURNING id`);
      const alias = this.db.prepare('INSERT OR IGNORE INTO distributor_aliases (agent_code, distributor_id) VALUES (?, ?)');
      const insert = this.db.prepare(`INSERT INTO tariff_history
        (distributor_id, agent_code, start_date, end_date, tusd_microrl_per_kwh, te_microrl_per_kwh,
         resolution, source_resource_id, source_date, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(distributor_id, start_date, resolution) DO UPDATE SET agent_code=excluded.agent_code,
          end_date=excluded.end_date, tusd_microrl_per_kwh=excluded.tusd_microrl_per_kwh,
          te_microrl_per_kwh=excluded.te_microrl_per_kwh, resolution=excluded.resolution,
          source_date=excluded.source_date, last_seen_at=excluded.last_seen_at`);
      const cache = this.db.prepare(`INSERT INTO tariffs (distributor, start_date, end_date, tusd, te, resolution)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(distributor, start_date) DO UPDATE SET
        end_date=excluded.end_date, tusd=excluded.tusd, te=excluded.te, resolution=excluded.resolution`);
      // Sorting means the identity ends up with its latest known name.
      for (const row of [...rows].sort((a, b) =>
        a.start.localeCompare(b.start) || resolutionDate(a.resolution).localeCompare(resolutionDate(b.resolution)))) {
        const { id } = identity.get(row.cnpj, row.distributor, TARIFF_DATASET_URL, row.sourceDate, fetchedAt) as { id: number };
        alias.run(row.distributor, id);
        insert.run(id, row.distributor, row.start, row.end || null, row.tusdMicrorl, row.teMicrorl,
          row.resolution, TARIFF_RESOURCE_ID, row.sourceDate, fetchedAt, fetchedAt);
      }
      // Rebuild choices from the accumulated acts, so a reduced response cannot
      // overwrite an amendment retained from an earlier import with its old act.
      const accumulated = this.db.prepare(`SELECT agent_code, start_date, end_date,
        tusd_microrl_per_kwh AS tusd, te_microrl_per_kwh AS te, resolution FROM tariff_history`).all() as {
        agent_code: string; start_date: string; end_date: string | null; tusd: number; te: number; resolution: string;
      }[];
      for (const row of accumulated.sort((a, b) =>
        a.start_date.localeCompare(b.start_date) || resolutionDate(a.resolution).localeCompare(resolutionDate(b.resolution)))) {
        cache.run(row.agent_code, row.start_date, row.end_date ?? '', row.tusd / 1e6, row.te / 1e6, row.resolution);
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

  saveAnnualTariffAverages(averages: AnnualTariffAverage[]): void {
    transaction(this.db, () => {
      const upsert = this.db.prepare(`INSERT INTO annual_tariff_averages
        (geography_type, geography_code, reference_year, consumer_class, tax_basis, includes_flags,
         tariff_microrl_per_kwh, complete_year, data_through, methodology, source_url, source_resource_id, source_date, fetched_at, quality_status)
        VALUES ('country', 'BR', ?, 'Residencial', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'validated')
        ON CONFLICT(geography_type, geography_code, reference_year, consumer_class, tax_basis, includes_flags)
        DO UPDATE SET tariff_microrl_per_kwh=excluded.tariff_microrl_per_kwh, complete_year=excluded.complete_year,
        data_through=excluded.data_through, methodology=excluded.methodology, source_url=excluded.source_url,
        source_resource_id=excluded.source_resource_id, source_date=excluded.source_date, fetched_at=excluded.fetched_at,
        quality_status=excluded.quality_status`);
      for (const row of averages) upsert.run(row.referenceYear, row.taxBasis, row.includesFlags ? 1 : 0,
        Math.round(row.price * 1e6), row.completeYear ? 1 : 0, row.dataThrough, row.methodology,
        row.sourceUrl, row.sourceResourceId, row.sourceDate, row.fetchedAt);
    });
  }

  readAnnualTariffAverages(): AnnualTariffAverage[] {
    const rows = this.db.prepare(`SELECT reference_year, tariff_microrl_per_kwh, tax_basis, includes_flags,
      complete_year, data_through, methodology, source_url, source_resource_id, source_date, fetched_at
      FROM annual_tariff_averages WHERE geography_type='country' AND geography_code='BR'
      AND consumer_class='Residencial' AND quality_status='validated' ORDER BY reference_year DESC, tax_basis`).all() as {
      reference_year: number; tariff_microrl_per_kwh: number; tax_basis: AnnualTariffAverage['taxBasis'];
      includes_flags: number; complete_year: number; data_through: string; methodology: string;
      source_url: string; source_resource_id: string; source_date: string; fetched_at: string;
    }[];
    return rows.map((row) => ({ referenceYear: row.reference_year, price: row.tariff_microrl_per_kwh / 1e6,
      taxBasis: row.tax_basis, includesFlags: row.includes_flags === 1, completeYear: row.complete_year === 1,
      dataThrough: row.data_through, methodology: row.methodology, sourceUrl: row.source_url,
      sourceResourceId: row.source_resource_id, sourceDate: row.source_date, fetchedAt: row.fetched_at }));
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
