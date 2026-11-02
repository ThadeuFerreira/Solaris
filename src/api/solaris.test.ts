import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUNDLED_ANNUAL_TARIFFS, loadAnnualTariffs } from './solaris';

afterEach(() => vi.unstubAllGlobals());
describe('annual reference availability', () => {
  it('keeps the bundled national reference available when the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await loadAnnualTariffs()).toEqual(BUNDLED_ANNUAL_TARIFFS);
  });

  it('does not turn an explicit cancellation into a fallback response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')));
    await expect(loadAnnualTariffs()).rejects.toThrow('cancelled');
  });
});
