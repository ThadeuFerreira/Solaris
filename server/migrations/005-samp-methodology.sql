-- Receita Energia already includes the tariff-flag receipt component.
-- Require a recalculation of any exploratory result that added it again.
UPDATE annual_tariff_averages SET quality_status='unchecked'
WHERE methodology NOT LIKE 'samp-residential-captive-v3:%';
