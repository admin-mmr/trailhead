-- ============================================================================
-- MIGRATION_V009: Renewal Audit Stored Procedure
-- ============================================================================
-- Purpose: Efficiently audit membership renewals by tracing transactions to members
-- and checking expiration dates against expected renewal target.
--
-- Procedure: sp_renewal_audit(start_date, end_date, target_expiration, membership_type)
--
-- Parameters:
--   @start_date DATE           - Transaction search range start (YYYY-MM-DD)
--   @end_date DATE             - Transaction search range end (YYYY-MM-DD)
--   @target_expiration DATE    - Expected member expiration after renewal (YYYY-MM-DD)
--   @membership_type VARCHAR   - 'individual', 'family', or 'both'
--
-- Returns:
--   Table with columns:
--   - message_id: Gmail transaction MessageId
--   - amount: Transaction amount
--   - transaction_date: Date of transaction
--   - sender: Gmail sender name/email
--   - memo: Transaction memo
--   - member_id: Linked MemberID (if found)
--   - member_name: First + Last name
--   - current_expiration: Current member expiration date
--   - target_expiration: Expected expiration after renewal
--   - status_match: 'MATCH' if expiration >= target, 'MISMATCH' if old
--   - trace_route: How member was found (TransactionNumber/submissions/etc)
--   - family_members_checked: Count of related family members checked (if family)
--   - family_all_match: All family members have matching expirations? (Y/N)
--
-- Usage Example:
--   CALL sp_renewal_audit('2025-10-01', '2026-04-04', '2027-03-31', 'both');
-- ============================================================================

DELIMITER //

DROP PROCEDURE IF EXISTS sp_renewal_audit //

DELIMITER //

CREATE PROCEDURE sp_renewal_audit(
  IN p_start_date DATE,
  IN p_end_date DATE,
  IN p_target_expiration DATE,
  IN p_membership_type VARCHAR(50)
)
MODIFIES SQL DATA
BEGIN
  -- Cleanup temporary tables
  DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;
  DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;

  -- Results table with family check columns set to NULL default
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

  -- Internal working table for filtering transactions
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

  -- Step 1: Pull transactions in range matching standard fee amounts
  INSERT INTO tmp_matching_txns (message_id, amount, transaction_date, transaction_number, sender, memo, original_memo)
  SELECT MessageId, Amount, TransactionDate, TransactionNumber, Sender, Memo, OriginalMemo
  FROM gmail_transactions
  WHERE TransactionDate BETWEEN p_start_date AND p_end_date
    AND Amount IN (30.00, 50.00);

  -- Step 2: Path A - Direct link (members.PaymentTransaction)
  UPDATE tmp_matching_txns txn
  INNER JOIN members m ON txn.transaction_number = m.PaymentTransaction
  SET txn.member_id = m.MemberID, txn.traced = TRUE;

  -- Step 3: Path B - Split link (payments.TransactionNumber)
  UPDATE tmp_matching_txns txn
  INNER JOIN payments p ON txn.transaction_number = p.TransactionNumber
  INNER JOIN members m ON p.MemberID = m.MemberID
  SET txn.member_id = m.MemberID, txn.traced = TRUE
  WHERE txn.traced = FALSE;

  -- Step 4: Build audit results for traced members
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

  -- Step 5: Add untraced transactions
  INSERT INTO tmp_audit_results (message_id, amount, transaction_date, sender, memo, status_match, trace_route)
  SELECT message_id, amount, transaction_date, sender, COALESCE(memo, original_memo, ''), 'NOT TRACED', 'NOT FOUND'
  FROM tmp_matching_txns WHERE member_id IS NULL;

  -- Step 6: Perform Family Consistency Check
  UPDATE tmp_audit_results audit
  INNER JOIN members m ON audit.member_id = m.MemberID
  SET
    audit.family_members_checked = (SELECT COUNT(*) FROM members m2 WHERE m2.FamilyID = m.FamilyID),
    audit.family_all_match = (
        SELECT IF(MIN(m3.Expiration >= p_target_expiration) = 1, 'Y', 'N')
        FROM members m3 WHERE m3.FamilyID = m.FamilyID
    )
  WHERE m.FamilyID IS NOT NULL;

  -- Return final report
  SELECT * FROM tmp_audit_results 
  ORDER BY 
    FIELD(status_match, 'MISMATCH', 'NOT TRACED', 'MATCH', 'ERROR'),
    transaction_date DESC;

  -- Cleanup
  DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;
  DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;
END //
DELIMITER ;

-- Register this migration
INSERT INTO schema_versions (version, applied_at)
VALUES ('V009', NOW())
ON DUPLICATE KEY UPDATE applied_at = NOW();
