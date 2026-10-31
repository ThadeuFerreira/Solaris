// ANEEL open data portal (CKAN). Datasets used:
//  - Tarifas de aplicação das distribuidoras de energia elétrica
//    https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica
//  - Bandeiras tarifárias (acionamento)
//    https://dadosabertos.aneel.gov.br/dataset/bandeiras-tarifarias
//
// Used by the Solaris server (which caches the results in SQLite) and, when
// that server is unreachable, directly by the browser.

import { fetchJson, isAbort } from './http';

const BASE = 'https://dadosabertos.aneel.gov.br/api/3/action';

export const TARIFF_RESOURCE_ID = 'fcf2906c-7c32-4b9b-a637-054e7a5234f4';
export const FLAG_RESOURCE_ID = '0591b8f6-fe54-437b-b72b-1aa2efd46e42';

export const TARIFF_DATASET_URL = 'https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica';
export const FLAG_DATASET_URL = 'https://dadosabertos.aneel.gov.br/dataset/bandeiras-tarifarias';

type CkanRecord = Record<string, unknown>;

interface CkanResponse {
  success: boolean;
  result: { records: CkanRecord[]; total?: number };
}

async function datastoreSearch(params: Record<string, string>, signal?: AbortSignal): Promise<CkanRecord[]> {
  const qs = new URLSearchParams(params).toString();
  const data = await fetchJson<CkanResponse>(`${BASE}/datastore_search?${qs}`, { signal, timeoutMs: 30000 });
  if (!data.success) throw new Error('ANEEL: consulta não foi aceita');
  return data.result.records;
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
 * Reduces raw tariff rows to one residential B1 conventional tariff per
 * distributor and validity period.
 */
export function parseTariffRecords(records: CkanRecord[]): Map<string, TariffPoint[]> {
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

  const result = new Map<string, TariffPoint[]>();
  for (const [distributor, periods] of byDistributor) {
    result.set(
      distributor,
      [...periods.values()].map((p) => p.point),
    );
  }
  return result;
}

/** Picks the tariff in force today for each distributor and sorts its history. */
export function assembleTariffs(
  byDistributor: Map<string, TariffPoint[]>,
  today = new Date().toISOString().slice(0, 10),
): DistributorTariff[] {
  const result: DistributorTariff[] = [];
  for (const [distributor, points] of byDistributor) {
    const history = [...points].sort((a, b) => a.start.localeCompare(b.start));
    const valid = history.filter((p) => p.start <= today);
    const current = valid.at(-1) ?? history.at(-1);
    if (current) result.push({ distributor, current, history: valid.length ? valid : history });
  }
  return result.sort((a, b) => a.distributor.localeCompare(b.distributor, 'pt-BR'));
}

export function buildTariffs(records: CkanRecord[], today?: string): DistributorTariff[] {
  return assembleTariffs(parseTariffRecords(records), today);
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

/** Downloads the full residential B1 history for every distributor. */
export async function fetchTariffRecords(signal?: AbortSignal): Promise<Map<string, TariffPoint[]>> {
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
  const parsed = parseTariffRecords(records);
  if (parsed.size === 0) throw new Error('ANEEL: nenhuma tarifa residencial encontrada');
  return parsed;
}

export async function fetchResidentialTariffs(signal?: AbortSignal): Promise<DistributorTariff[]> {
  return assembleTariffs(await fetchTariffRecords(signal));
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

/** Normalises flag rows; months without a date are dropped. */
export function parseFlagRecords(records: CkanRecord[]): FlagStatus[] {
  const flags: FlagStatus[] = [];
  for (const r of records) {
    const month = isoDate(field(r, 'DatCompetencia'));
    if (!month) continue;
    const rawName = str(field(r, 'NomBandeiraAcionada'));
    const name = normaliseFlag(rawName);
    // The surcharge column name has varied (VlrAdicionalBandeira, …RSMWh).
    const surchargeKey = Object.keys(r).find((k) => /^VlrAdicional/i.test(k));
    const raw = surchargeKey ? parseAneelNumber(r[surchargeKey]) : null;
    const fromApi = raw !== null && raw >= 0;
    flags.push({
      month,
      name,
      rawName,
      surcharge: fromApi ? surchargeToKWh(raw, name) : DEFAULT_FLAG_SURCHARGE[name],
      surchargeFromApi: fromApi,
    });
  }
  return flags;
}

/** The flag for the current month, ignoring flags already announced for later months. */
export function pickFlag(flags: FlagStatus[], today = new Date().toISOString().slice(0, 10)): FlagStatus | null {
  const month = today.slice(0, 7);
  return (
    flags
      .filter((f) => f.month.slice(0, 7) <= month)
      .sort((a, b) => b.month.localeCompare(a.month))[0] ?? null
  );
}

export function pickCurrentFlag(records: CkanRecord[], today?: string): FlagStatus | null {
  return pickFlag(parseFlagRecords(records), today);
}

export async function fetchFlagRecords(signal?: AbortSignal): Promise<FlagStatus[]> {
  const records = await firstNonEmpty(
    [
      { resource_id: FLAG_RESOURCE_ID, sort: 'DatCompetencia desc', limit: '24' },
      { resource_id: FLAG_RESOURCE_ID, limit: '1000' },
    ],
    signal,
  );
  return parseFlagRecords(records);
}

export async function fetchCurrentFlag(signal?: AbortSignal): Promise<FlagStatus> {
  const flag = pickFlag(await fetchFlagRecords(signal));
  if (!flag) throw new Error('ANEEL: sem dados de bandeira');
  return flag;
}
