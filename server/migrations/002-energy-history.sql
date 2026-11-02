CREATE TABLE distributors (
  id INTEGER PRIMARY KEY,
  cnpj TEXT NOT NULL UNIQUE CHECK(length(cnpj) = 14 AND cnpj NOT GLOB '*[^0-9]*'),
  agent_code TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE distributor_aliases (
  agent_code TEXT NOT NULL,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  PRIMARY KEY(agent_code, distributor_id)
);
CREATE TABLE tariff_history (
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  agent_code TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  tusd_microrl_per_kwh INTEGER NOT NULL CHECK(tusd_microrl_per_kwh >= 0),
  te_microrl_per_kwh INTEGER NOT NULL CHECK(te_microrl_per_kwh >= 0),
  resolution TEXT NOT NULL,
  source_resource_id TEXT NOT NULL,
  source_date TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  CHECK(end_date IS NULL OR end_date >= start_date),
  PRIMARY KEY(distributor_id, start_date)
);
-- This table is exclusively B1 / Convencional / Residencial / Residencial,
-- detail and tariff post "Não se aplica". Other profiles require a new key.
CREATE INDEX tariff_history_lookup ON tariff_history(distributor_id, start_date DESC);
CREATE TABLE annual_tariff_averages (
  geography_type TEXT NOT NULL CHECK(geography_type IN ('country', 'region', 'state')),
  geography_code TEXT NOT NULL,
  reference_year INTEGER NOT NULL CHECK(reference_year >= 1991),
  consumer_class TEXT NOT NULL,
  tax_basis TEXT NOT NULL CHECK(tax_basis IN ('with_taxes', 'without_taxes')),
  includes_flags INTEGER NOT NULL CHECK(includes_flags IN (0, 1)),
  tariff_microrl_per_kwh INTEGER NOT NULL CHECK(tariff_microrl_per_kwh > 0),
  complete_year INTEGER NOT NULL CHECK(complete_year IN (0, 1)),
  data_through TEXT NOT NULL,
  methodology TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_resource_id TEXT NOT NULL,
  source_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(geography_type, geography_code, reference_year, consumer_class, tax_basis, includes_flags)
);
CREATE TABLE energy_import_runs (
  id INTEGER PRIMARY KEY,
  dataset TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  records_received INTEGER,
  records_saved INTEGER,
  source_date TEXT,
  snapshot_path TEXT,
  snapshot_sha256 TEXT,
  error TEXT
);
