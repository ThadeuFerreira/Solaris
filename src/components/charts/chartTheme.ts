export const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };
export const AXIS_LINE = { stroke: 'var(--axis)' };

export interface TooltipRow {
  name: string;
  value: string;
  color?: string;
}

export type TooltipRender = (datum: Record<string, unknown>) => { title: string; rows: TooltipRow[] };

export interface NiceAxis {
  domain: [number, number];
  ticks: number[];
  format: (v: number) => string;
}

/**
 * Round 1/2/5 × 10ⁿ ticks covering the values (and zero), with one label
 * style for the whole axis: compact when it reaches 10 000, full otherwise.
 */
export function niceAxis(values: number[], format: (v: number, compact: boolean) => string, count = 5): NiceAxis {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  const compact = Math.max(Math.abs(lo), Math.abs(hi)) >= 10000;
  return { domain: [lo, hi], ticks, format: (v) => format(v, compact) };
}
