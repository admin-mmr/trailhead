-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Convert datetime columns to DATE type for cleaner display
-- ═══════════════════════════════════════════════════════════════════════════
-- Purpose: Change Expiration and PaymentDate columns from datetime to date type
--          to eliminate time component in UI and API responses
-- Tables affected:
--   - members: Expiration, PaymentDate
--   - webapp_events: PaymentDate
--   - payments: PaymentDate
-- Note: TransactionDate in gmail_transactions is already DATE type
-- ═══════════════════════════════════════════════════════════════════════════

-- Convert members table
ALTER TABLE members
  MODIFY COLUMN Expiration DATE DEFAULT NULL,
  MODIFY COLUMN PaymentDate DATE DEFAULT NULL;

-- Convert webapp_events table
ALTER TABLE webapp_events
  MODIFY COLUMN PaymentDate DATE DEFAULT NULL;

-- Convert payments table
ALTER TABLE payments
  MODIFY COLUMN PaymentDate DATE DEFAULT NULL;

-- Note: Update schema_snapshot.sql with the new column definitions after migration
