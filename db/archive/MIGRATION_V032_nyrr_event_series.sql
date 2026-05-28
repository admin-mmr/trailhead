-- ── MIGRATION_V032: Create nyrr_event_series table (HOF series grouping) ─────
-- Required by P1f Hall of Fame backend (api_hof.py).
-- V029 added nyrr_events.series_id but deferred this table until P1f.
--
-- Creates:
--   nyrr_event_series — named race series (e.g. "Brooklyn Half", "NYRR 5K")
--                       used to group annual race editions for HOF display.
--
-- Then wires up the FK from nyrr_events.series_id → nyrr_event_series.id
-- (V029 skipped the FK because the table didn't exist yet).
--
-- MySQL 5.7 constraint: no IF NOT EXISTS in ALTER TABLE / CREATE INDEX.
-- Table creation guarded by INFORMATION_SCHEMA. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create nyrr_event_series (guarded)
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'nyrr_event_series');
SET @sql = IF(@tbl = 0,
    "CREATE TABLE nyrr_event_series (
        id          INT NOT NULL AUTO_INCREMENT,
        name        VARCHAR(255) NOT NULL COMMENT 'Display name, e.g. Brooklyn Half Marathon',
        slug        VARCHAR(255) NOT NULL COMMENT 'URL-safe key, e.g. brooklyn-half',
        distance_km DECIMAL(6,4) NULL    COMMENT 'Canonical distance in km for HOF category splits',
        notes       TEXT         NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_series_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    "SELECT 'nyrr_event_series already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Add FK nyrr_events.series_id → nyrr_event_series.id
-- (V029 skipped this because the table was absent at the time)
SET @fk = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
           WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'nyrr_events'
           AND CONSTRAINT_NAME = 'fk_nyrr_events_series');
SET @sql = IF(@fk = 0,
    'ALTER TABLE nyrr_events ADD CONSTRAINT fk_nyrr_events_series
     FOREIGN KEY (series_id) REFERENCES nyrr_event_series (id) ON DELETE SET NULL',
    "SELECT 'fk_nyrr_events_series already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Self-registration (required — prevents re-run) ───────────────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V032', 'Create nyrr_event_series table and wire FK from nyrr_events.series_id', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
