-- Add Subject column to gmail_transactions table
-- MIGRATION for schema update

ALTER TABLE gmail_transactions
ADD COLUMN Subject text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
AFTER MessageId;
