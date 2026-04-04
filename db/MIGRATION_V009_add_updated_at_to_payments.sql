-- MIGRATION_V009: Add UpdatedAt column to payments table
-- Purpose: Enable incremental sync filtering for payments (export_payments job)
-- Timestamp: 2026-04-04
--
-- Summary:
--   - Adds UpdatedAt column to payments table with automatic timestamp tracking
--   - Enables sync_config.py to filter payments by UpdatedAt on subsequent exports
--   - Uses CURRENT_TIMESTAMP for existing rows, ON UPDATE for new/modified rows
--
-- MySQL 5.7 Constraint: Each operation is a separate ALTER TABLE statement
-- (no multi-clause ALTERs, no IF NOT EXISTS in ALTER TABLE)

-- Step 1: Check if UpdatedAt column already exists; skip if present
-- This makes the migration idempotent (safe to re-run)
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'UpdatedAt'
);

-- Step 2: Add UpdatedAt column to payments table (only if not present)
-- MySQL 5.7: Must use separate ALTER for column and separate ALTER for index
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `payments` ADD COLUMN `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT "Last modified timestamp for incremental sync"',
  'SELECT "UpdatedAt column already exists on payments table" as note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3: Create an index for efficient filtering during exports (if not present)
SET @idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'payments'
    AND INDEX_NAME = 'idx_payments_updated_at'
);

SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE `payments` ADD INDEX `idx_payments_updated_at` (`UpdatedAt`)',
  'SELECT "Index idx_payments_updated_at already exists on payments table" as note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 4: Self-register this migration in schema_migrations table
-- This prevents re-running the same migration and provides an audit trail
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V009', 'Add UpdatedAt column to payments table for incremental sync', NOW())
ON DUPLICATE KEY UPDATE executed_at=NOW();

-- End of MIGRATION_V009
