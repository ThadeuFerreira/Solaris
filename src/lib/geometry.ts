// Planar geometry for laying out solar panels inside a drawn polygon. Polygons
// arrive as [lat, lng] pairs and are projected to a local east/north metre
// grid around their centroid, which is accurate for roof- or field-sized areas.

export type LatLng = [number, number];
export interface Point {
  x: number;
  y: number;
}

const EARTH_RADIUS = 6371008.8;
const DEG = Math.PI / 180;

export interface LocalFrame {
  origin: LatLng;
  toLocal(p: LatLng): Point;
  toLatLng(p: Point): LatLng;
}

export function centroidOf(points: LatLng[]): LatLng {
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lat, lng];
}

export function localFrame(origin: LatLng): LocalFrame {
  const k = EARTH_RADIUS * DEG;
  const cosLat = Math.cos(origin[0] * DEG);
  return {
    origin,
    toLocal: ([lat, lng]) => ({ x: (lng - origin[1]) * k * cosLat, y: (lat - origin[0]) * k }),
    toLatLng: ({ x, y }) => [origin[0] + y / k, origin[1] + x / (k * cosLat)],
  };
}

/** Signed shoelace area (positive when counter-clockwise). */
function signedArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Area in m² of a polygon given as [lat, lng] vertices. */
export function polygonAreaM2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const frame = localFrame(centroidOf(points));
  return Math.abs(signedArea(points.map(frame.toLocal)));
}

/** Compass bearing (0–180) of the polygon's longest edge. */
export function longestEdgeBearing(points: LatLng[]): number {
  if (points.length < 2) return 0;
  const frame = localFrame(centroidOf(points));
  const local = points.map(frame.toLocal);
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < local.length; i++) {
    const p = local[i];
    const q = local[(i + 1) % local.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len > bestLen) {
      bestLen = len;
      best = Math.atan2(q.x - p.x, q.y - p.y) / DEG;
    }
  }
  return ((best % 180) + 180) % 180;
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * True when the rectangle lies inside the polygon and keeps at least
 * `clearance` metres from its boundary. With no crossings, the minimum
 * distance between the two boundaries is reached at a vertex of one of them.
 */
function rectFits(rect: Point[], poly: Point[], clearance: number): boolean {
  for (const c of rect) if (!pointInPolygon(c, poly)) return false;
  for (let i = 0; i < 4; i++) {
    const r1 = rect[i];
    const r2 = rect[(i + 1) % 4];
    for (let j = 0; j < poly.length; j++) {
      const p1 = poly[j];
      const p2 = poly[(j + 1) % poly.length];
      if (segmentsIntersect(r1, r2, p1, p2)) return false;
      if (clearance > 0) {
        if (pointSegmentDistance(r1, p1, p2) < clearance) return false;
        if (pointSegmentDistance(p1, r1, r2) < clearance) return false;
      }
    }
  }
  return true;
}

export interface LayoutOptions {
  /** Panel size along the row, metres. */
  alongRowM: number;
  /** Panel footprint across the row (projected if tilted), metres. */
  acrossRowM: number;
  /** Gap between neighbouring panels in a row, metres. */
  gapM: number;
  /** Distance between the back of one row and the front of the next, metres. */
  rowGapM: number;
  /** Clearance from the polygon edge, metres. */
  setbackM: number;
  /** Compass bearing of the across-row direction (the way panels face). */
  bearingDeg: number;
  /** Safety cap on the number of panels to place. */
  maxPanels?: number;
}

export interface Layout {
  panels: LatLng[][];
  truncated: boolean;
}

/**
 * Packs a regular grid of panel rectangles into the polygon. A handful of grid
 * offsets are tried and the one that fits the most panels is kept.
 */
export function layoutPanels(points: LatLng[], opts: LayoutOptions): Layout {
  const maxPanels = opts.maxPanels ?? 5000;
  if (points.length < 3 || opts.alongRowM <= 0 || opts.acrossRowM <= 0) return { panels: [], truncated: false };

  const frame = localFrame(centroidOf(points));
  const b = opts.bearingDeg * DEG;
  // v: across-row (facing) direction; u: along-row direction (v rotated 90° clockwise).
  const v = { x: Math.sin(b), y: Math.cos(b) };
  const u = { x: Math.cos(b), y: -Math.sin(b) };
  const toUV = (p: Point): Point => ({ x: p.x * u.x + p.y * u.y, y: p.x * v.x + p.y * v.y });
  const fromUV = (q: Point): Point => ({ x: q.x * u.x + q.y * v.x, y: q.x * u.y + q.y * v.y });

  const poly = points.map((p) => toUV(frame.toLocal(p)));
  const minU = Math.min(...poly.map((p) => p.x));
  const maxU = Math.max(...poly.map((p) => p.x));
  const minV = Math.min(...poly.map((p) => p.y));
  const maxV = Math.max(...poly.map((p) => p.y));

  const pitchU = opts.alongRowM + opts.gapM;
  const pitchV = opts.acrossRowM + opts.rowGapM;
  const estimate = ((maxU - minU) / pitchU) * ((maxV - minV) / pitchV);
  // Large fields get fewer offset trials so the layout stays interactive.
  const steps = estimate > 4000 ? 1 : estimate > 800 ? 2 : 4;

  let best: Point[][] = [];
  for (let iu = 0; iu < steps; iu++) {
    for (let iv = 0; iv < steps; iv++) {
      const startU = minU + (iu / steps) * pitchU;
      const startV = minV + (iv / steps) * pitchV;
      const found: Point[][] = [];
      for (let v0 = startV; v0 + opts.acrossRowM <= maxV + 1e-9; v0 += pitchV) {
        for (let u0 = startU; u0 + opts.alongRowM <= maxU + 1e-9; u0 += pitchU) {
          const rect = [
            { x: u0, y: v0 },
            { x: u0 + opts.alongRowM, y: v0 },
            { x: u0 + opts.alongRowM, y: v0 + opts.acrossRowM },
            { x: u0, y: v0 + opts.acrossRowM },
          ];
          if (rectFits(rect, poly, opts.setbackM)) found.push(rect);
        }
      }
      if (found.length > best.length) best = found;
    }
  }

  const truncated = best.length > maxPanels;
  const panels = best.slice(0, maxPanels).map((rect) => rect.map((q) => frame.toLatLng(fromUV(q))));
  return { panels, truncated };
}
