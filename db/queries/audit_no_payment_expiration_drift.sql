-- ============================================================
-- AUDIT: Members with no payments — expiration drift check
-- For each member with no payment record:
--   - Show first member_log Expiration (baseline/original state)
--   - Show current members.Expiration
--   - Flag if expiration changed without an admin override
--
-- INDIVIDUAL: Type = 'Individual' (no FamilyID)
-- FAMILY:     All members sharing a FamilyID where NO member
--             in that family has any payment record
-- ============================================================


-- ============================================================
-- PART 1: INDIVIDUAL MEMBERS — no payments, expiration drift
-- ============================================================
SELECT
    m.MemberID,
    CONCAT(m.FirstName, ' ', m.LastName) AS member_name,
    m.Status                             AS current_status,
    first_log.Expiration                 AS first_log_expiration,
    m.Expiration                         AS current_expiration,
    CASE
        WHEN first_log.Expiration IS NULL             THEN 'no log'
        WHEN first_log.Expiration = m.Expiration      THEN 'ok'
        ELSE                                               'CHANGED'
    END                                  AS exp_drift,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM admin_member_overrides ao
            WHERE ao.ActionType != 'REVERT'
              AND (
                ao.TargetMemberID = m.MemberID
                OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0
              )
        ) THEN 'YES' ELSE 'NO'
    END                                  AS has_override,
    CASE
        WHEN first_log.Expiration IS NOT NULL
             AND first_log.Expiration <> m.Expiration
             AND NOT EXISTS (
                 SELECT 1 FROM admin_member_overrides ao
                 WHERE ao.ActionType != 'REVERT'
                   AND (
                     ao.TargetMemberID = m.MemberID
                     OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0
                   )
             )
        THEN '⚠ UNEXPLAINED'
        ELSE ''
    END                                  AS flag
FROM members m
-- No payments at all
LEFT JOIN payments p ON p.MemberID = m.MemberID
-- First ever member_log entry (baseline expiration)
LEFT JOIN (
    SELECT ml.MemberID, ml.Expiration
    FROM member_log ml
    WHERE ml.LoggingTime = (
        SELECT MIN(ml2.LoggingTime)
        FROM member_log ml2
        WHERE ml2.MemberID = ml.MemberID
    )
) first_log ON first_log.MemberID = m.MemberID
WHERE m.Type = 'Individual'
  AND (m.FamilyID IS NULL OR m.FamilyID = '')
  AND p.MemberID IS NULL                        -- no payment record
ORDER BY flag DESC, exp_drift DESC, m.LastName, m.FirstName;


-- ============================================================
-- PART 2: FAMILY GROUPS — no payments across entire family
-- Only includes families where ZERO members have any payment.
-- Shows every member in the family with same drift check.
-- ============================================================
SELECT
    m.FamilyID,
    m.MemberID,
    CONCAT(m.FirstName, ' ', m.LastName) AS member_name,
    m.Type                               AS member_type,
    m.Status                             AS current_status,
    first_log.Expiration                 AS first_log_expiration,
    m.Expiration                         AS current_expiration,
    CASE
        WHEN first_log.Expiration IS NULL             THEN 'no log'
        WHEN first_log.Expiration = m.Expiration      THEN 'ok'
        ELSE                                               'CHANGED'
    END                                  AS exp_drift,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM admin_member_overrides ao
            WHERE ao.ActionType != 'REVERT'
              AND (
                ao.TargetMemberID = m.MemberID
                OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0
              )
        ) THEN 'YES' ELSE 'NO'
    END                                  AS has_override,
    CASE
        WHEN first_log.Expiration IS NOT NULL
             AND first_log.Expiration <> m.Expiration
             AND NOT EXISTS (
                 SELECT 1 FROM admin_member_overrides ao
                 WHERE ao.ActionType != 'REVERT'
                   AND (
                     ao.TargetMemberID = m.MemberID
                     OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0
                   )
             )
        THEN '⚠ UNEXPLAINED'
        ELSE ''
    END                                  AS flag
FROM members m
-- First ever member_log entry (baseline expiration)
LEFT JOIN (
    SELECT ml.MemberID, ml.Expiration
    FROM member_log ml
    WHERE ml.LoggingTime = (
        SELECT MIN(ml2.LoggingTime)
        FROM member_log ml2
        WHERE ml2.MemberID = ml.MemberID
    )
) first_log ON first_log.MemberID = m.MemberID
WHERE m.FamilyID IS NOT NULL
  AND m.FamilyID <> ''
  -- Only families where NO member has any payment
  AND m.FamilyID NOT IN (
      SELECT DISTINCT m2.FamilyID
      FROM members m2
      INNER JOIN payments p ON p.MemberID = m2.MemberID
      WHERE m2.FamilyID IS NOT NULL AND m2.FamilyID <> ''
  )
ORDER BY flag DESC, m.FamilyID, m.MemberID;
