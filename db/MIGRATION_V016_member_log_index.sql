-- ============================================================
-- MIGRATION V016: Index member_log for sp_revert_admin_override
-- ============================================================
-- sp_revert_admin_override cursor does this query for each of N impacted members:
--
--   SELECT Status, Expiration FROM member_log
--   WHERE MemberID = ? AND LoggingTime < ? AND Status IS NOT NULL
--   ORDER BY LoggingTime DESC LIMIT 1;
--
-- Without an index this is a full table scan per member.  With 171 members
-- and a large member_log, the SP hangs and can acquire row locks long enough
-- to block concurrent Sheets sync transactions.
--
-- Fix: composite index (MemberID, LoggingTime DESC) covers the WHERE + ORDER BY.
-- MySQL 5.7 does not support functional/descending index syntax in CREATE INDEX,
-- but the optimizer will use an ASC index in reverse for ORDER BY ... DESC LIMIT 1.
--
-- Note: MySQL 5.7 does not support CREATE INDEX IF NOT EXISTS.
-- Guard: only create if the index does not already exist.
-- ============================================================

-- Check and create index only if it does not exist (MySQL 5.7 compatible)
SET @idx_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'member_log'
      AND INDEX_NAME   = 'idx_member_log_member_time'
);

SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_member_log_member_time ON member_log (MemberID, LoggingTime)',
    'SELECT ''index idx_member_log_member_time already exists, skipping'' AS info'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Self-registration
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V016', 'Add idx_member_log_member_time to speed up sp_revert_admin_override cursor loop', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
