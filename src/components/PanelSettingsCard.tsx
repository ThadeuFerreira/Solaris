import { CUSTOM_PANEL_ID, PANELS, type PanelModel } from '../data/panels';
import { compassName, fmtNumber } from '../lib/format';
import type { LayoutPlan } from '../lib/simulate';
import type { PanelSettings } from '../model';
import { Check, NumberField, Section, Segmented } from './controls';

const COMPASS = [
  { label: 'N', deg: 0 },
  { label: 'NE', deg: 45 },
  { label: 'L', deg: 90 },
  { label: 'SE', deg: 135 },
  { label: 'S', deg: 180 },
  { label: 'SO', deg: 225 },
  { label: 'O', deg: 270 },
  { label: 'NO', deg: 315 },
];


interface Props {
  settings: PanelSettings;
  onChange: (patch: Partial<PanelSettings>) => void;
  panel: PanelModel;
  plan: LayoutPlan | null;
  suggestedPanels: number | null;
}

export function PanelSettingsCard({ settings, onChange, panel, plan, suggestedPanels }: Props) {
  const isCustom = settings.panelId === CUSTOM_PANEL_ID;
  return (
    <Section title="Painéis e instalação" note={`${panel.powerW} W · ${fmtNumber(panel.efficiencyPct, 1)}%`}>
      <label className="field">
        <span>Modelo do módulo</span>
        <select value={settings.panelId} onChange={(e) => onChange({ panelId: e.target.value })}>
          {PANELS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.brand} — {p.model}
            </option>
          ))}
          <option value={CUSTOM_PANEL_ID}>Personalizado…</option>
        </select>
      </label>
      {isCustom ? (
        <div className="field-grid">
          <NumberField
            label="Potência"
            unit="W"
            min={50}
            max={1000}
            value={settings.custom.powerW}
            onChange={(v) => v !== null && onChange({ custom: { ...settings.custom, powerW: v } })}
          />
          <NumberField
            label="Comprimento"
            unit="m"
            min={0.3}
            max={3}
            step={0.001}
            value={settings.custom.lengthM}
            onChange={(v) => v !== null && onChange({ custom: { ...settings.custom, lengthM: v } })}
          />
          <NumberField
            label="Largura"
            unit="m"
            min={0.3}
            max={2}
            step={0.001}
            value={settings.custom.widthM}
            onChange={(v) => v !== null && onChange({ custom: { ...settings.custom, widthM: v } })}
          />
        </div>
      ) : (
        <p className="hint">
          {fmtNumber(panel.lengthM, 3)} × {fmtNumber(panel.widthM, 3)} m · coef. temp. {fmtNumber(panel.tempCoeffPct, 2)}
          %/°C · degradação {fmtNumber(panel.degradationFirstYearPct, 1)}% no 1º ano e{' '}
          {fmtNumber(panel.degradationAnnualPct, 2)}%/ano.{' '}
          {panel.datasheetUrl && (
            <a href={panel.datasheetUrl} target="_blank" rel="noreferrer">
              Datasheet
            </a>
          )}
          {panel.note && <> {panel.note}</>}
        </p>
      )}

      <div className="field-grid">
        <Segmented
          label="Montagem"
          value={settings.mounting}
          options={[
            { value: 'flush', label: 'Telhado' },
            { value: 'rack', label: 'Laje / solo' },
          ]}
          onChange={(mounting) => onChange({ mounting, autoTilt: mounting === 'rack' })}
        />
        <Segmented
          label="Posição"
          value={settings.orientation}
          options={[
            { value: 'portrait', label: 'Retrato' },
            { value: 'landscape', label: 'Paisagem' },
          ]}
          onChange={(orientation) => onChange({ orientation })}
        />
      </div>

      <div className="field">
        <span>
          Direção para onde os painéis apontam
          {plan && (
            <>
              : <strong>{compassName(plan.azimuthDeg)}</strong> ({fmtNumber(plan.azimuthDeg)}°)
            </>
          )}
        </span>
        <div className="compass" role="group" aria-label="Azimute">
          {COMPASS.map((c) => (
            <button
              key={c.label}
              type="button"
              aria-pressed={settings.azimuthDeg === c.deg}
              onClick={() => onChange({ azimuthDeg: c.deg })}
              title={compassName(c.deg)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="field-grid">
          <NumberField
            label="Azimute exato"
            unit="°"
            min={0}
            max={359}
            nullable
            placeholder="automático"
            value={settings.azimuthDeg}
            onChange={(v) => onChange({ azimuthDeg: v })}
          />
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn"
              aria-pressed={settings.azimuthDeg === null}
              onClick={() => onChange({ azimuthDeg: null })}
            >
              {settings.azimuthDeg === null ? '✓ Alinhado à borda' : 'Alinhar à borda'}
            </button>
          </div>
        </div>
        <p className="hint">
          “Alinhar à borda” usa a face perpendicular ao maior lado desenhado, voltada para o Norte. No Brasil, painéis
          voltados ao Norte produzem mais.
        </p>
      </div>

      <div className="field-grid">
        <NumberField
          label={settings.mounting === 'flush' ? 'Inclinação do telhado' : 'Inclinação da estrutura'}
          unit="°"
          min={0}
          max={60}
          value={plan && settings.mounting === 'rack' && settings.autoTilt ? plan.tiltDeg : settings.tiltDeg}
          onChange={(v) => v !== null && onChange({ tiltDeg: v, autoTilt: false })}
        />
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          {settings.mounting === 'rack' ? (
            <Check checked={settings.autoTilt} onChange={(autoTilt) => onChange({ autoTilt })}>
              Usar ângulo ótimo{plan ? ` (${plan.optimalTiltDeg}°)` : ''}
            </Check>
          ) : (
            plan && (
              <button type="button" className="btn btn-small" onClick={() => onChange({ tiltDeg: plan.optimalTiltDeg })}>
                Ótimo: {plan.optimalTiltDeg}°
              </button>
            )
          )}
        </div>
        <NumberField
          label="Recuo das bordas"
          unit="m"
          min={0}
          max={5}
          step={0.05}
          value={settings.setbackM}
          onChange={(v) => v !== null && onChange({ setbackM: v })}
        />
        <NumberField
          label="Espaço entre painéis"
          unit="m"
          min={0}
          max={1}
          step={0.01}
          value={settings.gapM}
          onChange={(v) => v !== null && onChange({ gapM: v })}
        />
      </div>
      {settings.mounting === 'rack' && plan && (
        <p className="hint">
          Fileiras espaçadas em {fmtNumber(plan.rowGapM, 2)} m para evitar sombreamento entre 9h e 15h no solstício de
          inverno.
        </p>
      )}

      <div className="field-grid">
        <NumberField
          label="Limitar quantidade"
          unit="painéis"
          min={0}
          step={1}
          nullable
          placeholder={plan ? `máx. ${plan.fittedCount}` : 'sem limite'}
          value={settings.maxPanels}
          onChange={(v) => onChange({ maxPanels: v === null ? null : Math.round(v) })}
        />
        <NumberField
          label="Perdas do sistema"
          unit="%"
          min={0}
          max={50}
          value={settings.systemLossesPct}
          onChange={(v) => v !== null && onChange({ systemLossesPct: v })}
        />
      </div>
      {suggestedPanels !== null && (
        <div className="notice notice-row">
          <span>
            Para cobrir seu consumo: <strong>{suggestedPanels} painéis</strong>
          </span>
          <button type="button" className="btn btn-small" onClick={() => onChange({ maxPanels: suggestedPanels })}>
            Aplicar
          </button>
        </div>
      )}
      <p className="hint">Perdas incluem sujeira, cabos, inversor e descasamento; o efeito da temperatura é calculado à parte.</p>
    </Section>
  );
}
