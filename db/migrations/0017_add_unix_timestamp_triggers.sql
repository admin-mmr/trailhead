-- Migration 0017: Add triggers to auto-sync Unix timestamp columns
--
-- PURPOSE:
--   Keep Unix timestamp columns in sync with their corresponding DATETIME columns.
--   Triggers fire on INSERT and UPDATE to ensure updated_at_unix, last_login_date_unix, etc.
--   are always set to UNIX_TIMESTAMP(datetime_col) when the datetime changes.
--
-- TABLES AFFECTED:
--   - members (4 triggers: LastUpdated, LastLoginDate, ProfileLastUpdated, CreatedAt)
--   - payments (1 trigger: ProcessedDate)
--   - webapp_events (3 triggers: Timestamp, ExpiresAt, ApprovalDate)
--
-- NOTES:
--   - UNIX_TIMESTAMP() returns NULL for NULL input; we store 0 for NULL dates
--   - Triggers only update the Unix column if the datetime column changed
--   - Existing data must be backfilled separately (see backfill_unix_timestamps.py)

-- ─────────────────────────────────────────────────────────────────────────────
-- MEMBERS TABLE TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger: members_update_lastupdated_unix
-- Syncs: LastUpdated → updated_at_unix
CREATE TRIGGER members_update_lastupdated_unix
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.LastUpdated <> OLD.LastUpdated OR
     (NEW.LastUpdated IS NULL AND OLD.LastUpdated IS NOT NULL) OR
     (NEW.LastUpdated IS NOT NULL AND OLD.LastUpdated IS NULL)
  THEN
    SET NEW.updated_at_unix = IF(NEW.LastUpdated IS NULL, 0, UNIX_TIMESTAMP(NEW.LastUpdated));
  END IF;
END;
$$

-- Trigger: members_insert_lastupdated_unix
-- Syncs: LastUpdated → updated_at_unix (on INSERT)
CREATE TRIGGER members_insert_lastupdated_unix
BEFORE INSERT ON members
FOR EACH ROW
BEGIN
  IF NEW.LastUpdated IS NOT NULL THEN
    SET NEW.updated_at_unix = UNIX_TIMESTAMP(NEW.LastUpdated);
  ELSE
    SET NEW.updated_at_unix = 0;
  END IF;
END;
$$

-- Trigger: members_update_lastlogindate_unix
-- Syncs: LastLoginDate → last_login_date_unix
CREATE TRIGGER members_update_lastlogindate_unix
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.LastLoginDate <> OLD.LastLoginDate OR
     (NEW.LastLoginDate IS NULL AND OLD.LastLoginDate IS NOT NULL) OR
     (NEW.LastLoginDate IS NOT NULL AND OLD.LastLoginDate IS NULL)
  THEN
    SET NEW.last_login_date_unix = IF(NEW.LastLoginDate IS NULL, 0, UNIX_TIMESTAMP(NEW.LastLoginDate));
  END IF;
END;
$$

-- Trigger: members_insert_lastlogindate_unix
-- Syncs: LastLoginDate → last_login_date_unix (on INSERT)
CREATE TRIGGER members_insert_lastlogindate_unix
BEFORE INSERT ON members
FOR EACH ROW
BEGIN
  IF NEW.LastLoginDate IS NOT NULL THEN
    SET NEW.last_login_date_unix = UNIX_TIMESTAMP(NEW.LastLoginDate);
  ELSE
    SET NEW.last_login_date_unix = 0;
  END IF;
END;
$$

-- Trigger: members_update_profilelastupdated_unix
-- Syncs: ProfileLastUpdated → profile_last_updated_unix
CREATE TRIGGER members_update_profilelastupdated_unix
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.ProfileLastUpdated <> OLD.ProfileLastUpdated OR
     (NEW.ProfileLastUpdated IS NULL AND OLD.ProfileLastUpdated IS NOT NULL) OR
     (NEW.ProfileLastUpdated IS NOT NULL AND OLD.ProfileLastUpdated IS NULL)
  THEN
    SET NEW.profile_last_updated_unix = IF(NEW.ProfileLastUpdated IS NULL, 0, UNIX_TIMESTAMP(NEW.ProfileLastUpdated));
  END IF;
END;
$$

-- Trigger: members_insert_profilelastupdated_unix
-- Syncs: ProfileLastUpdated → profile_last_updated_unix (on INSERT)
CREATE TRIGGER members_insert_profilelastupdated_unix
BEFORE INSERT ON members
FOR EACH ROW
BEGIN
  IF NEW.ProfileLastUpdated IS NOT NULL THEN
    SET NEW.profile_last_updated_unix = UNIX_TIMESTAMP(NEW.ProfileLastUpdated);
  ELSE
    SET NEW.profile_last_updated_unix = 0;
  END IF;
END;
$$

-- Trigger: members_update_createdat_unix
-- Syncs: CreatedAt → created_at_unix
CREATE TRIGGER members_update_createdat_unix
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.CreatedAt <> OLD.CreatedAt OR
     (NEW.CreatedAt IS NULL AND OLD.CreatedAt IS NOT NULL) OR
     (NEW.CreatedAt IS NOT NULL AND OLD.CreatedAt IS NULL)
  THEN
    SET NEW.created_at_unix = IF(NEW.CreatedAt IS NULL, 0, UNIX_TIMESTAMP(NEW.CreatedAt));
  END IF;
END;
$$

-- Trigger: members_insert_createdat_unix
-- Syncs: CreatedAt → created_at_unix (on INSERT)
CREATE TRIGGER members_insert_createdat_unix
BEFORE INSERT ON members
FOR EACH ROW
BEGIN
  IF NEW.CreatedAt IS NOT NULL THEN
    SET NEW.created_at_unix = UNIX_TIMESTAMP(NEW.CreatedAt);
  ELSE
    SET NEW.created_at_unix = 0;
  END IF;
END;
$$

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENTS TABLE TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger: payments_update_processeddate_unix
-- Syncs: ProcessedDate → processed_date_unix
CREATE TRIGGER payments_update_processeddate_unix
BEFORE UPDATE ON payments
FOR EACH ROW
BEGIN
  IF NEW.ProcessedDate <> OLD.ProcessedDate OR
     (NEW.ProcessedDate IS NULL AND OLD.ProcessedDate IS NOT NULL) OR
     (NEW.ProcessedDate IS NOT NULL AND OLD.ProcessedDate IS NULL)
  THEN
    SET NEW.processed_date_unix = IF(NEW.ProcessedDate IS NULL, 0, UNIX_TIMESTAMP(NEW.ProcessedDate));
  END IF;
END;
$$

-- Trigger: payments_insert_processeddate_unix
-- Syncs: ProcessedDate → processed_date_unix (on INSERT)
CREATE TRIGGER payments_insert_processeddate_unix
BEFORE INSERT ON payments
FOR EACH ROW
BEGIN
  IF NEW.ProcessedDate IS NOT NULL THEN
    SET NEW.processed_date_unix = UNIX_TIMESTAMP(NEW.ProcessedDate);
  ELSE
    SET NEW.processed_date_unix = 0;
  END IF;
END;
$$

-- ─────────────────────────────────────────────────────────────────────────────
-- WEBAPP_EVENTS TABLE TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger: webapp_events_update_timestamp_unix
-- Syncs: Timestamp → timestamp_unix
CREATE TRIGGER webapp_events_update_timestamp_unix
BEFORE UPDATE ON webapp_events
FOR EACH ROW
BEGIN
  IF NEW.Timestamp <> OLD.Timestamp OR
     (NEW.Timestamp IS NULL AND OLD.Timestamp IS NOT NULL) OR
     (NEW.Timestamp IS NOT NULL AND OLD.Timestamp IS NULL)
  THEN
    SET NEW.timestamp_unix = IF(NEW.Timestamp IS NULL, 0, UNIX_TIMESTAMP(NEW.Timestamp));
  END IF;
END;
$$

-- Trigger: webapp_events_insert_timestamp_unix
-- Syncs: Timestamp → timestamp_unix (on INSERT)
CREATE TRIGGER webapp_events_insert_timestamp_unix
BEFORE INSERT ON webapp_events
FOR EACH ROW
BEGIN
  IF NEW.Timestamp IS NOT NULL THEN
    SET NEW.timestamp_unix = UNIX_TIMESTAMP(NEW.Timestamp);
  ELSE
    SET NEW.timestamp_unix = 0;
  END IF;
END;
$$

-- Trigger: webapp_events_update_expiresat_unix
-- Syncs: ExpiresAt → expires_at_unix
CREATE TRIGGER webapp_events_update_expiresat_unix
BEFORE UPDATE ON webapp_events
FOR EACH ROW
BEGIN
  IF NEW.ExpiresAt <> OLD.ExpiresAt OR
     (NEW.ExpiresAt IS NULL AND OLD.ExpiresAt IS NOT NULL) OR
     (NEW.ExpiresAt IS NOT NULL AND OLD.ExpiresAt IS NULL)
  THEN
    SET NEW.expires_at_unix = IF(NEW.ExpiresAt IS NULL, 0, UNIX_TIMESTAMP(NEW.ExpiresAt));
  END IF;
END;
$$

-- Trigger: webapp_events_insert_expiresat_unix
-- Syncs: ExpiresAt → expires_at_unix (on INSERT)
CREATE TRIGGER webapp_events_insert_expiresat_unix
BEFORE INSERT ON webapp_events
FOR EACH ROW
BEGIN
  IF NEW.ExpiresAt IS NOT NULL THEN
    SET NEW.expires_at_unix = UNIX_TIMESTAMP(NEW.ExpiresAt);
  ELSE
    SET NEW.expires_at_unix = 0;
  END IF;
END;
$$

-- Trigger: webapp_events_update_approvaldate_unix
-- Syncs: ApprovalDate → approval_date_unix
CREATE TRIGGER webapp_events_update_approvaldate_unix
BEFORE UPDATE ON webapp_events
FOR EACH ROW
BEGIN
  IF NEW.ApprovalDate <> OLD.ApprovalDate OR
     (NEW.ApprovalDate IS NULL AND OLD.ApprovalDate IS NOT NULL) OR
     (NEW.ApprovalDate IS NOT NULL AND OLD.ApprovalDate IS NULL)
  THEN
    SET NEW.approval_date_unix = IF(NEW.ApprovalDate IS NULL, 0, UNIX_TIMESTAMP(NEW.ApprovalDate));
  END IF;
END;
$$

-- Trigger: webapp_events_insert_approvaldate_unix
-- Syncs: ApprovalDate → approval_date_unix (on INSERT)
CREATE TRIGGER webapp_events_insert_approvaldate_unix
BEFORE INSERT ON webapp_events
FOR EACH ROW
BEGIN
  IF NEW.ApprovalDate IS NOT NULL THEN
    SET NEW.approval_date_unix = UNIX_TIMESTAMP(NEW.ApprovalDate);
  ELSE
    SET NEW.approval_date_unix = 0;
  END IF;
END;
$$
