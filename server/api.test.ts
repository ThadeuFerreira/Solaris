import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlagStatus, TariffPoint } from '../src/api/aneel';
import type { SolarClimatology } from '../src/api/nasaPower';
import { mergeSettings } from '../src/lib/savedSimulation';
import { createApiHandler, type ApiOptions } from './api';
import { openDatabase, Store } from './db';

const point = (start: string, tusd: number): TariffPoint => ({
  start,
  end: '',
  tusd,
  te: 0.3,
  total: tusd + 0.3,
  resolution: `REH ${start}`,
});

const TARIFFS = new Map([
  ['ENEL SP', [point('2025-07-04', 0.4), point('2026-07-04', 0.43)]],
  ['CEMIG-D', [point('2026-05-28', 0.52)]],
]);

const FLAGS: FlagStatus[] = [
  { month: '2026-11-01', name: 'Vermelha P1', rawName: 'Vermelha Patamar 1', surcharge: 0.04463, surchargeFromApi: false },
  { month: '2026-10-01', name: 'Amarela', rawName: 'Amarela', surcharge: 0.01885, surchargeFromApi: true },
];

const SOLAR: SolarClimatology = {
  ghi: Array(12).fill(5),
  clearSky: Array(12).fill(7),
  temperature: Array(12).fill(22),
  period: '2001–2020',
  url: 'https://power.larc.nasa.gov/…',
};

const servers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
});

// Test responses are asserted field by field, so a loose JSON type is enough.
type Json = any;

async function startApi(options: Partial<ApiOptions> = {}) {
  let clock = new Date('2026-10-31T12:00:00Z');
  const store = new Store(openDatabase(':memory:'));
  const fetchTariffs = vi.fn(async () => TARIFFS);
  const fetchFlags = vi.fn(async () => FLAGS);
  const fetchSolar = vi.fn(async (_lat: number, _lng: number) => SOLAR);
  const handler = createApiHandler({ store, now: () => clock, fetchTariffs, fetchFlags, fetchSolar, ...options });
  const server = createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(() => new Promise((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    store,
    fetchTariffs,
    fetchFlags,
    fetchSolar,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
    get: async (path: string) => {
      const res = await fetch(base + path);
      return { status: res.status, body: (await res.json()) as Json };
    },
    post: async (path: string, body: unknown, type = 'application/json') => {
      const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as Json };
    },
  };
}

const HOUR = 3600 * 1000;

describe('tariffs', () => {
  it('downloads once and serves from SQLite until the day is over', async () => {
    const api = await startApi();
    const first = await api.get('/api/tariffs');
    expect(first.status).toBe(200);
    expect(first.body.stale).toBe(false);
    expect(first.body.tariffs.map((t: { distributor: string }) => t.distributor)).toEqual(['CEMIG-D', 'ENEL SP']);
    expect(first.body.tariffs[1].current.start).toBe('2026-07-04');
    expect(first.body.tariffs[1].history).toHaveLength(2);

    api.advance(23 * HOUR);
    await api.get('/api/tariffs');
    expect(api.fetchTariffs).toHaveBeenCalledTimes(1);

    api.advance(2 * HOUR);
    await api.get('/api/tariffs');
    expect(api.fetchTariffs).toHaveBeenCalledTimes(2);
  });

  it('serves stale data when ANEEL fails, and 502 when there is nothing cached', async () => {
    const api = await startApi();
    await api.get('/api/tariffs');
    api.fetchTariffs.mockRejectedValue(new Error('timeout'));
    api.advance(25 * HOUR);
    const stale = await api.get('/api/tariffs');
    expect(stale.status).toBe(200);
    expect(stale.body.stale).toBe(true);
    expect(stale.body.tariffs).toHaveLength(2);

    // No retry storm: the next request within the cooldown skips the upstream.
    await api.get('/api/tariffs');
    expect(api.fetchTariffs).toHaveBeenCalledTimes(2);

    const empty = await startApi({ fetchTariffs: async () => Promise.reject(new Error('WAF')) });
    const failed = await empty.get('/api/tariffs');
    expect(failed.status).toBe(502);
    expect(failed.body.error).toContain('WAF');
  });

  it('shares one download between concurrent requests', async () => {
    const api = await startApi();
    await Promise.all([api.get('/api/tariffs'), api.get('/api/tariffs'), api.get('/api/tariffs')]);
    expect(api.fetchTariffs).toHaveBeenCalledTimes(1);
  });
});

describe('flag', () => {
  it('returns the flag of the current month, not the one announced for the next', async () => {
    const api = await startApi();
    const { body } = await api.get('/api/flag');
    expect(body.flag.name).toBe('Amarela');
    api.advance(24 * 24 * HOUR);
    expect((await api.get('/api/flag')).body.flag.name).toBe('Vermelha P1');
  });
});

describe('solar', () => {
  it('caches NASA POWER per 0.1° cell', async () => {
    const api = await startApi();
    const first = await api.get('/api/solar?lat=-23.5614&lng=-46.6559');
    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);
    expect(first.body.ghi).toHaveLength(12);
    expect(api.fetchSolar).toHaveBeenCalledWith(-23.6, -46.7);

    const nearby = await api.get('/api/solar?lat=-23.58&lng=-46.68');
    expect(nearby.body.cached).toBe(true);
    expect(api.fetchSolar).toHaveBeenCalledTimes(1);
  });

  it('rejects missing or invalid coordinates', async () => {
    const api = await startApi();
    expect((await api.get('/api/solar?lat=abc&lng=1')).status).toBe(400);
    expect((await api.get('/api/solar?lat=95&lng=1')).status).toBe(400);
    expect((await api.get('/api/solar')).status).toBe(400);
  });
});

describe('simulations', () => {
  const valid = {
    version: 1,
    polygon: [
      [-23.56, -46.65],
      [-23.56, -46.6499],
      [-23.5601, -46.6499],
    ],
    site: null,
    panel: { panelId: 'weg-wpv-550-hmm0' },
    tariff: {},
    finance: { monthlyConsumptionKWh: 450 },
  };

  it('saves and loads a simulation', async () => {
    const api = await startApi();
    const saved = await api.post('/api/simulations', valid);
    expect(saved.status).toBe(201);
    expect(saved.body.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    const loaded = await api.get(`/api/simulations/${saved.body.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.simulation).toEqual(valid);
  });

  it('validates input', async () => {
    const api = await startApi();
    expect((await api.post('/api/simulations', { ...valid, polygon: [[0, 0]] })).status).toBe(422);
    expect((await api.post('/api/simulations', { ...valid, version: 2 })).status).toBe(422);
    expect((await api.post('/api/simulations', valid, 'text/plain')).status).toBe(415);
    expect((await api.get('/api/simulations/nope')).status).toBe(404);
    expect((await api.get('/api/simulations/abcdefgh')).status).toBe(404);
  });
});

describe('mergeSettings', () => {
  it('keeps only known keys with the right type', () => {
    const defaults = { tilt: 15, azimuth: null as number | null, distributor: null as string | null, flag: true, custom: { w: 1 } };
    const merged = mergeSettings(defaults, {
      tilt: '30',
      azimuth: 'north',
      distributor: 'ENEL SP',
      flag: false,
      custom: { w: 2, extra: 1 },
      unknown: 1,
    });
    expect(merged).toEqual({ tilt: 15, azimuth: null, distributor: 'ENEL SP', flag: false, custom: { w: 2 } });
    expect(mergeSettings(defaults, { azimuth: 90, tilt: Infinity })).toMatchObject({ azimuth: 90, tilt: 15 });
  });
});
