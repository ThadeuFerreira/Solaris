import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { FLAG_RESOURCE_ID, RESIDENTIAL_FILTERS } from '../src/api/aneel';
import { openDatabase, Store } from './db';
import { collectEnergyHistory, parseHistoricalTariffs } from './energyHistory';

const tariff = (over: Record<string, unknown> = {}) => ({
  _id: 1, ...RESIDENTIAL_FILTERS,
  SigAgente: 'TESTE', NumCNPJDistribuidora: '01234567000189',
  DatInicioVigencia: '2025-01-01', DatFimVigencia: '2025-12-31',
  DscREH: 'RESOLUÇÃO HOMOLOGATÓRIA Nº 1, DE 1 DE JANEIRO DE 2025',
  DatGeracaoConjuntoDados: '2026-10-31', DscUnidadeTerciaria: 'MWh', VlrTUSD: '430,40', VlrTE: '328,42',
  ...over,
});
const flag = { _id: 1, DatGeracaoConjuntoDados: '2026-11-01', DatCompetencia: '2026-10-01', NomBandeiraAcionada: 'Verde', VlrAdicionalBandeira: ',00' };
const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const archiveDir = mkdtempSync(join(tmpdir(), 'solaris-history-'));
  directories.push(archiveDir);
  return { db, archiveDir, store: new Store(db) };
}

describe('historical energy ingestion', () => {
  it('normalizes units, deduplicates exact rows and retains different resolutions for one start date', () => {
    const rows = parseHistoricalTariffs([tariff(), tariff({ _id: 2 }), tariff({ _id: 3, DscREH: 'RETIFICAÇÃO', VlrTUSD: '0,5', DscUnidadeTerciaria: 'kWh' })]);
    expect(rows).toHaveLength(2);
    expect(rows[0].tusdMicrorl).toBe(430400);
    expect(rows[1].tusdMicrorl).toBe(500000);
    expect(() => parseHistoricalTariffs([tariff(), tariff({ VlrTUSD: '999,99' })])).toThrow('conflitantes');
    expect(parseHistoricalTariffs([tariff({ DscREH: null })])[0].resolution).toBe('');
  });

  it.each([{ DscClasse: 'Rural' }, { VlrTUSD: '-1' }, { DatInicioVigencia: '2025-02-30' }, { NumCNPJDistribuidora: 'inválido' }, { NumCNPJDistribuidora: null }])('rejects invalid records before a write: %j', (over) => {
    expect(() => parseHistoricalTariffs([tariff(over)])).toThrow('ANEEL:');
  });

  it('upserts without losing older periods, preserves first observation and resolves amendments by act date', () => {
    const { db, store } = setup();
    const old = tariff();
    const newerAct = tariff({ DscREH: 'RESOLUÇÃO Nº 2, DE 3 DE MARÇO DE 2025', VlrTUSD: '500,00' });
    store.saveTariffHistory(parseHistoricalTariffs([newerAct, old]), '2026-11-01T12:00:00Z');
    expect(store.readTariffs().get('TESTE')?.[0].tusd).toBe(0.5);
    store.saveTariffHistory(parseHistoricalTariffs([tariff({ DatInicioVigencia: '2026-01-01', DatFimVigencia: '2026-12-31' })]), '2026-11-02T12:00:00Z');
    store.saveTariffHistory(parseHistoricalTariffs([newerAct]), '2026-11-03T12:00:00Z');
    store.saveTariffHistory(parseHistoricalTariffs([old]), '2026-11-04T12:00:00Z');
    expect(store.readTariffs().get('TESTE')?.[0].tusd).toBe(0.5);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tariff_history').get()).toMatchObject({ n: 3 });
    expect(store.readTariffs().get('TESTE')).toHaveLength(2);
    const row = db.prepare('SELECT first_seen_at, last_seen_at FROM tariff_history WHERE resolution=?').get(newerAct.DscREH);
    expect(row).toMatchObject({ first_seen_at: '2026-11-01T12:00:00Z', last_seen_at: '2026-11-03T12:00:00Z' });
  });

  it('rolls back the complete write if any row violates the schema', () => {
    const { db, store } = setup();
    const rows = parseHistoricalTariffs([tariff()]);
    expect(() => store.saveTariffHistory([rows[0], { ...rows[0], cnpj: 'invalid' }], 'now')).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM distributors').get()).toMatchObject({ n: 0 });
    expect(store.getMeta('tariffs_fetched_at')).toBeNull();
  });

  it('retains historical periods when the daily API cache is refreshed with a smaller response', () => {
    const { store } = setup();
    const old = { start: '2025-01-01', end: '2025-12-31', tusd: 0.4, te: 0.3, total: 0.7, resolution: '2025' };
    const current = { ...old, start: '2026-01-01', end: '2026-12-31', tusd: 0.5, resolution: '2026' };
    store.saveTariffs(new Map([['TESTE', [old, current]]]), '2026-11-01T12:00:00Z');
    store.saveTariffs(new Map([['TESTE', [current]]]), '2026-11-02T12:00:00Z');
    expect(store.readTariffs().get('TESTE')).toHaveLength(2);
  });

  it('archives source files with a checksum and records successful, repeatable imports', async () => {
    const { db, store, archiveDir } = setup();
    const fetchRecords = async (id: string) => id === FLAG_RESOURCE_ID ? [flag] : [tariff(), tariff({ _id: 2 })];
    const results = await collectEnergyHistory({ store, archiveDir, fetchRecords });
    await collectEnergyHistory({ store, archiveDir, fetchRecords });
    expect(results.map((result) => result.saved)).toEqual([1, 1]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tariff_history').get()).toMatchObject({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM energy_import_runs WHERE status='completed'").get()).toMatchObject({ n: 4 });
    const run = db.prepare('SELECT snapshot_sha256 FROM energy_import_runs WHERE id=?').get(results[0].runId);
    const digest = createHash('sha256').update(readFileSync(results[0].snapshotPath)).digest('hex');
    expect(run).toMatchObject({ snapshot_sha256: digest });
  });

  it('records failure and preserves existing tariffs while still collecting the independent flag source', async () => {
    const { db, store, archiveDir } = setup();
    store.saveTariffHistory(parseHistoricalTariffs([tariff()]), '2026-11-01T12:00:00Z');
    await expect(collectEnergyHistory({ store, archiveDir, fetchRecords: async (id) => {
      if (id === FLAG_RESOURCE_ID) return [flag];
      throw new Error('timeout');
    } })).rejects.toThrow('timeout');
    expect(store.getMeta('tariffs_fetched_at')).toBe('2026-11-01T12:00:00Z');
    expect(db.prepare('SELECT COUNT(*) AS n FROM tariff_history').get()).toMatchObject({ n: 1 });
    expect(store.readFlags()).toHaveLength(1);
    expect(db.prepare('SELECT status FROM energy_import_runs ORDER BY id').all()).toEqual([
      { status: 'failed' }, { status: 'completed' },
    ]);
  });
});
