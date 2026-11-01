import L from 'leaflet';
import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import { footprintsInside, localFrame, simplePolygon, type LatLng } from '../lib/geometry';
import { curvePoints, infrastructureFootprints, type Infrastructure } from '../lib/infrastructure';

export type BuildTool = 'none' | 'transformer' | 'rectifier' | 'pole' | 'road' | 'curve-road' | 'curve-area';

export function InfrastructureLayer({ area, items, onChange, onAreaChange, roadIndex, tool, width, length, onMessage }: {
  area: LatLng[]; items: Infrastructure[]; onChange: (items: Infrastructure[]) => void;
  onAreaChange: (area: LatLng[]) => void; roadIndex: number;
  tool: BuildTool; width: number; length: number; onMessage: (s: string) => void;
}) {
  const map = useMap();
  const [points, setPoints] = useState<LatLng[]>([]);
  const [edge, setEdge] = useState<number | null>(null);
  useEffect(() => {
    if (tool === 'none') return;
    const wasDragging = map.dragging.enabled();
    map.pm.disableDraw();
    map.pm.disableGlobalEditMode();
    map.pm.disableGlobalDragMode();
    map.pm.disableGlobalRemovalMode();
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';
    return () => { if (wasDragging) map.dragging.enable(); map.getContainer().style.cursor = ''; };
  }, [map, tool]);
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    items.forEach((item) => infrastructureFootprints(item).forEach((shape) => {
      L.polygon(shape, { color: item.type === 'road' ? '#e4bb6c' : item.type === 'transformer' ? '#f47b35' : '#b384ed',
        weight: 1, fillOpacity: 0.65, interactive: false, pmIgnore: true }).addTo(group);
    }));
    points.forEach((p) => L.circleMarker(p, { radius: 5, color: '#fff', fillColor: '#e4bb6c', fillOpacity: 1, pmIgnore: true }).addTo(group));
    return () => { group.remove(); };
  }, [map, items, points]);
  useEffect(() => {
    if (tool === 'none') return;
    const click = (event: L.LeafletMouseEvent) => {
      if (map.pm.globalDrawModeEnabled() || map.pm.globalEditModeEnabled() || map.pm.globalDragModeEnabled() || map.pm.globalRemovalModeEnabled()) return;
      const p: LatLng = [event.latlng.lat, event.latlng.lng];
      if (tool === 'curve-area') {
        if (edge === null) {
          const f = localFrame(p), pt = f.toLocal(p), vertices = area.map(f.toLocal);
          let best = 0, distance = Infinity;
          vertices.forEach((a, i) => {
            const b = vertices[(i + 1) % vertices.length], dx = b.x-a.x, dy = b.y-a.y;
            const t = Math.max(0, Math.min(1, ((pt.x-a.x)*dx + (pt.y-a.y)*dy) / (dx*dx+dy*dy || 1)));
            const d = Math.hypot(pt.x-a.x-t*dx, pt.y-a.y-t*dy);
            if (d < distance) { distance = d; best = i; }
          });
          setEdge(best); onMessage('Clique na posição do controle para curvar o lado selecionado.'); return;
        }
        const curve = curvePoints(area[edge], p, area[(edge + 1) % area.length], 12);
        const next = [...area.slice(0, edge + 1), ...curve.slice(1, -1), ...area.slice(edge + 1)];
        setEdge(null);
        if (!simplePolygon(next) || items.some((item) => !footprintsInside(next, infrastructureFootprints(item)))) {
          onMessage('Curva inválida ou deixa uma estrutura fora da área. Tente novamente.'); return;
        }
        onAreaChange(next); onMessage('Limite curvado. Selecione outro lado para continuar.'); return;
      }
      if (tool === 'curve-road') {
        const road = items[roadIndex];
        if (!road || road.type !== 'road') { onMessage('Selecione uma estrada para curvar.'); return; }
        const updated: Infrastructure = { ...road, points: [road.points[0], p, road.points[2]] };
        if (!footprintsInside(area, infrastructureFootprints(updated))) { onMessage('A estrada deve ficar dentro da área.'); return; }
        onChange(items.map((item, i) => i === roadIndex ? updated : item));
        onMessage('Curva atualizada. Clique novamente para ajustar.'); return;
      }
      if (items.length >= 100) { onMessage('Limite de 100 estruturas atingido.'); return; }
      let item: Infrastructure;
      if (tool === 'road') {
        if (points.length === 0) { setPoints([p]); onMessage('Clique no fim da estrada reta.'); return; }
        item = { type: 'road', points: [points[0], [(points[0][0] + p[0]) / 2, (points[0][1] + p[1]) / 2], p], width };
      } else item = { type: tool, center: p, width, length };
      setPoints([]);
      if (!footprintsInside(area, infrastructureFootprints(item))) {
        onMessage('Toda a estrutura deve caber dentro da área selecionada. Tente novamente.');
        return;
      }
      onChange([...items, item]);
      onMessage(tool === 'road' ? 'Estrada adicionada. Clique para iniciar outra.' : 'Estrutura adicionada. Clique para adicionar outra.');
    };
    map.on('click', click);
    return () => { map.off('click', click); };
  }, [map, area, items, onChange, onAreaChange, roadIndex, tool, width, length, points, edge, onMessage]);
  return null;
}
