-- ============================================================================
-- MIGRATION_V007_FIX: Fix Constraint Violations Before Adding CHECK Constraints
-- ============================================================================
--
-- Purpose: Fix existing data that violates the new CHECK constraints in V007
--
-- Issues to Fix:
--   1. ExpiresAt <= CreatedAt (violates chk_submissions_expires_after_created)
--   2. Negative Amount values (violates chk_*_amount_nonnegative)
--   3. Invalid Status enums (violates chk_*_status_valid)
--   4. Invalid email format (violates chk_members_email_valid)
--   5. Invalid PaymentDate (violates chk_submissions_payment_date_reasonable)
--
-- Run this BEFORE MIGRATION_V007
-- ============================================================================


-- ============================================================================
-- SECTION 1: Fix ExpiresAt <= CreatedAt violations
-- ============================================================================
-- Set ExpiresAt to NULL if it's <= CreatedAt
-- (Interpretation: expiration wasn't properly set, treat as no expiration)

UPDATE `submissions`
SET `ExpiresAt` = NULL
WHERE `ExpiresAt` IS NOT NULL
  AND `ExpiresAt` <= `CreatedAt`;

-- Verify fix
-- SELECT COUNT(*) as violations FROM submissions
-- WHERE ExpiresAt IS NOT NULL AND ExpiresAt <= CreatedAt;


-- ============================================================================
-- SECTION 2: Fix negative Amount values
-- ============================================================================
-- Set Amount to NULL if negative (data entry error)

UPDATE `submissions`
SET `Amount` = NULL
WHERE `Amount` IS NOT NULL AND `Amount` < 0;

UPDATE `payments`
SET `Amount` = NULL
WHERE `Amount` IS NOT NULL AND `Amount` < 0;

UPDATE `gmail_transactions`
SET `Amount` = NULL
WHERE `Amount` IS NOT NULL AND `Amount` < 0;

-- Verify fixes
-- SELECT COUNT(*) as violations FROM submissions WHERE Amount < 0;
-- SELECT COUNT(*) as violations FROM payments WHERE Amount < 0;
-- SELECT COUNT(*) as violations FROM gmail_transactions WHERE Amount < 0;


-- ============================================================================
-- SECTION 3: Fix invalid Status enums in submissions
-- ============================================================================
-- Valid: 'pending', 'approved', 'cancelled', 'expired'
-- Set to 'pending' if invalid

UPDATE `submissions`
SET `Status` = 'pending'
WHERE `Status` NOT IN ('pending', 'approved', 'cancelled', 'expired')
  AND `Status` IS NOT NULL;

-- Verify fix
-- SELECT DISTINCT Status FROM submissions;


-- ============================================================================
-- SECTION 4: Fix invalid Status enums in members
-- ============================================================================
-- Valid: 'active', 'expired', 'inactive', 'pending'
-- Set to 'pending' if invalid (safest default)

UPDATE `members`
SET `Status` = 'pending'
WHERE `Status` NOT IN ('active', 'expired', 'inactive', 'pending')
  AND `Status` IS NOT NULL;

-- Verify fix
-- SELECT DISTINCT Status FROM members;


-- ============================================================================
-- SECTION 5: Fix invalid email format in members
-- ============================================================================
-- Email must contain @ if not NULL
-- Set to NULL if invalid (will need manual correction later)

UPDATE `members`
SET `Email` = NULL
WHERE `Email` IS NOT NULL
  AND `Email` NOT LIKE '%@%';

-- Verify fix
-- SELECT COUNT(*) as invalid_emails FROM members
-- WHERE Email IS NOT NULL AND Email NOT LIKE '%@%';


-- ============================================================================
-- SECTION 6: Fix invalid email format in activity_log
-- ============================================================================
-- Email must contain @ if not NULL
-- Set to NULL if invalid

UPDATE `activity_log`
SET `Email` = NULL
WHERE `Email` IS NOT NULL
  AND `Email` NOT LIKE '%@%';

-- Verify fix
-- SELECT COUNT(*) as invalid_emails FROM activity_log
-- WHERE Email IS NOT NULL AND Email NOT LIKE '%@%';


-- ============================================================================
-- SECTION 7: Fix invalid PaymentDate in submissions
-- ============================================================================
-- PaymentDate must be within ±1 year (past) / ±30 days (future)
-- Set to NULL if invalid (can be corrected manually later)

UPDATE `submissions`
SET `PaymentDate` = NULL
WHERE `PaymentDate` IS NOT NULL
  AND (
    `PaymentDate` < DATE_SUB(CURDATE(), INTERVAL 365 DAY)
    OR `PaymentDate` > DATE_ADD(CURDATE(), INTERVAL 30 DAY)
  );

-- Verify fix
-- SELECT COUNT(*) as invalid_dates FROM submissions
-- WHERE PaymentDate < DATE_SUB(CURDATE(), INTERVAL 365 DAY)
--    OR PaymentDate > DATE_ADD(CURDATE(), INTERVAL 30 DAY);


-- ============================================================================
-- SECTION 8: Summary Report (comment out for production, uncomment to verify)
-- ============================================================================

-- After running all sections above, this should return 0 violations:

-- SELECT 'ExpiresAt <= CreatedAt' as issue,
--        COUNT(*) as count
-- FROM submissions
-- WHERE ExpiresAt IS NOT NULL AND ExpiresAt <= CreatedAt
-- UNION ALL
-- SELECT 'Negative Amount (submissions)', COUNT(*)
-- FROM submissions
-- WHERE Amount < 0
-- UNION ALL
-- SELECT 'Negative Amount (payments)', COUNT(*)
-- FROM payments
-- WHERE Amount < 0
-- UNION ALL
-- SELECT 'Invalid Status (submissions)', COUNT(*)
-- FROM submissions
-- WHERE Status NOT IN ('pending', 'approved', 'cancelled', 'expired')
-- UNION ALL
-- SELECT 'Invalid Status (members)', COUNT(*)
-- FROM members
-- WHERE Status NOT IN ('active', 'expired', 'inactive', 'pending')
-- UNION ALL
-- SELECT 'Invalid Email (members)', COUNT(*)
-- FROM members
-- WHERE Email IS NOT NULL AND Email NOT LIKE '%@%'
-- UNION ALL
-- SELECT 'Invalid PaymentDate', COUNT(*)
-- FROM submissions
-- WHERE PaymentDate < DATE_SUB(CURDATE(), INTERVAL 365 DAY)
--    OR PaymentDate > DATE_ADD(CURDATE(), INTERVAL 30 DAY);
