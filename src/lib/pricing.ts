import { tariffTrend, type DistributorTariff, type FlagStatus } from '../api/aneel';
import { latestNationalAverage, type AnnualTariffAverage } from '../api/samp';
import { tariffIsCurrent } from '../data/distributorCatalog';
import { EXAMPLE_PRICE_PER_KWH, type TariffSettings } from '../model';

export interface Pricing {
  source: 'aneel' | 'manual' | 'national' | 'example';
  tariff: DistributorTariff | null;
  nationalAverage: AnnualTariffAverage | null;
  baseTariff: number | null;
  flagSurcharge: number;
  taxRate: number;
  icmsPct: number;
  finalPrice: number;
  trend: number | null;
}

export function calculatePricing({ tariffs, settings, icmsPct, flag, averages, today }: {
  tariffs: DistributorTariff[]; settings: TariffSettings; icmsPct: number;
  flag: FlagStatus | null; averages: AnnualTariffAverage[]; today: string;
}): Pricing {
  const tariff = tariffs.find((entry) => entry.distributor === settings.distributor && tariffIsCurrent(entry.current, today)) ?? null;
  const national = latestNationalAverage(averages, today);
  const taxRate = (icmsPct + settings.pisCofinsPct) / 100;
  const baseTariff = tariff?.current.total ?? null;
  const surcharge = settings.includeFlag && flag ? flag.surcharge : 0;
  const localPrice = baseTariff !== null && taxRate < 1 ? (baseTariff + surcharge) / (1 - taxRate) : null;
  const source = settings.manualPrice !== null ? 'manual' : localPrice !== null ? 'aneel' : national ? 'national' : 'example';
  return {
    source, tariff, nationalAverage: source === 'national' ? national : null, baseTariff,
    flagSurcharge: source === 'national' ? 0 : surcharge, taxRate, icmsPct,
    // SAMP's with-tax average already contains the observed taxes and flags.
    finalPrice: settings.manualPrice ?? localPrice ?? national?.price ?? EXAMPLE_PRICE_PER_KWH,
    trend: tariff ? tariffTrend(tariff.history) : null,
  };
}
