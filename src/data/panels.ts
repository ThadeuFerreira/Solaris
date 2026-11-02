// Module catalogue. WEG publishes no product API, so values are transcribed
// from WEG datasheets (static.weg.net download center). Dimensions for the
// 144 half-cell frame follow from the published power and efficiency
// (550 W / 21.3 % ⇒ 2.58 m²) and match the 2278 × 1134 mm M10 format.

export interface PanelModel {
  id: string;
  brand: string;
  model: string;
  powerW: number;
  /** Long side, metres. */
  lengthM: number;
  /** Short side, metres. */
  widthM: number;
  efficiencyPct: number;
  /** Pmax temperature coefficient, %/°C. */
  tempCoeffPct: number;
  noct: number;
  degradationFirstYearPct: number;
  degradationAnnualPct: number;
  warrantyYears: number;
  datasheetUrl?: string;
  note?: string;
}

const WEG_550_555_DATASHEET =
  'https://static.weg.net/medias/downloadcenter/h13/he1/WEG-wpv-550-555-hmm0-datasheet-pt.pdf';

export const PANELS: PanelModel[] = [
  {
    id: 'weg-wpv-550-hmm0',
    brand: 'WEG',
    model: 'WPV 550 HMM0 (monocristalino half-cell)',
    powerW: 550,
    lengthM: 2.278,
    widthM: 1.134,
    efficiencyPct: 21.3,
    tempCoeffPct: -0.35,
    noct: 45,
    degradationFirstYearPct: 2,
    degradationAnnualPct: 0.55,
    warrantyYears: 25,
    datasheetUrl: WEG_550_555_DATASHEET,
    note: 'Garantia de 12 anos (produto) e 25 anos (performance). Eficiência INMETRO classe A.',
  },
  {
    id: 'weg-wpv-555-hmm0',
    brand: 'WEG',
    model: 'WPV 555 HMM0 (monocristalino half-cell)',
    powerW: 555,
    lengthM: 2.278,
    widthM: 1.134,
    efficiencyPct: 21.5,
    tempCoeffPct: -0.35,
    noct: 45,
    degradationFirstYearPct: 2,
    degradationAnnualPct: 0.55,
    warrantyYears: 25,
    datasheetUrl: WEG_550_555_DATASHEET,
    note: 'Garantia de 12 anos (produto) e 25 anos (performance). Eficiência INMETRO classe A.',
  },
  {
    id: 'generic-450',
    brand: 'Genérico',
    model: '450 W — 144 células (formato M6)',
    powerW: 450,
    lengthM: 2.094,
    widthM: 1.038,
    efficiencyPct: 20.7,
    tempCoeffPct: -0.35,
    noct: 45,
    degradationFirstYearPct: 2,
    degradationAnnualPct: 0.55,
    warrantyYears: 25,
    note: 'Referência típica de mercado; ajuste conforme o datasheet do seu módulo.',
  },
  {
    id: 'generic-topcon-610',
    brand: 'Genérico',
    model: '610 W — TOPCon tipo-n bifacial (formato G12R)',
    powerW: 610,
    lengthM: 2.382,
    widthM: 1.134,
    efficiencyPct: 22.6,
    tempCoeffPct: -0.29,
    noct: 43,
    degradationFirstYearPct: 1,
    degradationAnnualPct: 0.4,
    warrantyYears: 30,
    note: 'Referência típica de mercado (ganho bifacial não considerado).',
  },
];

export const CUSTOM_PANEL_ID = 'custom';

export function makeCustomPanel(base: PanelModel, overrides: Partial<PanelModel>): PanelModel {
  const merged = { ...base, ...overrides, id: CUSTOM_PANEL_ID, brand: 'Personalizado', model: 'Módulo personalizado' };
  merged.efficiencyPct = (merged.powerW / (merged.lengthM * merged.widthM * 1000)) * 100;
  return merged;
}
