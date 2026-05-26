-- MIGRATION_V022: Fix members_before_update trigger NULL-safe Expiration check
--
-- Bug: trigger condition `NEW.Expiration <> OLD.Expiration` evaluates to NULL
-- (not TRUE) when OLD.Expiration IS NULL, so inserting a date into a previously
-- NULL Expiration bypasses the guard entirely.
--
-- Fix: use the NULL-safe equality operator <=> so that NULL→date transitions
-- are caught the same as date→date changes.
--   NOT (NEW.Expiration <=> OLD.Expiration)
-- evaluates TRUE whenever the values differ, including NULL vs. non-NULL.

DELIMITER $$

DROP TRIGGER IF EXISTS `members_before_update`$$

CREATE DEFINER=`mmradmin`@`%` TRIGGER `members_before_update`
BEFORE UPDATE ON `members`
FOR EACH ROW
BEGIN
    IF NOT (NEW.Expiration <=> OLD.Expiration) THEN
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Direct update to Expiration column is not allowed. Use the approved Procedure.';
        END IF;
    END IF;
END$$

DELIMITER ;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V022', 'Fix members_before_update trigger NULL-safe Expiration check', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
