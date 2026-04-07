-- V011: Enrich sp_reconcile_member_payments dry-run output
-- Adds member name, type, current status/expiration/tx/payment_date so admin can review before live run
-- Mismatch condition now also catches PaymentDate divergence between payments and members tables

DROP PROCEDURE IF EXISTS sp_reconcile_member_payments;

DELIMITER $$

CREATE PROCEDURE sp_reconcile_member_payments(IN p_dry_run BOOLEAN)
BEGIN
    DECLARE v_start_date DATE;
    DECLARE v_target_expiration DATE;

    -- Fetch config
    SELECT CAST(ConfigValue AS DATE) INTO v_start_date FROM config WHERE ConfigKey = 'MembershipCollectionStart';
    SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration FROM config WHERE ConfigKey = 'MembershipYearEnd';

    DROP TEMPORARY TABLE IF EXISTS tmp_to_update;
    CREATE TEMPORARY TABLE tmp_to_update AS
    SELECT DISTINCT
        m.MemberID,
        m.FamilyID,
        p.TransactionNumber AS actual_tx,
        p.PaymentDate AS actual_date,
        p.Amount AS actual_amount
    FROM members m
    INNER JOIN payments p ON m.MemberID = p.MemberID
    WHERE LOWER(p.PaymentType) LIKE '%membership%'
      AND p.PaymentDate >= v_start_date
      AND m.Status <> 'lifetime'
      AND (
        m.Expiration <> v_target_expiration
        OR m.PaymentTransaction <> p.TransactionNumber
        OR (p.PaymentDate IS NOT NULL AND (m.PaymentDate IS NULL OR m.PaymentDate <> p.PaymentDate))
      );

    IF p_dry_run THEN
        SELECT
            'DRY RUN'                       AS run_status,
            t.MemberID,
            CONCAT(m.FirstName, ' ', m.LastName) AS member_name,
            m.Type                          AS member_type,
            m.Status                        AS current_status,
            m.Expiration                    AS current_expiration,
            v_target_expiration             AS target_expiration,
            m.PaymentTransaction            AS current_tx,
            t.actual_tx                     AS new_tx,
            m.PaymentDate                   AS current_payment_date,
            t.actual_date                   AS new_payment_date,
            t.actual_amount                 AS new_amount,
            t.FamilyID
        FROM tmp_to_update t
        INNER JOIN members m ON t.MemberID = m.MemberID
        ORDER BY m.LastName, m.FirstName;
    ELSE
        START TRANSACTION;

        SET @internal_proc = 1;

        -- Step A: Update Primary Payers
        UPDATE members m
        INNER JOIN tmp_to_update t ON m.MemberID = t.MemberID
        SET
            m.Status = 'active',
            m.Expiration = v_target_expiration,
            m.PaymentTransaction = t.actual_tx,
            m.PaymentDate = t.actual_date,
            m.MembershipFeePaid = t.actual_amount,
            m.UpdatedAt = NOW();

        -- Step B: Update Family members
        UPDATE members
        SET
            Status = 'active',
            Expiration = v_target_expiration,
            UpdatedAt = NOW()
        WHERE FamilyID IN (SELECT DISTINCT FamilyID FROM tmp_to_update WHERE FamilyID <> '' AND FamilyID IS NOT NULL);

        COMMIT;
        SET @internal_proc = NULL;

        SELECT 'SUCCESS' AS run_status, t.* FROM tmp_to_update t;
    END IF;
END$$

DELIMITER ;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V011', 'Enrich sp_reconcile_member_payments dry-run output with member details', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
