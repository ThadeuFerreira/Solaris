import { useEffect, useRef, useState } from 'react';
import { fmtBRL, fmtNumber } from '../lib/format';
import type { LayoutPlan, Simulation } from '../lib/simulate';
import type { FinanceSettings } from '../model';

export type DetailView =
  | 'none'
  | 'panels'
  | 'tariffs'
  | 'finance'
  | 'metrics'
  | 'charts'
  | 'methodology'
  | 'all';

interface TopBarProps {
  sim: Simulation | null;
  plan: LayoutPlan | null;
  financeSettings: FinanceSettings;
  onUpdateFinance: (patch: Partial<FinanceSettings>) => void;
  detailView: DetailView;
  onSelectDetailView: (view: DetailView) => void;
}

const VIEW_LABELS: Record<DetailView, string> = {
  none: '',
  panels: 'Painéis e Instalação',
  tariffs: 'Tarifa de Energia',
  finance: 'Consumo e Investimento',
  metrics: 'Métricas e Sol',
  charts: 'Gráficos de Produção',
  methodology: 'Metodologia',
  all: 'Todos os Detalhes',
};

export function TopBar({
  sim,
  plan,
  financeSettings,
  onUpdateFinance,
  detailView,
  onSelectDetailView,
}: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Panel metrics
  const panelCount = sim?.usedCount ?? plan?.fittedCount ?? 0;
  const panelCountDisplay = panelCount > 0 ? `${panelCount} ${panelCount === 1 ? 'painel' : 'painéis'}` : '0 painéis';
  const panelCountSub = sim
    ? `${fmtNumber(sim.kWp, 2)} kWp · ${fmtNumber(sim.panelAreaM2, 1)} m² de módulos`
    : plan
      ? `Área: ${fmtNumber(plan.areaM2, 1)} m²`
      : 'Desenhe no mapa';

  // Money generated metrics
  const firstYear = sim?.finance.years[0];
  const monthlySavings = firstYear ? firstYear.savings / 12 : 0;
  const moneyDisplay = monthlySavings > 0 ? `${fmtBRL(monthlySavings)} / mês` : 'R$ 0,00';
  const moneySub = firstYear
    ? `${fmtBRL(firstYear.savings)} no 1º ano · ${fmtBRL(sim?.finance.totalSavings ?? 0)} em ${financeSettings.years} anos`
    : 'Economia estimada';

  const selectView = (view: DetailView) => {
    onSelectDetailView(view);
    setDropdownOpen(false);
  };

  return (
    <div className="top-metrics-bar" aria-label="Métricas e configurações principais">
      {/* 1. Quantidade de Painéis */}
      <div
        className="top-metric-card top-metric-interactive"
        onClick={() => onSelectDetailView('panels')}
        title="Clique para configurar painéis e instalação"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectDetailView('panels');
          }
        }}
      >
        <div className="top-metric-icon top-metric-icon-sun" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </div>
        <div className="top-metric-content">
          <span className="top-metric-label">Quantidade de Painéis</span>
          <span className="top-metric-value">{panelCountDisplay}</span>
          <span className="top-metric-sub">{panelCountSub}</span>
        </div>
      </div>

      {/* 2. Dinheiro Gerado */}
      <div
        className="top-metric-card top-metric-interactive"
        onClick={() => onSelectDetailView('finance')}
        title="Clique para ver detalhes de economia e investimento"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectDetailView('finance');
          }
        }}
      >
        <div className="top-metric-icon top-metric-icon-money" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 6v12" />
          </svg>
        </div>
        <div className="top-metric-content">
          <span className="top-metric-label">Dinheiro Gerado</span>
          <span className="top-metric-value">{moneyDisplay}</span>
          <span className="top-metric-sub">{moneySub}</span>
        </div>
      </div>

      {/* 3. Consumo Atual */}
      <div className="top-metric-card top-metric-consumption">
        <div className="top-metric-icon top-metric-icon-bolt" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <div className="top-metric-content">
          <label htmlFor="top-consumption-input" className="top-metric-label">
            Consumo Atual
          </label>
          <div className="top-consumption-box">
            <input
              id="top-consumption-input"
              type="number"
              min="0"
              max="100000"
              step="10"
              placeholder="0"
              className="top-consumption-input"
              value={financeSettings.monthlyConsumptionKWh || ''}
              onChange={(e) => {
                const val = e.target.value === '' ? 0 : Math.max(0, Number(e.target.value) || 0);
                onUpdateFinance({ monthlyConsumptionKWh: val });
              }}
            />
            <span className="top-consumption-unit">kWh/mês</span>
          </div>
          <span className="top-metric-sub">
            {financeSettings.monthlyConsumptionKWh > 0 ? 'Abatimento na conta' : 'Informe o consumo da sua conta'}
          </span>
        </div>
      </div>

      {/* 4. Dropdown Menu: Mais Detalhes - Configure */}
      <div className="top-dropdown-container" ref={dropdownRef}>
        <div className="top-dropdown-row">
          <button
            type="button"
            className={`btn btn-configure-dropdown ${detailView !== 'none' ? 'btn-configure-active' : ''}`}
            onClick={() => setDropdownOpen((open) => !open)}
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
            id="configure-dropdown-button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="btn-configure-text">
              {detailView !== 'none' ? `Mais Detalhes - Configure (${VIEW_LABELS[detailView]})` : 'Mais Detalhes - Configure'}
            </span>
            <svg
              className={`dropdown-chevron ${dropdownOpen ? 'chevron-rotated' : ''}`}
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Synced native select for keyboard accessibility & automation */}
          <select
            id="configure-dropdown-select"
            aria-label="Mais Detalhes - Configure"
            className="dropdown-configure-native-select"
            value={detailView}
            onChange={(e) => selectView(e.target.value as DetailView)}
          >
            <option value="none">Mais Detalhes - Configure</option>
            <optgroup label="Configurações">
              <option value="panels">Painéis e Instalação</option>
              <option value="tariffs">Tarifa de Energia</option>
              <option value="finance">Consumo e Investimento</option>
            </optgroup>
            <optgroup label="Mais Detalhes">
              <option value="metrics">Métricas Detalhadas e Sol</option>
              <option value="charts">Gráficos de Produção e Retorno</option>
              <option value="methodology">Metodologia</option>
            </optgroup>
            <optgroup label="Visualização">
              <option value="all">Exibir Todos os Detalhes</option>
              <option value="none">Ocultar Detalhes (Visão Simplificada)</option>
            </optgroup>
          </select>

          {detailView !== 'none' && (
            <button
              type="button"
              className="btn btn-small btn-close-pill"
              onClick={() => onSelectDetailView('none')}
              title="Voltar à visão simplificada"
            >
              ✕ Fechar
            </button>
          )}
        </div>

        {dropdownOpen && (
          <div className="dropdown-menu-popover" role="menu" aria-orientation="vertical">
            <div className="dropdown-group-header">Configurações</div>
            <button
              type="button"
              className={`dropdown-menu-item ${detailView === 'panels' ? 'active' : ''}`}
              onClick={() => selectView('panels')}
              role="menuitem"
            >
              <span className="dropdown-item-icon" aria-hidden="true">⚙️</span>
              <div className="dropdown-item-text">
                <strong>Painéis e Instalação</strong>
                <span>Modelo, telhado/solo, inclinação e perdas</span>
              </div>
              {detailView === 'panels' && <span className="dropdown-item-check" aria-hidden="true">✓</span>}
            </button>
            <button
              type="button"
              className={`dropdown-menu-item ${detailView === 'tariffs' ? 'active' : ''}`}
              onClick={() => selectView('tariffs')}
              role="menuitem"
            >
              <span className="dropdown-item-icon" aria-hidden="true">⚡</span>
              <div className="dropdown-item-text">
                <strong>Tarifa de Energia</strong>
                <span>Distribuidora, ANEEL, ICMS e bandeira tarifária</span>
              </div>
              {detailView === 'tariffs' && <span className="dropdown-item-check" aria-hidden="true">✓</span>}
            </button>
            <button
              type="button"
              className={`dropdown-menu-item ${detailView === 'finance' ? 'active' : ''}`}
              onClick={() => selectView('finance')}
              role="menuitem"
            >
              <span className="dropdown-item-icon" aria-hidden="true">💰</span>
              <div className="dropdown-item-text">
                <strong>Consumo e Investimento</strong>
                <span>Custo por Wp, ligação, reajuste e Lei 14.300</span>
              </div>
              {detailView === 'finance' && <span className="dropdown-item-check" aria-hidden="true">✓</span>}
            </button>

            <div className="dropdown-divider" />
            <div className="dropdown-group-header">Mais Detalhes</div>
            <button
              type="button"
              className={`dropdown-menu-item ${detailView === 'metrics' ? 'active' : ''}`}
              onClick={() => selectView('metrics')}
              role="menuitem"
            >
              <span className="dropdown-item-icon" aria-hidden="true">📊</span>
              <div className="dropdown-item-text">
                <strong>Métricas Detalhadas e Sol</strong>
                <span>Área, produtividade, payback e dados solares</span>
              </div>
              {detailView === 'metrics' && <span className="dropdown-item-check" aria-hidden="true">✓</span>}
            </button>
            <button
              type="button"
              className={`dropdown-menu-item ${detailView === 'charts' ? 'active' : ''}`}
              onClick={() => selectView('charts')}
              role="menuitem"
            >
              <span className="dropdown-item-icon" aria-hidden="true">📈</span>
              <div className="dropdown-item-text">
                <strong>Gráficos de Produção e Retorno</strong>
                <span>Geração mensal, irradiação e fluxo de caixa</span>
              </div>
              {detailView === 'charts' && <span className="dropdown-item-check" aria-hidden="true">✓</span>}
            </button>
            <button
              type="button"
              className={`dropdown-menu-item ${detailView === 'methodology' ? 'active' : ''}`}
              onClick={() => selectView('methodology')}
              role="menuitem"
            >
              <span className="dropdown-item-icon" aria-hidden="true">📐</span>
              <div className="dropdown-item-text">
                <strong>Metodologia de Cálculo</strong>
                <span>Fórmulas matemáticas e fontes de dados</span>
              </div>
              {detailView === 'methodology' && <span className="dropdown-item-check" aria-hidden="true">✓</span>}
            </button>

            <div className="dropdown-divider" />
            <div className="dropdown-group-header">Visualização</div>
            <button
              type="button"
              className={`dropdown-menu-item ${detailView === 'all' ? 'active' : ''}`}
              onClick={() => selectView('all')}
              role="menuitem"
            >
              <span className="dropdown-item-icon" aria-hidden="true">📋</span>
              <div className="dropdown-item-text">
                <strong>Exibir Todos os Detalhes</strong>
                <span>Abrir todas as configurações e gráficos juntos</span>
              </div>
              {detailView === 'all' && <span className="dropdown-item-check" aria-hidden="true">✓</span>}
            </button>
            {detailView !== 'none' && (
              <button
                type="button"
                className="dropdown-menu-item dropdown-menu-item-reset"
                onClick={() => selectView('none')}
                role="menuitem"
              >
                <span className="dropdown-item-icon" aria-hidden="true">✕</span>
                <div className="dropdown-item-text">
                  <strong>Ocultar Detalhes (Visão Simplificada)</strong>
                  <span>Manter apenas o mapa e métricas do topo</span>
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
