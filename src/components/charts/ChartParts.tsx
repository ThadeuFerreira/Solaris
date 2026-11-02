import type { ReactNode } from 'react';
import type { TooltipRender } from './chartTheme';

interface ChartTooltipProps {
  render: TooltipRender;
  // Injected by Recharts when the element is passed as `content`.
  active?: boolean;
  payload?: readonly { payload?: Record<string, unknown> }[];
}

/**
 * Tooltip body: the value leads, the series name follows, keyed with a short
 * line in the series colour.
 */
export function ChartTooltip({ active, payload, render }: ChartTooltipProps) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  const { title, rows } = render(datum);
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{title}</div>
      {rows.map((r) => (
        <div className="tt-row" key={r.name}>
          {r.color && <span className="tt-key" style={{ background: r.color }} />}
          <span className="tt-value">{r.value}</span>
          <span className="tt-name">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.name}>
          {i.dashed ? (
            <span className="key-dash" style={{ borderTopColor: i.color }} />
          ) : (
            <span className="key-line" style={{ background: i.color }} />
          )}
          {i.name}
        </li>
      ))}
    </ul>
  );
}

export function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <details className="data-table">
      <summary>Ver dados em tabela</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="card chart-card">
      <h3>{title}</h3>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}
