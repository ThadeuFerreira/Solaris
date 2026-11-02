import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, Store } from './db';
import { calculateSampAverages, collectSampAverages, SAMP_FILTERS, SAMP_METRICS } from './samp';

function records(year = 2024) {
  const values = ['100,000000', '70,000000', '0,000000', '0,000000', '5,000000', '15,000000', '1,000000', '4,000000'];
  return Array.from({ length: 12 }, (_, month) => Object.values(SAMP_METRICS).map((metric, index) => ({
    _id: month * 8 + index, NumCNPJAgenteDistribuidora: '01234567000189',
    DatGeracaoConjuntoDados: '2026-10-15T00:00:00',
    DatCompetencia: `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00`,
    DscClasseConsumoMercado: 'Residencial', DscOpcaoEnergia: 'CATIVO',
    DscDetalheMercado: metric, VlrMercado: values[index],
  }))).flat();
}

describe('national SAMP annual averages', () => {
  it('sums billed revenue once and distinguishes observed taxes from the pre-tax price', () => {
    const averages = calculateSampAverages(records(), 2024, 'resource', 'now');
    expect(averages.map((row) => [row.taxBasis, row.price])).toEqual([
      ['without_taxes', 0.7], ['with_taxes', 0.9],
    ]);
    expect(averages.every((row) => row.completeYear && row.includesFlags)).toBe(true);
    expect(SAMP_FILTERS.DscDetalheMercado).not.toContain('Energia TUSD (kWh)');
    expect(SAMP_FILTERS.DscDetalheMercado).not.toContain('Receita energia compensada (R$)');
  });

  it('weights by consumption instead of averaging each distributor tariff', () => {
    const first = records();
    const second = records().map((row) => ({ ...row, _id: row._id + 100,
      NumCNPJAgenteDistribuidora: '01234567000260',
      VlrMercado: row.DscDetalheMercado === SAMP_METRICS.energy ? '1000,000000' :
        row.DscDetalheMercado === SAMP_METRICS.revenue ? '500,000000' : '0,000000',
    }));
    expect(calculateSampAverages([...first, ...second], 2024, 'resource', 'now')[1].price).toBe(0.536364);
  });

  it('includes signed rebilling adjustments without dropping negative observations', () => {
    const input = records();
    const adjustment = { ...input[0], _id: 1000, VlrMercado: '-10,000000' };
    expect(calculateSampAverages([...input, adjustment], 2024, 'resource', 'now')[1].price).toBe(0.907563);
  });

  it('requires twelve months of consumption, receipts, taxes and flags', () => {
    expect(() => calculateSampAverages(records().filter((row) => row._id !== 0), 2024, 'resource', 'now')).toThrow('incompleto');
    expect(() => calculateSampAverages(records().filter((row) => row._id !== 5), 2024, 'resource', 'now')).toThrow('incompleto');
    expect(() => calculateSampAverages(records().filter((row) => row._id !== 4), 2024, 'resource', 'now')).toThrow('incompleto');
  });

  it('quarantines implausible distributor-months and rejects wrong scope, duplicate IDs and malformed values', () => {
    const input = records();
    expect(() => calculateSampAverages(input.map((row) => row._id === 1 ? { ...row, VlrMercado: '7000,000000' } : row), 2024, 'r', 'now')).toThrow('inconsistentes');
    expect(() => calculateSampAverages(input.map((row) => row._id === 5 ? { ...row, VlrMercado: '100,000000' } : row), 2024, 'r', 'now')).toThrow('inconsistentes');
    expect(() => calculateSampAverages([...input, input[0]], 2024, 'r', 'now')).toThrow('ID');
    expect(() => calculateSampAverages([{ ...input[0], DscOpcaoEnergia: 'LIVRE' }], 2024, 'r', 'now')).toThrow('recorte');
    expect(() => calculateSampAverages([{ ...input[0], VlrMercado: 'NaN' }], 2024, 'r', 'now')).toThrow('valor');
  });

  it('upserts validated years and excludes unchecked legacy averages', () => {
    const db = openDatabase(':memory:');
    try {
      const store = new Store(db);
      const rows = calculateSampAverages(records(), 2024, 'resource', 'now');
      store.saveAnnualTariffAverages(rows);
      store.saveAnnualTariffAverages(rows);
      expect(store.readAnnualTariffAverages()).toHaveLength(2);
      db.exec("UPDATE annual_tariff_averages SET quality_status='unchecked'");
      expect(store.readAnnualTariffAverages()).toEqual([]);
      store.saveAnnualTariffAverages(rows);
      expect(store.readAnnualTariffAverages()).toHaveLength(2);
    } finally { db.close(); }
  });

  it('archives rejected years, completes independent valid years and can replay without downloading source rows again', async () => {
    const db = openDatabase(':memory:');
    const store = new Store(db);
    const archiveDir = mkdtempSync(join(tmpdir(), 'solaris-samp-'));
    const resources = [2024, 2023].map((year) => ({ id: `resource-${year}`, name: `samp-${year}.csv`, datastore_active: true }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, result: { resources } }),
    })));
    const fetchRecords = vi.fn(async (id: string) => id === 'resource-2024'
      ? records().map((row) => row._id === 1 ? { ...row, VlrMercado: '7000,000000' } : row)
      : records(2023));
    try {
      await expect(collectSampAverages({ store, archiveDir, fetchRecords })).rejects.toThrow('2024');
      expect(store.readAnnualTariffAverages().map((row) => row.referenceYear)).toEqual([2023, 2023]);
      const runs = db.prepare('SELECT status,snapshot_path,snapshot_sha256 FROM energy_import_runs ORDER BY id').all();
      expect(runs[0]).toMatchObject({ status: 'failed', snapshot_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(runs[1]).toMatchObject({ status: 'completed' });
      fetchRecords.mockClear();
      await expect(collectSampAverages({ store, archiveDir, fetchRecords, reuseArchives: true })).rejects.toThrow('2024');
      expect(fetchRecords).not.toHaveBeenCalled();
      expect(store.readAnnualTariffAverages()).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      db.close();
      rmSync(archiveDir, { recursive: true, force: true });
    }
  });
});
