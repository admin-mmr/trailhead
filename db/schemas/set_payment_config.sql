-- Set payment reconciliation config values
-- Run: mysql-mmr < db/schemas/set_payment_config.sql

UPDATE config SET ConfigValue = '2027-03-31' WHERE ConfigKey = 'MembershipYearEnd';
UPDATE config SET ConfigValue = '2026-02-01' WHERE ConfigKey = 'MembershipCollectionStart';
UPDATE config SET ConfigValue = '2026-04-30' WHERE ConfigKey = 'MembershipCollectionEnd';

-- Verify all payment-related config
SELECT ConfigKey, ConfigValue, Description FROM config
WHERE ConfigKey IN (
  'IndividualPrice', 'FamilyPrice', 'FamilyUpgradePrice',
  'MembershipRenewalYears', 'MembershipYearEnd',
  'MembershipCollectionStart', 'MembershipCollectionEnd',
  'PaymentProofReviewDays', 'SheetsWebhookUrl', 'PaymentMethods'
)
ORDER BY ConfigKey;
