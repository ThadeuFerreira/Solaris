// ANEEL open data portal (CKAN). Datasets used:
//  - Tarifas de aplicação das distribuidoras de energia elétrica
//    https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica
//  - Bandeiras tarifárias (acionamento)
//    https://dadosabertos.aneel.gov.br/dataset/bandeiras-tarifarias

import { fetchJson, HttpError, isAbort } from './http';

const DIRECT_BASE = 'https://dadosabertos.aneel.gov.br/api/3/action';
// Same-origin fallback served by the Vite dev/preview proxy (see vite.config.ts)
// in case the portal does not send CORS headers to the browser.
const PROXY_BASE = '/aneel-api/api/3/action';

export const TARIFF_RESOURCE_ID = 'fcf2906c-7c32-4b9b-a637-054e7a5234f4';
export const FLAG_RESOURCE_ID = '0591b8f6-fe54-437b-b72b-1aa2efd46e42';

export const TARIFF_DATASET_URL = 'https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica';
export const FLAG_DATASET_URL = 'https://dadosabertos.aneel.gov.br/dataset/bandeiras-tarifarias';

type CkanRecord = Record<string, unknown>;

interface CkanResponse {
  success: boolean;
  result: { records: CkanRecord[]; total?: number };
}

let workingBase: string | null = null;

async function datastoreSearch(params: Record<string, string>, signal?: AbortSignal): Promise<CkanRecord[]> {
  const qs = new URLSearchParams(params).toString();
  const bases = workingBase ? [workingBase] : [DIRECT_BASE, PROXY_BASE];
  let lastError: unknown;
  for (const base of bases) {
    try {
      const data = await fetchJson<CkanResponse>(`${base}/datastore_search?${qs}`, { signal, timeoutMs: 30000 });
      if (!data.success) throw new Error('ANEEL: consulta não foi aceita');
      workingBase = base;
      return data.result.records;
    } catch (err) {
      if (isAbort(err)) throw err;
      lastError = err;
      // A 4xx from the portal itself means the query is wrong; the proxy would
      // answer the same. Network/CORS failures fall through to the proxy.
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && base === DIRECT_BASE) throw err;
    }
  }
  throw lastError;
}

/** Runs the first query variant that returns rows; later variants are fallbacks. */
async function firstNonEmpty(variants: Record<string, string>[], signal?: AbortSignal): Promise<CkanRecord[]> {
  let lastError: unknown = null;
  for (const params of variants) {
    try {
      const records = await datastoreSearch(params, signal);
      if (records.length) return records;
    } catch (err) {
      if (isAbort(err)) throw err;
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return [];
}

/** Reads a field tolerating casing differences between dataset versions. */
function field(r: CkanRecord, name: string): unknown {
  if (name in r) return r[name];
  const lower = name.toLowerCase();
  const key = Object.keys(r).find((k) => k.toLowerCase() === lower);
  return key ? r[key] : undefined;
}

/** Parses ANEEL numbers, which come as "390,51" strings or plain numbers. */
export function parseAneelNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalised = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function isoDate(value: unknown): string {
  return str(value).slice(0, 10);
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();

export interface TariffPoint {
  start: string;
  end: string;
  /** R$/kWh, before taxes. */
  tusd: number;
  te: number;
  total: number;
  resolution: string;
}

export interface DistributorTariff {
  distributor: string;
  current: TariffPoint;
  history: TariffPoint[];
}

/**
 * Groups raw tariff rows into one residential B1 conventional tariff per
 * distributor and validity period.
 */
export function buildTariffs(records: CkanRecord[], today = new Date().toISOString().slice(0, 10)): DistributorTariff[] {
  const byDistributor = new Map<string, Map<string, { point: TariffPoint; score: number }>>();

  for (const r of records) {
    const subclass = norm(str(field(r, 'DscSubClasse')));
    if (subclass && subclass !== 'RESIDENCIAL' && subclass !== 'NAO SE APLICA') continue;
    const post = norm(str(field(r, 'NomPostoTarifario')));
    if (post && post !== 'NAO SE APLICA') continue;
    const unit = norm(str(field(r, 'DscUnidadeTerciaria')));
    if (unit && unit !== 'MWH' && unit !== 'KWH') continue;

    const tusdRaw = parseAneelNumber(field(r, 'VlrTUSD'));
    const teRaw = parseAneelNumber(field(r, 'VlrTE'));
    if (tusdRaw === null || teRaw === null) continue;
    // Energy tariffs are published in R$/MWh; convert to R$/kWh.
    const divisor = unit === 'KWH' ? 1 : unit === 'MWH' || tusdRaw + teRaw > 10 ? 1000 : 1;

    const distributor = str(field(r, 'SigAgente'));
    const start = isoDate(field(r, 'DatInicioVigencia'));
    if (!distributor || !start) continue;

    const point: TariffPoint = {
      start,
      end: isoDate(field(r, 'DatFimVigencia')),
      tusd: tusdRaw / divisor,
      te: teRaw / divisor,
      total: (tusdRaw + teRaw) / divisor,
      resolution: str(field(r, 'DscREH')),
    };
    // Prefer the plain residential row when several share a period.
    const detail = norm(str(field(r, 'DscDetalhe')));
    const score = (subclass === 'RESIDENCIAL' ? 2 : 0) + (detail === '' || detail === 'NAO SE APLICA' ? 1 : 0);

    let periods = byDistributor.get(distributor);
    if (!periods) byDistributor.set(distributor, (periods = new Map()));
    const existing = periods.get(start);
    if (!existing || score > existing.score) periods.set(start, { point, score });
  }

  const result: DistributorTariff[] = [];
  for (const [distributor, periods] of byDistributor) {
    const history = [...periods.values()].map((p) => p.point).sort((a, b) => a.start.localeCompare(b.start));
    const valid = history.filter((p) => p.start <= today);
    const current = valid.at(-1) ?? history.at(-1);
    if (current) result.push({ distributor, current, history: valid.length ? valid : history });
  }
  return result.sort((a, b) => a.distributor.localeCompare(b.distributor, 'pt-BR'));
}

/**
 * Average yearly tariff change over (up to) the last `years` years of history.
 * Returns null when there is not enough data.
 */
export function tariffTrend(history: TariffPoint[], years = 8): number | null {
  if (history.length < 2) return null;
  const last = history.at(-1)!;
  const cutoff = new Date(last.start);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const first = history.find((p) => new Date(p.start) >= cutoff) ?? history[0];
  const span = (new Date(last.start).getTime() - new Date(first.start).getTime()) / (365.25 * 86400000);
  if (span < 2 || first.total <= 0) return null;
  return (last.total / first.total) ** (1 / span) - 1;
}

export async function fetchResidentialTariffs(signal?: AbortSignal): Promise<DistributorTariff[]> {
  const filters = {
    DscBaseTarifaria: 'Tarifa de Aplicação',
    DscSubGrupo: 'B1',
    DscModalidadeTarifaria: 'Convencional',
  };
  const query = (f: Record<string, string>, sorted: boolean) => ({
    resource_id: TARIFF_RESOURCE_ID,
    filters: JSON.stringify(f),
    limit: '32000',
    ...(sorted ? { sort: 'DatInicioVigencia desc' } : {}),
  });
  const records = await firstNonEmpty(
    [query({ ...filters, DscSubClasse: 'Residencial' }, true), query(filters, true), query(filters, false)],
    signal,
  );
  const tariffs = buildTariffs(records);
  if (tariffs.length === 0) throw new Error('ANEEL: nenhuma tarifa residencial encontrada');
  return tariffs;
}

export type FlagName = 'Verde' | 'Amarela' | 'Vermelha P1' | 'Vermelha P2' | 'Escassez hídrica';

/** Flag surcharges in R$/kWh in force since 2025. Used when the API row has none. */
export const DEFAULT_FLAG_SURCHARGE: Record<FlagName, number> = {
  Verde: 0,
  Amarela: 0.01885,
  'Vermelha P1': 0.04463,
  'Vermelha P2': 0.07877,
  'Escassez hídrica': 0.142,
};

export interface FlagStatus {
  month: string;
  name: FlagName;
  rawName: string;
  /** R$/kWh added to the tariff. */
  surcharge: number;
  surchargeFromApi: boolean;
}

export function normaliseFlag(raw: string): FlagName {
  const n = norm(raw);
  if (n.includes('ESCASSEZ')) return 'Escassez hídrica';
  if (n.includes('VERMELHA')) return /2|II/.test(n) ? 'Vermelha P2' : 'Vermelha P1';
  if (n.includes('AMARELA')) return 'Amarela';
  return 'Verde';
}

/**
 * Surcharges have been published per MWh, per 100 kWh and per kWh. Pick the
 * unit that lands closest (log scale) to the known value for that flag.
 */
export function surchargeToKWh(value: number, flag: FlagName): number {
  const reference = DEFAULT_FLAG_SURCHARGE[flag];
  if (value <= 0 || reference <= 0) return 0;
  const candidates = [value / 1000, value / 100, value];
  return candidates.reduce((best, c) =>
    Math.abs(Math.log(c / reference)) < Math.abs(Math.log(best / reference)) ? c : best,
  );
}

export function pickCurrentFlag(records: CkanRecord[], today = new Date().toISOString().slice(0, 10)): FlagStatus | null {
  const month = today.slice(0, 7);
  const rows = records
    .map((r) => ({ r, month: isoDate(field(r, 'DatCompetencia')) }))
    .filter((x) => x.month && x.month.slice(0, 7) <= month)
    .sort((a, b) => b.month.localeCompare(a.month));
  const latest = rows[0];
  if (!latest) return null;
  const rawName = str(field(latest.r, 'NomBandeiraAcionada'));
  const name = normaliseFlag(rawName);
  // The surcharge column name has varied (VlrAdicionalBandeira, …RSMWh).
  const surchargeKey = Object.keys(latest.r).find((k) => /^VlrAdicional/i.test(k));
  const raw = surchargeKey ? parseAneelNumber(latest.r[surchargeKey]) : null;
  const fromApi = raw !== null && raw >= 0;
  return {
    month: latest.month,
    name,
    rawName,
    surcharge: fromApi ? surchargeToKWh(raw, name) : DEFAULT_FLAG_SURCHARGE[name],
    surchargeFromApi: fromApi,
  };
}

export async function fetchCurrentFlag(signal?: AbortSignal): Promise<FlagStatus> {
  const records = await firstNonEmpty(
    [
      { resource_id: FLAG_RESOURCE_ID, sort: 'DatCompetencia desc', limit: '6' },
      { resource_id: FLAG_RESOURCE_ID, limit: '1000' },
    ],
    signal,
  );
  const flag = pickCurrentFlag(records);
  if (!flag) throw new Error('ANEEL: sem dados de bandeira');
  return flag;
}
