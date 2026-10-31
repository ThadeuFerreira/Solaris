// NASA POWER (Prediction Of Worldwide Energy Resources) — free, keyless API
// with satellite-derived solar and meteorological climatologies.
// https://power.larc.nasa.gov/docs/services/api/temporal/climatology/

import { fetchJson } from './http';

const MONTH_KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
const FILL_VALUE = -999;

interface PowerResponse {
  properties: { parameter: Record<string, Record<string, number>> };
  parameters?: Record<string, { units?: string; longname?: string }>;
  header?: { start?: string | number; end?: string | number };
}

export interface SolarClimatology {
  /** All-sky global horizontal irradiation, kWh/m²/day, Jan..Dec. */
  ghi: number[];
  /** Clear-sky global horizontal irradiation, kWh/m²/day (null when missing). */
  clearSky: (number | null)[];
  /** Mean air temperature at 2 m, °C (null when missing). */
  temperature: (number | null)[];
  period: string | null;
  url: string;
}

function toKWh(values: number[], units: string | undefined): number[] {
  return units && /MJ/i.test(units) ? values.map((v) => v / 3.6) : values;
}

function monthly(param: Record<string, number> | undefined): (number | null)[] {
  return MONTH_KEYS.map((k) => {
    const v = param?.[k];
    return typeof v === 'number' && v !== FILL_VALUE ? v : null;
  });
}

export async function fetchSolarClimatology(lat: number, lng: number, signal?: AbortSignal): Promise<SolarClimatology> {
  const params = new URLSearchParams({
    parameters: 'ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN,T2M',
    community: 'RE',
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    format: 'JSON',
  });
  const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?${params}`;
  const data = await fetchJson<PowerResponse>(url, { signal, timeoutMs: 30000 });
  const p = data.properties?.parameter ?? {};

  const ghiRaw = monthly(p.ALLSKY_SFC_SW_DWN);
  if (ghiRaw.some((v) => v === null)) throw new Error('NASA POWER sem dados de irradiação para este ponto');
  const ghi = toKWh(ghiRaw as number[], data.parameters?.ALLSKY_SFC_SW_DWN?.units);

  const clearRaw = monthly(p.CLRSKY_SFC_SW_DWN);
  const clearUnits = data.parameters?.CLRSKY_SFC_SW_DWN?.units;
  const clearSky = clearRaw.map((v) => (v === null ? null : toKWh([v], clearUnits)[0]));

  const start = data.header?.start;
  const end = data.header?.end;
  return {
    ghi,
    clearSky,
    temperature: monthly(p.T2M),
    period: start && end ? `${start}–${end}` : null,
    url,
  };
}
