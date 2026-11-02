import { dirname, join, resolve } from 'node:path';
import { openDatabase, Store } from './db';
import { collectEnergyHistory } from './energyHistory';

const dbPath = resolve(process.env.SOLARIS_DB ?? 'data/solaris.db');
const db = openDatabase(dbPath);
try {
  console.log(`Banco: ${dbPath}`);
  await collectEnergyHistory({
    store: new Store(db),
    archiveDir: join(dirname(dbPath), 'aneel-snapshots'),
    log: console.log,
  });
  const summary = db.prepare(`SELECT COUNT(*) AS periods, COUNT(DISTINCT distributor_id) AS distributors,
    MIN(start_date) AS first_period, MAX(start_date) AS last_period FROM tariff_history`).get();
  console.log('Histórico acumulado:', summary);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  db.close();
}
