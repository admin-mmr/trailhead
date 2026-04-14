-- MIGRATION_V019: Add MARK_ACTIVE to admin_member_overrides.ActionType ENUM
--
-- Root cause: sp_admin_update_member_status sets ActionType = 'MARK_ACTIVE' when
-- p_NewStatus = 'active', but the ENUM only contained STATUS_CHANGE, EXPIRATION_OVERRIDE,
-- LIFETIME_SET, INACTIVE_SET, REVERT. MySQL truncated the value (warning 1265),
-- causing the "Mark Active" flow to fail with a data truncation error.

ALTER TABLE admin_member_overrides
  MODIFY COLUMN ActionType ENUM(
    'STATUS_CHANGE',
    'EXPIRATION_OVERRIDE',
    'LIFETIME_SET',
    'INACTIVE_SET',
    'MARK_ACTIVE',
    'REVERT'
  ) NOT NULL;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V019', 'Add MARK_ACTIVE to admin_member_overrides.ActionType ENUM', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
