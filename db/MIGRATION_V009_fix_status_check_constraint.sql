-- MIGRATION V009: Fix chk_members_status_valid CHECK constraint
-- ---------------------------------------------------------------
-- Problem: V007 added chk_members_status_valid but omitted 'lifetime'
-- from the allowed Status values. This causes sp_admin_update_member_status
-- to fail with error 3819 (HY000) when an admin sets a member to lifetime.
--
-- The trigger (trg_before_insert/update_members) already allows:
--   active, expired, inactive, pending, pending_upgrade, lifetime
-- The CHECK constraint must match exactly.
--
-- Safe to re-run: DROP CHECK is a no-op if constraint was already dropped.
-- ---------------------------------------------------------------

-- Step 1: Drop the incomplete constraint (MySQL 8.0+ syntax)
ALTER TABLE members DROP CHECK chk_members_status_valid;

-- Step 2: Recreate with all valid statuses including 'lifetime'
ALTER TABLE members ADD CONSTRAINT chk_members_status_valid
    CHECK (Status IN ('active', 'expired', 'inactive', 'pending', 'pending_upgrade', 'lifetime'));

-- Step 3: Audit trail
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V009', 'Fix chk_members_status_valid CHECK constraint to include lifetime status', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
