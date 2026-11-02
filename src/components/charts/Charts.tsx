import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TariffPoint } from '../../api/aneel';
import { fmtBRL, fmtCompact, fmtDate, fmtNumber, fmtYears } from '../../lib/format';
import type { YearResult } from '../../lib/pv';
import { MONTH_LABELS } from '../../lib/solar';
import { ChartCard, ChartTooltip, DataTable, Legend } from './ChartParts';
import { AXIS_LINE, AXIS_TICK, niceAxis, type TooltipRender } from './chartTheme';

const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
const ACTIVE_DOT = { r: 4, stroke: 'var(--surface-1)', strokeWidth: 2 };
const HOVER_CURSOR = { fill: 'var(--hover-wash)' };
const CROSSHAIR = { stroke: 'var(--axis)', strokeWidth: 1 };

const axisNumber = (v: number, compact: boolean) => (compact ? fmtCompact(v) : fmtNumber(v));

// ---------- Monthly production ----------

export function MonthlyProductionChart({ monthlyKWh, consumption }: { monthlyKWh: number[]; consumption: number }) {
  const data = monthlyKWh.map((kwh, i) => ({ month: MONTH_LABELS[i], kwh }));
  const avg = monthlyKWh.reduce((a, b) => a + b, 0) / 12;
  const y = niceAxis([...monthlyKWh, consumption], axisNumber);
  const tip: TooltipRender = (d) => ({
    title: String(d.month),
    rows: [{ name: 'gerados', value: `${fmtNumber(d.kwh as number)} kWh`, color: 'var(--series-1)' }],
  });
  return (
    <ChartCard
      title="Geração mensal estimada (kWh)"
      subtitle={`Primeiro ano · média de ${fmtNumber(avg)} kWh/mês${consumption > 0 ? ` · consumo informado: ${fmtNumber(consumption)} kWh/mês` : ''}`}
    >
      {consumption > 0 && <Legend items={[{ name: 'Consumo médio', color: 'var(--text-muted)', dashed: true }]} />}
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="month" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={56}
              domain={y.domain}
              ticks={y.ticks}
              tickFormatter={y.format}
            />
            <Tooltip content={<ChartTooltip render={tip} />} cursor={HOVER_CURSOR} />
            <Bar dataKey="kwh" fill="var(--series-1)" radius={BAR_RADIUS} maxBarSize={24} isAnimationActive={false} />
            {consumption > 0 && (
              <ReferenceLine y={consumption} stroke="var(--text-muted)" strokeDasharray="4 4" strokeWidth={1.5} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        headers={['Mês', 'Geração (kWh)']}
        rows={data.map((d) => [d.month, fmtNumber(d.kwh)])}
      />
    </ChartCard>
  );
}

// ---------- Irradiance ----------

const IRRADIANCE_SERIES = [
  { key: 'h0', name: 'Topo da atmosfera (pela latitude)', color: 'var(--series-1)' },
  { key: 'clear', name: 'Céu claro (NASA)', color: 'var(--series-2)' },
  { key: 'ghi', name: 'Horizontal, céu real', color: 'var(--series-3)' },
  { key: 'plane', name: 'No plano dos painéis', color: 'var(--series-4)' },
] as const;

export function IrradianceChart({
  h0,
  clearSky,
  ghi,
  plane,
  ghiSource,
}: {
  h0: number[];
  clearSky: (number | null)[] | null;
  ghi: number[];
  plane: number[];
  ghiSource: string;
}) {
  const hasClear = !!clearSky && clearSky.every((v) => v !== null);
  const series = IRRADIANCE_SERIES.filter((s) => s.key !== 'clear' || hasClear);
  const data = MONTH_LABELS.map((month, i) => ({
    month,
    h0: h0[i],
    clear: hasClear ? clearSky![i] : null,
    ghi: ghi[i],
    plane: plane[i],
  }));
  const tip: TooltipRender = (d) => ({
    title: `${d.month} · kWh/m²/dia`,
    rows: series.map((s) => ({ name: s.name, value: fmtNumber(d[s.key] as number, 2), color: s.color })),
  });
  return (
    <ChartCard
      title="Irradiação solar diária (kWh/m²/dia)"
      subtitle={`Média mensal. “No plano dos painéis” equivale às horas de sol pleno. Fonte do céu real: ${ghiSource}.`}
    >
      <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} />
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="month" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={[0, 'auto']} />
            <Tooltip content={<ChartTooltip render={tip} />} cursor={CROSSHAIR} />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ ...ACTIVE_DOT, fill: s.color }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        headers={['Mês', ...series.map((s) => s.name)]}
        rows={data.map((d) => [d.month, ...series.map((s) => fmtNumber(d[s.key] as number, 2))])}
      />
    </ChartCard>
  );
}

// ---------- Lifetime production ----------

export function LifetimeProductionChart({ years }: { years: YearResult[] }) {
  const data = years.map((y) => ({ label: String(y.calendarYear), kwh: y.productionKWh, year: y.year }));
  const first = years[0];
  const last = years.at(-1);
  const y = niceAxis(data.map((d) => d.kwh), axisNumber);
  const tip: TooltipRender = (d) => ({
    title: `${d.label} (ano ${d.year})`,
    rows: [{ name: 'gerados', value: `${fmtNumber(d.kwh as number)} kWh`, color: 'var(--series-1)' }],
  });
  return (
    <ChartCard
      title="Geração ao longo dos anos (kWh/ano)"
      subtitle={
        first && last
          ? `De ${fmtNumber(first.productionKWh)} kWh no 1º ano para ${fmtNumber(last.productionKWh)} kWh no ano ${last.year}, pela degradação dos módulos.`
          : undefined
      }
    >
      <div className="chart">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={56}
              domain={y.domain}
              ticks={y.ticks}
              tickFormatter={y.format}
            />
            <Tooltip content={<ChartTooltip render={tip} />} cursor={HOVER_CURSOR} />
            <Bar dataKey="kwh" fill="var(--series-1)" radius={BAR_RADIUS} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        headers={['Ano', 'Geração (kWh)', 'Preço (R$/kWh)', 'Economia', 'Custos O&M', 'Saldo acumulado']}
        rows={years.map((y) => [
          `${y.calendarYear} (${y.year})`,
          fmtNumber(y.productionKWh),
          fmtNumber(y.pricePerKWh, 3),
          fmtBRL(y.savings),
          fmtBRL(y.cost),
          fmtBRL(y.cumulative),
        ])}
      />
    </ChartCard>
  );
}

// ---------- Cash flow ----------

export function CashFlowChart({ years, investment, payback }: { years: YearResult[]; investment: number; payback: number | null }) {
  const data = [
    { year: 0, label: 'Início', cumulative: -investment },
    ...years.map((y) => ({ year: y.year, label: `Ano ${y.year}`, cumulative: y.cumulative })),
  ];
  const y = niceAxis(data.map((d) => d.cumulative), axisNumber);
  const tip: TooltipRender = (d) => ({
    title: String(d.label),
    rows: [{ name: 'saldo acumulado', value: fmtBRL(d.cumulative as number), color: 'var(--series-1)' }],
  });
  return (
    <ChartCard
      title="Retorno do investimento (R$ acumulados)"
      subtitle={
        payback !== null
          ? `Investimento de ${fmtBRL(investment)} se paga em ${fmtYears(payback)}.`
          : `Investimento de ${fmtBRL(investment)} não se paga no horizonte simulado.`
      }
    >
      <div className="chart">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="year"
              type="number"
              domain={[0, years.length]}
              tick={AXIS_TICK}
              axisLine={AXIS_LINE}
              tickLine={false}
              tickFormatter={(v: number) => `${v}`}
              allowDecimals={false}
            />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={64}
              domain={y.domain}
              ticks={y.ticks}
              tickFormatter={y.format}
            />
            <Tooltip content={<ChartTooltip render={tip} />} cursor={CROSSHAIR} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            {payback !== null && (
              <ReferenceLine
                x={payback}
                stroke="var(--text-muted)"
                strokeDasharray="4 4"
                label={{ value: 'retorno', position: 'insideTopLeft', fill: 'var(--text-secondary)', fontSize: 12 }}
              />
            )}
            <Area
              dataKey="cumulative"
              type="monotone"
              stroke="var(--series-1)"
              strokeWidth={2}
              fill="var(--series-1)"
              fillOpacity={0.1}
              activeDot={{ ...ACTIVE_DOT, fill: 'var(--series-1)' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="source">Eixo horizontal: anos de operação.</p>
    </ChartCard>
  );
}

// ---------- Tariff history ----------

export function TariffHistoryChart({ history, distributor }: { history: TariffPoint[]; distributor: string }) {
  const data = history.map((p) => ({ date: p.start, total: p.total, resolution: p.resolution }));
  const y = niceAxis(data.map((d) => d.total), (v) => fmtNumber(v, 2));
  const tip: TooltipRender = (d) => ({
    title: `Desde ${fmtDate(String(d.date))}`,
    rows: [
      { name: 'TUSD + TE, sem impostos', value: fmtBRL(d.total as number, 4), color: 'var(--series-1)' },
      ...(d.resolution ? [{ name: String(d.resolution), value: '' }] : []),
    ],
  });
  return (
    <ChartCard
      title={`Histórico da tarifa residencial — ${distributor} (R$/kWh)`}
      subtitle="Tarifas de aplicação homologadas pela ANEEL, subgrupo B1 convencional, sem tributos nem bandeiras."
    >
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              axisLine={AXIS_LINE}
              tickLine={false}
              tickFormatter={(v: string) => v.slice(0, 4)}
              minTickGap={24}
            />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={48}
              domain={y.domain}
              ticks={y.ticks}
              tickFormatter={y.format}
            />
            <Tooltip content={<ChartTooltip render={tip} />} cursor={CROSSHAIR} />
            <Line
              dataKey="total"
              type="stepAfter"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ ...ACTIVE_DOT, fill: 'var(--series-1)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        headers={['Início da vigência', 'TUSD', 'TE', 'Total (R$/kWh)', 'Resolução']}
        rows={[...history].reverse().map((p) => [fmtDate(p.start), fmtNumber(p.tusd, 4), fmtNumber(p.te, 4), fmtNumber(p.total, 4), p.resolution])}
      />
    </ChartCard>
  );
}
