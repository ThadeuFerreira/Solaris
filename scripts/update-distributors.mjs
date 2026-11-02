// Refresh the bundled residential distributor catalogue from ANEEL's public API.
// Source data: ANEEL, ODbL 1.0. Run: npm run update:distributors
import { writeFile } from 'node:fs/promises';

const resourceId = 'fcf2906c-7c32-4b9b-a637-054e7a5234f4';
const sourceUrl = `https://dadosabertos.aneel.gov.br/dataset/tarifas-distribuidoras-energia-eletrica/resource/${resourceId}`;
const asOf = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const filters = {
  DscBaseTarifaria: 'Tarifa de Aplicação',
  DscSubGrupo: 'B1',
  DscModalidadeTarifaria: 'Convencional',
  DscClasse: 'Residencial',
  DscSubClasse: 'Residencial',
  DscDetalhe: 'Não se aplica',
  NomPostoTarifario: 'Não se aplica',
};
const records = [];
for (let offset = 0; ; ) {
  const params = new URLSearchParams({ resource_id: resourceId, filters: JSON.stringify(filters), limit: '5000', offset: String(offset) });
  const response = await fetch(`https://dadosabertos.aneel.gov.br/api/3/action/datastore_search?${params}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`ANEEL: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error('ANEEL: consulta rejeitada');
  const page = data.result.records;
  records.push(...page);
  offset += page.length;
  if (offset >= data.result.total) break;
  if (!page.length) throw new Error('ANEEL: resposta incompleta');
}

const byCnpj = new Map();
for (const row of records) {
  if (row.DatInicioVigencia > asOf || (row.DatFimVigencia && row.DatFimVigencia < asOf)) continue;
  const rawCnpj = String(row.NumCNPJDistribuidora ?? '');
  const cnpj = rawCnpj.padStart(14, '0');
  if (!/^\d{1,14}$/.test(rawCnpj) || /^0+$/.test(rawCnpj) || !row.SigAgente?.trim()) throw new Error('ANEEL: distribuidora inválida');
  const previous = byCnpj.get(cnpj);
  if (!previous || row.DatInicioVigencia > previous.DatInicioVigencia) byCnpj.set(cnpj, row);
}
const distributors = [...byCnpj.entries()]
  .map(([cnpj, row]) => ({ distributor: row.SigAgente.trim(), cnpj }))
  .sort((a, b) => a.distributor.localeCompare(b.distributor, 'pt-BR'));
if (!distributors.length) throw new Error('ANEEL: nenhuma distribuidora vigente; catálogo anterior preservado');
const snapshot = {
  sourceUrl,
  license: 'ODbL-1.0',
  sourceDate: records.map((row) => row.DatGeracaoConjuntoDados).sort().at(-1),
  asOf,
  distributors,
};
await writeFile(new URL('../src/data/distributor-catalog.json', import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`${distributors.length} distribuidoras residenciais vigentes em ${asOf}. Fonte: ANEEL (${snapshot.sourceDate}).`);
