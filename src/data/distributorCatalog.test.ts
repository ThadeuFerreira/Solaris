import { describe, expect, it } from 'vitest';
import type { DistributorTariff } from '../api/aneel';
import { DISTRIBUTOR_CATALOG, distributorOptions, filterDistributors, tariffIsCurrent } from './distributorCatalog';

const tariff = (distributor: string, start = '2026-01-01', end = '2026-12-31'): DistributorTariff => ({
  distributor,
  current: { start, end, tusd: 0.4, te: 0.3, total: 0.7, resolution: '' },
  history: [],
});

describe('distributor catalogue', () => {
  it('provides official, unique distributor identities without an upstream response', () => {
    const list = distributorOptions([]);
    expect(list.length).toBeGreaterThan(90);
    expect(new Set(list.map((entry) => entry.distributor)).size).toBe(list.length);
    expect(new Set(list.map((entry) => entry.cnpj)).size).toBe(list.length);
    expect(list.every((entry) => /^\d{14}$/.test(entry.cnpj ?? ''))).toBe(true);
    expect(DISTRIBUTOR_CATALOG.sourceUrl).toContain('dadosabertos.aneel.gov.br');
  });

  it('adds new current agents, excludes retired/future ones, and keeps a saved choice', () => {
    const list = distributorOptions([
      tariff('NOVA DISTRIBUIDORA'),
      tariff('ENCERRADA', '2025-01-01', '2025-12-31'),
      tariff('FUTURA', '2027-01-01', '2027-12-31'),
    ], 'ANTIGA SELECIONADA', '2026-11-02');
    const names = list.map((entry) => entry.distributor);
    expect(names).toContain('NOVA DISTRIBUIDORA');
    expect(names).toContain('ANTIGA SELECIONADA');
    expect(names).not.toContain('ENCERRADA');
    expect(names).not.toContain('FUTURA');
  });

  it('searches names without accents and CNPJ with or without punctuation', () => {
    const list = [{ distributor: 'Âmbar Amazonas', cnpj: '02341467000120' }];
    expect(filterDistributors(list, 'ambar')).toEqual(list);
    expect(filterDistributors(list, '02.341.467/0001-20')).toEqual(list);
    expect(filterDistributors(list, '02341467')).toEqual(list);
    expect(filterDistributors(list, 'outra')).toEqual([]);
    expect(filterDistributors(list, 'outra 1')).toEqual([]);
    expect(filterDistributors(list, '  ')).toEqual(list);
  });

  it('accepts validity boundaries and rejects expired/future tariffs', () => {
    const point = tariff('TESTE').current;
    expect(tariffIsCurrent(point, point.start)).toBe(true);
    expect(tariffIsCurrent(point, point.end)).toBe(true);
    expect(tariffIsCurrent(point, '2027-01-01')).toBe(false);
    expect(tariffIsCurrent(point, '2025-12-31')).toBe(false);
  });
});
