import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TARIFF_SETTINGS } from '../model';
import { TariffSettingsCard, type Pricing } from './TariffSettingsCard';
import { calculatePricing } from '../lib/pricing';

describe('distributor selection without ANEEL', () => {
  it('keeps the selector and saved distributor visible, without presenting an example as an official tariff', () => {
    const pricing: Pricing = {
      source: 'example', tariff: null, nationalAverage: null, baseTariff: null, flagSurcharge: 0,
      taxRate: 0.24, icmsPct: 19, finalPrice: 1, trend: null,
    };
    const html = renderToString(<TariffSettingsCard
      settings={{ ...DEFAULT_TARIFF_SETTINGS, distributor: 'MINHA DISTRIBUIDORA ANTIGA', distributorPinned: true }}
      onChange={vi.fn()}
      tariffs={{ status: 'error', error: 'timeout', retry: vi.fn() }}
      flag={{ status: 'error', error: 'timeout', retry: vi.fn() }}
      pricing={pricing}
      placeLabel={null}
    />);
    expect(html).toContain('Buscar distribuidora');
    expect(html).toContain('CEMIG-D');
    expect(html).toContain('MINHA DISTRIBUIDORA ANTIGA');
    expect(html).toContain('Tarifa vigente de');
    expect(html).toContain('valor de exemplo');
  });

  it('labels the national year and source and omits controls that would add taxes and flags again', () => {
    const settings = { ...DEFAULT_TARIFF_SETTINGS, distributor: 'TESTE' };
    const pricing = calculatePricing({ tariffs: [], settings, icmsPct: 19, flag: null, today: '2026-11-02', averages: [{
      referenceYear: 2024, price: 0.95, taxBasis: 'with_taxes', includesFlags: true, completeYear: true,
      dataThrough: '2024-12', methodology: 'test', sourceUrl: 'https://dadosabertos.aneel.gov.br/dataset/samp',
      sourceResourceId: 'r', sourceDate: '2026-10-15', fetchedAt: '2026-11-02T12:00:00Z',
    }] });
    const html = renderToString(<TariffSettingsCard settings={settings} pricing={pricing} onChange={vi.fn()}
      tariffs={{ status: 'error', error: 'timeout', retry: vi.fn() }} flag={{ status: 'error', error: 'timeout', retry: vi.fn() }} placeLabel={null} />).replace(/<!--.*?-->/g, '');
    expect(html).toContain('média nacional residencial de 2024');
    expect(html).toContain('ANEEL/SAMP');
    expect(html).toContain('já inclui impostos');
    expect(html).not.toContain('valor de exemplo');
    expect(html).not.toContain('Bandeira tarifária indisponível');
    expect(html).not.toContain('<span>ICMS</span>');
  });
});
