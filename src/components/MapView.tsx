import '../lib/leafletGlobal';
import '@geoman-io/leaflet-geoman-free';
import L from 'leaflet';
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { CircleMarker, LayersControl, MapContainer, TileLayer, useMap } from 'react-leaflet';
import { elevationColor, type TerrainProfile } from '../api/openMeteo';
import { compassName, fmtNumber } from '../lib/format';
import type { LatLng } from '../lib/geometry';
import type { Infrastructure } from '../lib/infrastructure';
import { InfrastructureLayer, type BuildTool } from './InfrastructureEditor';
import type { Mounting } from '../model';

const SolarScene = lazy(() => import('./SolarScene'));

const BRAZIL_CENTER: LatLng = [-14.5, -52];
const GRADIENT_ID = 'solaris-elevation-gradient';

const AREA_STYLE: L.PathOptions = { color: '#ffb000', weight: 2.2, fillColor: '#ffb000', fillOpacity: 0.14 };
const USED_STYLE: L.PolylineOptions = { color: '#9ec5f4', weight: 0.6, fillColor: '#123a7a', fillOpacity: 0.88 };
const SPARE_STYLE: L.PolylineOptions = { color: '#ffffff', weight: 0.8, opacity: 0.7, dashArray: '3 3', fill: false };

export interface FlyTarget {
  lat: number;
  lng: number;
  zoom: number;
  /** Changes on every request so flying to the same place twice still works. */
  nonce: number;
}

interface MapViewProps {
  mode: '2d' | '3d';
  tiltDeg: number;
  azimuthDeg: number;
  mounting: Mounting;
  polygon: LatLng[] | null;
  onPolygonChange: (polygon: LatLng[] | null) => void;
  panels: LatLng[][];
  usedCount: number;
  site: { lat: number; lng: number } | null;
  terrain?: TerrainProfile | null;
  shadeElevation?: boolean;
  onToggleShadeElevation?: () => void;
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

/**
 * Updates (or creates) an SVG <linearGradient> inside the polygon's owner
 * <svg> element and styles the polygon fill according to the terrain slope and
 * elevation range.
 */
function stylePolygonByElevation(layer: L.Polygon, terrain: TerrainProfile | null | undefined) {
  if (!terrain) {
    layer.setStyle(AREA_STYLE);
    return;
  }

  const el = layer.getElement() as SVGPathElement | undefined;
  const svg = el?.ownerSVGElement;
  if (!svg || terrain.aspectDeg === null) {
    const flatColor = elevationColor(0.5);
    layer.setStyle({ ...AREA_STYLE, color: flatColor, fillColor: flatColor, fillOpacity: 0.28 });
    return;
  }

  const NS = 'http://www.w3.org/2000/svg';
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(NS, 'defs');
    svg.prepend(defs);
  }
  let grad = svg.querySelector(`#${GRADIENT_ID}`) as SVGLinearGradientElement | null;
  if (!grad) {
    grad = document.createElementNS(NS, 'linearGradient') as SVGLinearGradientElement;
    grad.setAttribute('id', GRADIENT_ID);
    grad.setAttribute('gradientUnits', 'objectBoundingBox');
    defs.appendChild(grad);
  }

  // aspectDeg points downhill (0 = N, 90 = E). Uphill screen vector (low -> high):
  const rad = (terrain.aspectDeg * Math.PI) / 180;
  const ux = -Math.sin(rad);
  const uy = Math.cos(rad);
  grad.setAttribute('x1', `${(0.5 - 0.5 * ux).toFixed(3)}`);
  grad.setAttribute('y1', `${(0.5 - 0.5 * uy).toFixed(3)}`);
  grad.setAttribute('x2', `${(0.5 + 0.5 * ux).toFixed(3)}`);
  grad.setAttribute('y2', `${(0.5 + 0.5 * uy).toFixed(3)}`);

  grad.replaceChildren();
  const stops: [string, string][] = [
    ['0%', elevationColor(0)],
    ['50%', elevationColor(0.5)],
    ['100%', elevationColor(1)],
  ];
  for (const [offset, color] of stops) {
    const stop = document.createElementNS(NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    grad.appendChild(stop);
  }

  // Increase shading intensity slightly on steeper slopes (0.32 to 0.52).
  const fillOpacity = Math.min(0.52, 0.32 + Math.min(terrain.slopePct, 20) * 0.01);
  layer.setStyle({
    ...AREA_STYLE,
    color: '#ffb000',
    fillColor: `url(#${GRADIENT_ID})`,
    fillOpacity,
  });
}

function DrawControl({
  polygon,
  onPolygonChange,
  terrain,
}: Pick<MapViewProps, 'polygon' | 'onPolygonChange' | 'terrain'>) {
  const map = useMap();
  const layerRef = useRef<L.Polygon | null>(null);
  const emittedRef = useRef('null');
  const onChangeRef = useRef(onPolygonChange);
  const terrainRef = useRef(terrain);
  useEffect(() => {
    onChangeRef.current = onPolygonChange;
    terrainRef.current = terrain;
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
      stylePolygonByElevation(layer, terrainRef.current);
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
    stylePolygonByElevation(layer, terrainRef.current);
    attachRef.current(layer);
    map.fitBounds(layer.getBounds(), { maxZoom: 21, padding: [40, 40] });
  }, [polygon, map]);

  // Re-shade the active polygon whenever Open-Meteo terrain data updates.
  useEffect(() => {
    if (layerRef.current) {
      stylePolygonByElevation(layerRef.current, terrain);
    }
  }, [terrain, polygon]);

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

function TerrainVerticesLayer({ terrain }: { terrain?: TerrainProfile | null }) {
  const map = useMap();
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
    if (!terrain || terrain.vertices.length === 0) return;

    const decimals = terrain.reliefM > 0 && terrain.reliefM < 5 ? 1 : 0;
    // Avoid clutter when a curved polygon has many closely spaced vertices.
    const step = terrain.vertices.length > 8 ? Math.ceil(terrain.vertices.length / 8) : 1;
    terrain.vertices.forEach((v, i) => {
      if (i % step !== 0) return;
      const color = elevationColor(v.normalized);
      L.circleMarker([v.lat, v.lng], {
        radius: 5,
        color: '#0b0b0b',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 1,
        interactive: false,
        pmIgnore: true,
      })
        .bindTooltip(`${fmtNumber(v.elevationM, decimals)} m`, {
          permanent: true,
          direction: 'top',
          offset: [0, -5],
          className: 'elevation-vertex-label',
        })
        .addTo(group);
    });
  }, [terrain]);

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

export function MapView({
  mode,
  tiltDeg,
  azimuthDeg,
  mounting,
  polygon,
  onPolygonChange,
  panels,
  usedCount,
  site,
  terrain,
  shadeElevation = false,
  onToggleShadeElevation,
  flyTo,
  onReady,
  infrastructure,
  onInfrastructureChange,
  buildTool,
  buildWidth,
  buildLength,
  roadIndex,
  onBuildMessage,
}: MapViewProps) {
  const legendDecimals = terrain && terrain.reliefM > 0 && terrain.reliefM < 5 ? 1 : 0;
  const activeTerrain = shadeElevation ? terrain : null;
  const show3d = mode === '3d' && !!polygon;
  return (
    <div className="map-frame">
      <div className={`map-2d${show3d ? ' map-2d-hidden' : ''}`} aria-hidden={show3d} inert={show3d}>
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
        <DrawControl polygon={polygon} onPolygonChange={onPolygonChange} terrain={activeTerrain} />
        <PanelsLayer panels={panels} usedCount={usedCount} />
        <TerrainVerticesLayer terrain={activeTerrain} />
        {polygon && (
          <InfrastructureLayer
            key={`${buildTool}:${roadIndex}:${JSON.stringify(polygon)}`}
            area={polygon}
            items={infrastructure}
            onChange={onInfrastructureChange}
            onAreaChange={onPolygonChange}
            roadIndex={roadIndex}
            tool={buildTool}
            width={buildWidth}
            length={buildLength}
            onMessage={onBuildMessage}
          />
        )}
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
      </div>
      {show3d && (
        <Suspense fallback={<div className="scene-loading" role="status">Carregando visualização 3D…</div>}>
          <SolarScene polygon={polygon} panels={panels.slice(0, usedCount)} tiltDeg={tiltDeg} azimuthDeg={azimuthDeg} mounting={mounting} terrain={terrain} infrastructure={infrastructure} />
        </Suspense>
      )}
      {terrain && !show3d && (
        <div className="map-terrain-badge" aria-label="Elevação e relevo do local (Open-Meteo)">
          <span>
            <strong>⛰ {fmtNumber(terrain.elevationM, 0)} m</strong> de altitude
          </span>
          <span>
            · Inclinação:{' '}
            <strong>
              {fmtNumber(terrain.slopePct, 1)}% ({fmtNumber(terrain.slopeDeg, 1)}°
              {terrain.aspectDeg !== null ? ` · face ${compassName(terrain.aspectDeg)}` : ' · plano'})
            </strong>
          </span>
          {shadeElevation && terrain.vertices.length > 0 && (
            <span className="map-terrain-scale">
              · Cota:{' '}
              <span className="map-terrain-low">{fmtNumber(terrain.minElevationM, legendDecimals)} m</span>
              <span className="map-terrain-gradient-bar" aria-hidden="true" />
              <span className="map-terrain-high">{fmtNumber(terrain.maxElevationM, legendDecimals)} m</span>
              {' '}(Δ {fmtNumber(terrain.reliefM, 1)} m)
            </span>
          )}
          {polygon && onToggleShadeElevation && (
            <button
              type="button"
              className="map-terrain-toggle"
              aria-pressed={shadeElevation}
              onClick={onToggleShadeElevation}
            >
              {shadeElevation ? '✓ Gradiente de elevação' : 'Exibir gradiente de elevação'}
            </button>
          )}
        </div>
      )}
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
