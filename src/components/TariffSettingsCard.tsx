import { FLAG_DATASET_URL, TARIFF_DATASET_URL, type DistributorTariff, type FlagStatus } from '../api/aneel';
import type { AsyncState } from '../hooks/useAsync';
import { fmtBRL, fmtDate, fmtMonthYear, fmtNumber, fmtPct } from '../lib/format';
import type { TariffSettings } from '../model';
import { Check, NumberField, Section } from './controls';

export interface Pricing {
  source: 'aneel' | 'manual' | 'example';
  tariff: DistributorTariff | null;
  /** R$/kWh before taxes (TUSD + TE). */
  baseTariff: number | null;
  flagSurcharge: number;
  taxRate: number;
  icmsPct: number;
  finalPrice: number;
  /** Yearly tariff trend from ANEEL history. */
  trend: number | null;
}

const FLAG_COLORS: Record<string, string> = {
  Verde: 'var(--good)',
  Amarela: 'var(--warning)',
  'Vermelha P1': 'var(--serious)',
  'Vermelha P2': 'var(--critical)',
  'Escassez hídrica': 'var(--critical)',
};

interface Props {
  settings: TariffSettings;
  onChange: (patch: Partial<TariffSettings>) => void;
  tariffs: AsyncState<DistributorTariff[]> & { retry: () => void };
  flag: AsyncState<FlagStatus> & { retry: () => void };
  pricing: Pricing;
  placeLabel: string | null;
}

export function TariffSettingsCard({ settings, onChange, tariffs, flag, pricing, placeLabel }: Props) {
  const list = tariffs.data ?? [];
  const current = pricing.tariff?.current;
  const manual = settings.manualPrice !== null;

  return (
    <Section title="Tarifa de energia" note={`${fmtBRL(pricing.finalPrice, 2)}/kWh`}>
      {tariffs.status === 'loading' && !tariffs.data && <p className="notice">Carregando tarifas homologadas da ANEEL…</p>}
      {tariffs.status === 'error' && (
        <div className="notice notice-error notice-row">
          <span>Não foi possível consultar a ANEEL ({tariffs.error}). Informe a tarifa da sua conta de luz abaixo.</span>
          <button type="button" className="btn btn-small" onClick={tariffs.retry}>
            Tentar de novo
          </button>
        </div>
      )}

      {list.length > 0 && (
        <label className="field">
          <span>Distribuidora{placeLabel ? ` (local: ${placeLabel})` : ''}</span>
          <select
            value={settings.distributor ?? ''}
            onChange={(e) => onChange({ distributor: e.target.value || null, distributorPinned: true })}
          >
            <option value="">Selecione…</option>
            {list.map((t) => (
              <option key={t.distributor} value={t.distributor}>
                {t.distributor}
              </option>
            ))}
          </select>
        </label>
      )}

      {current && (
        <dl className="kv">
          <dt>TUSD (uso da rede)</dt>
          <dd>{fmtBRL(current.tusd, 4)}</dd>
          <dt>TE (energia)</dt>
          <dd>{fmtBRL(current.te, 4)}</dd>
          <dt>Tarifa B1 residencial, sem impostos</dt>
          <dd>{fmtBRL(current.total, 4)}</dd>
          {settings.includeFlag && pricing.flagSurcharge > 0 && (
            <>
              <dt>Adicional da bandeira</dt>
              <dd>{fmtBRL(pricing.flagSurcharge, 4)}</dd>
            </>
          )}
          <dt>Impostos (ICMS {fmtNumber(pricing.icmsPct, 1)}% + PIS/COFINS)</dt>
          <dd>{fmtPct(pricing.taxRate)}</dd>
          <dt className="total">Preço final estimado</dt>
          <dd className="total">{fmtBRL(pricing.finalPrice, 3)}/kWh</dd>
        </dl>
      )}
      {current && (
        <p className="source">
          {current.resolution || 'Resolução homologatória'} · vigência {fmtDate(current.start)}
          {current.end ? ` a ${fmtDate(current.end)}` : ''} ·{' '}
          <a href={TARIFF_DATASET_URL} target="_blank" rel="noreferrer">
            ANEEL Dados Abertos
          </a>
        </p>
      )}

      <div className="field-grid">
        <NumberField
          label="ICMS"
          unit="%"
          min={0}
          max={40}
          value={pricing.icmsPct}
          onChange={(v) => onChange({ icmsPct: v })}
        />
        <NumberField
          label="PIS/COFINS"
          unit="%"
          min={0}
          max={15}
          value={settings.pisCofinsPct}
          onChange={(v) => v !== null && onChange({ pisCofinsPct: v })}
        />
      </div>
      <p className="hint">
        As tarifas da ANEEL não incluem tributos. O ICMS padrão é a alíquota modal do estado e o PIS/COFINS varia mês a mês —
        confira na sua conta de luz.
      </p>

      <div className="field">
        {flag.data ? (
          <Check checked={settings.includeFlag} onChange={(includeFlag) => onChange({ includeFlag })}>
            <span className="status-dot" style={{ background: FLAG_COLORS[flag.data.name] }} aria-hidden />
            Bandeira <strong>{flag.data.rawName || flag.data.name}</strong> em {fmtMonthYear(flag.data.month)}
            {flag.data.surcharge > 0 ? ` (+${fmtBRL(flag.data.surcharge * 100, 2)} a cada 100 kWh)` : ''} — incluir no
            preço
          </Check>
        ) : flag.status === 'error' ? (
          <div className="notice notice-row">
            <span>Bandeira tarifária indisponível ({flag.error}).</span>
            <button type="button" className="btn btn-small" onClick={flag.retry}>
              Tentar de novo
            </button>
          </div>
        ) : (
          <p className="hint">Consultando bandeira tarifária…</p>
        )}
        {flag.data && (
          <p className="source">
            <a href={FLAG_DATASET_URL} target="_blank" rel="noreferrer">
              ANEEL — Bandeiras tarifárias
            </a>
            {!flag.data.surchargeFromApi && ' · adicional pelos valores vigentes desde 2025'}
          </p>
        )}
      </div>

      <Check
        checked={manual}
        onChange={(on) => onChange({ manualPrice: on ? Number(pricing.finalPrice.toFixed(3)) : null })}
      >
        Informar o preço final do kWh manualmente
      </Check>
      {manual && (
        <NumberField
          label="Preço final (com impostos)"
          unit="R$/kWh"
          min={0.05}
          max={5}
          step={0.01}
          value={settings.manualPrice}
          onChange={(v) => v !== null && onChange({ manualPrice: v })}
        />
      )}
      {pricing.source === 'example' && (
        <p className="notice notice-warning">
          Usando {fmtBRL(pricing.finalPrice, 2)}/kWh como valor de exemplo até a tarifa ser carregada ou informada.
        </p>
      )}
    </Section>
  );
}
