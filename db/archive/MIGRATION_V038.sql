-- ── MIGRATION_V038: rolling renewal expiration + notification log ────────────
-- Membership expiration moves from a single fixed club-year date to the rolling
-- rule requested by the club:
--
--     new expiration = MAX(current expiration + 1 year, anchor date + 1 year)
--
-- On-time renewers are unaffected in spirit — a member expiring 2027-03-31 who
-- renews lands on 2028-03-31, exactly as the old config-driven rule produced.
-- A LAPSED member no longer loses the months they were expired: someone who
-- expired 2026-03-31 and renews on 2026-07-30 now gets 2027-07-30 instead of
-- being snapped to the club year end.
--
-- Before this migration every one of the 408 active members shared
-- Expiration = config.MembershipYearEnd ('2027-03-31'), set in two places:
--   • trg_payments_sync_membership_only  (the live renewal path)
--   • sp_reconcile_member_payments       (the admin repair path)
-- Both are rewritten here. Leaving the second one alone would have silently
-- reverted every rolling date the next time an admin ran a reconcile.
--
-- Creates:
--   fn_next_expiration           — the renewal rule, in ONE place. Mirrored by
--                                  lib/membership/expiration.ts in the webapp;
--                                  change both together.
--   notification_log             — one row per member-facing email we send, with
--                                  a UNIQUE dedupe_key. This is what makes the
--                                  weekly renewal reminder job safe to re-run:
--                                  a member can never receive the same reminder
--                                  stage twice for the same expiration date.
--   config.RenewalRemindersEnabled     — kill switch, no deploy needed
--   config.RenewalReminderMaxPerRun    — per-run send cap (GAS/Gmail daily quota)
--
-- config.MembershipYearEnd is deliberately KEPT: the audit paths
-- (sp_renewal_audit, api_audit_members) compare with >= against it, which stays
-- correct under rolling dates. It is simply no longer the renewal target.
--
-- Every step is guarded by INFORMATION_SCHEMA or is a CREATE OR REPLACE-style
-- DROP + CREATE, so this file is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. fn_next_expiration — the single definition of the renewal rule.
--
--    Declared DETERMINISTIC + NO SQL on purpose: Azure MySQL Flexible Server
--    leaves log_bin_trust_function_creators OFF, so a function that is neither
--    would be rejected outright at CREATE time. That constraint is also why the
--    function reads nothing — no CURDATE(), no config lookup. Callers pass the
--    anchor date and the renewal length explicitly.
--
--    p_base   = the expiration being extended (NULL for a member who has never
--               had one — a brand-new join)
--    p_anchor = the date the renewal is measured from (payment date, or today)
--    p_years  = config.MembershipRenewalYears
--
--    Returns NULL if p_anchor is NULL; callers must COALESCE before calling.
DROP FUNCTION IF EXISTS fn_next_expiration;
CREATE FUNCTION fn_next_expiration(p_base DATE, p_anchor DATE, p_years INT)
RETURNS DATE
DETERMINISTIC
NO SQL
RETURN GREATEST(
    DATE_ADD(IFNULL(p_base, p_anchor), INTERVAL IFNULL(p_years, 1) YEAR),
    DATE_ADD(p_anchor,                 INTERVAL IFNULL(p_years, 1) YEAR)
);

-- 2. notification_log — send ledger + idempotency guard.
--
--    dedupe_key is the whole point. The weekly reminder job builds it as
--    'renewal:<MemberID>:<expiration>:<stage>', so:
--      • re-running the job in the same week sends nothing new
--      • a member who renews gets a NEW expiration, hence new keys, hence a
--        fresh reminder cycle next year without any cleanup
--    Failed sends are logged too (status='failed'), but with a NULL dedupe_key
--    so the next run retries them — a GAS timeout must not silently consume a
--    member's only notice.
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'notification_log');
SET @sql = IF(@tbl = 0,
    "CREATE TABLE notification_log (
        id          BIGINT NOT NULL AUTO_INCREMENT,
        MemberID    VARCHAR(10) NULL COMMENT 'FK to members.MemberID; NULL for anonymous recipients',
        email_type  VARCHAR(50) NOT NULL COMMENT 'Matches EMAIL_TYPES in lib/email/registry.ts',
        stage       VARCHAR(30) NULL COMMENT 'Reminder stage (T60/T30/T7/LAPSED_14/FINAL_45) where applicable',
        dedupe_key  VARCHAR(160) NULL COMMENT 'UNIQUE when set — prevents duplicate sends. NULL for retryable failures',
        recipient   VARCHAR(255) NOT NULL,
        subject     VARCHAR(255) NULL,
        status      ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
        error       TEXT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_notification_dedupe (dedupe_key),
        KEY idx_notification_member (MemberID),
        KEY idx_notification_type_created (email_type, created_at),
        CONSTRAINT fk_notification_member FOREIGN KEY (MemberID)
            REFERENCES members (MemberID) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Ledger of member-facing emails; dedupe_key makes scheduled jobs idempotent'",
    "SELECT 'notification_log already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Reminder job config knobs (INSERT IGNORE — never stomp an admin edit)
INSERT IGNORE INTO config (ConfigKey, ConfigValue)
VALUES ('RenewalRemindersEnabled', '1');
INSERT IGNORE INTO config (ConfigKey, ConfigValue)
VALUES ('RenewalReminderMaxPerRun', '150');

-- 4. trg_payments_sync_membership_only — the live renewal path.
--
--    Changes from the previous version:
--      a) Expiration comes from fn_next_expiration instead of
--         config.MembershipYearEnd.
--      b) The base is MAX(Expiration) across everyone the payment covers, so a
--         family renewal can never shorten one member's coverage to match a
--         shorter-dated relative.
--      c) lifetime members are no longer stomped. The old version updated every
--         row sharing the FamilyID unconditionally, which overwrote a lifetime
--         member's 2126-03-31 with the club year end. They now keep their
--         status and expiration; only the payment audit fields are recorded.
DROP TRIGGER IF EXISTS trg_payments_sync_membership_only;

DELIMITER $$
CREATE TRIGGER trg_payments_sync_membership_only
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
    DECLARE v_years      INT;
    DECLARE v_anchor     DATE;
    DECLARE v_family_id  VARCHAR(50);
    DECLARE v_base_exp   DATE;
    DECLARE v_new_exp    DATE;

    -- Membership-related payments only (LOWER for case-insensitive matching)
    IF LOWER(NEW.PaymentType) LIKE '%membership%' THEN

        SELECT CAST(ConfigValue AS UNSIGNED) INTO v_years
        FROM config WHERE ConfigKey = 'MembershipRenewalYears' LIMIT 1;
        SET v_years = IFNULL(v_years, 1);

        -- Anchor on the payment date so a back-dated import lands where it
        -- belongs; fall back to today when the ledger row has no date.
        SET v_anchor = IFNULL(NEW.PaymentDate, CURDATE());

        SELECT FamilyID INTO v_family_id
        FROM members WHERE MemberID = NEW.MemberID LIMIT 1;

        IF v_family_id IS NOT NULL AND v_family_id <> '' THEN
            SELECT MAX(Expiration) INTO v_base_exp
            FROM members
            WHERE (FamilyID = v_family_id OR MemberID = NEW.MemberID)
              AND Status <> 'lifetime';
        ELSE
            SELECT Expiration INTO v_base_exp
            FROM members
            WHERE MemberID = NEW.MemberID AND Status <> 'lifetime' LIMIT 1;
        END IF;

        SET v_new_exp = fn_next_expiration(v_base_exp, v_anchor, v_years);

        -- LOCK: members_before_update blocks any Expiration write without this,
        -- and it also stops this trigger from recursing.
        SET @internal_proc = 1;

        -- Everyone the payment covers, except lifetime members.
        UPDATE members
        SET Status             = 'active',
            MembershipFeePaid  = NEW.Amount,
            PaymentDate        = NEW.PaymentDate,
            PaymentTransaction = NEW.TransactionNumber,
            Expiration         = v_new_exp,
            UpdatedAt          = NOW()
        WHERE Status <> 'lifetime'
          AND (
                MemberID = NEW.MemberID
                OR (v_family_id IS NOT NULL AND v_family_id <> '' AND FamilyID = v_family_id)
              );

        -- Lifetime members in scope: record the payment, leave status and
        -- expiration alone. Kept as a separate statement rather than a CASE in
        -- the UPDATE above because column assignment order matters in MySQL and
        -- this rule is too important to hide behind that subtlety.
        UPDATE members
        SET MembershipFeePaid  = NEW.Amount,
            PaymentDate        = NEW.PaymentDate,
            PaymentTransaction = NEW.TransactionNumber,
            UpdatedAt          = NOW()
        WHERE Status = 'lifetime'
          AND (
                MemberID = NEW.MemberID
                OR (v_family_id IS NOT NULL AND v_family_id <> '' AND FamilyID = v_family_id)
              );

        SET @internal_proc = NULL;

    END IF;
END$$
DELIMITER ;

-- 5. sp_reconcile_member_payments — the admin repair path.
--
--    ⚠️ The important change. The old version force-set
--    Expiration = config.MembershipYearEnd for every member with a membership
--    payment since MembershipCollectionStart. Under a rolling rule that would
--    walk every renewed member BACK to the club year end.
--
--    The naive fix — re-apply fn_next_expiration to the member's current date —
--    would be worse: it is not idempotent, so every re-run would hand out
--    another year. Instead the repair target is derived purely from the PAYMENT
--    DATE (payment_date + MembershipRenewalYears), and the update is
--    NON-DECREASING. That makes the proc idempotent, keeps it useful for rows
--    the trigger never touched, and makes it incapable of shortening anyone's
--    membership. A member the trigger handled correctly already sits at or past
--    the target, so reconcile leaves them alone.
DROP PROCEDURE IF EXISTS sp_reconcile_member_payments;

DELIMITER $$
CREATE PROCEDURE sp_reconcile_member_payments(IN p_dry_run BOOLEAN)
BEGIN
    DECLARE v_start_date DATE;
    DECLARE v_years      INT;

    SELECT CAST(ConfigValue AS DATE) INTO v_start_date
    FROM config WHERE ConfigKey = 'MembershipCollectionStart';

    SELECT CAST(ConfigValue AS UNSIGNED) INTO v_years
    FROM config WHERE ConfigKey = 'MembershipRenewalYears';
    SET v_years = IFNULL(v_years, 1);

    DROP TEMPORARY TABLE IF EXISTS tmp_to_update;
    CREATE TEMPORARY TABLE tmp_to_update AS
    SELECT DISTINCT
        m.MemberID,
        m.FamilyID,
        p.TransactionNumber AS actual_tx,
        p.PaymentDate       AS actual_date,
        p.Amount            AS actual_amount,
        -- Repair target: derived from the payment date only, so re-running this
        -- proc can never grant a second year.
        fn_next_expiration(NULL, p.PaymentDate, v_years) AS target_expiration
    FROM members m
    INNER JOIN payments p ON m.MemberID = p.MemberID
    WHERE LOWER(p.PaymentType) LIKE '%membership%'
      AND (p.PaymentMethod IS NULL OR p.PaymentMethod <> 'Stripe (TEST)')
      AND p.PaymentDate >= v_start_date
      AND m.Status <> 'lifetime'
      AND (
        m.Status <> 'active'
        -- Only a SHORTFALL counts as a mismatch now. Anyone at or past the
        -- payment-derived target is correct, including rolling dates that sit
        -- well beyond the club year end.
        OR m.Expiration IS NULL
        OR m.Expiration < fn_next_expiration(NULL, p.PaymentDate, v_years)
        OR m.PaymentTransaction <> p.TransactionNumber
        OR (p.PaymentDate IS NOT NULL AND (m.PaymentDate IS NULL OR m.PaymentDate <> p.PaymentDate))
      );

    IF p_dry_run THEN
        SELECT
            'DRY RUN'                            AS run_status,
            t.MemberID,
            CONCAT(m.FirstName, ' ', m.LastName) AS member_name,
            m.Type                               AS member_type,
            m.Status                             AS current_status,
            'active'                             AS target_status,
            CASE WHEN m.Status <> 'active' THEN 'STATUS MISMATCH' ELSE 'ok' END AS status_match,
            m.Expiration                         AS current_expiration,
            t.target_expiration                  AS target_expiration,
            GREATEST(IFNULL(m.Expiration, t.target_expiration), t.target_expiration)
                                                 AS resulting_expiration,
            CASE
                WHEN m.Expiration IS NULL                  THEN 'EXP MISSING'
                WHEN m.Expiration < t.target_expiration    THEN 'EXP SHORT'
                ELSE 'ok'
            END                                  AS exp_match,
            m.PaymentTransaction                 AS current_tx,
            t.actual_tx                          AS new_tx,
            m.PaymentDate                        AS current_payment_date,
            t.actual_date                        AS new_payment_date,
            t.actual_amount                      AS new_amount,
            t.FamilyID
        FROM tmp_to_update t
        INNER JOIN members m ON t.MemberID = m.MemberID
        ORDER BY status_match DESC, exp_match DESC, m.LastName, m.FirstName;
    ELSE
        START TRANSACTION;
        SET @internal_proc = 1;

        -- Paying members. GREATEST keeps this non-decreasing.
        UPDATE members m
        INNER JOIN tmp_to_update t ON m.MemberID = t.MemberID
        SET
            m.Status             = 'active',
            m.Expiration         = GREATEST(IFNULL(m.Expiration, t.target_expiration),
                                            t.target_expiration),
            m.PaymentTransaction = t.actual_tx,
            m.PaymentDate        = t.actual_date,
            m.MembershipFeePaid  = t.actual_amount,
            m.UpdatedAt          = NOW();

        -- Their families. Same non-decreasing rule, and lifetime members are
        -- excluded here too (the old version overwrote them).
        UPDATE members m
        INNER JOIN (
            SELECT FamilyID, MAX(target_expiration) AS target_expiration
            FROM tmp_to_update
            WHERE FamilyID IS NOT NULL AND FamilyID <> ''
            GROUP BY FamilyID
        ) f ON m.FamilyID = f.FamilyID
        SET
            m.Status     = 'active',
            m.Expiration = GREATEST(IFNULL(m.Expiration, f.target_expiration),
                                    f.target_expiration),
            m.UpdatedAt  = NOW()
        WHERE m.Status <> 'lifetime';

        COMMIT;
        SET @internal_proc = NULL;

        SELECT 'SUCCESS' AS run_status, t.* FROM tmp_to_update t;
    END IF;

    DROP TEMPORARY TABLE IF EXISTS tmp_to_update;
END$$
DELIMITER ;

-- 6. Self-registration (audit trail + prevents re-runs)
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V038', 'Rolling renewal expiration (fn_next_expiration) + notification_log + reminder config', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
