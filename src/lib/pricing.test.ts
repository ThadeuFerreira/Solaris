import { describe, expect, it } from 'vitest';
import type { AnnualTariffAverage } from '../api/samp';
import { DEFAULT_TARIFF_SETTINGS } from '../model';
import { calculatePricing } from './pricing';

const national: AnnualTariffAverage = {
  referenceYear: 2024, price: 0.95, taxBasis: 'with_taxes', includesFlags: true,
  completeYear: true, dataThrough: '2024-12', methodology: 'test',
  sourceUrl: 'https://dadosabertos.aneel.gov.br/dataset/samp', sourceResourceId: 'test',
  sourceDate: '2026-10-15', fetchedAt: '2026-11-02T12:00:00Z',
};
const input = {
  tariffs: [], settings: { ...DEFAULT_TARIFF_SETTINGS, distributor: 'TESTE' },
  icmsPct: 19, flag: { name: 'Amarela' as const, rawName: 'Amarela', month: '2026-11-01', surcharge: 0.02, surchargeFromApi: true },
  averages: [national], today: '2026-11-02',
};
const local = { distributor: 'TESTE', current: { start: '2026-01-01', end: '2026-12-31', tusd: 0.4, te: 0.3, total: 0.7, resolution: '' }, history: [] };

describe('tariff fallback used by savings calculations', () => {
  it('uses the latest complete validated annual average without applying taxes or flags twice', () => {
    const result = calculatePricing({ ...input, averages: [national, { ...national, referenceYear: 2025, dataThrough: '2025-12', price: 0.97 }] });
    expect(result.source).toBe('national');
    expect(result.finalPrice).toBe(0.97);
    expect(result.flagSurcharge).toBe(0);
    expect(result.nationalAverage?.referenceYear).toBe(2025);
    const changedTaxes = calculatePricing({ ...input, icmsPct: 35, settings: { ...input.settings, pisCofinsPct: 15, includeFlag: false } });
    expect(changedTaxes.finalPrice).toBe(0.95);
  });

  it('prefers a valid local tariff and always respects the user bill price', () => {
    const result = calculatePricing({ ...input, tariffs: [local] });
    expect(result.source).toBe('aneel');
    expect(result.finalPrice).toBeCloseTo(0.72 / 0.76);
    const manual = calculatePricing({ ...input, tariffs: [local], settings: { ...input.settings, manualPrice: 1.23 } });
    expect(manual.source).toBe('manual');
    expect(manual.finalPrice).toBe(1.23);
    expect(manual.nationalAverage).toBeNull();
  });

  it('falls back when the selected distributor is missing, expired or not yet effective', () => {
    for (const tariff of [{ ...local, distributor: 'OUTRA' }, { ...local, current: { ...local.current, end: '2025-12-31' } },
      { ...local, current: { ...local.current, start: '2027-01-01' } }]) {
      expect(calculatePricing({ ...input, tariffs: [tariff] }).source).toBe('national');
    }
  });

  it('rejects incomplete, future, pre-tax and invalid national averages', () => {
    for (const average of [{ ...national, completeYear: false }, { ...national, referenceYear: 2026, dataThrough: '2026-12' },
      { ...national, taxBasis: 'without_taxes' as const }, { ...national, price: NaN }, { ...national, dataThrough: '2024-11' }]) {
      expect(calculatePricing({ ...input, averages: [average] }).source).toBe('example');
    }
  });
});
