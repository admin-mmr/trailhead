-- ── MIGRATION_V029: nyrr_events load_mode + series_id ───────────────────────
-- Adds two columns required by P1e (historical MMR-only backfill) and
-- P1f/P1g (Hall of Fame series grouping):
--
--   load_mode   ENUM('full','mmr_only') DEFAULT 'full'
--               'full'     → fetch all finishers (current pipeline, 2025+)
--               'mmr_only' → fetch only MMR team runners (historical, pre-2025)
--
--   series_id   INT NULL FK → nyrr_event_series.id
--               Groups race editions into a named series (e.g. "Brooklyn Half").
--               FK added only if nyrr_event_series table exists; safe to run
--               before P1f creates that table.
--
-- MySQL 5.7 constraint: no IF NOT EXISTS in ALTER TABLE.
-- Each ADD is a separate statement, guarded by INFORMATION_SCHEMA.
-- Safe to re-run: skips columns that already exist.
-- ----------------------------------------------------------------------------

-- load_mode
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_events'
            AND COLUMN_NAME = 'load_mode');
SET @sql = IF(@col = 0,
    "ALTER TABLE nyrr_events ADD COLUMN load_mode ENUM('full','mmr_only') NOT NULL DEFAULT 'full' COMMENT 'full=all finishers; mmr_only=MMR team only (pre-2025 backfill)' AFTER processing_status",
    "SELECT 'load_mode already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: pre-2025 rows that were ingested via backfill-mmr-only
-- should be marked mmr_only. Rows added by the weekly full pipeline
-- keep the default 'full'. Safe to re-run (idempotent).
UPDATE nyrr_events
   SET load_mode = 'mmr_only'
 WHERE event_date < '2025-01-01'
   AND load_mode = 'full';

-- series_id (for HOF grouping, P1f)
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_events'
            AND COLUMN_NAME = 'series_id');
SET @sql = IF(@col = 0,
    'ALTER TABLE nyrr_events ADD COLUMN series_id INT NULL COMMENT ''FK to nyrr_event_series.id — HOF grouping'' AFTER load_mode',
    "SELECT 'series_id already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK from nyrr_events.series_id → nyrr_event_series.id
-- Only add if nyrr_event_series table already exists (created by P1f migration).
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_event_series');
SET @fk  = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nyrr_events'
            AND CONSTRAINT_NAME = 'fk_nyrr_events_series');
SET @sql = IF(@tbl > 0 AND @fk = 0,
    'ALTER TABLE nyrr_events ADD CONSTRAINT fk_nyrr_events_series FOREIGN KEY (series_id) REFERENCES nyrr_event_series (id) ON DELETE SET NULL',
    "SELECT 'FK skipped (table absent or FK exists)' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Self-registration
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V029', 'nyrr_events: load_mode ENUM + series_id INT for backfill gating and HOF series', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
