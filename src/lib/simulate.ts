// Ties geometry, irradiance, production and finance together.

import type { PanelModel } from '../data/panels';
import type { FinanceSettings, PanelSettings } from '../model';
import { MINIMUM_BILL_KWH } from '../model';
import { layoutPanels, longestEdgeBearing, polygonAreaM2, type LatLng } from './geometry';
import { monthlyProduction, performanceRatio, projectFinance, sizeForConsumption, type FinanceResult } from './pv';
import { annualFromDailyMeans, equatorFacingAzimuth, optimalTilt, rowShadeGap, tiltedIrradiation } from './solar';

export interface SolarInput {
  lat: number;
  ghi: number[];
  temperature: number[];
}

export interface LayoutInput {
  polygon: LatLng[];
  solar: SolarInput;
  panel: PanelModel;
  settings: PanelSettings;
  exclusions?: LatLng[][];
}

export interface LayoutPlan {
  areaM2: number;
  azimuthDeg: number;
  tiltDeg: number;
  optimalTiltDeg: number;
  rowGapM: number;
  panels: LatLng[][];
  fittedCount: number;
}

export interface EnergyInput {
  plan: LayoutPlan;
  solar: SolarInput;
  panel: PanelModel;
  settings: PanelSettings;
  finance: FinanceSettings;
  pricePerKWh: number;
  tariffIncrease: number;
  startYear: number;
}

export interface Simulation {
  usedCount: number;
  kWp: number;
  panelAreaM2: number;
  planeIrradiation: number[];
  monthlyKWh: number[];
  annualKWh: number;
  specificYield: number;
  performanceRatio: number;
  suggestedPanels: number | null;
  finance: FinanceResult;
  investment: number;
}

/**
 * Of the two directions perpendicular to the longest edge, the one closer to
 * the equator — the roof face that matters most when drawing a pitched roof.
 */
export function autoAzimuth(polygon: LatLng[], lat: number): number {
  const edge = longestEdgeBearing(polygon);
  const target = equatorFacingAzimuth(lat);
  const options = [(edge + 90) % 360, (edge + 270) % 360];
  const distance = (a: number) => Math.min(Math.abs(a - target), 360 - Math.abs(a - target));
  return distance(options[0]) <= distance(options[1]) ? options[0] : options[1];
}

export function planLayout({ polygon, solar, panel, settings, exclusions }: LayoutInput): LayoutPlan {
  const azimuthDeg = settings.azimuthDeg ?? autoAzimuth(polygon, solar.lat);
  const optimalTiltDeg = optimalTilt(solar.lat, solar.ghi, azimuthDeg);
  const tiltDeg = settings.mounting === 'rack' && settings.autoTilt ? optimalTiltDeg : settings.tiltDeg;

  const across = settings.orientation === 'portrait' ? panel.lengthM : panel.widthM;
  const along = settings.orientation === 'portrait' ? panel.widthM : panel.lengthM;
  // The map shows the horizontal projection, so a tilted panel's footprint shrinks.
  const footprint = across * Math.cos((tiltDeg * Math.PI) / 180);
  const rowGapM =
    settings.mounting === 'rack' ? Math.max(settings.gapM, rowShadeGap(solar.lat, across, tiltDeg, azimuthDeg)) : settings.gapM;

  const layout = layoutPanels(polygon, {
    alongRowM: along,
    acrossRowM: footprint,
    gapM: settings.gapM,
    rowGapM,
    setbackM: settings.setbackM,
    bearingDeg: azimuthDeg,
    exclusions,
  });
  const areaM2 = polygonAreaM2(polygon);
  const coverage = Math.max(0, Math.min(100, settings.coveragePct));
  const coverageLimit = Math.floor((areaM2 * coverage / 100) / (along * footprint) + 1e-9);
  const panels = layout.panels.slice(0, coverageLimit);
  return {
    areaM2,
    azimuthDeg,
    tiltDeg,
    optimalTiltDeg,
    rowGapM,
    panels,
    fittedCount: panels.length,
  };
}

export function simulate(input: EnergyInput): Simulation {
  const { plan, solar, panel, settings, finance } = input;
  const usedCount = plan.fittedCount;
  const kWp = (usedCount * panel.powerW) / 1000;

  const planeIrradiation = tiltedIrradiation(solar.lat, solar.ghi, { tiltDeg: plan.tiltDeg, azimuthDeg: plan.azimuthDeg });
  const productionInput = {
    kWp,
    planeIrradiation,
    airTemperature: solar.temperature,
    tempCoeffPct: panel.tempCoeffPct,
    noct: panel.noct,
    systemLosses: settings.systemLossesPct / 100,
  };
  const monthlyKWh = monthlyProduction(productionInput);
  const annualKWh = monthlyKWh.reduce((a, b) => a + b, 0);
  const pr = performanceRatio({ ...productionInput, kWp: 1 });
  const specificYield = annualFromDailyMeans(planeIrradiation) * pr;

  const minimumBill = MINIMUM_BILL_KWH[finance.connection];
  const suggestedPanels =
    finance.monthlyConsumptionKWh > 0
      ? Math.ceil((sizeForConsumption(finance.monthlyConsumptionKWh, minimumBill, specificYield) * 1000) / panel.powerW)
      : null;

  const investment = kWp * 1000 * finance.costPerWp;
  const financeResult = projectFinance({
    firstYearKWh: annualKWh,
    years: finance.years,
    startYear: input.startYear,
    pricePerKWh: input.pricePerKWh,
    tariffIncrease: input.tariffIncrease,
    degradationFirstYearPct: panel.degradationFirstYearPct,
    degradationAnnualPct: panel.degradationAnnualPct,
    investment,
    omShare: finance.omPct / 100,
    monthlyConsumptionKWh: finance.monthlyConsumptionKWh,
    minimumBillKWh: minimumBill,
    applyFioB: finance.applyFioB,
    fioBShareOfTariff: finance.fioBSharePct / 100,
    selfConsumption: finance.selfConsumptionPct / 100,
  });

  return {
    usedCount,
    kWp,
    panelAreaM2: usedCount * panel.lengthM * panel.widthM,
    planeIrradiation,
    monthlyKWh,
    annualKWh,
    specificYield,
    performanceRatio: pr,
    suggestedPanels,
    finance: financeResult,
    investment,
  };
}
