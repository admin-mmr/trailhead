-- ============================================================
-- Migration v5: Expand webapp_events Status enum for payment reconciliation
-- Adds: matched, expired, error statuses
-- ============================================================

-- Expand the Status enum to support the full reconciliation lifecycle
ALTER TABLE webapp_events
  MODIFY Status ENUM('pending','matched','approved','rejected','expired','error')
  NOT NULL DEFAULT 'pending';

-- Add EventCategory column if not present (for future: 'payment', 'registration', 'donation')
-- Uses a stored procedure to handle "column already exists" gracefully on MySQL 8
DROP PROCEDURE IF EXISTS _add_event_category;
DELIMITER //
CREATE PROCEDURE _add_event_category()
BEGIN
    DECLARE CONTINUE HANDLER FOR 1060 BEGIN END;  -- 1060 = Duplicate column name
    ALTER TABLE webapp_events
      ADD COLUMN EventCategory VARCHAR(50) DEFAULT 'payment' AFTER EventType;
END //
DELIMITER ;
CALL _add_event_category();
DROP PROCEDURE IF EXISTS _add_event_category;

-- Add config entries for payment reconciliation
INSERT INTO config (ConfigKey, ConfigValue, Description) VALUES
('MembershipYearEnd',          '',     'Fixed membership year-end date (YYYY-MM-DD). Leave blank for rolling renewal.'),
('MembershipCollectionStart',  '',     'Start of collection window (YYYY-MM-DD). Auto-match only runs within window.'),
('MembershipCollectionEnd',    '',     'End of collection window (YYYY-MM-DD).'),
('FamilyUpgradePrice',         '20',   'Price delta to upgrade Individual to Family mid-cycle'),
('PaymentProofReviewDays',     '7',    'Days before unreviewed payment proofs auto-expire'),
('SheetsWebhookUrl',           '',     'GAS web app URL for syncing approved payments back to Sheets')
ON DUPLICATE KEY UPDATE Description = VALUES(Description);

-- Record migration
INSERT INTO schema_migrations (version, description) VALUES
('v5_payment_statuses', 'Expand webapp_events Status enum; add payment reconciliation config')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;
