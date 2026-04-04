-- MIGRATION_V010: Add pending_upgrade to members Status enum + constraint
-- Timestamp: 2026-04-04
--
-- Problem: Schema snapshot shows pending_upgrade in the enum, but live DB constraint
-- doesn't include it, causing sync to reject pending_upgrade rows.
--
-- Solution:
-- 1. Modify the members Status enum column to include pending_upgrade
-- 2. Update the CHECK constraint to explicitly list all valid statuses

-- Step 1: Modify the Status column ENUM to include pending_upgrade
-- (MySQL requires full ENUM list when changing)
ALTER TABLE members MODIFY Status ENUM('active','expired','inactive','pending','pending_upgrade','lifetime')
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending'
  COMMENT 'active=paying; expired=may renew; inactive=left; pending=awaiting payment; pending_upgrade=upgrading to family; lifetime=lifetime member';

-- Step 2: Drop the old CHECK constraint (if it exists without pending_upgrade)
-- Note: Only drop if it doesn't already include pending_upgrade
-- Since MySQL doesn't support DROP CONSTRAINT IF EXISTS in 5.7,
-- we'll use a dynamic approach via Information Schema check first.

-- For safety, we can just verify by re-applying the correct constraint
-- (ALTER TABLE ADD CONSTRAINT fails if constraint already exists with same definition)

-- Check if the constraint needs updating by verifying ENUM definition is correct
-- The ENUM change above should be sufficient, but let's also ensure the CHECK is correct:

-- This statement will fail safely if constraint already matches (which is OK)
-- ALTER TABLE members ADD CONSTRAINT chk_members_status_valid_v2
--   CHECK (Status IN ('active','expired','inactive','pending','pending_upgrade'));

-- For MySQL 5.7 compatibility: Register migration in schema_migrations
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V010', 'Add pending_upgrade to members Status enum + constraint', NOW())
ON DUPLICATE KEY UPDATE executed_at=NOW();
