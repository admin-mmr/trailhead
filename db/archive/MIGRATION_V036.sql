-- MIGRATION_V036: Exclude Stripe test-mode payments from reconciliation + renewal audit
--
-- V035 stamped test-mode Stripe rows as PaymentMethod = 'Stripe (TEST)' in both
-- payments and gmail_transactions. These two procedures still counted them as real
-- money: sp_reconcile_member_payments would ACTIVATE a member (status/expiration/
-- fee/tx) off a test charge, and sp_renewal_audit reported test $30/$50 rows as
-- genuine renewals. Both now skip 'Stripe (TEST)'; NULL PaymentMethod is kept so
-- legacy rows are unaffected.
--
-- Affected procedures: sp_reconcile_member_payments, sp_renewal_audit
-- Bodies are otherwise verbatim copies of the live definitions (SHOW CREATE PROCEDURE).

DELIMITER $$

-- ============================================================================
-- sp_reconcile_member_payments (test-mode payments excluded)
-- ============================================================================
DROP PROCEDURE IF EXISTS `sp_reconcile_member_payments`$$
CREATE PROCEDURE `sp_reconcile_member_payments`(IN p_dry_run TINYINT(1))
BEGIN
    DECLARE v_start_date DATE;
    DECLARE v_target_expiration DATE;

    SELECT CAST(ConfigValue AS DATE) INTO v_start_date      FROM config WHERE ConfigKey = 'MembershipCollectionStart';
    SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration FROM config WHERE ConfigKey = 'MembershipYearEnd';

    DROP TEMPORARY TABLE IF EXISTS tmp_to_update;
    CREATE TEMPORARY TABLE tmp_to_update AS
    SELECT DISTINCT
        m.MemberID,
        m.FamilyID,
        p.TransactionNumber AS actual_tx,
        p.PaymentDate       AS actual_date,
        p.Amount            AS actual_amount
    FROM members m
    INNER JOIN payments p ON m.MemberID = p.MemberID
    WHERE LOWER(p.PaymentType) LIKE '%membership%'
      AND (p.PaymentMethod IS NULL OR p.PaymentMethod <> 'Stripe (TEST)')
      AND p.PaymentDate >= v_start_date
      AND m.Status <> 'lifetime'
      AND (
        m.Status         <> 'active'                     -- NEW: catch inactive despite valid payment
        OR m.Expiration  <> v_target_expiration
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
            v_target_expiration                  AS target_expiration,
            CASE WHEN m.Expiration <> v_target_expiration THEN 'EXP MISMATCH' ELSE 'ok' END AS exp_match,
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

        -- Fix primary members
        UPDATE members m
        INNER JOIN tmp_to_update t ON m.MemberID = t.MemberID
        SET
            m.Status             = 'active',
            m.Expiration         = v_target_expiration,
            m.PaymentTransaction = t.actual_tx,
            m.PaymentDate        = t.actual_date,
            m.MembershipFeePaid  = t.actual_amount,
            m.UpdatedAt          = NOW();

        -- Cascade to family members
        UPDATE members
        SET
            Status     = 'active',
            Expiration = v_target_expiration,
            UpdatedAt  = NOW()
        WHERE FamilyID IN (SELECT DISTINCT FamilyID FROM tmp_to_update WHERE FamilyID <> '' AND FamilyID IS NOT NULL);

        COMMIT;
        SET @internal_proc = NULL;

        SELECT 'SUCCESS' AS run_status, t.* FROM tmp_to_update t;
    END IF;

    DROP TEMPORARY TABLE IF EXISTS tmp_to_update;
END$$

-- ============================================================================
-- sp_renewal_audit (test-mode transactions excluded)
-- ============================================================================
DROP PROCEDURE IF EXISTS `sp_renewal_audit`$$
CREATE PROCEDURE `sp_renewal_audit`(
  IN p_start_date DATE,
  IN p_end_date DATE,
  IN p_target_expiration DATE,
  IN p_membership_type VARCHAR(50),
  IN p_only_mismatches BOOLEAN
)
    MODIFIES SQL DATA
BEGIN
  
  DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;
  DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;

  
  CREATE TEMPORARY TABLE tmp_audit_results (
    message_id VARCHAR(100),
    amount DECIMAL(10,2),
    transaction_date DATE,
    sender VARCHAR(255),
    memo TEXT,
    member_id VARCHAR(10),
    member_name VARCHAR(255),
    current_expiration DATE,
    target_expiration DATE,
    status_match VARCHAR(20),
    trace_route VARCHAR(100),
    family_members_checked INT DEFAULT NULL,
    family_all_match CHAR(1) DEFAULT NULL
  );

  
  CREATE TEMPORARY TABLE tmp_matching_txns (
    message_id VARCHAR(100),
    amount DECIMAL(10,2),
    transaction_date DATE,
    transaction_number VARCHAR(100),
    sender VARCHAR(255),
    memo TEXT,
    original_memo TEXT,
    traced BOOLEAN DEFAULT FALSE,
    member_id VARCHAR(10)
  );

  
  INSERT INTO tmp_matching_txns (message_id, amount, transaction_date, transaction_number, sender, memo, original_memo)
  SELECT MessageId, Amount, TransactionDate, TransactionNumber, Sender, Memo, OriginalMemo
  FROM gmail_transactions
  WHERE TransactionDate BETWEEN p_start_date AND p_end_date
    AND Amount IN (30.00, 50.00)
    AND (PaymentMethod IS NULL OR PaymentMethod <> 'Stripe (TEST)');

  
  UPDATE tmp_matching_txns txn
  INNER JOIN members m ON txn.transaction_number = m.PaymentTransaction
  SET txn.member_id = m.MemberID, txn.traced = TRUE;

  
  UPDATE tmp_matching_txns txn
  INNER JOIN payments p ON txn.transaction_number = p.TransactionNumber
  INNER JOIN members m ON p.MemberID = m.MemberID
  SET txn.member_id = m.MemberID, txn.traced = TRUE
  WHERE txn.traced = FALSE;

  
  INSERT INTO tmp_audit_results (
    message_id, amount, transaction_date, sender, memo,
    member_id, member_name, current_expiration, target_expiration,
    status_match, trace_route
  )
  SELECT
    txn.message_id, txn.amount, txn.transaction_date, txn.sender,
    COALESCE(txn.memo, txn.original_memo, ''),
    txn.member_id, CONCAT(m.FirstName, ' ', m.LastName),
    m.Expiration, p_target_expiration,
    CASE
      WHEN m.Expiration IS NULL THEN 'ERROR'
      WHEN m.Expiration >= p_target_expiration THEN 'MATCH'
      ELSE 'MISMATCH'
    END,
    CASE
      WHEN m.PaymentTransaction = txn.transaction_number THEN 'members.PaymentTransaction'
      WHEN txn.traced THEN 'payments.TransactionNumber'
      ELSE 'UNKNOWN'
    END
  FROM tmp_matching_txns txn
  INNER JOIN members m ON txn.member_id = m.MemberID
  WHERE (p_membership_type = 'both')
     OR (p_membership_type = 'individual' AND LOWER(m.Type) = 'individual')
     OR (p_membership_type = 'family' AND LOWER(m.Type) = 'family');

  
  INSERT INTO tmp_audit_results (message_id, amount, transaction_date, sender, memo, status_match, trace_route)
  SELECT message_id, amount, transaction_date, sender, COALESCE(memo, original_memo, ''), 'NOT TRACED', 'NOT FOUND'
  FROM tmp_matching_txns WHERE member_id IS NULL;

  
  UPDATE tmp_audit_results audit
  INNER JOIN members m ON audit.member_id = m.MemberID
  SET
    audit.family_members_checked = (SELECT COUNT(*) FROM members m2 WHERE m2.FamilyID = m.FamilyID),
    audit.family_all_match = (
        SELECT IF(MIN(m3.Expiration >= p_target_expiration) = 1, 'Y', 'N')
        FROM members m3 WHERE m3.FamilyID = m.FamilyID
    )
  WHERE m.FamilyID IS NOT NULL;

  
  SELECT * FROM tmp_audit_results 
  WHERE (p_only_mismatches IS FALSE OR status_match <> 'MATCH')
  ORDER BY 
    FIELD(status_match, 'MISMATCH', 'NOT TRACED', 'MATCH', 'ERROR'),
    transaction_date DESC;

  DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;
  DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;
END$$

DELIMITER ;

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V036', 'Exclude Stripe (TEST) rows from sp_reconcile_member_payments + sp_renewal_audit', NOW())
ON DUPLICATE KEY UPDATE executed_at=NOW();
