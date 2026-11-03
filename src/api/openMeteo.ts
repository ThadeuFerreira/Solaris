// Open-Meteo Elevation API — free, keyless global Digital Elevation Model
// (Copernicus DEM GLO-90 / SRTM, ~30–90 m resolution).
// https://open-meteo.com/en/docs/elevation-api

import { localFrame, type LatLng } from '../lib/geometry';
import { fetchJson } from './http';

const DEG = Math.PI / 180;
const STENCIL_STEP_M = 60;
const MAX_POLYGON_VERTICES = 40;

interface OpenMeteoElevationResponse {
  elevation?: unknown;
}

export interface VertexElevation {
  lat: number;
  lng: number;
  elevationM: number;
  /** Normalized height within the polygon [0 = lowest, 1 = highest]. */
  normalized: number;
}

export interface TerrainProfile {
  /** Altitude above sea level at the center point (metres). */
  elevationM: number;
  /** Minimum altitude across sampled points (metres). */
  minElevationM: number;
  /** Maximum altitude across sampled points (metres). */
  maxElevationM: number;
  /** Height difference across the sampled area (metres). */
  reliefM: number;
  /** Terrain slope angle in degrees (0 = flat). */
  slopeDeg: number;
  /** Terrain grade in percent (tan(slope) * 100). */
  slopePct: number;
  /**
   * Compass azimuth (0 = N, 90 = E, 180 = S, 270 = W) toward which the ground
   * slopes downward (the direction a flush ground-mounted panel would face).
   * Null when terrain is nearly flat (< 0.1°).
   */
  aspectDeg: number | null;
  /** Elevations for the drawn polygon vertices (when a polygon is provided). */
  vertices: VertexElevation[];
}

/**
 * Hypsometric color scale for normalized elevation t in [0, 1]:
 * 0.0 (lowest) -> #0ea5e9 (cyan/blue)
 * 0.5 (mid)    -> #eab308 (gold/amber)
 * 1.0 (highest)-> #ef4444 (warm red-orange)
 */
export function elevationColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number, u: number) => Math.round(a + (b - a) * u);
  if (clamped <= 0.5) {
    const u = clamped * 2;
    return `rgb(${lerp(14, 234, u)}, ${lerp(165, 179, u)}, ${lerp(233, 8, u)})`;
  }
  const u = (clamped - 0.5) * 2;
  return `rgb(${lerp(234, 239, u)}, ${lerp(179, 68, u)}, ${lerp(8, 68, u)})`;
}

/**
 * Computes terrain slope and downhill aspect from central differences.
 */
export function computeSlopeAndAspect(
  eastM: number,
  westM: number,
  northM: number,
  southM: number,
  stepM: number,
): { dzdx: number; dzdy: number; slopeDeg: number; slopePct: number; aspectDeg: number | null } {
  const dzdx = (eastM - westM) / (2 * stepM);
  const dzdy = (northM - southM) / (2 * stepM);
  const grad = Math.hypot(dzdx, dzdy);
  const slopeDeg = Math.atan(grad) / DEG;
  const slopePct = grad * 100;
  // Downhill vector is (-dzdx, -dzdy). Compass bearing: atan2(east, north).
  const aspectDeg = slopeDeg >= 0.1 ? ((Math.atan2(-dzdx, -dzdy) / DEG) + 360) % 360 : null;
  return { dzdx, dzdy, slopeDeg, slopePct, aspectDeg };
}

export async function fetchTerrainProfile(
  center: LatLng,
  polygon: LatLng[] | null,
  signal?: AbortSignal,
): Promise<TerrainProfile> {
  const frame = localFrame(center);
  const stencil: LatLng[] = [
    center,
    frame.toLatLng({ x: STENCIL_STEP_M, y: 0 }), // East
    frame.toLatLng({ x: -STENCIL_STEP_M, y: 0 }), // West
    frame.toLatLng({ x: 0, y: STENCIL_STEP_M }), // North
    frame.toLatLng({ x: 0, y: -STENCIL_STEP_M }), // South
  ];

  const sampledVertices = polygon ? polygon.slice(0, MAX_POLYGON_VERTICES) : [];
  const allPoints = [...stencil, ...sampledVertices];

  const params = new URLSearchParams({
    latitude: allPoints.map((p) => p[0].toFixed(5)).join(','),
    longitude: allPoints.map((p) => p[1].toFixed(5)).join(','),
  });
  const url = `https://api.open-meteo.com/v1/elevation?${params}`;
  const data = await fetchJson<OpenMeteoElevationResponse>(url, { signal, timeoutMs: 15000 });

  if (!Array.isArray(data.elevation) || data.elevation.length !== allPoints.length) {
    throw new Error('Open-Meteo sem dados de altitude para este ponto');
  }

  const values = data.elevation.map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error('Open-Meteo retornou altitude inválida');
    }
    return v;
  });

  const [centerElev, eastElev, westElev, northElev, southElev] = values;
  const { dzdx, dzdy, slopeDeg, slopePct, aspectDeg } = computeSlopeAndAspect(
    eastElev,
    westElev,
    northElev,
    southElev,
    STENCIL_STEP_M,
  );

  const rawVertexElevs = sampledVertices.map((_, i) => values[stencil.length + i]);
  const rawMin = rawVertexElevs.length > 0 ? Math.min(...rawVertexElevs) : centerElev;
  const rawMax = rawVertexElevs.length > 0 ? Math.max(...rawVertexElevs) : centerElev;
  const usePlaneInterpolation = rawVertexElevs.length > 0 && rawMax - rawMin < 0.5 && (dzdx !== 0 || dzdy !== 0);

  const prelimVertices = sampledVertices.map(([lat, lng], i) => {
    const local = frame.toLocal([lat, lng]);
    const elevationM = usePlaneInterpolation
      ? centerElev + dzdx * local.x + dzdy * local.y
      : rawVertexElevs[i];
    return { lat, lng, elevationM };
  });

  const relevantElevations =
    prelimVertices.length > 0 ? prelimVertices.map((v) => v.elevationM) : values.slice(0, stencil.length);
  const minElevationM = Math.min(...relevantElevations);
  const maxElevationM = Math.max(...relevantElevations);
  const reliefM = Math.max(0, maxElevationM - minElevationM);

  const vertices: VertexElevation[] = prelimVertices.map((v) => ({
    ...v,
    normalized: reliefM > 1e-3 ? (v.elevationM - minElevationM) / reliefM : 0.5,
  }));

  return {
    elevationM: centerElev,
    minElevationM,
    maxElevationM,
    reliefM,
    slopeDeg,
    slopePct,
    aspectDeg,
    vertices,
  };
}

export interface TerrainGrid {
  /** Grid resolution per side (N x N samples). */
  size: number;
  /** Half-width in metres covered by the sampled grid [-sampleRadiusM, +sampleRadiusM]. */
  sampleRadiusM: number;
  /** Elevation at (0, 0) in metres above sea level. */
  centerElevationM: number;
  /** Row-major (iy * size + ix) smoothed elevations in metres above sea level, ix: West->East, iy: South->North. */
  elevations: number[];
}

/** Light 3x3 binomial smoothing so integer-meter DEM cells form a smooth surface. */
export function smoothElevationGrid(raw: number[], size: number, passes = 2): number[] {
  let cur = raw.slice();
  for (let p = 0; p < passes; p++) {
    const next = new Array<number>(size * size);
    for (let iy = 0; iy < size; iy++) {
      for (let ix = 0; ix < size; ix++) {
        let sum = 0;
        let weightSum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = Math.max(0, Math.min(size - 1, iy + dy));
          const wy = dy === 0 ? 2 : 1;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.max(0, Math.min(size - 1, ix + dx));
            const w = wy * (dx === 0 ? 2 : 1);
            sum += cur[ny * size + nx] * w;
            weightSum += w;
          }
        }
        next[iy * size + ix] = sum / weightSum;
      }
    }
    cur = next;
  }
  return cur;
}

/** Bilinearly samples absolute elevation (metres above sea level) at local (eastM, northM). */
export function sampleGridElevation(grid: TerrainGrid, eastM: number, northM: number): number {
  const { size, sampleRadiusM, elevations } = grid;
  if (size < 2 || sampleRadiusM <= 0) return grid.centerElevationM;
  const fx = Math.max(0, Math.min(1, (eastM + sampleRadiusM) / (2 * sampleRadiusM))) * (size - 1);
  const fy = Math.max(0, Math.min(1, (northM + sampleRadiusM) / (2 * sampleRadiusM))) * (size - 1);
  const x0 = Math.min(size - 2, Math.floor(fx));
  const y0 = Math.min(size - 2, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const e00 = elevations[y0 * size + x0];
  const e10 = elevations[y0 * size + x0 + 1];
  const e01 = elevations[(y0 + 1) * size + x0];
  const e11 = elevations[(y0 + 1) * size + x0 + 1];
  const e0 = e00 + (e10 - e00) * tx;
  const e1 = e01 + (e11 - e01) * tx;
  return e0 + (e1 - e0) * ty;
}

/** Immediate planar fallback grid built from TerrainProfile before the 64-point DEM grid loads. */
export function fallbackTerrainGrid(radiusM: number, terrain?: TerrainProfile | null): TerrainGrid {
  const size = 4;
  const sampleRadiusM = Math.max(radiusM, 120);
  const centerElev = terrain?.elevationM ?? 0;
  let dzdx = 0;
  let dzdy = 0;
  if (terrain && terrain.aspectDeg !== null && terrain.slopeDeg > 0) {
    const grad = Math.tan(terrain.slopeDeg * DEG);
    const rad = terrain.aspectDeg * DEG;
    // Downhill is (sin(rad), cos(rad)), so uphill gradient is (-sin, -cos).
    dzdx = -grad * Math.sin(rad);
    dzdy = -grad * Math.cos(rad);
  }
  const elevations: number[] = [];
  for (let iy = 0; iy < size; iy++) {
    const y = -sampleRadiusM + (2 * sampleRadiusM * iy) / (size - 1);
    for (let ix = 0; ix < size; ix++) {
      const x = -sampleRadiusM + (2 * sampleRadiusM * ix) / (size - 1);
      elevations.push(centerElev + dzdx * x + dzdy * y);
    }
  }
  return { size, sampleRadiusM, centerElevationM: centerElev, elevations };
}

/** Fetches an 8x8 (64-point) elevation grid around `center` from Open-Meteo. */
export async function fetchTerrainGrid(
  center: LatLng,
  radiusM: number,
  signal?: AbortSignal,
): Promise<TerrainGrid> {
  const size = 8;
  // Minimum 120 m half-width so spacing (>= 34 m) matches SRTM/Copernicus DEM resolution without stair-stepping.
  const sampleRadiusM = Math.max(radiusM, 120);
  const frame = localFrame(center);
  const points: LatLng[] = [];
  for (let iy = 0; iy < size; iy++) {
    const y = -sampleRadiusM + (2 * sampleRadiusM * iy) / (size - 1);
    for (let ix = 0; ix < size; ix++) {
      const x = -sampleRadiusM + (2 * sampleRadiusM * ix) / (size - 1);
      points.push(frame.toLatLng({ x, y }));
    }
  }

  const params = new URLSearchParams({
    latitude: points.map((p) => p[0].toFixed(5)).join(','),
    longitude: points.map((p) => p[1].toFixed(5)).join(','),
  });
  const url = `https://api.open-meteo.com/v1/elevation?${params}`;
  const data = await fetchJson<OpenMeteoElevationResponse>(url, { signal, timeoutMs: 15000 });
  if (!Array.isArray(data.elevation) || data.elevation.length !== points.length) {
    throw new Error('Open-Meteo sem grade de altitude para este local');
  }
  const raw = data.elevation.map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Altitude inválida na grade Open-Meteo');
    return v;
  });
  const elevations = smoothElevationGrid(raw, size, 2);
  const grid: TerrainGrid = { size, sampleRadiusM, centerElevationM: 0, elevations };
  grid.centerElevationM = sampleGridElevation(grid, 0, 0);
  return grid;
}
