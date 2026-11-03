import { describe, expect, it } from 'vitest';
import { localFrame } from './geometry';
import { pitchHeight, rackPanelHeights, roofSurface, satelliteBounds, satelliteTiles, sceneBounds, solarDayOfYear, toMercator } from './sceneGeometry';

describe('3D placement', () => {
  const corners = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];

  it.each([0, 90, 180, 270])('lowers the front edge for azimuth %s', (azimuth) => {
    const angle = azimuth * Math.PI / 180;
    const front = { x: Math.sin(angle), y: Math.cos(angle) };
    expect(pitchHeight(front, 30, azimuth)).toBeCloseTo(-Math.tan(Math.PI / 6));
    expect(pitchHeight({ x: -front.x, y: -front.y }, 30, azimuth)).toBeGreaterThan(0);
  });

  it('keeps racks rigid, at the configured pitch, above uneven ground', () => {
    const ground = (p: { x: number; y: number }) => p.x * p.y + 4;
    const heights = rackPanelHeights(corners, ground, 30, 0);
    heights.forEach((height, i) => expect(height - ground(corners[i])).toBeGreaterThanOrEqual(0.65 - 1e-9));
    expect(heights[0] - heights[3]).toBeCloseTo(2 * Math.tan(Math.PI / 6));
    expect(heights[0]).toBeCloseTo(heights[1]);
    expect(heights[2]).toBeCloseTo(heights[3]);
  });

  it('uses one continuous roof plane for flush panels', () => {
    const ground = (p: { x: number }) => p.x * 0.2;
    const roof = roofSurface(corners, ground, 20, 90);
    corners.forEach((p) => expect(roof(p)).toBeGreaterThan(ground(p)));
    expect(roof({ x: 0, y: 0 })).toBeCloseTo((roof(corners[0]) + roof(corners[2])) / 2);
    expect(roof(corners[0]) - roof(corners[1])).toBeCloseTo(2 * Math.tan(20 * Math.PI / 180));
  });
});

describe('scene coordinates', () => {
  it('covers the polygon with margin and aligns satellite bounds with east/north', () => {
    const frame = localFrame([-23.56, -46.65]);
    const polygon = [[-50, -30], [50, -30], [50, 30], [-50, 30]].map(([x, y]) => frame.toLatLng({ x, y }));
    const bounds = sceneBounds(polygon);
    expect(bounds.radiusM).toBeGreaterThan(Math.hypot(50, 30));
    const merc = satelliteBounds(bounds.frame, bounds.radiusM);
    const center = toMercator(bounds.center);
    expect(merc.west).toBeLessThan(center.x);
    expect(merc.east).toBeGreaterThan(center.x);
    expect(merc.south).toBeLessThan(center.y);
    expect(merc.north).toBeGreaterThan(center.y);
  });

  it('uses date-only UTC arithmetic including leap days', () => {
    expect(solarDayOfYear('2026-01-01')).toBe(1);
    expect(solarDayOfYear('2026-12-31')).toBe(365);
    expect(solarDayOfYear('2028-03-01')).toBe(61);
  });

  it.each([20, 200, 2000, 20000])('crops cached satellite tiles to the %s m scene extent', (radiusM) => {
    const tiles = satelliteTiles(satelliteBounds(localFrame([-23.56, -46.65]), radiusM));
    expect(tiles.columns * tiles.rows).toBeLessThanOrEqual(9);
    expect(tiles.zoom).toBeLessThanOrEqual(19);
    expect(tiles.crop.x).toBeGreaterThanOrEqual(0);
    expect(tiles.crop.y).toBeGreaterThanOrEqual(0);
    expect(tiles.crop.x + tiles.crop.width).toBeLessThanOrEqual(tiles.columns * 256);
    expect(tiles.crop.y + tiles.crop.height).toBeLessThanOrEqual(tiles.rows * 256);
  });
});
