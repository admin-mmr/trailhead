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

CREATE PROCEDURE sp_renewal_audit(
  IN p_start_date DATE,
  IN p_end_date DATE,
  IN p_target_expiration DATE,
  IN p_membership_type VARCHAR(50)
)
READS SQL DATA
BEGIN
  -- Temporary table to hold matched transactions with member info
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
    family_members_checked INT DEFAULT 0,
    family_all_match CHAR(1) DEFAULT NULL
  );

  -- Step 1: Find all transactions in date range matching membership fees ($30/$50)
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
  SELECT
    MessageId,
    Amount,
    TransactionDate,
    TransactionNumber,
    Sender,
    Memo,
    OriginalMemo
  FROM gmail_transactions
  WHERE TransactionDate BETWEEN p_start_date AND p_end_date
    AND Amount IN (30.00, 50.00)
  ORDER BY TransactionDate DESC;

  -- Step 2: PATH 1 - Trace via TransactionNumber → members.PaymentTransaction
  UPDATE tmp_matching_txns txn
  INNER JOIN members m ON txn.transaction_number = m.PaymentTransaction
  SET txn.member_id = m.MemberID, txn.traced = TRUE
  WHERE txn.traced = FALSE AND txn.transaction_number IS NOT NULL;

  -- Step 3: PATH 2 - Trace via TransactionNumber → payments → members
  UPDATE tmp_matching_txns txn
  INNER JOIN payments p ON txn.transaction_number = p.TransactionNumber
  INNER JOIN members m ON p.MemberID = m.MemberID
  SET txn.member_id = m.MemberID, txn.traced = TRUE
  WHERE txn.traced = FALSE AND txn.transaction_number IS NOT NULL;

  -- Step 4: PATH 3 - Trace via MessageId → submissions → members
  UPDATE tmp_matching_txns txn
  INNER JOIN submissions s ON txn.message_id = s.MatchedMessageId
  INNER JOIN members m ON s.MemberID = m.MemberID
  SET txn.member_id = m.MemberID, txn.traced = TRUE
  WHERE txn.traced = FALSE;

  -- Step 5: Build audit results with member info and expiration check
  INSERT INTO tmp_audit_results (
    message_id, amount, transaction_date, sender, memo,
    member_id, member_name, current_expiration, target_expiration,
    status_match, trace_route
  )
  SELECT
    txn.message_id,
    txn.amount,
    txn.transaction_date,
    txn.sender,
    COALESCE(txn.memo, txn.original_memo, ''),
    txn.member_id,
    CONCAT(m.FirstName, ' ', m.LastName),
    m.Expiration,
    p_target_expiration,
    CASE
      WHEN m.Expiration IS NULL THEN 'ERROR'
      WHEN m.Expiration >= p_target_expiration THEN 'MATCH'
      ELSE 'MISMATCH'
    END AS status_match,
    CASE
      WHEN m.PaymentTransaction = txn.transaction_number THEN 'members.PaymentTransaction'
      WHEN EXISTS (
        SELECT 1 FROM payments p
        WHERE p.TransactionNumber = txn.transaction_number
          AND p.MemberID = txn.member_id
      ) THEN 'payments.TransactionNumber → members'
      WHEN EXISTS (
        SELECT 1 FROM submissions s
        WHERE s.MatchedMessageId = txn.message_id
          AND s.MemberID = txn.member_id
      ) THEN 'submissions.MatchedMessageId → members'
      ELSE 'UNKNOWN'
    END AS trace_route
  FROM tmp_matching_txns txn
  LEFT JOIN members m ON txn.member_id = m.MemberID
  WHERE (p_membership_type = 'both')
     OR (p_membership_type = 'individual' AND (m.Type = 'Individual' OR m.Type IS NULL))
     OR (p_membership_type = 'family' AND m.Type = 'Family');

  -- Step 6: Add untraced transactions (no member found)
  INSERT INTO tmp_audit_results (
    message_id, amount, transaction_date, sender, memo,
    member_id, member_name, current_expiration, target_expiration,
    status_match, trace_route
  )
  SELECT
    txn.message_id,
    txn.amount,
    txn.transaction_date,
    txn.sender,
    COALESCE(txn.memo, txn.original_memo, ''),
    NULL,
    NULL,
    NULL,
    p_target_expiration,
    'NOT TRACED',
    'NOT FOUND'
  FROM tmp_matching_txns txn
  WHERE txn.member_id IS NULL;

  -- Step 7: For family members, check if all related members have matching expirations
  UPDATE tmp_audit_results audit
  SET
    family_members_checked = (
      SELECT COUNT(*) FROM members m2
      WHERE m2.FamilyID = (
        SELECT FamilyID FROM members m1
        WHERE m1.MemberID = audit.member_id
      )
    ),
    family_all_match = (
      SELECT IF(
        MIN(m2.Expiration >= p_target_expiration) = 1,
        'Y',
        'N'
      )
      FROM members m2
      WHERE m2.FamilyID = (
        SELECT FamilyID FROM members m1
        WHERE m1.MemberID = audit.member_id
      )
    )
  WHERE member_id IS NOT NULL
    AND family_members_checked IS NULL;

  -- Step 8: Return results, sorted by status and date
  SELECT
    message_id,
    amount,
    transaction_date,
    sender,
    memo,
    member_id,
    member_name,
    current_expiration,
    target_expiration,
    status_match,
    trace_route,
    family_members_checked,
    family_all_match
  FROM tmp_audit_results
  ORDER BY
    CASE WHEN status_match = 'MISMATCH' THEN 1
         WHEN status_match = 'NOT TRACED' THEN 2
         WHEN status_match = 'MATCH' THEN 3
         ELSE 4
    END,
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
