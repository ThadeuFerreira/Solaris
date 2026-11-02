-- Old exploratory calculations must be revalidated before becoming a fallback.
ALTER TABLE annual_tariff_averages ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'unchecked'
  CHECK(quality_status IN ('unchecked', 'validated'));
