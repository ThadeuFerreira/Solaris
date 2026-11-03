import { useEffect, useMemo, useRef, useState } from 'react';
import { fallbackTerrainGrid, fetchTerrainGrid, type TerrainProfile } from '../api/openMeteo';
import { useAsync } from '../hooks/useAsync';
import { fmtNumber } from '../lib/format';
import type { LatLng } from '../lib/geometry';
import type { Infrastructure } from '../lib/infrastructure';
import { DEG, sceneBounds, solarDayOfYear } from '../lib/sceneGeometry';
import { buildSceneWorld, createSceneViewer, loadSatellite, type SceneViewer } from '../lib/sceneRenderer';
import { declination, sunVector } from '../lib/solar';
import type { Mounting } from '../model';

interface SolarSceneProps {
  polygon: LatLng[];
  panels: LatLng[][];
  tiltDeg: number;
  azimuthDeg: number;
  mounting: Mounting;
  terrain?: TerrainProfile | null;
  infrastructure: Infrastructure[];
}

export default function SolarScene({ polygon, panels, tiltDeg, azimuthDeg, mounting, terrain, infrastructure }: SolarSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<SceneViewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imagery, setImagery] = useState<'loading' | 'ready' | 'error'>('loading');
  const [exaggeration, setExaggeration] = useState(1);
  const [hour, setHour] = useState(12);
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  const bounds = useMemo(() => sceneBounds(polygon), [polygon]);
  const gridState = useAsync(`${bounds.center.join(',')}:${bounds.radiusM}`, (signal) => fetchTerrainGrid(bounds.center, bounds.radiusM, signal));
  const grid = useMemo(() => gridState.status === 'success' ? gridState.data! : fallbackTerrainGrid(bounds.radiusM, terrain), [gridState.status, gridState.data, bounds.radiusM, terrain]);
  const sun = sunVector(bounds.center[0], declination(solarDayOfYear(date)), (hour - 12) * 15);

  useEffect(() => {
    if (!hostRef.current) return;
    let runtime: SceneViewer;
    try {
      runtime = createSceneViewer(hostRef.current, bounds, () => setError('A conexão com a placa gráfica foi interrompida. Volte ao mapa 2D e abra a cena novamente.'));
    } catch {
      setError('Não foi possível iniciar o 3D. Este navegador precisa de WebGL 2 e aceleração gráfica. Você pode continuar no mapa 2D.');
      return;
    }
    setViewer(runtime);
    setError(null);
    setImagery('loading');
    const controller = new AbortController();
    let disposed = false;
    // A slow image request must not leave a permanent loading indicator.
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    loadSatellite(bounds, runtime, controller.signal).then(
      () => { if (!controller.signal.aborted) setImagery('ready'); },
      () => { if (!disposed) setImagery('error'); },
    ).finally(() => clearTimeout(timeout));
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timeout);
      runtime.dispose();
    };
  }, [bounds]);

  useEffect(() => {
    if (!viewer) return;
    return buildSceneWorld(viewer, { bounds, grid, exaggeration, polygon, panels, tiltDeg, azimuthDeg, mounting, infrastructure });
  }, [viewer, bounds, grid, exaggeration, polygon, panels, tiltDeg, azimuthDeg, mounting, infrastructure]);

  useEffect(() => {
    if (!viewer) return;
    const distance = bounds.radiusM * 4;
    viewer.sun.position.set(sun.e * distance, sun.u * distance, -sun.n * distance);
    viewer.sun.intensity = sun.u > 0 ? 2.8 * Math.min(1, sun.u * 4) : 0;
    viewer.sun.castShadow = sun.u > 0;
    viewer.hemi.intensity = sun.u > 0 ? 1.6 : 0.5;
    viewer.render();
  }, [viewer, bounds.radiusM, sun.e, sun.n, sun.u]);

  const hourLabel = `${Math.floor(hour).toString().padStart(2, '0')}:${Math.round((hour % 1) * 60).toString().padStart(2, '0')}`;
  return (
    <section className="solar-scene" aria-label="Visualização 3D do projeto">
      <div ref={hostRef} className="solar-scene-canvas" />
      {error ? (
        <div className="solar-scene-error" role="alert"><strong>Visualização 3D indisponível</strong><p>{error}</p></div>
      ) : (
        <>
          <div className="scene-heading scene-glass">
            <strong>Projeto em 3D</strong>
            <span>{fmtNumber(panels.length, 0)} painéis · {fmtNumber(tiltDeg, 1)}° de inclinação</span>
            <small>Arraste para girar · Roda para zoom · Botão direito para mover</small>
          </div>
          <div className="scene-camera-controls scene-glass" role="group" aria-label="Câmera 3D">
            <button type="button" onClick={() => viewer?.rotate(-30 * DEG)} aria-label="Girar câmera 30 graus à esquerda">↶</button>
            <button type="button" onClick={() => viewer?.rotate(30 * DEG)} aria-label="Girar câmera 30 graus à direita">↷</button>
            <button type="button" onClick={() => viewer?.resetCamera(true)}>Vista superior</button>
            <button type="button" onClick={() => viewer?.resetCamera()}>Recentrar</button>
          </div>
          <div className="scene-controls scene-glass">
            <label className="scene-time">
              <span>Hora solar <output>{hourLabel}</output></span>
              <input type="range" min="6" max="18" step="0.25" value={hour} onChange={(e) => setHour(Number(e.target.value))} aria-label="Hora solar" aria-valuetext={hourLabel} />
              <small>06h <span>12h</span> 18h</small>
            </label>
            <label className="scene-date"><span>Data do sol</span><input type="date" aria-label="Data do sol" value={date} onChange={(e) => { if (e.target.value && Number.isFinite(solarDayOfYear(e.target.value))) setDate(e.target.value); }} /></label>
            <label className="scene-relief">
              <span>Relevo <output>{fmtNumber(exaggeration, 1)}×</output></span>
              <input type="range" min="1" max="5" step="0.25" value={exaggeration} onChange={(e) => setExaggeration(Number(e.target.value))} aria-label="Exagero vertical do relevo" />
              <small>{exaggeration > 1 ? 'Relevo exagerado; sombras ilustrativas' : 'Escala vertical real'}</small>
            </label>
            <p className="scene-status" role="status">
              {gridState.status === 'loading' ? 'Carregando relevo…' : gridState.status === 'error' ? <>Relevo aproximado{terrain ? ' pela inclinação local' : ' em plano, sem altitude'}. <button type="button" onClick={gridState.retry}>Tentar novamente</button></> : 'Relevo Open-Meteo carregado.'}
              {' '}{imagery === 'loading' ? 'Carregando satélite…' : imagery === 'error' ? 'Satélite indisponível; terreno sem textura.' : ''}
              {sun.u <= 0 && ' Sol abaixo do horizonte; sem sombras diretas.'}
            </p>
            <small className="scene-caveat">{mounting === 'flush' ? 'Cobertura esquemática na inclinação configurada; altura do edifício não medida.' : 'Suportes e alturas da infraestrutura são esquemáticos.'} Relevo de baixa resolução; edite o projeto no mapa 2D.</small>
          </div>
        </>
      )}
      <div className="scene-attribution">Imagens © Esri, Maxar, Earthstar Geographics e comunidade GIS · <a href="https://open-meteo.com/en/docs/elevation-api" target="_blank" rel="noreferrer">Open-Meteo</a> / Copernicus</div>
    </section>
  );
}
