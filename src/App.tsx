import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tariffTrend } from './api/aneel';
import { isAbort } from './api/http';
import { reverseGeocode, type Place } from './api/nominatim';
import { loadFlag, loadSimulation, loadSolar, loadTariffs, saveSimulation } from './api/solaris';
import { CashFlowChart, IrradianceChart, LifetimeProductionChart, MonthlyProductionChart, TariffHistoryChart } from './components/charts/Charts';
import { Section } from './components/controls';
import { FinanceSettingsCard } from './components/FinanceSettingsCard';
import { MapView, type FlyTarget } from './components/MapView';
import { Methodology } from './components/Methodology';
import { PanelSettingsCard } from './components/PanelSettingsCard';
import { DetailTiles, QuickSummary, SunFacts } from './components/Results';
import { SearchBar } from './components/SearchBar';
import { TariffSettingsCard, type Pricing } from './components/TariffSettingsCard';
import { guessDistributor, ICMS_BY_UF } from './data/distributors';
import { CUSTOM_PANEL_ID, makeCustomPanel, PANELS } from './data/panels';
import { useAsync } from './hooks/useAsync';
import { fmtNumber } from './lib/format';
import { centroidOf, localFrame, type LatLng } from './lib/geometry';
import { mergeSettings, validateSavedSimulation, type SavedSimulation } from './lib/savedSimulation';
import { planLayout, simulate, type SolarInput } from './lib/simulate';
import { annualFromDailyMeans, estimateGhiFromLatitude, monthlyExtraterrestrial } from './lib/solar';
import {
  DEFAULT_FINANCE_SETTINGS,
  DEFAULT_PANEL_SETTINGS,
  DEFAULT_TARIFF_SETTINGS,
  EXAMPLE_PRICE_PER_KWH,
  FALLBACK_ICMS_PCT,
  FALLBACK_TARIFF_INCREASE_PCT,
  type FinanceSettings,
  type PanelSettings,
  type TariffSettings,
} from './model';

const START_YEAR = new Date().getFullYear();
// Used for the example area when the map has not been zoomed anywhere yet.
const EXAMPLE_CENTER: LatLng = [-23.5614, -46.6559];

function roundedKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

type ShareState =
  | { status: 'idle' }
  | { status: 'busy'; message: string }
  | { status: 'done'; message: string; url: string }
  | { status: 'error'; message: string };

function shareUrl(id: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('sim', id);
  return url.toString();
}

export default function App() {
  const [polygon, setPolygon] = useState<LatLng[] | null>(null);
  const [searchSite, setSearchSite] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [panelSettings, setPanelSettings] = useState<PanelSettings>(DEFAULT_PANEL_SETTINGS);
  const [tariffSettings, setTariffSettings] = useState<TariffSettings>(DEFAULT_TARIFF_SETTINGS);
  const [financeSettings, setFinanceSettings] = useState<FinanceSettings>(DEFAULT_FINANCE_SETTINGS);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [sharedId] = useState(() => new URLSearchParams(window.location.search).get('sim'));
  const [share, setShare] = useState<ShareState>(() =>
    sharedId ? { status: 'busy', message: 'Carregando simulação compartilhada…' } : { status: 'idle' },
  );
  const mapRef = useRef<L.Map | null>(null);

  const updatePanel = useCallback((patch: Partial<PanelSettings>) => setPanelSettings((s) => ({ ...s, ...patch })), []);
  const updateTariff = useCallback((patch: Partial<TariffSettings>) => setTariffSettings((s) => ({ ...s, ...patch })), []);
  const updateFinance = useCallback((patch: Partial<FinanceSettings>) => setFinanceSettings((s) => ({ ...s, ...patch })), []);
  const onMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
  }, []);

  // ---------- Location ----------
  const site = useMemo(() => {
    if (polygon) {
      const [lat, lng] = centroidOf(polygon);
      return { lat, lng };
    }
    return searchSite;
  }, [polygon, searchSite]);

  const siteKey = site ? roundedKey(site.lat, site.lng) : null;
  const solarState = useAsync(siteKey, async (signal) => {
    const [lat, lng] = siteKey!.split(',').map(Number);
    return { key: siteKey!, ...(await loadSolar(lat, lng, signal)) };
  });
  const placeState = useAsync(siteKey, (signal) => {
    const [lat, lng] = siteKey!.split(',').map(Number);
    return reverseGeocode(lat, lng, signal);
  });

  const nasa = solarState.data?.key === siteKey ? solarState.data : undefined;
  const solar: SolarInput | null = useMemo(() => {
    if (!site) return null;
    if (nasa) return { lat: site.lat, ghi: nasa.ghi, temperature: nasa.temperature.map((t) => t ?? 25) };
    return { lat: site.lat, ghi: estimateGhiFromLatitude(site.lat), temperature: Array(12).fill(25) };
  }, [site, nasa]);
  const solarSource = nasa
    ? `NASA POWER${nasa.period ? ` (${nasa.period})` : ''}${nasa.via === 'server' ? ' · cache local' : ''}`
    : solarState.status === 'error'
      ? 'estimativa pela latitude'
      : 'estimativa pela latitude (aguardando NASA POWER)';

  // ---------- Tariff ----------
  const tariffsState = useAsync('tariffs', loadTariffs);
  const flagState = useAsync('flag', loadFlag);
  const tariffList = tariffsState.data?.tariffs;
  const currentFlag = flagState.data?.flag ?? null;
  const place = placeState.status === 'success' ? placeState.data : undefined;

  const distributor = useMemo(() => {
    if (tariffSettings.distributorPinned) return tariffSettings.distributor;
    const agents = tariffList?.map((t) => t.distributor) ?? [];
    return guessDistributor(agents, place?.uf ?? null, place?.city ?? null) ?? tariffSettings.distributor;
  }, [tariffSettings.distributorPinned, tariffSettings.distributor, tariffList, place]);

  const pricing: Pricing = useMemo(() => {
    const tariff = tariffList?.find((t) => t.distributor === distributor) ?? null;
    const icmsPct = tariffSettings.icmsPct ?? (place?.uf ? ICMS_BY_UF[place.uf] : undefined) ?? FALLBACK_ICMS_PCT;
    const taxRate = (icmsPct + tariffSettings.pisCofinsPct) / 100;
    const flagSurcharge = tariffSettings.includeFlag && currentFlag ? currentFlag.surcharge : 0;
    const baseTariff = tariff?.current.total ?? null;
    const computed = baseTariff !== null && taxRate < 1 ? (baseTariff + flagSurcharge) / (1 - taxRate) : null;
    return {
      source: tariffSettings.manualPrice !== null ? 'manual' : computed !== null ? 'aneel' : 'example',
      tariff,
      baseTariff,
      flagSurcharge,
      taxRate,
      icmsPct,
      finalPrice: tariffSettings.manualPrice ?? computed ?? EXAMPLE_PRICE_PER_KWH,
      trend: tariff ? tariffTrend(tariff.history) : null,
    };
  }, [tariffList, distributor, tariffSettings, place, currentFlag]);

  const tariffIncrease =
    financeSettings.tariffIncreasePct !== null
      ? financeSettings.tariffIncreasePct / 100
      : pricing.trend !== null
        ? Math.min(0.12, Math.max(0, pricing.trend))
        : FALLBACK_TARIFF_INCREASE_PCT / 100;

  // ---------- Simulation ----------
  const panel = useMemo(() => {
    if (panelSettings.panelId === CUSTOM_PANEL_ID) return makeCustomPanel(PANELS[0], panelSettings.custom);
    return PANELS.find((p) => p.id === panelSettings.panelId) ?? PANELS[0];
  }, [panelSettings.panelId, panelSettings.custom]);

  const { mounting, orientation, tiltDeg, autoTilt, azimuthDeg, setbackM, gapM } = panelSettings;
  const plan = useMemo(() => {
    if (!polygon || !solar) return null;
    return planLayout({
      polygon,
      solar,
      panel,
      settings: { ...DEFAULT_PANEL_SETTINGS, mounting, orientation, tiltDeg, autoTilt, azimuthDeg, setbackM, gapM },
    });
  }, [polygon, solar, panel, mounting, orientation, tiltDeg, autoTilt, azimuthDeg, setbackM, gapM]);

  const sim = useMemo(() => {
    if (!plan || !solar) return null;
    return simulate({
      plan,
      solar,
      panel,
      settings: panelSettings,
      finance: financeSettings,
      pricePerKWh: pricing.finalPrice,
      tariffIncrease,
      startYear: START_YEAR,
    });
  }, [plan, solar, panel, panelSettings, financeSettings, pricing.finalPrice, tariffIncrease]);

  // ---------- Saved simulations ----------
  // Opening a ?sim=<id> link restores the area and every setting once.
  useEffect(() => {
    if (!sharedId) return;
    const controller = new AbortController();
    loadSimulation(sharedId, controller.signal).then(
      (saved) => {
        const invalid = validateSavedSimulation(saved);
        if (invalid) throw new Error(invalid);
        setPolygon(saved.polygon);
        setSearchSite(saved.site);
        setPanelSettings(mergeSettings(DEFAULT_PANEL_SETTINGS, saved.panel));
        setTariffSettings(mergeSettings(DEFAULT_TARIFF_SETTINGS, saved.tariff));
        setFinanceSettings(mergeSettings(DEFAULT_FINANCE_SETTINGS, saved.finance));
        setShare({ status: 'done', message: 'Simulação compartilhada carregada.', url: shareUrl(sharedId) });
      },
      (err: unknown) => {
        if (isAbort(err)) return;
        setShare({ status: 'error', message: `Não foi possível abrir a simulação “${sharedId}”: ${err instanceof Error ? err.message : err}` });
      },
    );
    return () => controller.abort();
  }, [sharedId]);

  const save = useCallback(async () => {
    if (!polygon) return;
    const simulation: SavedSimulation = {
      version: 1,
      polygon,
      site: searchSite,
      panel: { ...panelSettings },
      tariff: { ...tariffSettings },
      finance: { ...financeSettings },
    };
    setShare({ status: 'busy', message: 'Salvando…' });
    try {
      const url = shareUrl(await saveSimulation(simulation));
      window.history.replaceState(null, '', url);
      const copied = await navigator.clipboard?.writeText(url).then(
        () => true,
        () => false,
      );
      setShare({ status: 'done', message: copied ? 'Simulação salva. Link copiado:' : 'Simulação salva. Link:', url });
    } catch (err) {
      setShare({
        status: 'error',
        message: `Não foi possível salvar (${err instanceof Error ? err.message : err}). Salvar requer o servidor do Solaris (npm run dev ou npm start).`,
      });
    }
  }, [polygon, searchSite, panelSettings, tariffSettings, financeSettings]);

  // ---------- Actions ----------
  const selectPlace = useCallback((p: Place) => {
    setSearchSite(p);
    setFlyTo({ lat: p.lat, lng: p.lng, zoom: 19, nonce: Date.now() });
  }, []);

  const locate = useCallback(() => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Seu navegador não oferece geolocalização.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => selectPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Minha localização' }),
      (err) => setGeoError(`Não foi possível obter sua localização (${err.message}).`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, [selectPlace]);

  const addExample = useCallback(() => {
    const map = mapRef.current;
    const zoomedIn = map && map.getZoom() >= 16;
    const center: LatLng = zoomedIn
      ? [map.getCenter().lat, map.getCenter().lng]
      : searchSite
        ? [searchSite.lat, searchSite.lng]
        : EXAMPLE_CENTER;
    const f = localFrame(center);
    setPolygon(
      [
        [-6, -4],
        [6, -4],
        [6, 4],
        [-6, 4],
      ].map(([x, y]) => f.toLatLng({ x, y })),
    );
  }, [searchSite]);

  const annualGhi = solar ? annualFromDailyMeans(solar.ghi) : null;

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
            <circle cx="17" cy="17" r="7" fill="var(--sun)" />
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              return (
                <line
                  key={i}
                  x1={17 + Math.cos(a) * 10.5}
                  y1={17 + Math.sin(a) * 10.5}
                  x2={17 + Math.cos(a) * 15}
                  y2={17 + Math.sin(a) * 15}
                  stroke="var(--sun)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              );
            })}
          </svg>
          <div>
            <h1>Solaris</h1>
            <p>Simule painéis solares no seu telhado: tamanho, geração e economia</p>
          </div>
        </div>
      </header>

      <main>
        <div className="workspace">
          <div className="map-column">
            <SearchBar onSelect={selectPlace} />
            <div className="map-toolbar">
              <button type="button" className="btn btn-small" onClick={locate}>
                Usar minha localização
              </button>
              <button type="button" className="btn btn-small" onClick={addExample}>
                Área de exemplo (12 × 8 m)
              </button>
              {polygon && (
                <button type="button" className="btn btn-small" onClick={() => setPolygon(null)}>
                  Apagar área
                </button>
              )}
              {polygon && (
                <button type="button" className="btn btn-small" onClick={save} disabled={share.status === 'busy'}>
                  Salvar e compartilhar
                </button>
              )}
              <span className="spacer" />
              {place?.city && (
                <span className="hint">
                  {place.city}
                  {place.uf ? ` — ${place.uf}` : ''}
                </span>
              )}
            </div>
            {geoError && <p className="notice notice-error">{geoError}</p>}
            {share.status !== 'idle' && (
              <p className={`notice${share.status === 'error' ? ' notice-error' : ''}`} role="status">
                {share.message}{' '}
                {share.status === 'done' && <a href={share.url}>{share.url}</a>}
              </p>
            )}
            <MapView
              polygon={polygon}
              onPolygonChange={setPolygon}
              panels={plan?.panels ?? []}
              usedCount={sim?.usedCount ?? 0}
              site={site}
              flyTo={flyTo}
              onReady={onMapReady}
            />
            {plan?.layoutTruncated && (
              <p className="notice notice-warning">Área muito grande: exibindo os primeiros 5.000 painéis.</p>
            )}
          </div>

          <aside className="sidebar" aria-label="Configurações">
            {sim ? (
              <QuickSummary sim={sim} consumptionKnown={financeSettings.monthlyConsumptionKWh > 0} />
            ) : (
              <div className="card empty-state">
                <h2>Comece pelo mapa</h2>
                <p className="hint">
                  1. Busque seu endereço e aproxime até ver o telhado. 2. Desenhe a área disponível com as ferramentas à
                  esquerda do mapa. 3. Ajuste painéis, tarifa e consumo aqui.
                </p>
              </div>
            )}

            {site && (
              <Section title="Sol no local" note={annualGhi ? `${fmtNumber(annualGhi)} kWh/m²·ano` : undefined}>
                <SunFacts lat={site.lat} plan={plan} />
                <p className="source">
                  Irradiação: {solarSource}
                  {solarState.status === 'error' && (
                    <>
                      {' '}
                      ·{' '}
                      <button type="button" className="btn btn-small" onClick={solarState.retry}>
                        Tentar NASA de novo
                      </button>
                    </>
                  )}
                </p>
              </Section>
            )}

            <PanelSettingsCard
              settings={panelSettings}
              onChange={updatePanel}
              panel={panel}
              plan={plan}
              suggestedPanels={sim?.suggestedPanels ?? null}
            />
            <TariffSettingsCard
              settings={{ ...tariffSettings, distributor }}
              onChange={updateTariff}
              tariffs={tariffsState}
              flag={flagState}
              pricing={pricing}
              placeLabel={place?.uf ?? null}
            />
            <FinanceSettingsCard
              settings={financeSettings}
              onChange={updateFinance}
              trend={pricing.trend}
              effectiveIncrease={tariffIncrease}
            />
          </aside>
        </div>

        <section className="results" aria-label="Resultados">
          {plan && sim && solar && (
            <>
              <DetailTiles plan={plan} sim={sim} />
              <div className="chart-grid">
                <MonthlyProductionChart monthlyKWh={sim.monthlyKWh} consumption={financeSettings.monthlyConsumptionKWh} />
                <IrradianceChart
                  h0={monthlyExtraterrestrial(solar.lat)}
                  clearSky={nasa?.clearSky ?? null}
                  ghi={solar.ghi}
                  plane={sim.planeIrradiation}
                  ghiSource={solarSource}
                />
                <LifetimeProductionChart years={sim.finance.years} />
                <CashFlowChart
                  years={sim.finance.years}
                  investment={sim.investment}
                  payback={sim.finance.paybackYears}
                />
              </div>
            </>
          )}
          {pricing.tariff && pricing.tariff.history.length > 1 && (
            <TariffHistoryChart history={pricing.tariff.history} distributor={pricing.tariff.distributor} />
          )}
          <Methodology />
        </section>
      </main>
    </>
  );
}
