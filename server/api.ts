// HTTP API backed by SQLite. Mounted as connect-style middleware by the Vite
// dev/preview servers (vite.config.ts) and by the production server
// (server/index.ts).
//
//   GET  /api/health
//   GET  /api/tariffs                 ANEEL B1 tariffs, refreshed every 24 h
//   GET  /api/flag                    current ANEEL tariff flag, refreshed every 24 h
//   GET  /api/solar?lat=&lng=         NASA POWER climatology, cached per 0.1° cell
//   POST /api/simulations             save a simulation → { id }
//   GET  /api/simulations/:id         load a saved simulation

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  assembleTariffs,
  fetchFlagRecords,
  fetchTariffRecords,
  pickFlag,
  type FlagStatus,
  type TariffPoint,
} from '../src/api/aneel';
import { fetchSolarClimatology, type SolarClimatology } from '../src/api/nasaPower';
import { MAX_SIMULATION_BYTES, validateSavedSimulation } from '../src/lib/savedSimulation';
import type { Store } from './db';

const DAY_MS = 24 * 60 * 60 * 1000;
// After a failed refresh, keep serving cached data for a while instead of
// making every request wait for a slow or unreachable upstream.
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

export interface ApiOptions {
  store: Store;
  now?: () => Date;
  ttlMs?: number;
  fetchTariffs?: () => Promise<Map<string, TariffPoint[]>>;
  fetchFlags?: () => Promise<FlagStatus[]>;
  fetchSolar?: (lat: number, lng: number) => Promise<SolarClimatology>;
}

export type Next = (err?: unknown) => void;
export type ApiHandler = (req: IncomingMessage, res: ServerResponse, next?: Next) => void;

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-cache',
  });
  res.end(json);
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new ApiError(415, 'Content-Type deve ser application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ApiError(413, 'simulação grande demais');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'JSON inválido');
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createApiHandler(options: ApiOptions): ApiHandler {
  const {
    store,
    now = () => new Date(),
    ttlMs = DAY_MS,
    fetchTariffs = () => fetchTariffRecords(),
    fetchFlags = () => fetchFlagRecords(),
    fetchSolar = (lat, lng) => fetchSolarClimatology(lat, lng),
  } = options;

  const inflight = new Map<string, Promise<void>>();
  const lastFailure = new Map<string, number>();

  /** Shares one upstream request between concurrent callers. */
  function once(key: string, task: () => Promise<void>): Promise<void> {
    let p = inflight.get(key);
    if (!p) {
      p = task().finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  }

  /**
   * Refreshes a dataset when older than the TTL. Falls back to the cached copy
   * (flagged as stale) when the upstream fails.
   */
  async function ensureFresh(kind: 'tariffs' | 'flags', refresh: (fetchedAt: string) => Promise<void>) {
    const metaKey = `${kind}_fetched_at`;
    const fetchedAt = store.getMeta(metaKey);
    const t = now().getTime();
    const fresh = fetchedAt !== null && t - Date.parse(fetchedAt) < ttlMs;
    const coolingDown = fetchedAt !== null && t - (lastFailure.get(kind) ?? -Infinity) < RETRY_AFTER_FAILURE_MS;
    if (fresh || coolingDown) return { fetchedAt, stale: !fresh };
    try {
      await once(kind, () => refresh(now().toISOString()));
      lastFailure.delete(kind);
      return { fetchedAt: store.getMeta(metaKey), stale: false };
    } catch (err) {
      lastFailure.set(kind, t);
      if (fetchedAt !== null) return { fetchedAt, stale: true };
      throw new ApiError(502, `ANEEL indisponível: ${message(err)}`);
    }
  }

  async function tariffs(res: ServerResponse) {
    const status = await ensureFresh('tariffs', async (at) => store.replaceTariffs(await fetchTariffs(), at));
    const today = now().toISOString().slice(0, 10);
    sendJson(res, 200, { ...status, tariffs: assembleTariffs(store.readTariffs(), today) });
  }

  async function flag(res: ServerResponse) {
    const status = await ensureFresh('flags', async (at) => store.saveFlags(await fetchFlags(), at));
    const today = now().toISOString().slice(0, 10);
    sendJson(res, 200, { ...status, flag: pickFlag(store.readFlags(), today) });
  }

  async function solar(res: ServerResponse, params: URLSearchParams) {
    const lat = Number(params.get('lat'));
    const lng = Number(params.get('lng'));
    if (!params.has('lat') || !params.has('lng') || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new ApiError(400, 'lat e lng são obrigatórios');
    }
    // NASA's solar grid is ~0.5°; a 0.1° cache cell loses nothing and is shared
    // by every roof in the neighbourhood.
    const rLat = Math.round(lat * 10) / 10;
    const rLng = Math.round(lng * 10) / 10;
    const key = `${rLat.toFixed(1)},${rLng.toFixed(1)}`;
    let cached = store.getSolar(key);
    const hit = cached !== null;
    if (!cached) {
      try {
        await once(`solar:${key}`, async () => store.saveSolar(key, await fetchSolar(rLat, rLng), now().toISOString()));
      } catch (err) {
        throw new ApiError(502, `NASA POWER indisponível: ${message(err)}`);
      }
      cached = store.getSolar(key);
    }
    sendJson(res, 200, { ...(cached!.payload as object), cached: hit, fetchedAt: cached!.fetchedAt });
  }

  async function saveSimulation(req: IncomingMessage, res: ServerResponse) {
    const body = await readJsonBody(req, MAX_SIMULATION_BYTES);
    const error = validateSavedSimulation(body);
    if (error) throw new ApiError(422, error);
    const id = randomBytes(6).toString('base64url');
    store.saveSimulation(id, body, now().toISOString());
    sendJson(res, 201, { id });
  }

  function loadSimulation(res: ServerResponse, id: string) {
    const saved = /^[A-Za-z0-9_-]{6,32}$/.test(id) ? store.getSimulation(id) : null;
    if (!saved) throw new ApiError(404, 'simulação não encontrada');
    sendJson(res, 200, { simulation: saved.payload, createdAt: saved.createdAt });
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname.replace(/\/+$/, '');
    const method = req.method ?? 'GET';
    if (method === 'GET' && path === '/api/health') return sendJson(res, 200, { ok: true });
    if (method === 'GET' && path === '/api/tariffs') return tariffs(res);
    if (method === 'GET' && path === '/api/flag') return flag(res);
    if (method === 'GET' && path === '/api/solar') return solar(res, url.searchParams);
    if (method === 'POST' && path === '/api/simulations') return saveSimulation(req, res);
    const match = /^\/api\/simulations\/([^/]+)$/.exec(path);
    if (method === 'GET' && match) return loadSimulation(res, decodeURIComponent(match[1]));
    throw new ApiError(404, 'rota não encontrada');
  }

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (next) return next();
      return sendJson(res, 404, { error: 'rota não encontrada' });
    }
    route(req, res, url).catch((err: unknown) => {
      const status = err instanceof ApiError ? err.status : 500;
      if (status === 500) console.error('[solaris api]', err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'erro interno' : message(err) });
      else res.end();
    });
  };
}
