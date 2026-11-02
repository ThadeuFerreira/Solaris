import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TopBar } from './TopBar';
import { DEFAULT_FINANCE_SETTINGS } from '../model';

describe('TopBar', () => {
  it('renders default values with 0 paineis and R$ 0,00 when no simulation exists', () => {
    const html = renderToString(
      <TopBar
        sim={null}
        plan={null}
        financeSettings={DEFAULT_FINANCE_SETTINGS}
        onUpdateFinance={vi.fn()}
        detailView="none"
        onSelectDetailView={vi.fn()}
      />
    );

    expect(html).toContain('Quantidade de Painéis');
    expect(html).toContain('0 painéis');
    expect(html).toContain('Dinheiro Gerado');
    expect(html).toContain('R$ 0,00');
    expect(html).toContain('Consumo Atual');
    expect(html).toContain('Mais Detalhes - Configure');
  });

  it('renders custom consumption value in input', () => {
    const html = renderToString(
      <TopBar
        sim={null}
        plan={null}
        financeSettings={{ ...DEFAULT_FINANCE_SETTINGS, monthlyConsumptionKWh: 350 }}
        onUpdateFinance={vi.fn()}
        detailView="none"
        onSelectDetailView={vi.fn()}
      />
    );

    expect(html).toContain('value="350"');
    expect(html).toContain('kWh/mês');
  });

  it('renders active view label in button when detailView is set', () => {
    const html = renderToString(
      <TopBar
        sim={null}
        plan={null}
        financeSettings={DEFAULT_FINANCE_SETTINGS}
        onUpdateFinance={vi.fn()}
        detailView="panels"
        onSelectDetailView={vi.fn()}
      />
    );

    expect(html).toContain('Mais Detalhes - Configure (Painéis e Instalação)');
    expect(html).toContain('Fechar');
  });
});
