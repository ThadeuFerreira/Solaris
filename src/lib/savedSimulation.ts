// Shape of a saved simulation, shared by the server (validation) and the
// client (restore). Settings are merged over the current defaults on restore,
// so older saves keep working when new settings are added.

import type { LatLng } from './geometry';
import type { Infrastructure } from './infrastructure';

export interface SavedSimulation {
  version: 1;
  polygon: LatLng[];
  site: { lat: number; lng: number; label: string } | null;
  panel: Record<string, unknown>;
  tariff: Record<string, unknown>;
  finance: Record<string, unknown>;
  infrastructure?: Infrastructure[];
}

export const MAX_SIMULATION_BYTES = 64 * 1024;
const MAX_VERTICES = 500;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isLatLng(v: unknown): v is LatLng {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    Math.abs(v[0]) <= 90 &&
    Math.abs(v[1]) <= 180
  );
}

/** Returns an error message, or null when the value is a valid save. */
export function validateSavedSimulation(v: unknown): string | null {
  if (!isPlainObject(v)) return 'corpo deve ser um objeto JSON';
  if (v.version !== 1) return 'versão não suportada';
  if (!Array.isArray(v.polygon) || v.polygon.length < 3 || v.polygon.length > MAX_VERTICES) {
    return `polígono deve ter entre 3 e ${MAX_VERTICES} vértices`;
  }
  if (!v.polygon.every(isLatLng)) return 'vértices inválidos';
  if (v.site !== null) {
    if (!isPlainObject(v.site) || !isLatLng([v.site.lat, v.site.lng]) || typeof v.site.label !== 'string') {
      return 'local inválido';
    }
  }
  for (const key of ['panel', 'tariff', 'finance'] as const) {
    if (!isPlainObject(v[key])) return `configuração "${key}" inválida`;
  }
  if (v.infrastructure !== undefined) {
    if (!Array.isArray(v.infrastructure) || v.infrastructure.length > 100) return 'infraestrutura inválida';
    for (const item of v.infrastructure) {
      if (!isPlainObject(item) || typeof item.width !== 'number' || !Number.isFinite(item.width) || item.width <= 0 || item.width > 100) return 'infraestrutura inválida';
      if (item.type === 'road') {
        if (!Array.isArray(item.points) || item.points.length !== 3 || !item.points.every(isLatLng)) return 'estrada inválida';
      } else if ((item.type !== 'transformer' && item.type !== 'rectifier' && item.type !== 'pole') || !isLatLng(item.center) || typeof item.length !== 'number' || !Number.isFinite(item.length) || item.length <= 0 || item.length > 100) return 'infraestrutura inválida';
    }
  }
  return null;
}

/** Settings whose default is null but which hold text rather than a number. */
const NULLABLE_STRINGS = new Set(['distributor']);

/**
 * Copies saved values over the defaults, keeping only known keys whose type
 * matches. A null default accepts null or a finite number (or a string for
 * the keys in NULLABLE_STRINGS); other defaults accept null only if they are
 * null themselves.
 */
export function mergeSettings<T extends object>(defaults: T, saved: Record<string, unknown>): T {
  const result = { ...defaults } as Record<string, unknown>;
  for (const [key, def] of Object.entries(defaults)) {
    if (!(key in saved)) continue;
    const value = saved[key];
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    if (isPlainObject(def)) {
      if (isPlainObject(value)) result[key] = mergeSettings(def, value);
    } else if (def === null) {
      const kind = NULLABLE_STRINGS.has(key) ? 'string' : 'number';
      if (value === null || typeof value === kind) result[key] = value;
    } else if (typeof value === typeof def) {
      result[key] = value;
    }
  }
  return result as T;
}
