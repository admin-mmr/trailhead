-- MIGRATION_V008: Drop webapp_events + Remove legacy sync tables + Consolidate admin tables
-- Date: 2026-04-04
-- Purpose:
--   1. Remove webapp_events table — use submissions instead for member portal
--   2. Remove legacy sync_changes, sync_snapshots, sync_metadata tables (historical only)
--   3. Keep sync_jobs table (actively used for background job tracking)
--   4. Consolidate admins + viewer_admins → admin_users (single source of truth)
--   5. Add indexes on submissions for optimized queries
--
-- Impact:
--   - webapp_events: Removed (replaced by submissions table)
--   - sync_changes, sync_snapshots, sync_metadata: Removed (legacy, no active use)
--   - sync_jobs: Retained (actively used for job tracking in mmr-admin)
--   - admins table: Renamed to admin_users, merged with viewer_admins roles
--   - Code changes: webapp routes use submissions; auth queries use admin_users
--
-- MySQL 5.7+ compatible: Uses idempotent checks via INFORMATION_SCHEMA

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1: Drop deprecated tables
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop webapp_events (replaced by submissions)
DROP TABLE IF EXISTS `webapp_events`;

-- Drop legacy sync snapshot/metadata tracking (historical only)
DROP TABLE IF EXISTS `sync_changes`;
DROP TABLE IF EXISTS `sync_snapshots`;
DROP TABLE IF EXISTS `sync_metadata`;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2: Add missing indexes to submissions (performance)
-- ═══════════════════════════════════════════════════════════════════════════

-- Check if idx_submissions_status exists, add if missing
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_NAME = 'submissions' AND COLUMN_NAME = 'Status' AND INDEX_NAME = 'idx_submissions_status';

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE submissions ADD INDEX idx_submissions_status (Status)',
  'SELECT 1 /* Index idx_submissions_status already exists */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Check if idx_submissions_expires exists, add if missing
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_NAME = 'submissions' AND COLUMN_NAME = 'ExpiresAt' AND INDEX_NAME = 'idx_submissions_expires';

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE submissions ADD INDEX idx_submissions_expires (ExpiresAt)',
  'SELECT 1 /* Index idx_submissions_expires already exists */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Composite index for common queries: Status + ExpiresAt
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_NAME = 'submissions' AND INDEX_NAME = 'idx_submissions_status_expires';

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE submissions ADD INDEX idx_submissions_status_expires (Status, ExpiresAt)',
  'SELECT 1 /* Index idx_submissions_status_expires already exists */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3: Consolidate admin tables: admins + viewer_admins → admin_users
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 3.1: Rename admins → admin_users (check if rename needed)
SET @table_exists = 0;
SELECT COUNT(*) INTO @table_exists
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users';

-- If admin_users doesn't exist, rename admins to admin_users
SET @sql = IF(@table_exists = 0,
  'ALTER TABLE admins RENAME TO admin_users',
  'SELECT 1 /* admin_users already exists */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3.2: Add role column to admin_users (if not exists)
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'role';

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE admin_users ADD COLUMN role enum(\'admin\', \'super_admin\') NOT NULL DEFAULT \'admin\' AFTER email',
  'SELECT 1 /* role column already exists */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3.3: Add updated_at column to admin_users (if not exists)
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'updated_at';

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE admin_users ADD COLUMN updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER added_at',
  'SELECT 1 /* updated_at column already exists */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3.4: Migrate roles from viewer_admins to admin_users (idempotent)
-- Update admin_users with role info from viewer_admins where not already super_admin
UPDATE admin_users au
SET role = (
  SELECT role FROM viewer_admins va
  WHERE va.email = au.email AND au.role = 'admin' LIMIT 1
)
WHERE email IN (SELECT email FROM viewer_admins)
  AND role = 'admin';

-- Step 3.5: Ensure super admin exists with correct role
-- Use INSERT IGNORE to prevent duplicate key error if already exists
INSERT IGNORE INTO admin_users (email, role, added_by, added_at)
VALUES ('admin@mmrunners.org', 'super_admin', 'system', CURRENT_TIMESTAMP);

-- Step 3.6: Migrate any new admins from viewer_admins that don't exist in admin_users yet
INSERT IGNORE INTO admin_users (email, role, added_by, added_at)
SELECT email, role, 'migrated-from-viewer_admins', created_at
FROM viewer_admins va
WHERE NOT EXISTS (SELECT 1 FROM admin_users au WHERE au.email = va.email);

-- Step 3.7: Drop viewer_admins table (check if exists first)
SET @table_exists = 0;
SELECT COUNT(*) INTO @table_exists
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'viewer_admins';

SET @sql = IF(@table_exists = 1,
  'DROP TABLE viewer_admins',
  'SELECT 1 /* viewer_admins does not exist */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Step 3.8: Add indexes to admin_users for performance
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'role' AND INDEX_NAME = 'idx_admin_role';

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE admin_users ADD INDEX idx_admin_role (role)',
  'SELECT 1 /* Index idx_admin_role already exists */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'email' AND INDEX_NAME = 'idx_admin_email';

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE admin_users ADD INDEX idx_admin_email (email)',
  'SELECT 1 /* Index idx_admin_email already exists */');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4: Record migration in schema_migrations table
-- ═══════════════════════════════════════════════════════════════════════════

INSERT IGNORE INTO schema_migrations (version, description, executed_at)
VALUES (
  '008',
  'Drop webapp_events + sync_changes/snapshots/metadata + Consolidate admins→admin_users',
  CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5: Verify migration success
-- ═══════════════════════════════════════════════════════════════════════════

-- Show final admin_users structure and data
SELECT 'Admin Users Summary:' as migration_status;
SELECT COUNT(*) as total_admins, role, COUNT(*) as count_by_role
FROM admin_users
GROUP BY role;

-- Show submissions table with new indexes
SELECT 'Submissions Table Indexes:' as status;
SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_NAME = 'submissions' AND TABLE_SCHEMA = DATABASE()
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
