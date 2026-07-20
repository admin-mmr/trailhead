-- MIGRATION_V033: Stripe integration — stripe_events idempotency table + membership price config keys
-- P1k step 1. stripe_events guards against Stripe webhook re-delivery (event_id PK);
-- price keys consolidate the hardcoded $30/$50/$20 across webapp checkout + Flask payment matching.
-- ⚠️ Numbering verified against 07-19 Data Query (max = V032). Re-verify before push:
--    SELECT version FROM schema_migrations ORDER BY executed_at DESC LIMIT 5;

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id          VARCHAR(100) NOT NULL,
  payment_intent_id VARCHAR(100) DEFAULT NULL,
  status            VARCHAR(30)  NOT NULL DEFAULT 'processed',
  payload_hash      VARCHAR(64)  DEFAULT NULL,
  processed_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO config (ConfigKey, ConfigValue, Description)
VALUES ('IndividualPrice', '30', 'Individual membership price (USD) — Stripe checkout + payment matching')
ON DUPLICATE KEY UPDATE Description = VALUES(Description);

INSERT INTO config (ConfigKey, ConfigValue, Description)
VALUES ('FamilyPrice', '50', 'Family membership price (USD) — Stripe checkout + payment matching')
ON DUPLICATE KEY UPDATE Description = VALUES(Description);

INSERT INTO config (ConfigKey, ConfigValue, Description)
VALUES ('FamilyUpgradePrice', '20', 'Individual→Family upgrade price (USD) — Stripe checkout')
ON DUPLICATE KEY UPDATE Description = VALUES(Description);

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V033', 'stripe_events idempotency table + membership price config keys', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
