-- EMERGENCY: Drop ALL triggers that reference dropped/renamed columns
-- Run this NOW on Azure MySQL to unblock the cron job
--
-- These triggers were created by old migrations but still reference:
--   - WebApp (dropped in V10-b)
--   - PaymentCheck (dropped in V10-b)
--   - LastLoginDate (renamed to LastLogin in V10-c)
--   - ProfileLastUpdated (dropped in V10-b)

DROP TRIGGER IF EXISTS members_after_insert;
DROP TRIGGER IF EXISTS members_after_update;
DROP TRIGGER IF EXISTS members_update_lastupdated_unix;
DROP TRIGGER IF EXISTS members_insert_lastupdated_unix;
DROP TRIGGER IF EXISTS members_update_lastlogindate_unix;
DROP TRIGGER IF EXISTS members_insert_lastlogindate_unix;
DROP TRIGGER IF EXISTS members_update_profilelastupdated_unix;
DROP TRIGGER IF EXISTS members_insert_profilelastupdated_unix;
DROP TRIGGER IF EXISTS members_update_createdat_unix;
DROP TRIGGER IF EXISTS members_insert_createdat_unix;
DROP TRIGGER IF EXISTS payments_update_processeddate_unix;
DROP TRIGGER IF EXISTS payments_insert_processeddate_unix;
DROP TRIGGER IF EXISTS webapp_events_update_timestamp_unix;
DROP TRIGGER IF EXISTS webapp_events_insert_timestamp_unix;
DROP TRIGGER IF EXISTS webapp_events_update_expiresat_unix;
DROP TRIGGER IF EXISTS webapp_events_insert_expiresat_unix;
DROP TRIGGER IF EXISTS webapp_events_update_approvaldate_unix;
DROP TRIGGER IF EXISTS webapp_events_insert_approvaldate_unix;

-- Verify all dropped
SHOW TRIGGERS WHERE `Table` = 'members';
SHOW TRIGGERS WHERE `Table` = 'payments';
SHOW TRIGGERS WHERE `Table` = 'webapp_events';
