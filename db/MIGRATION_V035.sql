-- MIGRATION_V035: distinguish test-mode vs live Stripe payments
-- Test and live Stripe payments were indistinguishable in the DB. From now on
-- the webhook stamps mode everywhere; this migration adds the column and
-- retroactively marks all existing Stripe rows as TEST (only sk_test_ keys
-- have ever been configured, so every Stripe row to date is a test payment,
-- including the 07-20 smoke-test donation SUB-20260720-1USF2).
--   gmail_transactions/payments: PaymentMethod 'Stripe' (live) vs 'Stripe (TEST)'
--   stripe_events: livemode 1/0

ALTER TABLE stripe_events ADD COLUMN livemode TINYINT(1) NOT NULL DEFAULT 0;

UPDATE gmail_transactions SET PaymentMethod = 'Stripe (TEST)' WHERE PaymentMethod = 'Stripe';

UPDATE payments SET PaymentMethod = 'Stripe (TEST)' WHERE PaymentMethod = 'Stripe';

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V035', 'stripe_events.livemode + retro-mark existing Stripe rows as TEST', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
