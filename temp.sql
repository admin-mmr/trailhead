-- Step 1: compute correct expirations into temp table (reads member_log, no trigger)
CREATE TEMPORARY TABLE tmp_exp_fix AS
SELECT
    m.MemberID,
    ml_pre.Expiration AS correct_expiration
FROM members m
JOIN (
    SELECT MemberID, MIN(LoggingTime) AS first_active_ts
    FROM member_log
    WHERE Status = 'active' AND Expiration = '2027-03-31'
    GROUP BY MemberID
) act ON act.MemberID = m.MemberID
JOIN member_log ml_pre
    ON  ml_pre.MemberID    = m.MemberID
    AND ml_pre.Status      NOT IN ('active')
    AND ml_pre.Status      IS NOT NULL
    AND ml_pre.LoggingTime < act.first_active_ts
WHERE m.Status NOT IN ('active', 'lifetime')
  AND m.Expiration = '2027-03-31'
  AND ml_pre.LoggingTime = (
      SELECT MAX(ml2.LoggingTime)
      FROM member_log ml2
      WHERE ml2.MemberID    = m.MemberID
        AND ml2.Status      NOT IN ('active')
        AND ml2.Status      IS NOT NULL
        AND ml2.LoggingTime < act.first_active_ts
  );

-- Verify before applying
SELECT * FROM tmp_exp_fix ORDER BY MemberID;

-- Step 2: update from temp table (no member_log reference, trigger safe)
SET @internal_proc = 1;

UPDATE members m
JOIN tmp_exp_fix t ON t.MemberID = m.MemberID
SET m.Expiration = t.correct_expiration,
    m.UpdatedAt  = NOW();

SET @internal_proc = NULL;
SELECT ROW_COUNT() AS rows_fixed;

DROP TEMPORARY TABLE IF EXISTS tmp_exp_fix;