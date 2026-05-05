-- MIGRATION_V025: NYRR Tier-4 fuzzy match support
--
-- Changes to nyrr_event_runners:
--   1. Add `confidence_score TINYINT NULL`
--      Populated by Tier-4 fuzzy matcher (token_set_ratio 0–100).
--      NULL for all other match methods.
--
--   2. Extend `match_method` ENUM to include 'auto_fuzzy'
--      MySQL 5.7 requires a full MODIFY COLUMN to change ENUM values.
--      New set: auto_name | auto_lastname | auto_firstlast | auto_partial_name
--               | manual | not_member | unmatched | auto_fuzzy
--
-- MySQL 5.7+ constraints:
--   • No IF NOT EXISTS in ALTER TABLE — guarded via INFORMATION_SCHEMA checks.
--   • Each ALTER is a separate statement (no multi-clause ALTER).
--
-- Safe to re-run: guards prevent duplicate column errors.

-- ── 1. Add confidence_score (skip if already present) ──────────────────────
SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nyrr_event_runners'
      AND COLUMN_NAME  = 'confidence_score'
);

SET @sql = IF(
    @col_exists = 0,
    'ALTER TABLE nyrr_event_runners ADD COLUMN confidence_score TINYINT NULL COMMENT "Fuzzy match score 0-100 (Tier-4 only)" AFTER match_method',
    'SELECT "confidence_score already exists — skipping"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. Extend match_method ENUM to add auto_fuzzy ──────────────────────────
-- Check whether auto_fuzzy is already in the ENUM before modifying.
SET @enum_has_fuzzy = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA  = DATABASE()
      AND TABLE_NAME    = 'nyrr_event_runners'
      AND COLUMN_NAME   = 'match_method'
      AND COLUMN_TYPE LIKE '%auto_fuzzy%'
);

SET @sql2 = IF(
    @enum_has_fuzzy = 0,
    "ALTER TABLE nyrr_event_runners MODIFY COLUMN match_method
        ENUM('auto_name','auto_lastname','auto_firstlast','auto_partial_name',
             'manual','not_member','unmatched','auto_fuzzy')
        NULL COMMENT 'Match tier: auto_fuzzy = Tier-4 rapidfuzz hit awaiting confirmation'",
    'SELECT "auto_fuzzy already in ENUM — skipping"'
);

PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- ── Self-registration ───────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V025', 'Add confidence_score column + auto_fuzzy to nyrr_event_runners.match_method ENUM', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
