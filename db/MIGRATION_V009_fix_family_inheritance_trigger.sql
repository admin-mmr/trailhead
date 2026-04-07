-- MIGRATION V009: Fix trg_members_family_inheritance (MySQL 5.7 error 1093)
-- Problem: trigger used subqueries (SELECT FROM members) inside UPDATE members,
--          which MySQL 5.7 forbids: "Can't specify target table for update in FROM clause"
-- Fix:     SELECT family values INTO local variables first, then UPDATE using those vars.
-- Also:    fixed typo 'pending_ungrade' → 'pending_upgrade' in WHERE clause.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_members_family_inheritance;

DELIMITER $$

CREATE TRIGGER trg_members_family_inheritance
AFTER INSERT ON members
FOR EACH ROW
BEGIN
  DECLARE v_expiration       DATE;
  DECLARE v_fee              DECIMAL(10,2);
  DECLARE v_payment_date     DATE;
  DECLARE v_payment_tx       VARCHAR(100);

  IF NEW.FamilyID IS NOT NULL THEN
    -- Step 1: read family values into variables (separate SELECT — no 1093)
    SELECT Expiration, MembershipFeePaid, PaymentDate, PaymentTransaction
    INTO   v_expiration, v_fee, v_payment_date, v_payment_tx
    FROM   members
    WHERE  FamilyID = NEW.FamilyID
      AND  Status IN ('active', 'lifetime')
    LIMIT 1;

    -- Step 2: update the new member using variables only (no subquery)
    UPDATE members
    SET
      Expiration       = v_expiration,
      MembershipFeePaid = v_fee,
      PaymentDate      = v_payment_date,
      PaymentTransaction = v_payment_tx
    WHERE  MemberID = NEW.MemberID
      AND  FamilyID = NEW.FamilyID
      AND  Status IN ('pending', 'pending_upgrade', 'expired', 'inactive');
  END IF;
END$$

DELIMITER ;

-- Audit trail
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V009', 'Fix trg_members_family_inheritance: replace self-referencing subqueries with SELECT INTO variables (MySQL 5.7 error 1093)', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
