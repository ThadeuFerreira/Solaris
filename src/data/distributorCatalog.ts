import type { DistributorTariff, TariffPoint } from '../api/aneel';
import snapshot from './distributor-catalog.json';

export const DISTRIBUTOR_CATALOG = snapshot;

export interface DistributorOption {
  distributor: string;
  cnpj: string | null;
}

export function tariffIsCurrent(point: TariffPoint, today: string): boolean {
  return point.start <= today && (!point.end || point.end >= today);
}

/** The bundled catalogue remains available when neither server nor ANEEL responds. */
export function distributorOptions(
  tariffs: DistributorTariff[],
  selected: string | null = null,
  today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
): DistributorOption[] {
  const options = new Map<string, DistributorOption>(snapshot.distributors.map((entry) => [entry.distributor, entry]));
  for (const tariff of tariffs) {
    if (tariffIsCurrent(tariff.current, today) && !options.has(tariff.distributor)) {
      options.set(tariff.distributor, { distributor: tariff.distributor, cnpj: null });
    }
  }
  // A previously saved choice must still be visible after a rename or retirement.
  if (selected && !options.has(selected)) options.set(selected, { distributor: selected, cnpj: null });
  return [...options.values()].sort((a, b) => a.distributor.localeCompare(b.distributor, 'pt-BR'));
}

const searchable = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function filterDistributors(options: DistributorOption[], query: string): DistributorOption[] {
  const search = searchable(query.trim());
  const digits = query.replace(/\D/g, '');
  const cnpjSearch = digits.length > 0 && /^[\d\s./-]+$/.test(query);
  return options.filter((entry) => searchable(entry.distributor).includes(search) || (cnpjSearch && entry.cnpj?.includes(digits)));
}
