-- Migration 0016: Add missing indices for Unix timestamp columns
--
-- NOTE: Unix timestamp columns (updated_at_unix, timestamp_unix, processed_date_unix, etc.)
-- already exist in the schema (added previously). This migration adds missing indices
-- for fast comparison during sync operations.
--
-- This is a minimal, safe migration that only adds indices.
-- Backfill of Unix values is handled separately via backfill_unix_timestamps.py script.

-- Members table: add indices for Unix columns (updated_at_unix already has index)
CREATE INDEX IF NOT EXISTS idx_members_last_login_date_unix ON members(last_login_date_unix);
CREATE INDEX IF NOT EXISTS idx_members_profile_last_updated_unix ON members(profile_last_updated_unix);
CREATE INDEX IF NOT EXISTS idx_members_created_at_unix ON members(created_at_unix);

-- WebApp events table: add indices for Unix columns (timestamp_unix already has index)
CREATE INDEX IF NOT EXISTS idx_webapp_events_expires_at_unix ON webapp_events(expires_at_unix);
CREATE INDEX IF NOT EXISTS idx_webapp_events_approval_date_unix ON webapp_events(approval_date_unix);

-- Payments table: processed_date_unix already has index idx_payment_history_processed_date_unix

-- Note: Backfill of Unix timestamps is intentionally excluded from this migration
-- to avoid race conditions if app is running. Use the backfill_unix_timestamps.py script
-- to populate Unix columns safely outside of migration window.
