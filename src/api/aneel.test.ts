import { describe, expect, it } from 'vitest';
import { guessDistributor } from '../data/distributors';
import { buildTariffs, parseAneelNumber, pickCurrentFlag, surchargeToKWh, tariffTrend } from './aneel';

const row = (over: Record<string, unknown>) => ({
  SigAgente: 'ENEL SP',
  DatInicioVigencia: '2026-07-04',
  DatFimVigencia: '2027-07-03',
  DscREH: 'REH 3.400/2026',
  DscSubClasse: 'Residencial',
  DscDetalhe: 'Não se aplica',
  NomPostoTarifario: 'Não se aplica',
  DscUnidadeTerciaria: 'MWh',
  VlrTUSD: '450,10',
  VlrTE: '300,00',
  ...over,
});

describe('ANEEL parsing', () => {
  it('parses Brazilian decimal strings', () => {
    expect(parseAneelNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(parseAneelNumber('390,51')).toBeCloseTo(390.51);
    expect(parseAneelNumber(12.5)).toBe(12.5);
    expect(parseAneelNumber('')).toBeNull();
  });

  it('keeps one residential tariff per period and picks the one in force', () => {
    const tariffs = buildTariffs(
      [
        row({}),
        row({ DscSubClasse: 'Baixa Renda', VlrTUSD: '10,00' }),
        row({ DatInicioVigencia: '2025-07-04', DatFimVigencia: '2026-07-03', VlrTUSD: '420,00' }),
        row({ DatInicioVigencia: '2027-07-04', VlrTUSD: '999,00' }),
        row({ SigAgente: 'CEMIG-D', VlrTUSD: '500,00', VlrTE: '310,00' }),
      ],
      '2026-10-31',
    );
    expect(tariffs.map((t) => t.distributor)).toEqual(['CEMIG-D', 'ENEL SP']);
    const enel = tariffs[1];
    expect(enel.current.start).toBe('2026-07-04');
    expect(enel.current.total).toBeCloseTo(0.7501);
    expect(enel.history).toHaveLength(2);
  });

  it('computes the yearly tariff trend', () => {
    const history = [
      { start: '2018-01-01', end: '', tusd: 0, te: 0, total: 0.5, resolution: '' },
      { start: '2026-01-01', end: '', tusd: 0, te: 0, total: 0.5 * 1.06 ** 8, resolution: '' },
    ];
    expect(tariffTrend(history)).toBeCloseTo(0.06, 3);
  });

  it('prefers the latest published act for amendments with the same validity date', () => {
    const old = row({ DscREH: 'RESOLUÇÃO Nº 1, DE 6 DE ABRIL DE 2026', VlrTUSD: '200,00' });
    const revised = row({ DscREH: 'RESOLUÇÃO Nº 2, DE 13 DE JULHO DE 2026', VlrTUSD: '300,00' });
    for (const records of [[old, revised], [revised, old]]) {
      expect(buildTariffs(records, '2026-11-02')[0].current.tusd).toBe(0.3);
    }
  });

  it('normalises flag surcharges in any unit', () => {
    expect(surchargeToKWh(18.85, 'Amarela')).toBeCloseTo(0.01885);
    expect(surchargeToKWh(1.885, 'Amarela')).toBeCloseTo(0.01885);
    expect(surchargeToKWh(0.07877, 'Vermelha P2')).toBeCloseTo(0.07877);
  });

  it('ignores flags announced for future months', () => {
    const flag = pickCurrentFlag(
      [
        { DatCompetencia: '2026-11-01', NomBandeiraAcionada: 'Vermelha Patamar 2' },
        { DatCompetencia: '2026-10-01', NomBandeiraAcionada: 'Amarela', VlrAdicionalBandeiraRSMWh: '18,85' },
      ],
      '2026-10-31',
    );
    expect(flag?.name).toBe('Amarela');
    expect(flag?.surcharge).toBeCloseTo(0.01885);
    expect(flag?.surchargeFromApi).toBe(true);
  });
});

describe('distributor guess', () => {
  const agents = ['CEMIG-D', 'CPFL-PAULISTA', 'ELETROPAULO', 'ENEL SP', 'LIGHT SESA', 'RGE SUL'];

  it('uses city overrides before the state default', () => {
    expect(guessDistributor(agents, 'SP', 'Campinas')).toBe('CPFL-PAULISTA');
    expect(guessDistributor(agents, 'SP', 'São Paulo')).toBe('ENEL SP');
    expect(guessDistributor(agents, 'RJ', 'Rio de Janeiro')).toBe('LIGHT SESA');
    expect(guessDistributor(agents, 'MG', null)).toBe('CEMIG-D');
    expect(guessDistributor(agents, 'AM', null)).toBeNull();
  });
});
