import { dirname, join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { openDatabase, Store } from './db';
import { collectSampAverages } from './samp';

const reuseArchives = process.argv.includes('--replay');
const args = process.argv.slice(2).filter((arg) => arg !== '--replay');
if (args.some((arg) => !/^\d{4}$/.test(arg))) throw new Error('Uso: npm run collect:samp -- [--replay] [2025 2024 ...]');
const years = args.length ? args.map(Number) : undefined;
const dbPath = resolve(process.env.SOLARIS_DB ?? 'data/solaris.db');
const db = openDatabase(dbPath);
try {
  await collectSampAverages({ store: new Store(db), archiveDir: join(dirname(dbPath), 'aneel-snapshots'), years, reuseArchives, log: console.log });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try {
    const averages = new Store(db).readAnnualTariffAverages();
    if (averages.length) {
      await writeFile(new URL('../src/data/samp-annual-averages.json', import.meta.url),
        `${JSON.stringify({ source: 'ANEEL/SAMP', license: 'ODbL-1.0', averages }, null, 2)}\n`);
      console.log(`${averages.length} médias validadas exportadas para a referência incluída no aplicativo.`);
    }
  } finally { db.close(); }
}
