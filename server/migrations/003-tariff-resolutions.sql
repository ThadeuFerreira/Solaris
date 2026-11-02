-- ANEEL can publish multiple resolutions for the very same start date.
-- Retain each act; the UI cache selects the most recently dated resolution.
CREATE TABLE tariff_history_with_resolutions (
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
  PRIMARY KEY(distributor_id, start_date, resolution)
);
INSERT INTO tariff_history_with_resolutions SELECT * FROM tariff_history;
DROP TABLE tariff_history;
ALTER TABLE tariff_history_with_resolutions RENAME TO tariff_history;
CREATE INDEX tariff_history_lookup ON tariff_history(distributor_id, start_date DESC);
