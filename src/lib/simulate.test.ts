import { describe, expect, it } from 'vitest';
import { PANELS } from '../data/panels';
import { DEFAULT_FINANCE_SETTINGS, DEFAULT_PANEL_SETTINGS } from '../model';
import { localFrame } from './geometry';
import { planLayout, simulate } from './simulate';

describe('area coverage', () => {
  it('limits the projected panel area and reduces energy in proportion to panel count', () => {
    const frame = localFrame([-23.55, -46.63]);
    const polygon = [[0, 0], [20, 0], [20, 20], [0, 20]].map(([x, y]) => frame.toLatLng({ x, y }));
    const solar = { lat: -23.55, ghi: Array(12).fill(5), temperature: Array(12).fill(25) };
    const panel = PANELS[0];
    const settings = { ...DEFAULT_PANEL_SETTINGS, tiltDeg: 0, azimuthDeg: 0, setbackM: 0, gapM: 0 };
    const full = planLayout({ polygon, solar, panel, settings });
    const reducedSettings = { ...settings, coveragePct: 40 };
    const reduced = planLayout({ polygon, solar, panel, settings: reducedSettings });
    expect(reduced.fittedCount).toBeLessThan(full.fittedCount);
    expect(reduced.fittedCount * panel.lengthM * panel.widthM).toBeLessThanOrEqual(reduced.areaM2 * 0.4);
    expect(reduced.panels).toHaveLength(reduced.fittedCount);
    const input = { solar, panel, finance: DEFAULT_FINANCE_SETTINGS, pricePerKWh: 1, tariffIncrease: 0, startYear: 2026 };
    const fullEnergy = simulate({ ...input, settings, plan: full });
    const reducedEnergy = simulate({ ...input, settings: reducedSettings, plan: reduced });
    expect(reducedEnergy.annualKWh / fullEnergy.annualKWh).toBeCloseTo(reduced.fittedCount / full.fittedCount);
    expect(planLayout({ polygon, solar, panel, settings: { ...settings, coveragePct: 0 } }).fittedCount).toBe(0);
  });
});
