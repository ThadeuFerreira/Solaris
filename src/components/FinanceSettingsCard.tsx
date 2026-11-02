import { fmtNumber, fmtPct } from '../lib/format';
import type { Connection, FinanceSettings } from '../model';
import { MINIMUM_BILL_KWH } from '../model';
import { Check, NumberField, Section, Segmented } from './controls';

interface Props {
  settings: FinanceSettings;
  onChange: (patch: Partial<FinanceSettings>) => void;
  trend: number | null;
  effectiveIncrease: number;
}

export function FinanceSettingsCard({ settings, onChange, trend, effectiveIncrease }: Props) {
  return (
    <Section title="Consumo e investimento" note={`R$ ${fmtNumber(settings.costPerWp, 2)}/Wp`}>
      <div className="field-grid">
        <NumberField
          label="Consumo médio mensal"
          unit="kWh"
          min={0}
          placeholder="opcional"
          nullable
          value={settings.monthlyConsumptionKWh || null}
          onChange={(v) => onChange({ monthlyConsumptionKWh: v ?? 0 })}
        />
        <Segmented<Connection>
          label="Ligação"
          value={settings.connection}
          options={[
            { value: 'mono', label: 'Mono' },
            { value: 'bi', label: 'Bi' },
            { value: 'tri', label: 'Tri' },
          ]}
          onChange={(connection) => onChange({ connection })}
        />
      </div>
      <p className="hint">
        Com o consumo informado, a economia considera só a energia que abate a conta: o custo de disponibilidade (
        {MINIMUM_BILL_KWH[settings.connection]} kWh) é sempre cobrado e o excedente vira crédito.
      </p>

      <div className="field-grid">
        <NumberField
          label="Custo do sistema instalado"
          unit="R$/Wp"
          min={0}
          max={20}
          step={0.05}
          value={settings.costPerWp}
          onChange={(v) => v !== null && onChange({ costPerWp: v })}
        />
        <NumberField
          label="Operação e manutenção"
          unit="%/ano"
          min={0}
          max={10}
          step={0.1}
          value={settings.omPct}
          onChange={(v) => v !== null && onChange({ omPct: v })}
        />
        <NumberField
          label="Reajuste anual da tarifa"
          unit="%"
          min={-5}
          max={30}
          step={0.1}
          nullable
          placeholder={fmtNumber(effectiveIncrease * 100, 1)}
          value={settings.tariffIncreasePct}
          onChange={(v) => onChange({ tariffIncreasePct: v })}
        />
        <NumberField
          label="Horizonte"
          unit="anos"
          min={1}
          max={40}
          step={1}
          value={settings.years}
          onChange={(v) => v !== null && onChange({ years: Math.round(v) })}
        />
      </div>
      <p className="hint">
        {settings.tariffIncreasePct === null
          ? trend !== null
            ? `Reajuste padrão: média histórica da distribuidora na ANEEL (${fmtPct(trend)} ao ano).`
            : 'Reajuste padrão de 5% ao ano (sem histórico da ANEEL disponível).'
          : 'Deixe em branco para usar a média histórica da ANEEL.'}{' '}
        O custo por Wp é uma referência de mercado — use o orçamento do seu instalador.
      </p>

      <Check checked={settings.applyFioB} onChange={(applyFioB) => onChange({ applyFioB })}>
        Aplicar regra de transição da Lei 14.300/2022 (cobrança gradual do Fio B sobre a energia injetada)
      </Check>
      {settings.applyFioB && (
        <div className="field-grid">
          <NumberField
            label="Fio B na tarifa"
            unit="%"
            min={0}
            max={80}
            value={settings.fioBSharePct}
            onChange={(v) => v !== null && onChange({ fioBSharePct: v })}
          />
          <NumberField
            label="Autoconsumo simultâneo"
            unit="%"
            min={0}
            max={100}
            value={settings.selfConsumptionPct}
            onChange={(v) => v !== null && onChange({ selfConsumptionPct: v })}
          />
        </div>
      )}
    </Section>
  );
}
