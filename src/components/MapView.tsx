import '../lib/leafletGlobal';
import '@geoman-io/leaflet-geoman-free';
import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { CircleMarker, LayersControl, MapContainer, TileLayer, useMap } from 'react-leaflet';
import type { LatLng } from '../lib/geometry';
import type { Infrastructure } from '../lib/infrastructure';
import { InfrastructureLayer, type BuildTool } from './InfrastructureEditor';

const BRAZIL_CENTER: LatLng = [-14.5, -52];

const AREA_STYLE: L.PathOptions = { color: '#ffb000', weight: 2, fillColor: '#ffb000', fillOpacity: 0.08 };
const USED_STYLE: L.PolylineOptions = { color: '#9ec5f4', weight: 0.6, fillColor: '#123a7a', fillOpacity: 0.9 };
const SPARE_STYLE: L.PolylineOptions = { color: '#ffffff', weight: 0.8, opacity: 0.7, dashArray: '3 3', fill: false };

export interface FlyTarget {
  lat: number;
  lng: number;
  zoom: number;
  /** Changes on every request so flying to the same place twice still works. */
  nonce: number;
}

interface MapViewProps {
  polygon: LatLng[] | null;
  onPolygonChange: (polygon: LatLng[] | null) => void;
  panels: LatLng[][];
  usedCount: number;
  site: { lat: number; lng: number } | null;
  flyTo: FlyTarget | null;
  onReady?: (map: L.Map) => void;
  infrastructure: Infrastructure[];
  onInfrastructureChange: (items: Infrastructure[]) => void;
  buildTool: BuildTool;
  buildWidth: number;
  buildLength: number;
  roadIndex: number;
  onBuildMessage: (message: string) => void;
}

function toCoords(layer: L.Polygon): LatLng[] {
  const rings = layer.getLatLngs() as L.LatLng[][];
  return rings[0].map((ll) => [ll.lat, ll.lng]);
}

function DrawControl({ polygon, onPolygonChange }: Pick<MapViewProps, 'polygon' | 'onPolygonChange'>) {
  const map = useMap();
  const layerRef = useRef<L.Polygon | null>(null);
  const emittedRef = useRef('null');
  const onChangeRef = useRef(onPolygonChange);
  useEffect(() => {
    onChangeRef.current = onPolygonChange;
  });

  const attachRef = useRef((layer: L.Polygon) => {
    const emit = () => {
      const coords = toCoords(layer);
      emittedRef.current = JSON.stringify(coords);
      onChangeRef.current(coords);
    };
    layer.on('pm:edit pm:dragend pm:rotateend', emit);
    return emit;
  });

  useEffect(() => {
    map.pm.setLang('pt_br');
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawText: false,
      cutPolygon: false,
      drawPolygon: true,
      drawRectangle: true,
      editMode: true,
      dragMode: true,
      rotateMode: true,
      removalMode: true,
    });
    map.pm.setGlobalOptions({ pathOptions: AREA_STYLE, allowSelfIntersection: false, snappable: true });

    const onCreate = (e: { layer: L.Layer }) => {
      const layer = e.layer as L.Polygon;
      // A single area at a time: a new drawing replaces the previous one.
      if (layerRef.current && layerRef.current !== layer) layerRef.current.remove();
      layerRef.current = layer;
      layer.setStyle(AREA_STYLE);
      attachRef.current(layer)();
    };
    const onRemove = (e: { layer: L.Layer }) => {
      if (e.layer !== layerRef.current) return;
      layerRef.current = null;
      emittedRef.current = 'null';
      onChangeRef.current(null);
    };
    map.on('pm:create', onCreate);
    map.on('pm:remove', onRemove);
    return () => {
      map.off('pm:create', onCreate);
      map.off('pm:remove', onRemove);
      map.pm.removeControls();
    };
  }, [map]);

  // Polygons set from outside (example, clear) replace the drawn layer.
  useEffect(() => {
    const key = JSON.stringify(polygon);
    if (key === emittedRef.current) return;
    emittedRef.current = key;
    layerRef.current?.remove();
    layerRef.current = null;
    if (!polygon) return;
    const layer = L.polygon(polygon, AREA_STYLE).addTo(map);
    layerRef.current = layer;
    attachRef.current(layer);
    map.fitBounds(layer.getBounds(), { maxZoom: 21, padding: [40, 40] });
  }, [polygon, map]);

  return null;
}

function PanelsLayer({ panels, usedCount }: { panels: LatLng[][]; usedCount: number }) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    return () => {
      group.remove();
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    panels.forEach((corners, i) => {
      const style = i < usedCount ? USED_STYLE : SPARE_STYLE;
      L.polygon(corners, { ...style, renderer, interactive: false, pmIgnore: true }).addTo(group);
    });
  }, [panels, usedCount, renderer]);

  return null;
}

function MapReady({ onReady }: { onReady?: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady?.(map);
  }, [map, onReady]);
  return null;
}

function FlyTo({ target }: { target: FlyTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], target.zoom, { duration: 1.2 });
  }, [target, map]);
  return null;
}

export function MapView({ polygon, onPolygonChange, panels, usedCount, site, flyTo, onReady, infrastructure, onInfrastructureChange, buildTool, buildWidth, buildLength, roadIndex, onBuildMessage }: MapViewProps) {
  return (
    <div className="map-frame">
      <MapContainer center={BRAZIL_CENTER} zoom={4} maxZoom={21} scrollWheelZoom>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satélite (Esri)">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Imagens &copy; Esri, Maxar, Earthstar Geographics e comunidade GIS"
              maxNativeZoom={19}
              maxZoom={21}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Mapa (OpenStreetMap)">
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores do OpenStreetMap</a>'
              maxNativeZoom={19}
              maxZoom={21}
            />
          </LayersControl.BaseLayer>
          <LayersControl.Overlay checked name="Nomes e limites">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              attribution="Rótulos &copy; Esri"
              maxNativeZoom={19}
              maxZoom={21}
            />
          </LayersControl.Overlay>
        </LayersControl>
        <DrawControl polygon={polygon} onPolygonChange={onPolygonChange} />
        <PanelsLayer panels={panels} usedCount={usedCount} />
        {polygon && <InfrastructureLayer key={`${buildTool}:${roadIndex}:${JSON.stringify(polygon)}`} area={polygon} items={infrastructure} onChange={onInfrastructureChange} onAreaChange={onPolygonChange} roadIndex={roadIndex} tool={buildTool} width={buildWidth} length={buildLength} onMessage={onBuildMessage} />}
        <FlyTo target={flyTo} />
        <MapReady onReady={onReady} />
        {site && !polygon && (
          <CircleMarker
            center={[site.lat, site.lng]}
            radius={7}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#eb6834', fillOpacity: 1 }}
          />
        )}
      </MapContainer>
      {!polygon && (
        <div className="map-hint">
          {site ? (
            <>
              Use <strong>⬠ Desenhar polígono</strong> ou <strong>▭ retângulo</strong> (à esquerda) para marcar a área dos
              painéis. Dê zoom até ver o telhado.
            </>
          ) : (
            <>Busque um endereço acima ou use sua localização para começar.</>
          )}
        </div>
      )}
    </div>
  );
}
