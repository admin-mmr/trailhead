-- ── MIGRATION_V031: Normalize nyrr_events.distance values ───────────────────
-- ⚠️  HARD RULE: Before deploying, verify the number:
--     mysql-mmr -e "SELECT version FROM schema_migrations ORDER BY id DESC LIMIT 5;"
--     Rename file to MIGRATION_V{max+1}_... if V031 is already taken.
-- ─────────────────────────────────────────────────────────────────────────────
-- Raw NYRR API returns inconsistent distance strings. This migration
-- normalises them to canonical values:
--
--   HALF / half marathon / Half-Marathon / HALF MARATHON → Half Marathon
--   MARATHON / Full Marathon                             → Marathon
--   5K / 5 K / 5k                                       → 5K
--   10K / 10 K / 10k                                    → 10K
--   15K / 15k                                           → 15K
--   4M / 4 MILES / 4-Mile                               → 4 Miles
--   5M / 5 MILES / 5-Mile                               → 5 Miles
--   1M / 1 MILE / 1-MILE                                → 1 Mile
--   Remaining values: TRIM whitespace only (preserves oddities like "kids dash,1 mile")
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE nyrr_events
SET distance = CASE
  -- Half Marathon variants
  WHEN UPPER(TRIM(distance)) IN (
    'HALF', 'HALF MARATHON', 'HALF-MARATHON', 'HALFMARATHON',
    'HALF MARATHON (21.0975 KM)', '13.1', '13.1 MILES'
  ) THEN 'Half Marathon'

  -- Marathon variants
  WHEN UPPER(TRIM(distance)) IN (
    'MARATHON', 'FULL MARATHON', 'FULL-MARATHON', 'FULLMARATHON',
    '26.2', '26.2 MILES'
  ) THEN 'Marathon'

  -- 5K variants
  WHEN UPPER(TRIM(distance)) IN ('5K', '5 K', '5KM', '5 KM', '3.1 MILES', '3.1')
    THEN '5K'

  -- 10K variants
  WHEN UPPER(TRIM(distance)) IN ('10K', '10 K', '10KM', '10 KM', '6.2 MILES', '6.2')
    THEN '10K'

  -- 15K variants
  WHEN UPPER(TRIM(distance)) IN ('15K', '15 K', '15KM', '15 KM')
    THEN '15K'

  -- 4 Miles variants
  WHEN UPPER(TRIM(distance)) IN ('4M', '4 MILES', '4 MILE', '4-MILE', '4-MILES')
    THEN '4 Miles'

  -- 5 Miles variants
  WHEN UPPER(TRIM(distance)) IN ('5M', '5 MILES', '5 MILE', '5-MILE', '5-MILES')
    THEN '5 Miles'

  -- 1 Mile variants
  WHEN UPPER(TRIM(distance)) IN ('1M', '1 MILE', '1-MILE', '1 MILES')
    THEN '1 Mile'

  -- Empty → NULL
  WHEN TRIM(distance) = '' THEN NULL

  -- All others: just clean up leading/trailing whitespace
  ELSE TRIM(distance)
END
WHERE distance IS NOT NULL;

-- ── Self-registration (required — prevents re-run) ───────────────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V031', 'Normalize nyrr_events.distance to canonical values', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
