import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCkanRecords } from './ckan';

afterEach(() => vi.unstubAllGlobals());
const record = (_id: number, date = '2026-10-31') => ({ _id, DatGeracaoConjuntoDados: date });
function response(records: unknown[], total: number) {
  return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ success: true, result: { records, total } }) };
}

describe('complete ANEEL snapshots', () => {
  it('paginates until the declared total even when the server caps page size', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([record(1)], 3))
      .mockResolvedValueOnce(response([record(2), record(3)], 3));
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchCkanRecords('resource', { DscSubGrupo: 'B1' })).toHaveLength(3);
    const second = new URL(fetcher.mock.calls[1][0]);
    expect(second.searchParams.get('offset')).toBe('1');
    expect(second.searchParams.get('sort')).toBe('_id asc');
  });

  it.each(['truncated', 'duplicate', 'changed_total', 'changed_version'])('rejects a %s snapshot', async (failure) => {
    const last = failure === 'truncated' ? [] : [record(failure === 'duplicate' ? 1 : 2, failure === 'changed_version' ? '2026-11-01' : '2026-10-31')];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([record(1)], 2))
      .mockResolvedValueOnce(response(last, failure === 'changed_total' ? 3 : 2)));
    await expect(fetchCkanRecords('resource')).rejects.toThrow('ANEEL:');
  });

  it('passes multi-value metric filters and keeps audit fields when reducing the payload', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([record(1)], 1));
    vi.stubGlobal('fetch', fetcher);
    await fetchCkanRecords('resource', { metric: ['energy', 'revenue'] }, undefined, 20000, ['VlrMercado']);
    const params = new URL(fetcher.mock.calls[0][0]).searchParams;
    expect(JSON.parse(params.get('filters')!)).toEqual({ metric: ['energy', 'revenue'] });
    expect(params.get('fields')).toBe('_id,DatGeracaoConjuntoDados,VlrMercado');
  });
});
