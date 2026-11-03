import type { TerrainProfile } from '../api/openMeteo';
import { compassName, fmtBRL, fmtNumber, fmtPct, fmtYears } from '../lib/format';
import type { LayoutPlan, Simulation } from '../lib/simulate';
import { daylightHours, noonElevation } from '../lib/solar';

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

/** Compact live summary for the sidebar. */
export function QuickSummary({ sim, consumptionKnown }: { sim: Simulation; consumptionKnown: boolean }) {
  const first = sim.finance.years[0];
  return (
    <div className="tiles">
      <Tile label="Painéis" value={`${sim.usedCount}`} sub={`${fmtNumber(sim.panelAreaM2, 1)} m² de módulos`} />
      <Tile label="Potência" value={`${fmtNumber(sim.kWp, 2)} kWp`} />
      <Tile label="Geração média" value={`${fmtNumber(sim.annualKWh / 12)} kWh`} sub="por mês, 1º ano" />
      <Tile
        label="Economia média"
        value={first ? fmtBRL(first.savings / 12) : '—'}
        sub={consumptionKnown ? 'por mês, 1º ano' : 'por mês, se você consumir tudo'}
      />
    </div>
  );
}

export function DetailTiles({ plan, sim }: { plan: LayoutPlan; sim: Simulation }) {
  const last = sim.finance.years.at(-1);
  return (
    <div className="tiles">
      <Tile
        label="Área desenhada"
        value={`${fmtNumber(plan.areaM2, 1)} m²`}
        sub={sim.usedCount < plan.fittedCount ? `cabem ${plan.fittedCount} painéis` : 'projeção horizontal'}
      />
      <Tile label="Geração anual" value={`${fmtNumber(sim.annualKWh)} kWh`} sub="1º ano" />
      <Tile
        label="Produtividade"
        value={`${fmtNumber(sim.specificYield)} kWh/kWp`}
        sub={`por ano · PR ${fmtPct(sim.performanceRatio, 0)}`}
      />
      <Tile label="Investimento estimado" value={fmtBRL(sim.investment)} />
      <Tile
        label="Retorno (payback)"
        value={sim.finance.paybackYears !== null ? fmtYears(sim.finance.paybackYears) : '—'}
        sub={sim.finance.paybackYears === null ? 'fora do horizonte' : undefined}
      />
      <Tile
        label={`Economia em ${sim.finance.years.length} anos`}
        value={fmtBRL(sim.finance.totalSavings)}
        sub={last ? `saldo líquido ${fmtBRL(last.cumulative)}` : undefined}
      />
    </div>
  );
}

/** What the latitude alone tells about the sun at this site. */
export function SunFacts({
  lat,
  plan,
  terrain,
}: {
  lat: number;
  plan: LayoutPlan | null;
  terrain?: TerrainProfile | null;
}) {
  const south = lat < 0;
  const summer = south ? 355 : 172;
  const winter = south ? 172 : 355;
  return (
    <dl className="kv">
      <dt>Latitude</dt>
      <dd>
        {fmtNumber(Math.abs(lat), 4)}° {south ? 'S' : 'N'}
      </dd>
      {terrain && (
        <>
          <dt>Altitude (Open-Meteo)</dt>
          <dd>
            {fmtNumber(terrain.elevationM, 0)} m
            {terrain.vertices.length > 0 && ` (desnível ${fmtNumber(terrain.reliefM, 1)} m)`}
          </dd>
          <dt>Inclinação do terreno</dt>
          <dd>
            {fmtNumber(terrain.slopePct, 1)}% ({fmtNumber(terrain.slopeDeg, 1)}°
            {terrain.aspectDeg !== null ? ` · face ${compassName(terrain.aspectDeg)}` : ' · plano'})
          </dd>
        </>
      )}
      <dt>Sol ao meio-dia no verão / inverno</dt>
      <dd>
        {fmtNumber(Math.min(90, noonElevation(lat, summer)), 0)}° / {fmtNumber(noonElevation(lat, winter), 0)}°
      </dd>
      <dt>Duração do dia no verão / inverno</dt>
      <dd>
        {fmtNumber(daylightHours(lat, summer), 1)} h / {fmtNumber(daylightHours(lat, winter), 1)} h
      </dd>
      {plan && (
        <>
          <dt>Inclinação ótima voltado ao {compassName(plan.azimuthDeg)}</dt>
          <dd>{plan.optimalTiltDeg}°</dd>
        </>
      )}
    </dl>
  );
}
