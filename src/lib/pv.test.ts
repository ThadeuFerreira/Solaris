import { describe, expect, it } from 'vitest';
import { degradationFactor, fioBTransitionShare, monthlyProduction, performanceRatio, projectFinance } from './pv';

const FLAT = Array(12).fill(5);

describe('production', () => {
  it('gives ~1 500 kWh/kWp/year for 5 peak sun hours and ~80 % PR', () => {
    const input = {
      kWp: 1,
      planeIrradiation: FLAT,
      airTemperature: Array(12).fill(22),
      tempCoeffPct: -0.35,
      noct: 45,
      systemLosses: 0.14,
    };
    const annual = monthlyProduction(input).reduce((a, b) => a + b, 0);
    expect(annual).toBeGreaterThan(1350);
    expect(annual).toBeLessThan(1550);
    expect(performanceRatio(input)).toBeGreaterThan(0.75);
    expect(performanceRatio(input)).toBeLessThan(0.85);
  });
});

describe('degradation', () => {
  it('follows a linear warranty curve', () => {
    expect(degradationFactor(1, 2, 0.55)).toBeCloseTo(0.98);
    expect(degradationFactor(25, 2, 0.55)).toBeCloseTo(0.848);
  });
});

describe('Lei 14.300 transition', () => {
  it('ramps the Fio B share from 2023 to 2029', () => {
    expect(fioBTransitionShare(2022)).toBe(0);
    expect(fioBTransitionShare(2026)).toBe(0.6);
    expect(fioBTransitionShare(2030)).toBe(1);
  });
});

describe('finance', () => {
  const base = {
    firstYearKWh: 6000,
    years: 25,
    startYear: 2026,
    pricePerKWh: 1,
    tariffIncrease: 0,
    degradationFirstYearPct: 0,
    degradationAnnualPct: 0,
    investment: 15000,
    omShare: 0,
    monthlyConsumptionKWh: 0,
    minimumBillKWh: 0,
    applyFioB: false,
    fioBShareOfTariff: 0,
    selfConsumption: 0,
  };

  it('computes payback with constant savings', () => {
    const r = projectFinance(base);
    expect(r.paybackYears).toBeCloseTo(2.5, 6);
    expect(r.totalSavings).toBeCloseTo(150000, 6);
    expect(r.roi).toBeCloseTo(9, 6);
  });

  it('caps savings at the consumption above the minimum bill', () => {
    const r = projectFinance({ ...base, monthlyConsumptionKWh: 300, minimumBillKWh: 50 });
    expect(r.years[0].usedKWh).toBe(3000);
    expect(r.years[0].savings).toBe(3000);
  });

  it('discounts injected energy by the Fio B share', () => {
    const r = projectFinance({ ...base, applyFioB: true, fioBShareOfTariff: 0.3, selfConsumption: 0.5 });
    // 2026: 60 % of a 30 % Fio B on the injected half.
    expect(r.years[0].savings).toBeCloseTo(3000 + 3000 * (1 - 0.18), 6);
    expect(r.years[3].savings).toBeCloseTo(3000 + 3000 * 0.7, 6);
  });
});
