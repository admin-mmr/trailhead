-- Backfill Unix timestamp columns from existing datetime columns
-- Safe to run anytime, even while app is running (read-only sourcing)
--
-- Usage:
--   mysql-mmr < db/migrations/0016_backfill_unix_timestamps.sql

-- Members table: Backfill Unix timestamps from datetime columns
UPDATE members
SET updated_at_unix = UNIX_TIMESTAMP(LastUpdated)
WHERE LastUpdated IS NOT NULL
AND (updated_at_unix IS NULL OR updated_at_unix = 0);

UPDATE members
SET last_login_date_unix = UNIX_TIMESTAMP(LastLoginDate)
WHERE LastLoginDate IS NOT NULL
AND (last_login_date_unix IS NULL OR last_login_date_unix = 0);

UPDATE members
SET profile_last_updated_unix = UNIX_TIMESTAMP(ProfileLastUpdated)
WHERE ProfileLastUpdated IS NOT NULL
AND (profile_last_updated_unix IS NULL OR profile_last_updated_unix = 0);

UPDATE members
SET created_at_unix = UNIX_TIMESTAMP(Created)
WHERE Created IS NOT NULL
AND (created_at_unix IS NULL OR created_at_unix = 0);

-- WebApp events table: Backfill Unix timestamps from datetime columns
UPDATE webapp_events
SET timestamp_unix = UNIX_TIMESTAMP(Timestamp)
WHERE Timestamp IS NOT NULL
AND (timestamp_unix IS NULL OR timestamp_unix = 0);

UPDATE webapp_events
SET expires_at_unix = UNIX_TIMESTAMP(ExpiresAt)
WHERE ExpiresAt IS NOT NULL
AND (expires_at_unix IS NULL OR expires_at_unix = 0);

UPDATE webapp_events
SET approval_date_unix = UNIX_TIMESTAMP(ApprovalDate)
WHERE ApprovalDate IS NOT NULL
AND (approval_date_unix IS NULL OR approval_date_unix = 0);

-- Payments table: Backfill Unix timestamp from datetime column
UPDATE payments
SET processed_date_unix = UNIX_TIMESTAMP(ProcessedDate)
WHERE ProcessedDate IS NOT NULL
AND (processed_date_unix IS NULL OR processed_date_unix = 0);

-- Verify backfill completeness
SELECT 'members.updated_at_unix' AS `table.column`,
       COUNT(*) AS total_rows,
       SUM(CASE WHEN updated_at_unix > 0 THEN 1 ELSE 0 END) AS populated,
       SUM(CASE WHEN updated_at_unix = 0 THEN 1 ELSE 0 END) AS unpopulated
FROM members
UNION ALL
SELECT 'members.last_login_date_unix',
       COUNT(*),
       SUM(CASE WHEN last_login_date_unix > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN last_login_date_unix = 0 THEN 1 ELSE 0 END)
FROM members
UNION ALL
SELECT 'members.profile_last_updated_unix',
       COUNT(*),
       SUM(CASE WHEN profile_last_updated_unix > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN profile_last_updated_unix = 0 THEN 1 ELSE 0 END)
FROM members
UNION ALL
SELECT 'members.created_at_unix',
       COUNT(*),
       SUM(CASE WHEN created_at_unix > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN created_at_unix = 0 THEN 1 ELSE 0 END)
FROM members
UNION ALL
SELECT 'webapp_events.timestamp_unix',
       COUNT(*),
       SUM(CASE WHEN timestamp_unix > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN timestamp_unix = 0 THEN 1 ELSE 0 END)
FROM webapp_events
UNION ALL
SELECT 'webapp_events.expires_at_unix',
       COUNT(*),
       SUM(CASE WHEN expires_at_unix > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN expires_at_unix = 0 THEN 1 ELSE 0 END)
FROM webapp_events
UNION ALL
SELECT 'webapp_events.approval_date_unix',
       COUNT(*),
       SUM(CASE WHEN approval_date_unix > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN approval_date_unix = 0 THEN 1 ELSE 0 END)
FROM webapp_events
UNION ALL
SELECT 'payments.processed_date_unix',
       COUNT(*),
       SUM(CASE WHEN processed_date_unix > 0 THEN 1 ELSE 0 END),
       SUM(CASE WHEN processed_date_unix = 0 THEN 1 ELSE 0 END)
FROM payments;
