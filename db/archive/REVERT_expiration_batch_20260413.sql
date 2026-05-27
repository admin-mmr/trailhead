-- ============================================================
-- REVERT: Expiration date 2026->2027 + status Expired->Inactive
-- Incident window: 2026-04-13 01:45:00 – 01:55:00
-- Run Step 1 first, verify output, then run Step 2.
-- ============================================================

-- ============================================================
-- STEP 1: PREVIEW (read-only — run this first)
-- ============================================================
SELECT
    b.MemberID,
    b.Status        AS current_status,
    b.Expiration    AS current_expiration,
    prev.Status     AS restore_status,
    prev.Expiration AS restore_expiration,
    prev.LoggingTime AS restore_from_time
FROM (
    SELECT MemberID, Status, Expiration
    FROM member_log
    WHERE LoggingTime BETWEEN '2026-04-13 01:45:00' AND '2026-04-13 01:55:00'
      AND ChangeType = 'UPDATE'
) b
JOIN member_log prev ON prev.MemberID = b.MemberID
WHERE prev.LoggingTime = (
    SELECT MAX(LoggingTime)
    FROM member_log
    WHERE MemberID = b.MemberID
      AND LoggingTime < '2026-04-13 01:45:00'
)
ORDER BY b.MemberID;


-- ============================================================
-- STEP 2: REVERT (only after verifying Step 1 output)
-- ============================================================
START TRANSACTION;

UPDATE members m
JOIN (
    SELECT MemberID, Status, Expiration
    FROM member_log
    WHERE LoggingTime BETWEEN '2026-04-13 01:45:00' AND '2026-04-13 01:55:00'
      AND ChangeType = 'UPDATE'
) bad ON bad.MemberID = m.MemberID
JOIN member_log prev ON prev.MemberID = m.MemberID
  AND prev.LoggingTime = (
      SELECT MAX(LoggingTime)
      FROM member_log
      WHERE MemberID = m.MemberID
        AND LoggingTime < '2026-04-13 01:45:00'
  )
SET
    m.Status              = prev.Status,
    m.MembershipExpiration = prev.Expiration;

-- Verify row count before committing
SELECT ROW_COUNT() AS rows_reverted;

-- If rows_reverted looks correct: COMMIT
-- If something looks wrong:       ROLLBACK
-- COMMIT;
-- ROLLBACK;
