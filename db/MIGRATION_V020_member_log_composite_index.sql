-- MIGRATION_V020: Add composite index on member_log(MemberID, LoggingTime)
--
-- Root cause: sp_delink_member_payment (and related procs) query member_log with:
--   WHERE MemberID = ? AND LoggingTime < ? ORDER BY LoggingTime DESC LIMIT 1
-- Individual indexes on MemberID and LoggingTime exist but MySQL can only use one,
-- forcing a full scan of all rows for that member sorted in memory. With a large
-- member_log this pegs CPU at 100% and hangs integration tests.
--
-- This composite index lets MySQL seek directly to the MemberID partition
-- and scan LoggingTime in reverse order, making the LIMIT 1 nearly instant.

CREATE INDEX idx_member_log_member_time
    ON member_log (MemberID, LoggingTime);

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V020', 'Add composite index member_log(MemberID, LoggingTime)', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
