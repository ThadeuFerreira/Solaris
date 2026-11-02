import { fetchJson } from './http';

export type CkanRecord = Record<string, unknown>;
interface Page {
  success: boolean;
  result: { records: CkanRecord[]; total: number };
}

/** Fetch a complete, consistently ordered snapshot; never accept a partial page set. */
export async function fetchCkanRecords(
  resourceId: string,
  filters: Record<string, string | string[]> = {},
  signal?: AbortSignal,
  pageSize = 5000,
  fields?: string[],
): Promise<CkanRecord[]> {
  const records: CkanRecord[] = [];
  const ids = new Set<unknown>();
  let expectedTotal: number | undefined;
  let generation: unknown;
  for (let offset = 0; ; ) {
    const params = new URLSearchParams({
      resource_id: resourceId, filters: JSON.stringify(filters), sort: '_id asc',
      limit: String(pageSize), offset: String(offset),
    });
    if (fields) params.set('fields', [...new Set(['_id', 'DatGeracaoConjuntoDados', ...fields])].join(','));
    const data = await fetchJson<Page>(`https://dadosabertos.aneel.gov.br/api/3/action/datastore_search?${params}`, {
      signal, timeoutMs: 30000,
    });
    if (!data.success || !Array.isArray(data.result?.records) || !Number.isSafeInteger(data.result.total) || data.result.total < 0) {
      throw new Error('ANEEL: resposta de paginação inválida');
    }
    const { total, records: page } = data.result;
    expectedTotal ??= total;
    if (total !== expectedTotal) throw new Error('ANEEL: base mudou durante a coleta; repita a carga');
    for (const row of page) {
      if (row._id === undefined || ids.has(row._id)) throw new Error('ANEEL: paginação contém registros repetidos ou sem ID');
      ids.add(row._id);
      generation ??= row.DatGeracaoConjuntoDados;
      if (row.DatGeracaoConjuntoDados !== generation) throw new Error('ANEEL: versões distintas na mesma coleta');
    }
    records.push(...page);
    offset += page.length;
    if (offset === total) return records;
    if (!page.length || offset > total) throw new Error('ANEEL: carga incompleta');
  }
}
