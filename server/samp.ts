import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fetchJson } from '../src/api/http';
import { fetchCkanRecords, type CkanRecord } from '../src/api/ckan';
import { SAMP_DATASET_URL, type AnnualTariffAverage } from '../src/api/samp';
import type { Store } from './db';

export const SAMP_METRICS = {
  energy: 'Energia TE (kWh)',
  revenue: 'Receita Energia (R$)',
  demand: 'Receita Demanda (R$)',
  excessDemand: 'Receita Ultrapassagem Demanda (R$)',
  flags: 'Receita Bandeiras (R$)',
  icms: 'ICMS (R$)',
  pis: 'PIS/PASEP (R$)',
  cofins: 'COFINS (R$)',
} as const;
export const SAMP_FILTERS = {
  DscClasseConsumoMercado: 'Residencial',
  DscOpcaoEnergia: 'CATIVO',
  DscDetalheMercado: Object.values(SAMP_METRICS),
};
const FIELDS = ['NumCNPJAgenteDistribuidora', 'DscClasseConsumoMercado', 'DscOpcaoEnergia',
  'DscDetalheMercado', 'DatCompetencia', 'VlrMercado'];
export const SAMP_METHODOLOGY = 'samp-residential-captive-v3: sum(Receita Energia + Receita Demanda + Receita Ultrapassagem Demanda [+ ICMS + PIS/PASEP + COFINS]) / sum(Energia TE); Receita Energia already includes flags, so Receita Bandeiras is not added; all modalities, subclasses and market types, including signed rebilling adjustments; nominal BRL/kWh; no double count of Energia TUSD or GD compensation; 12-month category coverage and distributor-month plausibility checks';

/** SAMP values have six decimal places. Accumulate exactly, including negative adjustments. */
function fixed(value: unknown): bigint {
  const match = String(value ?? '').trim().match(/^(-?)(\d*)(?:,(\d{0,6}))?$/);
  if (!match || (!match[2] && !match[3])) throw new Error(`SAMP: valor inválido (${String(value)})`);
  return (match[1] ? -1n : 1n) * (BigInt(match[2] || '0') * 1000000n + BigInt((match[3] ?? '').padEnd(6, '0')));
}

export function calculateSampAverages(records: CkanRecord[], year: number, resourceId: string, fetchedAt: string): AnnualTariffAverage[] {
  if (!records.length) throw new Error(`SAMP ${year}: recorte vazio`);
  const totals = new Map<string, bigint>();
  const coverage = new Map<string, Set<string>>();
  const ids = new Set<unknown>();
  const generations = new Set<string>();
  const monthly = new Map<string, Map<string, bigint>>();
  for (const row of records) {
    if (ids.has(row._id) || row._id === undefined) throw new Error('SAMP: ID repetido ou ausente');
    ids.add(row._id);
    if (row.DscClasseConsumoMercado !== 'Residencial' || row.DscOpcaoEnergia !== 'CATIVO') throw new Error('SAMP: recorte de mercado inválido');
    const metric = String(row.DscDetalheMercado);
    if (!(Object.values(SAMP_METRICS) as string[]).includes(metric)) throw new Error(`SAMP: métrica inesperada ${metric}`);
    const competence = String(row.DatCompetencia).slice(0, 10);
    if (!new RegExp(`^${year}-(0[1-9]|1[0-2])-01$`).test(competence)) throw new Error('SAMP: competência fora do ano');
    const generation = String(row.DatGeracaoConjuntoDados).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(generation)) throw new Error('SAMP: data de origem inválida');
    generations.add(generation);
    const value = fixed(row.VlrMercado);
    totals.set(metric, (totals.get(metric) ?? 0n) + value);
    const rawCnpj = String(row.NumCNPJAgenteDistribuidora ?? '');
    if (!/^\d{1,14}$/.test(rawCnpj) || /^0+$/.test(rawCnpj)) throw new Error('SAMP: distribuidora sem CNPJ válido');
    const key = `${rawCnpj.padStart(14, '0')}:${competence}`;
    if (!monthly.has(key)) monthly.set(key, new Map());
    const bucket = monthly.get(key)!;
    bucket.set(metric, (bucket.get(metric) ?? 0n) + value);
    if (!coverage.has(metric)) coverage.set(metric, new Set());
    coverage.get(metric)!.add(competence.slice(0, 7));
  }
  if (generations.size !== 1) throw new Error('SAMP: versões distintas no mesmo ano');
  for (const [key, bucket] of monthly) {
    const energy = bucket.get(SAMP_METRICS.energy) ?? 0n;
    const revenue = [SAMP_METRICS.revenue, SAMP_METRICS.demand, SAMP_METRICS.excessDemand]
      .reduce((sum, metric) => sum + (bucket.get(metric) ?? 0n), 0n);
    const taxes = [SAMP_METRICS.icms, SAMP_METRICS.pis, SAMP_METRICS.cofins]
      .reduce((sum, metric) => sum + (bucket.get(metric) ?? 0n), 0n);
    // Broad guards against source errors (e.g. a shifted decimal point). Do not
    // trim or correct individual observations: quarantine the entire year.
    if (energy > 0n && (revenue > energy * 3n || taxes > revenue)) {
      throw new Error(`SAMP ${year}: valores mensais inconsistentes em ${key}; ano não liberado para estimativas`);
    }
  }
  // A year missing any monthly energy/revenue or tax category must not become a fallback.
  const required = [SAMP_METRICS.energy, SAMP_METRICS.revenue, SAMP_METRICS.icms,
    ...(year >= 2006 ? [SAMP_METRICS.pis, SAMP_METRICS.cofins] : []),
    ...(year >= 2015 ? [SAMP_METRICS.flags] : [])];
  for (const metric of required) {
    if (coverage.get(metric)?.size !== 12) throw new Error(`SAMP ${year}: ano incompleto em ${metric}`);
  }
  const energy = totals.get(SAMP_METRICS.energy) ?? 0n;
  const revenue = [SAMP_METRICS.revenue, SAMP_METRICS.demand, SAMP_METRICS.excessDemand]
    .reduce((sum, key) => sum + (totals.get(key) ?? 0n), 0n);
  const taxes = [SAMP_METRICS.icms, SAMP_METRICS.pis, SAMP_METRICS.cofins]
    .reduce((sum, key) => sum + (totals.get(key) ?? 0n), 0n);
  if (energy <= 0n || revenue <= 0n || taxes < 0n) throw new Error('SAMP: totais de mercado inválidos');
  return (['without_taxes', 'with_taxes'] as const).map((taxBasis) => {
    const numerator = taxBasis === 'with_taxes' ? revenue + taxes : revenue;
    const microPrice = (numerator * 1000000n + energy / 2n) / energy;
    if (microPrice <= 0n || microPrice > 10000000n) throw new Error('SAMP: média fora do intervalo esperado');
    return {
      referenceYear: year, price: Number(microPrice) / 1e6, taxBasis, includesFlags: true,
      completeYear: true, dataThrough: `${year}-12`, methodology: SAMP_METHODOLOGY,
      sourceUrl: SAMP_DATASET_URL, sourceResourceId: resourceId,
      sourceDate: [...generations][0], fetchedAt,
    };
  });
}

interface Resource { id: string; name: string; datastore_active: boolean }
export async function collectSampAverages({ store, archiveDir, years, reuseArchives = false, log = () => {}, fetchRecords = fetchCkanRecords }: {
  store: Store; archiveDir: string; years?: number[]; reuseArchives?: boolean;
  log?: (message: string) => void; fetchRecords?: typeof fetchCkanRecords;
}): Promise<void> {
  const metadata = await fetchJson<{ success: boolean; result: { resources: Resource[] } }>(
    'https://dadosabertos.aneel.gov.br/api/3/action/package_show?id=samp', { timeoutMs: 30000 });
  if (!metadata.success) throw new Error('SAMP: catálogo indisponível');
  const currentYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 4));
  const resources = metadata.result.resources.map((resource) => ({ ...resource, year: Number(resource.name.match(/^samp-(\d{4})\.csv$/i)?.[1]) }))
    .filter((resource) => resource.datastore_active && resource.year >= 2003 && resource.year < currentYear && (!years || years.includes(resource.year)))
    .sort((a, b) => b.year - a.year);
  if (!resources.length || (years && resources.length !== new Set(years).size)) throw new Error('SAMP: anos solicitados indisponíveis');
  const failures: string[] = [];
  for (const resource of resources) {
    const fetchedAt = new Date().toISOString();
    const id = store.startEnergyImport(`samp-${resource.year}`, resource.id, fetchedAt);
    let received = 0;
    let snapshotPath: string | undefined;
    let sha256: string | undefined;
    try {
      log(`SAMP ${resource.year}: coletando consumo e receitas residenciais…`);
      let records: CkanRecord[];
      let observedAt = fetchedAt;
      const archive = reuseArchives ? (await readdir(archiveDir).catch(() => []))
        .filter((name) => name.startsWith(`samp-${resource.year}-`) && name.endsWith('.json')).sort().at(-1) : undefined;
      if (archive) {
        snapshotPath = resolve(join(archiveDir, archive));
        const payload = await readFile(snapshotPath, 'utf8');
        sha256 = createHash('sha256').update(payload).digest('hex');
        const saved = JSON.parse(payload) as { resourceId: string; records: CkanRecord[]; fetchedAt: string };
        if (saved.resourceId !== resource.id || !Array.isArray(saved.records) || !Number.isFinite(Date.parse(saved.fetchedAt))) {
          throw new Error('SAMP: arquivo de origem incompatível');
        }
        records = saved.records;
        observedAt = saved.fetchedAt;
        log(`SAMP ${resource.year}: reprocessando arquivo local.`);
      } else {
        records = await fetchRecords(resource.id, SAMP_FILTERS, undefined, 20000, FIELDS);
        const payload = JSON.stringify({ source: 'ANEEL/SAMP', license: 'ODbL-1.0', resourceId: resource.id, filters: SAMP_FILTERS, fetchedAt, records });
        sha256 = createHash('sha256').update(payload).digest('hex');
        await mkdir(archiveDir, { recursive: true });
        snapshotPath = resolve(join(archiveDir, `samp-${resource.year}-${fetchedAt.replace(/[:.]/g, '-')}-${id}.json`));
        await writeFile(`${snapshotPath}.tmp`, payload, { flag: 'wx' });
        await rename(`${snapshotPath}.tmp`, snapshotPath);
      }
      received = records.length;
      const averages = calculateSampAverages(records, resource.year, resource.id, observedAt);
      store.saveAnnualTariffAverages(averages);
      store.finishEnergyImport(id, { status: 'completed', finishedAt: new Date().toISOString(), received, saved: averages.length,
        sourceDate: averages[0].sourceDate, snapshotPath, sha256 });
      log(`SAMP ${resource.year}: ${received} registros; R$ ${averages[1].price.toFixed(6)}/kWh com impostos e bandeiras.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.finishEnergyImport(id, { status: 'failed', finishedAt: new Date().toISOString(), received, snapshotPath, sha256, error: message.slice(0, 2000) });
      failures.push(`${resource.year}: ${message}`);
      log(`SAMP ${resource.year}: falha (${message}).`);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
}
