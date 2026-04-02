-- Migration 0019: Fix member_log INSERT/UPDATE triggers for V10 column renames
--
-- PURPOSE:
--   The triggers that log member changes to member_log still reference dropped columns:
--   - WebApp (dropped in V10-b)
--   - PaymentCheck (dropped in V10-b)
--   - LastLoginDate (renamed to LastLogin in V10-c)
--   - ProfileLastUpdated (dropped in V10-b)
--
--   When UPDATE members happens, the trigger tries to INSERT these columns into member_log,
--   causing: "Unknown column 'WebApp' in 'field list'" error.
--
-- SOLUTION:
--   Drop old triggers and recreate them with only the columns that exist in member_log.
--
-- TABLES AFFECTED:
--   - members (triggers that INSERT into member_log on INSERT/UPDATE)
--   - member_log (no schema changes, just matching the triggers)

-- Drop old triggers
DROP TRIGGER IF EXISTS members_after_insert;
DROP TRIGGER IF EXISTS members_after_update;

-- ─────────────────────────────────────────────────────────────────────────────
-- NEW TRIGGERS FOR V10 COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger: members_after_insert
-- Logs new member inserts to member_log
-- NOTE: Only includes columns that exist in member_log (no WebApp, PaymentCheck, ProfileLastUpdated)
CREATE TRIGGER members_after_insert
AFTER INSERT ON members
FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    Info, LastUpdated, MembershipFeePaid, PaymentDate, PaymentTransaction,
    JoinYear, PhoneNumber, LastLogin, Notes, NYRRRunnerName, YearBorn
  )
  VALUES (
    CONCAT('ML-', UNIX_TIMESTAMP(NOW(3)) * 1000, '-', FLOOR(RAND() * 10000)),
    NOW(),
    NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID,
    NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.Info, NEW.LastUpdated, NEW.MembershipFeePaid, NEW.PaymentDate,
    NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.LastLogin,
    NEW.Notes, NEW.NYRRRunnerName, NEW.YearBorn
  );
END;
$$

-- Trigger: members_after_update
-- Logs member updates to member_log
-- NOTE: Only includes columns that exist in member_log (no WebApp, PaymentCheck, ProfileLastUpdated)
CREATE TRIGGER members_after_update
AFTER UPDATE ON members
FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    Info, LastUpdated, MembershipFeePaid, PaymentDate, PaymentTransaction,
    JoinYear, PhoneNumber, LastLogin, Notes, NYRRRunnerName, YearBorn
  )
  VALUES (
    CONCAT('ML-', UNIX_TIMESTAMP(NOW(3)) * 1000, '-', FLOOR(RAND() * 10000)),
    NOW(),
    NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID,
    NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.Info, NEW.LastUpdated, NEW.MembershipFeePaid, NEW.PaymentDate,
    NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.LastLogin,
    NEW.Notes, NEW.NYRRRunnerName, NEW.YearBorn
  );
END;
$$

-- Note: These triggers are AFTER triggers (fire after INSERT/UPDATE completes).
-- They log changes to member_log table for audit trail.
-- The columns logged match exactly what exists in member_log after V10-c migration.
