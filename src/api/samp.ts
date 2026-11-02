export const SAMP_DATASET_URL = 'https://dadosabertos.aneel.gov.br/dataset/samp';

export interface AnnualTariffAverage {
  referenceYear: number;
  /** Nominal R$/kWh, weighted by billed residential captive consumption. */
  price: number;
  taxBasis: 'with_taxes' | 'without_taxes';
  includesFlags: boolean;
  completeYear: boolean;
  dataThrough: string;
  methodology: string;
  sourceUrl: string;
  sourceResourceId: string;
  sourceDate: string;
  fetchedAt: string;
}

export function latestNationalAverage(averages: AnnualTariffAverage[], today: string): AnnualTariffAverage | null {
  const currentYear = Number(today.slice(0, 4));
  return averages.filter((entry) => entry.completeYear && entry.referenceYear < currentYear &&
    entry.dataThrough === `${entry.referenceYear}-12` && entry.taxBasis === 'with_taxes' && entry.includesFlags &&
    Number.isFinite(entry.price) && entry.price > 0)
    .sort((a, b) => b.referenceYear - a.referenceYear || b.sourceDate.localeCompare(a.sourceDate) ||
      b.fetchedAt.localeCompare(a.fetchedAt))[0] ?? null;
}
