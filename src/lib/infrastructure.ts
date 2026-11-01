import { localFrame, type LatLng } from './geometry';

export type Infrastructure =
  | { type: 'transformer' | 'rectifier' | 'pole'; center: LatLng; width: number; length: number }
  | { type: 'road'; points: [LatLng, LatLng, LatLng]; width: number };

export function curvePoints(start: LatLng, control: LatLng, end: LatLng, steps = 24): LatLng[] {
  const f = localFrame(start);
  const [a, b, c] = [start, control, end].map(f.toLocal);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return f.toLatLng({ x: (1-t)**2*a.x + 2*(1-t)*t*b.x + t*t*c.x, y: (1-t)**2*a.y + 2*(1-t)*t*b.y + t*t*c.y });
  });
}

/** Footprints are shared by the map and the panel exclusion calculation. */
export function infrastructureFootprints(item: Infrastructure): LatLng[][] {
  if (item.type !== 'road') {
    const f = localFrame(item.center);
    return [[[-item.width / 2, -item.length / 2], [item.width / 2, -item.length / 2],
      [item.width / 2, item.length / 2], [-item.width / 2, item.length / 2]]
      .map(([x, y]) => f.toLatLng({ x, y }))];
  }
  const f = localFrame(item.points[0]);
  const [a, b, c] = item.points.map(f.toLocal);
  const curve = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return { x: (1-t)**2*a.x + 2*(1-t)*t*b.x + t*t*c.x, y: (1-t)**2*a.y + 2*(1-t)*t*b.y + t*t*c.y };
  });
  const radius = item.width / 2;
  const shapes = curve.map((p) => Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6;
    // Circumscribed polygon keeps the whole road width excluded.
    return f.toLatLng({ x: p.x + radius / Math.cos(Math.PI / 12) * Math.cos(angle), y: p.y + radius / Math.cos(Math.PI / 12) * Math.sin(angle) });
  }));
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i - 1], q = curve[i];
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (!d) continue;
    const x = -(q.y - p.y) / d * radius, y = (q.x - p.x) / d * radius;
    shapes.push([{x:p.x+x,y:p.y+y},{x:q.x+x,y:q.y+y},{x:q.x-x,y:q.y-y},{x:p.x-x,y:p.y-y}].map(f.toLatLng));
  }
  return shapes;
}
