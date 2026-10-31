import { describe, expect, it } from 'vitest';
import { layoutPanels, localFrame, longestEdgeBearing, polygonAreaM2, type LatLng } from './geometry';

function rectangle(origin: LatLng, widthM: number, heightM: number): LatLng[] {
  const f = localFrame(origin);
  return [
    f.toLatLng({ x: 0, y: 0 }),
    f.toLatLng({ x: widthM, y: 0 }),
    f.toLatLng({ x: widthM, y: heightM }),
    f.toLatLng({ x: 0, y: heightM }),
  ];
}

const BASE = {
  gapM: 0,
  rowGapM: 0,
  setbackM: 0,
  bearingDeg: 0,
};

describe('polygon area', () => {
  it('measures a 10 m × 20 m rectangle in São Paulo', () => {
    expect(polygonAreaM2(rectangle([-23.55, -46.63], 10, 20))).toBeCloseTo(200, 0);
  });

  it('finds the bearing of the longest edge', () => {
    expect(longestEdgeBearing(rectangle([-23.55, -46.63], 30, 5))).toBeCloseTo(90, 1);
    expect(longestEdgeBearing(rectangle([-23.55, -46.63], 5, 30))).toBeCloseTo(0, 1);
  });
});

describe('panel layout', () => {
  const square = rectangle([-15.79, -47.88], 10.001, 10.001);

  it('tiles a square exactly', () => {
    const { panels } = layoutPanels(square, { ...BASE, alongRowM: 1, acrossRowM: 2 });
    expect(panels).toHaveLength(50);
  });

  it('respects setbacks and gaps', () => {
    const { panels } = layoutPanels(square, { ...BASE, alongRowM: 1, acrossRowM: 2, gapM: 0.1, setbackM: 0.5 });
    // 9 m usable: 8 panels per row (8×1.1 − 0.1 = 8.7 m), 4 rows of 2 m.
    expect(panels).toHaveLength(32);
  });

  it('keeps panels out of the notch of an L-shaped roof', () => {
    const f = localFrame([-15.79, -47.88]);
    const l: LatLng[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ].map(([x, y]) => f.toLatLng({ x: x + 0.0001, y: y + 0.0001 }));
    const { panels } = layoutPanels(l, { ...BASE, alongRowM: 2, acrossRowM: 2 });
    // 10×4 strip holds 10 panels, the 4×6 arm above it 6 more.
    expect(panels).toHaveLength(16);
    for (const panel of panels) {
      for (const corner of panel) {
        const p = f.toLocal(corner);
        expect(p.x > 4.01 && p.y > 4.01).toBe(false);
      }
    }
  });

  it('caps very large layouts', () => {
    const field = rectangle([-15.79, -47.88], 200, 200);
    const { panels, truncated } = layoutPanels(field, { ...BASE, alongRowM: 1, acrossRowM: 2, maxPanels: 100 });
    expect(panels).toHaveLength(100);
    expect(truncated).toBe(true);
  });
});
