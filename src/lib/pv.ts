// Photovoltaic production and financial projection.

import { MONTH_DAYS } from './solar';

export interface ProductionInput {
  kWp: number;
  /** Monthly mean daily irradiation on the panel plane, kWh/m²/day (= peak sun hours). */
  planeIrradiation: number[];
  /** Monthly mean air temperature, °C. */
  airTemperature: number[];
  /** Pmax temperature coefficient, %/°C (negative). */
  tempCoeffPct: number;
  /** Nominal operating cell temperature, °C. */
  noct: number;
  /** Other system losses: soiling, wiring, inverter, mismatch… (0–1). */
  systemLosses: number;
}

/**
 * Average cell temperature while producing: the 24 h mean air temperature is
 * ~3 °C below the daytime mean, and the module heats above ambient roughly in
 * proportion to irradiance (NOCT is defined at 800 W/m²; ~600 W/m² is a
 * typical irradiance-weighted operating level).
 */
export function cellTemperature(airTemp: number, noct: number): number {
  return airTemp + 3 + ((noct - 20) * 600) / 800;
}

export function temperatureFactor(airTemp: number, noct: number, tempCoeffPct: number): number {
  return 1 + (tempCoeffPct / 100) * (cellTemperature(airTemp, noct) - 25);
}

/** Monthly energy (kWh) for the first year of operation. */
export function monthlyProduction(input: ProductionInput): number[] {
  return input.planeIrradiation.map((h, m) => {
    const t = input.airTemperature[m] ?? 25;
    const pr = (1 - input.systemLosses) * temperatureFactor(t, input.noct, input.tempCoeffPct);
    return input.kWp * h * MONTH_DAYS[m] * pr;
  });
}

/** Performance ratio implied by the losses and temperatures, annual. */
export function performanceRatio(input: ProductionInput): number {
  const energy = monthlyProduction(input).reduce((a, b) => a + b, 0);
  const reference = input.planeIrradiation.reduce((s, h, m) => s + h * MONTH_DAYS[m], 0) * input.kWp;
  return reference > 0 ? energy / reference : 0;
}

/**
 * Output relative to nameplate at the given operating year (1-based),
 * following the usual linear warranty: a first-year drop followed by a
 * constant annual degradation.
 */
export function degradationFactor(year: number, firstYearPct: number, annualPct: number): number {
  return Math.max(0, 1 - firstYearPct / 100 - (Math.max(1, year) - 1) * (annualPct / 100));
}

/**
 * Share of the Fio B (distribution wire) component charged on compensated
 * energy for distributed generation under the Lei 14.300/2022 transition, by
 * calendar year. Systems connected from 2023 on pay the rising share; from
 * 2029 the full Fio B is assumed.
 */
export function fioBTransitionShare(calendarYear: number): number {
  if (calendarYear <= 2022) return 0;
  const table: Record<number, number> = { 2023: 0.15, 2024: 0.3, 2025: 0.45, 2026: 0.6, 2027: 0.75, 2028: 0.9 };
  return table[calendarYear] ?? 1;
}

export interface FinanceInput {
  firstYearKWh: number;
  years: number;
  startYear: number;
  /** Final price paid per kWh today, R$ (taxes and flags included). */
  pricePerKWh: number;
  /** Expected yearly tariff increase (0.05 = 5%). */
  tariffIncrease: number;
  degradationFirstYearPct: number;
  degradationAnnualPct: number;
  investment: number;
  /** Yearly operation & maintenance cost as a share of the investment. */
  omShare: number;
  /** Average monthly consumption, kWh. 0 = unknown → all production valued. */
  monthlyConsumptionKWh: number;
  /** Minimum billed energy (custo de disponibilidade), kWh/month. */
  minimumBillKWh: number;
  /** Apply the Lei 14.300 Fio B transition on injected energy. */
  applyFioB: boolean;
  /** Fio B share of the final tariff (0–1). */
  fioBShareOfTariff: number;
  /** Share of production consumed at the moment it is generated (0–1). */
  selfConsumption: number;
}

export interface YearResult {
  year: number;
  calendarYear: number;
  productionKWh: number;
  usedKWh: number;
  pricePerKWh: number;
  savings: number;
  cost: number;
  cashFlow: number;
  cumulative: number;
}

export interface FinanceResult {
  years: YearResult[];
  paybackYears: number | null;
  totalSavings: number;
  totalProductionKWh: number;
  /** Net gain over the period divided by the investment. */
  roi: number;
}

export function projectFinance(input: FinanceInput): FinanceResult {
  const years: YearResult[] = [];
  const annualOffsetCap =
    input.monthlyConsumptionKWh > 0
      ? Math.max(0, input.monthlyConsumptionKWh - input.minimumBillKWh) * 12
      : Infinity;

  let cumulative = -input.investment;
  let payback: number | null = null;
  let totalSavings = 0;
  let totalProduction = 0;

  for (let y = 1; y <= input.years; y++) {
    const calendarYear = input.startYear + y - 1;
    const production =
      input.firstYearKWh * degradationFactor(y, input.degradationFirstYearPct, input.degradationAnnualPct);
    const used = Math.min(production, annualOffsetCap);
    const price = input.pricePerKWh * (1 + input.tariffIncrease) ** (y - 1);

    // Energy consumed instantly never touches the grid; the rest is injected and
    // compensated as credits, which pay part of the Fio B after Lei 14.300.
    const fioB = input.applyFioB ? input.fioBShareOfTariff * fioBTransitionShare(calendarYear) : 0;
    const instant = used * input.selfConsumption;
    const injected = used - instant;
    const savings = price * (instant + injected * (1 - fioB));

    const cost = input.investment * input.omShare * (1 + input.tariffIncrease) ** (y - 1);
    const cashFlow = savings - cost;
    const previous = cumulative;
    cumulative += cashFlow;
    if (payback === null && cumulative >= 0 && cashFlow > 0) {
      payback = y - 1 + -previous / cashFlow;
    }
    totalSavings += savings;
    totalProduction += production;
    years.push({
      year: y,
      calendarYear,
      productionKWh: production,
      usedKWh: used,
      pricePerKWh: price,
      savings,
      cost,
      cashFlow,
      cumulative,
    });
  }

  return {
    years,
    paybackYears: payback,
    totalSavings,
    totalProductionKWh: totalProduction,
    roi: input.investment > 0 ? cumulative / input.investment : 0,
  };
}

/** kWp needed to cover a monthly consumption, given specific yield (kWh/kWp/year). */
export function sizeForConsumption(monthlyKWh: number, minimumBillKWh: number, specificYield: number): number {
  if (specificYield <= 0) return 0;
  return (Math.max(0, monthlyKWh - minimumBillKWh) * 12) / specificYield;
}
