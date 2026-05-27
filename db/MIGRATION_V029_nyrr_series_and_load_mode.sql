-- ── MIGRATION_V029: nyrr_event_series + load_mode on nyrr_events ────────────
--
-- 1. New table: nyrr_event_series  (race-distance series registry)
-- 2. New column: nyrr_events.series_id  FK → nyrr_event_series.id
-- 3. New column: nyrr_events.load_mode  ENUM('full','mmr_only') DEFAULT 'full'
-- 4. Backfill: pre-2025 events → load_mode='mmr_only'
-- 5. Self-registration in schema_migrations
--
-- MySQL 5.7 constraints:
--   • No IF NOT EXISTS on ALTER TABLE
--   • No multi-clause ALTERs (one operation per ALTER TABLE statement)
-- ─────────────────────────────────────────────────────────────────────────────

-- Guard: skip entire migration if already applied.
-- (GitHub Actions re-runs the file on every push; self-registration in step 5
--  prevents double-execution, but the INFORMATION_SCHEMA check below lets the
--  file be re-sourced safely from a MySQL client too.)
SET @already_run = (
    SELECT COUNT(*) FROM schema_migrations WHERE version = 'V029'
);

-- ─── 1. nyrr_event_series ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nyrr_event_series (
    id          INT            NOT NULL AUTO_INCREMENT,
    name        VARCHAR(200)   NOT NULL                COMMENT 'Human-readable series name, e.g. "Brooklyn Half"',
    slug        VARCHAR(100)   NOT NULL                COMMENT 'URL-safe identifier, e.g. "brooklyn-half"',
    distance_km DECIMAL(6,3)   NULL                    COMMENT 'Canonical race distance in km (NULL = multi-distance)',
    notes       TEXT           NULL,
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_series_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Race-distance series registry for Hall of Fame grouping';

-- ─── 2. nyrr_events.series_id ────────────────────────────────────────────────

-- Check whether the column already exists before adding it.
SET @col_series = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nyrr_events'
      AND COLUMN_NAME  = 'series_id'
);

-- Add series_id only when absent (MySQL 5.7 has no IF NOT EXISTS on ALTER).
SET @sql_series = IF(
    @col_series = 0 AND @already_run = 0,
    'ALTER TABLE nyrr_events ADD COLUMN series_id INT NULL AFTER notes',
    'SELECT 1 /* series_id already exists, skipping */'
);
PREPARE stmt FROM @sql_series; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add FK separately (only when column was just added).
SET @fk_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA    = DATABASE()
      AND TABLE_NAME      = 'nyrr_events'
      AND CONSTRAINT_NAME = 'fk_nyrr_events_series'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_fk = IF(
    @fk_exists = 0 AND @already_run = 0,
    'ALTER TABLE nyrr_events ADD CONSTRAINT fk_nyrr_events_series FOREIGN KEY (series_id) REFERENCES nyrr_event_series (id) ON DELETE SET NULL',
    'SELECT 2 /* FK fk_nyrr_events_series already exists, skipping */'
);
PREPARE stmt FROM @sql_fk; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index for series lookup.
SET @idx_series = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nyrr_events'
      AND INDEX_NAME   = 'idx_series_id'
);
SET @sql_idx_series = IF(
    @idx_series = 0 AND @already_run = 0,
    'ALTER TABLE nyrr_events ADD INDEX idx_series_id (series_id)',
    'SELECT 3 /* idx_series_id already exists, skipping */'
);
PREPARE stmt FROM @sql_idx_series; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 3. nyrr_events.load_mode ────────────────────────────────────────────────

SET @col_load_mode = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nyrr_events'
      AND COLUMN_NAME  = 'load_mode'
);
SET @sql_load_mode = IF(
    @col_load_mode = 0 AND @already_run = 0,
    "ALTER TABLE nyrr_events ADD COLUMN load_mode ENUM('full','mmr_only') NOT NULL DEFAULT 'full' AFTER series_id",
    'SELECT 4 /* load_mode already exists, skipping */'
);
PREPARE stmt FROM @sql_load_mode; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index: fast queries for backfill pipelines that filter on load_mode.
SET @idx_load_mode = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nyrr_events'
      AND INDEX_NAME   = 'idx_load_mode'
);
SET @sql_idx_lm = IF(
    @idx_load_mode = 0 AND @already_run = 0,
    'ALTER TABLE nyrr_events ADD INDEX idx_load_mode (load_mode)',
    'SELECT 5 /* idx_load_mode already exists, skipping */'
);
PREPARE stmt FROM @sql_idx_lm; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 4. Backfill: pre-2025 events → mmr_only ─────────────────────────────────

-- Only run when load_mode column was just added (col_load_mode = 0 means it
-- didn't exist before this migration ran, so DEFAULT 'full' was just applied).
SET @sql_backfill = IF(
    @col_load_mode = 0 AND @already_run = 0,
    "UPDATE nyrr_events SET load_mode = 'mmr_only' WHERE event_date < '2025-01-01'",
    'SELECT 6 /* backfill skipped — column already existed */'
);
PREPARE stmt FROM @sql_backfill; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── 5. Self-registration ─────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V029', 'nyrr_event_series table + series_id/load_mode on nyrr_events', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
