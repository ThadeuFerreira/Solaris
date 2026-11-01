// Settings shared by the sidebar and the simulation, with their defaults.

export type Mounting = 'flush' | 'rack';
export type Orientation = 'portrait' | 'landscape';
export type Connection = 'mono' | 'bi' | 'tri';

export interface PanelSettings {
  panelId: string;
  custom: { powerW: number; lengthM: number; widthM: number };
  mounting: Mounting;
  orientation: Orientation;
  /** Roof pitch (flush) or rack tilt, degrees. */
  tiltDeg: number;
  autoTilt: boolean;
  /** Compass direction the panels face; null = perpendicular to the longest edge. */
  azimuthDeg: number | null;
  setbackM: number;
  gapM: number;
  /** Maximum share of the drawn horizontal area covered by panel footprints. */
  coveragePct: number;
  systemLossesPct: number;
}

export interface TariffSettings {
  distributor: string | null;
  /** True once the user picked a distributor, so location changes stop overriding it. */
  distributorPinned: boolean;
  manualPrice: number | null;
  icmsPct: number | null;
  pisCofinsPct: number;
  includeFlag: boolean;
}

export interface FinanceSettings {
  costPerWp: number;
  monthlyConsumptionKWh: number;
  connection: Connection;
  /** null = use ANEEL's historical trend for the selected distributor. */
  tariffIncreasePct: number | null;
  omPct: number;
  years: number;
  applyFioB: boolean;
  fioBSharePct: number;
  selfConsumptionPct: number;
}

export const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  panelId: 'weg-wpv-550-hmm0',
  custom: { powerW: 550, lengthM: 2.278, widthM: 1.134 },
  mounting: 'flush',
  orientation: 'portrait',
  tiltDeg: 15,
  autoTilt: false,
  azimuthDeg: null,
  setbackM: 0.3,
  gapM: 0.02,
  coveragePct: 100,
  systemLossesPct: 14,
};

export const DEFAULT_TARIFF_SETTINGS: TariffSettings = {
  distributor: null,
  distributorPinned: false,
  manualPrice: null,
  icmsPct: null,
  pisCofinsPct: 5,
  includeFlag: true,
};

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  costPerWp: 3,
  monthlyConsumptionKWh: 0,
  connection: 'bi',
  tariffIncreasePct: null,
  omPct: 0.5,
  years: 25,
  applyFioB: true,
  fioBSharePct: 28,
  selfConsumptionPct: 30,
};

/** Minimum billed energy (custo de disponibilidade) per connection type, kWh/month. */
export const MINIMUM_BILL_KWH: Record<Connection, number> = { mono: 30, bi: 50, tri: 100 };

/** Default ICMS when the state is unknown. */
export const FALLBACK_ICMS_PCT = 19;
/** Yearly tariff increase used when ANEEL history is unavailable. */
export const FALLBACK_TARIFF_INCREASE_PCT = 5;
/** Final price used only when ANEEL is unreachable and the user typed nothing. */
export const EXAMPLE_PRICE_PER_KWH = 1;
