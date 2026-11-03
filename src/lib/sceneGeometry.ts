import { centroidOf, localFrame, type LatLng, type LocalFrame, type Point } from './geometry';

export const DEG = Math.PI / 180;
const MERCATOR_RADIUS = 6378137;

export function sceneBounds(polygon: LatLng[]) {
  const center = centroidOf(polygon);
  const frame = localFrame(center);
  const points = polygon.map(frame.toLocal);
  const siteRadiusM = Math.max(5, ...points.map((p) => Math.hypot(p.x, p.y)));
  return { center, frame, siteRadiusM, radiusM: Math.max(20, siteRadiusM * 1.45) };
}

/** Web Mercator coordinates match the satellite image's projection. */
export function toMercator([lat, lng]: LatLng): Point {
  const latitude = Math.max(-85, Math.min(85, lat)) * DEG;
  return { x: MERCATOR_RADIUS * lng * DEG, y: MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + latitude / 2)) };
}

export function satelliteBounds(frame: LocalFrame, radiusM: number) {
  const sw = toMercator(frame.toLatLng({ x: -radiusM, y: -radiusM }));
  const ne = toMercator(frame.toLatLng({ x: radiusM, y: radiusM }));
  return { west: sw.x, south: sw.y, east: ne.x, north: ne.y };
}

/** Cover the scene with at most 3 × 3 cached Esri tiles, up to native zoom 19. */
export function satelliteTiles(bounds: ReturnType<typeof satelliteBounds>) {
  const worldM = 2 * Math.PI * MERCATOR_RADIUS;
  const span = Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
  const zoom = Math.max(1, Math.min(19, Math.floor(Math.log2(worldM * 2 / span))));
  const count = 2 ** zoom;
  const west = (bounds.west / worldM + 0.5) * count;
  const east = (bounds.east / worldM + 0.5) * count;
  const north = (0.5 - bounds.north / worldM) * count;
  const south = (0.5 - bounds.south / worldM) * count;
  const x0 = Math.floor(west), y0 = Math.floor(north);
  const columns = Math.ceil(east) - x0, rows = Math.ceil(south) - y0;
  return { zoom, count, x0, y0, columns, rows, crop: { x: (west - x0) * 256, y: (north - y0) * 256, width: (east - west) * 256, height: (south - north) * 256 } };
}

/** A panel's front edge is lower; its outward normal faces the configured azimuth. */
export function pitchHeight(point: Point, tiltDeg: number, azimuthDeg: number): number {
  const facingDistance = point.x * Math.sin(azimuthDeg * DEG) + point.y * Math.cos(azimuthDeg * DEG);
  return -facingDistance * Math.tan(tiltDeg * DEG);
}

/** Keep each rack rigid at its specified pitch, clearing the ground at every corner. */
export function rackPanelHeights(
  corners: Point[],
  ground: (point: Point) => number,
  tiltDeg: number,
  azimuthDeg: number,
  clearanceM = 0.65,
): number[] {
  const center = { x: corners.reduce((s, p) => s + p.x, 0) / corners.length, y: corners.reduce((s, p) => s + p.y, 0) / corners.length };
  const offsets = corners.map((p) => pitchHeight({ x: p.x - center.x, y: p.y - center.y }, tiltDeg, azimuthDeg));
  const base = Math.max(...corners.map((p, i) => ground(p) - offsets[i])) + clearanceM;
  return offsets.map((offset) => base + offset);
}

/** A consistent pitched surface for flush mounting; no building height is inferred from DEM. */
export function roofSurface(
  polygon: Point[],
  ground: (point: Point) => number,
  tiltDeg: number,
  azimuthDeg: number,
): (point: Point) => number {
  const base = Math.max(...polygon.map((p) => ground(p) - pitchHeight(p, tiltDeg, azimuthDeg))) + 0.25;
  return (p) => base + pitchHeight(p, tiltDeg, azimuthDeg);
}

export function solarDayOfYear(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
}
