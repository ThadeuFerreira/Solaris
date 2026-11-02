// Client for the Solaris server (server/api.ts), which caches ANEEL and NASA
// data in SQLite and stores saved simulations. Every loader falls back to the
// public API when the server is missing (e.g. a static deploy) or failing.

import type { SavedSimulation } from '../lib/savedSimulation';
import { fetchCurrentFlag, fetchResidentialTariffs, type DistributorTariff, type FlagStatus } from './aneel';
import { fetchJson, HttpError, isAbort } from './http';
import { fetchSolarClimatology, type SolarClimatology } from './nasaPower';
import type { AnnualTariffAverage } from './samp';
import nationalSnapshot from '../data/samp-annual-averages.json';

export interface Provenance {
  /** 'server': Solaris cache; 'direct': the public API, called from the browser. */
  via: 'server' | 'direct';
  /** When the server last refreshed the data from the upstream API. */
  fetchedAt: string | null;
  /** True when the server could not refresh and served an older copy. */
  stale: boolean;
}

export interface TariffData extends Provenance {
  tariffs: DistributorTariff[];
}

export interface FlagData extends Provenance {
  flag: FlagStatus | null;
}

export interface AnnualTariffData {
  averages: AnnualTariffAverage[];
}

export const BUNDLED_ANNUAL_TARIFFS: AnnualTariffData = nationalSnapshot as AnnualTariffData;

export function loadAnnualTariffs(signal?: AbortSignal): Promise<AnnualTariffData> {
  return withFallback(async () => {
    const result = await fetchJson<AnnualTariffData>('/api/annual-tariffs', { signal });
    return { averages: [...result.averages, ...BUNDLED_ANNUAL_TARIFFS.averages] };
  }, async () => BUNDLED_ANNUAL_TARIFFS, signal);
}

export type SolarData = SolarClimatology & Provenance;

async function withFallback<T>(fromServer: () => Promise<T>, direct: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fromServer();
  } catch (err) {
    if (isAbort(err) || signal?.aborted) throw err;
    return direct();
  }
}

const DIRECT: Provenance = { via: 'direct', fetchedAt: null, stale: false };

export function loadTariffs(signal?: AbortSignal): Promise<TariffData> {
  return withFallback(
    async () => {
      const r = await fetchJson<{ tariffs: DistributorTariff[]; fetchedAt: string | null; stale: boolean }>('/api/tariffs', {
        signal,
        timeoutMs: 90000,
      });
      return { via: 'server', fetchedAt: r.fetchedAt, stale: r.stale, tariffs: r.tariffs };
    },
    async () => ({ ...DIRECT, tariffs: await fetchResidentialTariffs(signal) }),
    signal,
  );
}

export function loadFlag(signal?: AbortSignal): Promise<FlagData> {
  return withFallback(
    async () => {
      const r = await fetchJson<{ flag: FlagStatus | null; fetchedAt: string | null; stale: boolean }>('/api/flag', {
        signal,
        timeoutMs: 60000,
      });
      if (!r.flag) throw new Error('servidor sem bandeira');
      return { via: 'server', fetchedAt: r.fetchedAt, stale: r.stale, flag: r.flag };
    },
    async () => ({ ...DIRECT, flag: await fetchCurrentFlag(signal) }),
    signal,
  );
}

export function loadSolar(lat: number, lng: number, signal?: AbortSignal): Promise<SolarData> {
  return withFallback(
    async () => {
      const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      const r = await fetchJson<SolarClimatology & { fetchedAt: string }>(`/api/solar?${params}`, { signal, timeoutMs: 45000 });
      return { ...r, via: 'server', stale: false };
    },
    async () => ({ ...(await fetchSolarClimatology(lat, lng, signal)), ...DIRECT }),
    signal,
  );
}

export async function saveSimulation(simulation: SavedSimulation): Promise<string> {
  const res = await fetch('/api/simulations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(simulation),
  });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new HttpError(res.status, 'o servidor do Solaris não está disponível');
  const body = (await res.json()) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new HttpError(res.status, body.error ?? `HTTP ${res.status}`);
  return body.id;
}

export async function loadSimulation(id: string, signal?: AbortSignal): Promise<SavedSimulation> {
  const r = await fetchJson<{ simulation: SavedSimulation }>(`/api/simulations/${encodeURIComponent(id)}`, { signal });
  return r.simulation;
}
