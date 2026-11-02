import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  FLAG_RESOURCE_ID, parseAneelNumber, parseFlagRecords, RESIDENTIAL_FILTERS, TARIFF_RESOURCE_ID,
} from '../src/api/aneel';
import { fetchCkanRecords, type CkanRecord } from '../src/api/ckan';
import type { Store } from './db';

export interface HistoricalTariff {
  cnpj: string;
  distributor: string;
  start: string;
  end: string;
  tusdMicrorl: number;
  teMicrorl: number;
  resolution: string;
  sourceDate: string;
}

function date(value: unknown): string {
  const text = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) {
    throw new Error(`ANEEL: data inválida (${text})`);
  }
  return text;
}

/** Reject a malformed load before it can change any stored tariff. */
export function parseHistoricalTariffs(records: CkanRecord[]): HistoricalTariff[] {
  if (!records.length) throw new Error('ANEEL: histórico residencial vazio');
  const unique = new Map<string, HistoricalTariff>();
  for (const row of records) {
    for (const [key, value] of Object.entries(RESIDENTIAL_FILTERS)) {
      if (row[key] !== value) throw new Error(`ANEEL: perfil inesperado em ${key}`);
    }
    const rawCnpj = String(row.NumCNPJDistribuidora ?? '');
    const cnpj = rawCnpj.padStart(14, '0');
    const distributor = String(row.SigAgente ?? '').trim();
    if (!/^\d{1,14}$/.test(rawCnpj) || /^0+$/.test(rawCnpj) || !distributor) throw new Error('ANEEL: identificação incompleta');
    const tusd = parseAneelNumber(row.VlrTUSD);
    const te = parseAneelNumber(row.VlrTE);
    const unit = String(row.DscUnidadeTerciaria).toUpperCase();
    if (tusd === null || te === null || tusd < 0 || te < 0 || !['MWH', 'KWH'].includes(unit)) {
      throw new Error('ANEEL: tarifa ou unidade inválida');
    }
    const multiplier = unit === 'MWH' ? 1000 : 1e6;
    const entry: HistoricalTariff = {
      cnpj, distributor, start: date(row.DatInicioVigencia),
      end: row.DatFimVigencia ? date(row.DatFimVigencia) : '',
      tusdMicrorl: Math.round(tusd * multiplier), teMicrorl: Math.round(te * multiplier),
      // Some official rows have no act description; the raw snapshot retains that null.
      resolution: String(row.DscREH ?? ''), sourceDate: date(row.DatGeracaoConjuntoDados),
    };
    if ((entry.end && entry.end < entry.start) || !Number.isSafeInteger(entry.tusdMicrorl) || !Number.isSafeInteger(entry.teMicrorl)) {
      throw new Error('ANEEL: período ou valor fora do intervalo');
    }
    const key = `${cnpj}:${entry.start}:${entry.resolution}`;
    const previous = unique.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new Error(`ANEEL: tarifas conflitantes para ${distributor} em ${entry.start}`);
    }
    unique.set(key, entry);
  }
  return [...unique.values()];
}

export interface CollectionResult {
  dataset: string;
  runId: number;
  received: number;
  saved: number;
  sourceDate: string;
  snapshotPath: string;
}

interface CollectionOptions {
  store: Store;
  archiveDir: string;
  fetchRecords?: typeof fetchCkanRecords;
  log?: (message: string) => void;
}

/** One bounded backfill. Each dataset commits atomically and can be retried safely. */
export async function collectEnergyHistory({ store, archiveDir, fetchRecords = fetchCkanRecords, log = () => {} }: CollectionOptions): Promise<CollectionResult[]> {
  const results: CollectionResult[] = [];
  const failures: string[] = [];
  for (const [dataset, resourceId, filters] of [
    ['tariffs', TARIFF_RESOURCE_ID, RESIDENTIAL_FILTERS],
    ['flags', FLAG_RESOURCE_ID, {}],
  ] as const) {
    const startedAt = new Date().toISOString();
    const runId = store.startEnergyImport(dataset, resourceId, startedAt);
    let received = 0;
    let snapshotPath: string | undefined;
    let sha256: string | undefined;
    let sourceDate: string | undefined;
    try {
      log(`Coletando ${dataset} (execução ${runId})…`);
      const records = await fetchRecords(resourceId, filters);
      received = records.length;
      if (!received) throw new Error('ANEEL: base vazia');
      sourceDate = date(records[0].DatGeracaoConjuntoDados);
      const payload = JSON.stringify({ source: 'ANEEL Dados Abertos', license: 'ODbL-1.0', resourceId, filters, fetchedAt: startedAt, records });
      sha256 = createHash('sha256').update(payload).digest('hex');
      await mkdir(archiveDir, { recursive: true });
      snapshotPath = resolve(join(archiveDir, `${dataset}-${startedAt.replace(/[:.]/g, '-')}-${runId}.json`));
      await writeFile(`${snapshotPath}.tmp`, payload, { flag: 'wx' });
      await rename(`${snapshotPath}.tmp`, snapshotPath);
      let saved: number;
      if (dataset === 'tariffs') {
        const rows = parseHistoricalTariffs(records);
        store.saveTariffHistory(rows, startedAt);
        saved = rows.length;
      } else {
        const flags = parseFlagRecords(records);
        const knownNames = /^(Verde|Amarela|Vermelha.*[12]|Vermelha.*I|Escassez)/i;
        if (flags.length !== records.length || flags.some((flag) =>
          !knownNames.test(flag.rawName) || !flag.surchargeFromApi || !Number.isFinite(flag.surcharge) || flag.surcharge < 0)) {
          throw new Error('ANEEL: bandeira inválida ou adicional ausente');
        }
        // Do not silently retain an unknown date or a unit inferred incorrectly.
        for (const row of records) date(row.DatCompetencia);
        store.saveFlags(flags, startedAt);
        saved = flags.length;
      }
      store.finishEnergyImport(runId, {
        status: 'completed', finishedAt: new Date().toISOString(), received, saved, sourceDate, snapshotPath, sha256,
      });
      results.push({ dataset, runId, received, saved, sourceDate, snapshotPath });
      log(`${dataset}: ${received} registros recebidos, ${saved} salvos (base ${sourceDate}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.finishEnergyImport(runId, {
        status: 'failed', finishedAt: new Date().toISOString(), received, sourceDate, snapshotPath, sha256, error: message.slice(0, 2000),
      });
      failures.push(`${dataset}: ${message}`);
      log(`Falha em ${dataset}: ${message}`);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
  return results;
}
