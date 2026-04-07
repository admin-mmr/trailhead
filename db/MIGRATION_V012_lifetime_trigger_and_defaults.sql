-- MIGRATION_V012: Lifetime trigger + sp_renewal_audit_default uses config
-- 1. BEFORE UPDATE trigger: auto-set Expiration = 2126-03-31 when Status = 'lifetime'
-- 2. Update sp_renewal_audit_default to pull dates from config table

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Lifetime expiration trigger
--    Fires BEFORE UPDATE on members.
--    When Status is set to 'lifetime', auto-set Expiration = 2126-03-31.
--    Skips when @internal_proc is set (prevents recursion from sp_admin_update).
-- ──────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_members_before_update_lifetime;

DELIMITER $$

CREATE TRIGGER trg_members_before_update_lifetime
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
    IF @internal_proc IS NULL AND NEW.Status = 'lifetime' AND OLD.Status <> 'lifetime' THEN
        SET NEW.Expiration = '2126-03-31';
    END IF;
END$$

DELIMITER ;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Update sp_renewal_audit_default to read from config table
--    Config keys used:
--      MembershipCollectionStart  → start of renewal window (e.g. 2025-10-01)
--      MembershipYearEnd          → target expiration date  (e.g. 2027-03-31)
-- ──────────────────────────────────────────────────────────────────────────

DROP PROCEDURE IF EXISTS sp_renewal_audit_default;

DELIMITER $$

CREATE PROCEDURE sp_renewal_audit_default()
BEGIN
    DECLARE v_start_date DATE;
    DECLARE v_target_expiration DATE;

    SELECT CAST(ConfigValue AS DATE) INTO v_start_date
    FROM config WHERE ConfigKey = 'MembershipCollectionStart';

    SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration
    FROM config WHERE ConfigKey = 'MembershipYearEnd';

    CALL sp_renewal_audit(v_start_date, CURDATE(), v_target_expiration, 'both', TRUE);
END$$

DELIMITER ;

-- ──────────────────────────────────────────────────────────────────────────
-- Audit trail
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V012', 'Lifetime trigger auto-expiry + sp_renewal_audit_default uses config', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
