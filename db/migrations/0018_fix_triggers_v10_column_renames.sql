-- Migration 0018: Fix triggers for V10 column renames
--
-- PURPOSE:
--   Update triggers to use new column names after Migration V10:
--   - LastLoginDate → LastLogin
--   - Created → Created (for INSERT trigger, no change to column name)
--   - ProfileLastUpdated → REMOVED (drop trigger, column no longer exists)
--
-- TABLES AFFECTED:
--   - members (drop 2 triggers for ProfileLastUpdated, rename 2 for LastLogin)
--
-- NOTE:
--   This migration DROPS and RECREATES triggers. Safe because:
--   1. Triggers are not foreign keys, just auto-sync logic
--   2. Unix columns were not synced before this anyway (migration 0017 is new)
--   3. Existing unix values are already correct from backfill

-- Drop old triggers that reference removed columns
DROP TRIGGER IF EXISTS members_update_lastlogindate_unix;
DROP TRIGGER IF EXISTS members_insert_lastlogindate_unix;
DROP TRIGGER IF EXISTS members_update_profilelastupdated_unix;
DROP TRIGGER IF EXISTS members_insert_profilelastupdated_unix;
DROP TRIGGER IF EXISTS members_update_createdat_unix;
DROP TRIGGER IF EXISTS members_insert_createdat_unix;

-- ─────────────────────────────────────────────────────────────────────────────
-- NEW TRIGGERS FOR V10 COLUMN NAMES
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger: members_update_lastlogin_unix
-- Syncs: LastLogin → last_login_unix
CREATE TRIGGER members_update_lastlogin_unix
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.LastLogin <> OLD.LastLogin OR
     (NEW.LastLogin IS NULL AND OLD.LastLogin IS NOT NULL) OR
     (NEW.LastLogin IS NOT NULL AND OLD.LastLogin IS NULL)
  THEN
    SET NEW.last_login_unix = IF(NEW.LastLogin IS NULL, 0, UNIX_TIMESTAMP(NEW.LastLogin));
  END IF;
END;
$$

-- Trigger: members_insert_lastlogin_unix
-- Syncs: LastLogin → last_login_unix (on INSERT)
CREATE TRIGGER members_insert_lastlogin_unix
BEFORE INSERT ON members
FOR EACH ROW
BEGIN
  IF NEW.LastLogin IS NOT NULL THEN
    SET NEW.last_login_unix = UNIX_TIMESTAMP(NEW.LastLogin);
  ELSE
    SET NEW.last_login_unix = 0;
  END IF;
END;
$$

-- Trigger: members_update_created_unix
-- Syncs: Created → created_at_unix
CREATE TRIGGER members_update_created_unix
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.Created <> OLD.Created OR
     (NEW.Created IS NULL AND OLD.Created IS NOT NULL) OR
     (NEW.Created IS NOT NULL AND OLD.Created IS NULL)
  THEN
    SET NEW.created_at_unix = IF(NEW.Created IS NULL, 0, UNIX_TIMESTAMP(NEW.Created));
  END IF;
END;
$$

-- Trigger: members_insert_created_unix
-- Syncs: Created → created_at_unix (on INSERT)
CREATE TRIGGER members_insert_created_unix
BEFORE INSERT ON members
FOR EACH ROW
BEGIN
  IF NEW.Created IS NOT NULL THEN
    SET NEW.created_at_unix = UNIX_TIMESTAMP(NEW.Created);
  ELSE
    SET NEW.created_at_unix = 0;
  END IF;
END;
$$

-- NOTE: ProfileLastUpdated trigger is intentionally NOT recreated.
-- The ProfileLastUpdated column was dropped in Migration V10-b.
-- The profile_last_updated_unix column was never actually created in the schema.
-- If needed in the future, add LastUpdated instead (already has a trigger).
