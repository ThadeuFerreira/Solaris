import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeSlopeAndAspect, elevationColor, fallbackTerrainGrid, fetchTerrainGrid, fetchTerrainProfile, sampleGridElevation, smoothElevationGrid } from './openMeteo';

afterEach(() => vi.unstubAllGlobals());

describe('3D terrain grid', () => {
  it('interpolates south-to-north and west-to-east, clamping at the sampled extent', () => {
    const grid = { size: 2, sampleRadiusM: 10, centerElevationM: 15, elevations: [0, 10, 20, 30] };
    expect(sampleGridElevation(grid, 0, 0)).toBe(15);
    expect(sampleGridElevation(grid, -10, 10)).toBe(20);
    expect(sampleGridElevation(grid, 10, -10)).toBe(10);
    expect(sampleGridElevation(grid, 100, 100)).toBe(30);
  });

  it('preserves constant DEM elevations when smoothing', () => {
    expect(smoothElevationGrid(Array(64).fill(760), 8)).toEqual(Array(64).fill(760));
  });

  it('uses the terrain downhill aspect in the fallback plane', () => {
    const terrain = { elevationM: 500, minElevationM: 488, maxElevationM: 512, reliefM: 24, slopeDeg: Math.atan(0.1) * 180 / Math.PI, slopePct: 10, aspectDeg: 0, vertices: [] };
    const grid = fallbackTerrainGrid(30, terrain);
    expect(sampleGridElevation(grid, 0, 10)).toBeCloseTo(499);
    expect(sampleGridElevation(grid, 0, -10)).toBeCloseTo(501);
  });

  it('fetches and validates all 64 DEM samples', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ elevation: Array(64).fill(800) }) });
    vi.stubGlobal('fetch', fetch);
    const grid = await fetchTerrainGrid([-23.56, -46.65], 30);
    expect(grid.size).toBe(8);
    expect(grid.sampleRadiusM).toBe(120);
    expect(grid.centerElevationM).toBe(800);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('latitude')!.split(',')).toHaveLength(64);
  });

  it.each([Array(63).fill(800), [...Array(63).fill(800), null]])('rejects incomplete or invalid terrain rather than creating a broken mesh', async (elevation) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ elevation }) }));
    await expect(fetchTerrainGrid([-23.56, -46.65], 30)).rejects.toThrow();
  });
});

describe('computeSlopeAndAspect', () => {
  it('returns 0 slope and null aspect for flat ground', () => {
    const res = computeSlopeAndAspect(500, 500, 500, 500, 60);
    expect(res.slopeDeg).toBe(0);
    expect(res.slopePct).toBe(0);
    expect(res.aspectDeg).toBeNull();
  });

  it('detects a North-facing downhill slope when South is higher than North', () => {
    // North is 12 m lower than South over 2 * 60 = 120 m -> 10% grade facing North (0°)
    const res = computeSlopeAndAspect(500, 500, 494, 506, 60);
    expect(res.slopePct).toBeCloseTo(10, 4);
    expect(res.slopeDeg).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 4);
    expect(res.aspectDeg).toBeCloseTo(0, 4);
  });

  it('detects an East-facing downhill slope when West is higher than East', () => {
    const res = computeSlopeAndAspect(494, 506, 500, 500, 60);
    expect(res.slopePct).toBeCloseTo(10, 4);
    expect(res.aspectDeg).toBeCloseTo(90, 4);
  });
});

describe('fetchTerrainProfile', () => {
  it('fetches stencil and vertex elevations from Open-Meteo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          elevation: [760, 760, 760, 754, 766, 758, 762, 763],
        }),
      }),
    );

    const profile = await fetchTerrainProfile(
      [-23.56, -46.65],
      [
        [-23.56, -46.65],
        [-23.561, -46.651],
        [-23.562, -46.652],
      ],
    );

    expect(profile.elevationM).toBe(760);
    expect(profile.minElevationM).toBe(758);
    expect(profile.maxElevationM).toBe(763);
    expect(profile.reliefM).toBe(5);
    expect(profile.slopePct).toBeCloseTo(10, 3);
    expect(profile.aspectDeg).toBeCloseTo(0, 3);
    expect(profile.vertices).toHaveLength(3);
    expect(profile.vertices[0].normalized).toBe(0);
    expect(profile.vertices[2].normalized).toBe(1);
  });

  it('interpolates vertex elevations from local slope when DEM quantizes small polygons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          // Stencil has 10% North-facing slope, but small roof corners all returned 760
          elevation: [760, 760, 760, 754, 766, 760, 760],
        }),
      }),
    );

    const profile = await fetchTerrainProfile(
      [-23.56, -46.65],
      [
        [-23.5599, -46.65], // North corner (lower)
        [-23.5601, -46.65], // South corner (higher)
      ],
    );

    expect(profile.reliefM).toBeGreaterThan(1);
    expect(profile.vertices[0].elevationM).toBeLessThan(profile.vertices[1].elevationM);
    expect(profile.vertices[0].normalized).toBeCloseTo(0, 4);
    expect(profile.vertices[1].normalized).toBeCloseTo(1, 4);
    expect(elevationColor(0)).toBe('rgb(14, 165, 233)');
    expect(elevationColor(1)).toBe('rgb(239, 68, 68)');
  });
});
