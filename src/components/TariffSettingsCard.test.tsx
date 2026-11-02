import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TARIFF_SETTINGS } from '../model';
import { TariffSettingsCard, type Pricing } from './TariffSettingsCard';

describe('distributor selection without ANEEL', () => {
  it('keeps the selector and saved distributor visible, without presenting an example as an official tariff', () => {
    const pricing: Pricing = {
      source: 'example', tariff: null, baseTariff: null, flagSurcharge: 0,
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
});
