import { describe, expect, it } from 'vitest';
import { footprintsInside, layoutPanels, localFrame, simplePolygon } from './geometry';
import { curvePoints, infrastructureFootprints, type Infrastructure } from './infrastructure';
import { validateSavedSimulation } from './savedSimulation';

describe('ground infrastructure', () => {
  const f = localFrame([-23.55, -46.63]);
  const at = (x: number, y: number) => f.toLatLng({ x, y });
  const area = [at(0, 0), at(30, 0), at(30, 30), at(0, 30)];
  const opts = { alongRowM: 1, acrossRowM: 2, gapM: 0, rowGapM: 0, setbackM: 0, bearingDeg: 0 };
  it('reserves a curved road and equipment in the panel layout', () => {
    const road: Infrastructure = { type: 'road', points: [at(5, 5), at(25, 5), at(25, 25)], width: 2 };
    const equipment: Infrastructure = { type: 'transformer', center: at(8, 20), width: 4, length: 4 };
    const shapes = [road, equipment].flatMap(infrastructureFootprints);
    expect(footprintsInside(area, shapes)).toBe(true);
    const full = layoutPanels(area, opts);
    const reduced = layoutPanels(area, { ...opts, exclusions: shapes });
    expect(reduced.panels.length).toBeLessThan(full.panels.length);
    expect(reduced.panels.length).toBeGreaterThan(0);
  });
  it('rejects equipment and curved roads extending beyond the selected area', () => {
    expect(footprintsInside(area, infrastructureFootprints({ type: 'rectifier', center: at(1, 1), width: 4, length: 4 }))).toBe(false);
    expect(footprintsInside(area, infrastructureFootprints({ type: 'road', points: [at(5, 5), at(70, 15), at(5, 25)], width: 3 }))).toBe(false);
  });
  it('creates a straight road from a midpoint control and can curve it', () => {
    const start = at(5, 5), end = at(25, 5);
    const straight = curvePoints(start, at(15, 5), end);
    const curved = curvePoints(start, at(15, 15), end);
    expect(f.toLocal(straight[12]).y).toBeCloseTo(5, 4);
    expect(f.toLocal(curved[12]).y).toBeCloseTo(10, 4);
    const boundary = [at(0, 0), ...curvePoints(at(30, 0), at(35, 15), at(30, 30), 12), at(0, 30)];
    expect(simplePolygon(boundary)).toBe(true);
    expect(simplePolygon([at(0, 0), at(30, 30), at(30, 0), at(0, 30)])).toBe(false);
  });
  it('accepts a saved pole with a footprint', () => {
    const simulation = { version: 1, polygon: area, site: null, panel: {}, tariff: {}, finance: {}, infrastructure: [{ type: 'pole', center: at(10, 10), width: 2, length: 2 }] };
    expect(validateSavedSimulation(simulation)).toBeNull();
  });
});
