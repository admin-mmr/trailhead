# Payments API Trace & Cleanup Plan
**Date: 2026-04-04**

## Operations Overview

### 1. Dashboard Stats (`/api/payments/dashboard`)
**Status**: ✅ MySQL-ready
- Queries `submissions` table (status: pending, matched, approved, rejected, error)
- Queries `gmail_transactions` table (processed state)
- Returns counts for dashboard cards
- **Action**: No changes needed

### 2. Pending Events (`/api/payments/pending-events`)
**Status**: ✅ MySQL-ready
- LEFT JOINs submissions + members
- Supports search filters
- Returns events ready for matching/approval
- **Action**: No changes needed

### 3. Unmatched Gmail (`/api/payments/unmatched-gmail`)
**Status**: ✅ MySQL-ready
- Fetches gmail_transactions WHERE ProcessedTime IS NULL
- Supports search filters
- **Action**: No changes needed

### 4. Auto-Match (`/api/payments/auto-match` POST)
**Status**: ✅ MySQL-ready
- Runs `run_auto_match()` from payment_actions.py
- Scoring: amount match + date ±7 days + identifier (last4/member_id/name)
- Updates submissions.Status = 'approved' + MatchedMessageId
- Updates gmail_transactions.ProcessedTime + PaymentID
- **Action**: No changes needed

### 5. Manual Match (`/api/payments/manual-match` POST)
**Status**: ✅ MySQL-ready
- Links event to gmail transaction manually
- Sets event status = 'approved', MatchedMessageId, MatchedTransactionNumber
- **Action**: Remove GAS webhook sync call (line 647 in api_payments.py)

### 6. Approve Event (`/api/payments/approve/<event_id>` POST)
**Status**: ⚠️ NEEDS CLEANUP
- Orchestrator: dispatch_fulfillment() → category handlers
- Handlers: create payment record, update member expiration, sync to Sheets
- **Current flow**:
  1. Validate event exists
  2. Call dispatch_fulfillment() → payment_handlers.py
  3. Inside handlers: create_payment_record() + update_member_expiration()
  4. update_member_expiration() calls sync_member_to_sheets() [REMOVE]
  5. After approval: sync_event_to_sheets() + sync_payment_to_sheets() [REMOVE]
  6. Send email via webhook [CHECK]
- **Action**: Remove all sync_*_to_sheets() calls, keep email handling

### 7. Reject Event (`/api/payments/reject/<event_id>` POST)
**Status**: ⚠️ NEEDS CLEANUP
- Sets event status = 'cancelled'
- Logs activity
- Calls sync_event_to_sheets() [REMOVE]
- Sends rejection email [KEEP]
- **Action**: Remove sync_event_to_sheets() call

### 8. Admin Create Payment (`/api/payments/admin-create` POST)
**Status**: ✅ MySQL-ready (no webhook calls currently)
- Creates submission from unmatched gmail
- Calls dispatch_fulfillment()
- Syncs gmail_transactions.ProcessedTime
- **Action**: No changes needed (sync happens in scheduled jobs)

### 9. Payment History (`/api/payments/history`)
**Status**: ✅ MySQL-ready
- JOINs payments + members
- **Action**: No changes needed

### 10. Member Summary (`/api/payments/member/<member_id>`)
**Status**: ✅ MySQL-ready
- Fetches member + family + recent payments
- **Action**: No changes needed

### 11. Gmail Candidates (`/api/payments/gmail-candidates/<event_id>`)
**Status**: ⚠️ NEEDS REVIEW
- Returns matched + fuzzy-match candidates
- Post-filters by identifier (last4/member_id/name)
- **Action**: Check if this is used; consider if needed

### 12. Member Quick Lookup (`/api/payments/member-quick/*`)
**Status**: ✅ MySQL-ready
- Lightweight member data for popover
- **Action**: No changes needed

## Old Code to Remove

### `_sync_member_events_to_sheets()` (api_payments.py lines 662-741)
- **Called from**: api_approve_event_match (line 647)
- **Purpose**: Real-time sync of event updates to Sheets via GAS webhook
- **Status**: REMOVE — sync jobs handle this on schedule
- **Action**: Delete function + remove call from api_approve_event_match()

### Imports to Remove/Fix
- `from sheets_sync import sync_member_to_sheets` (payment_handlers.py line 16)
- `from sheets_sync import (sync_member_to_sheets, sync_event_to_sheets, sync_payment_to_sheets)` (payment_actions.py lines 36-40)
- These are called from:
  - payment_handlers.py: update_member_expiration() line 124
  - payment_actions.py: approve_event() lines 303-312
  - payment_actions.py: reject_event() line 363

### Email Webhook Code
- `from webhook_client import send_payment_approved_email, send_payment_rejected_email` (payment_actions.py lines 41-44)
- Called from:
  - approve_event() lines 315-328
  - reject_event() lines 366-377
- **Status**: KEEP for now (replacement for Azure SDK) — just confirm it works

## MySQL Operations Summary

### Tables Modified:
1. **submissions**
   - INSERT: admin_create_payment()
   - UPDATE: auto-match, manual-match, approve, reject

2. **gmail_transactions**
   - UPDATE: ProcessedTime, Notes, PaymentID

3. **members**
   - UPDATE: Expiration, Type, Status, MembershipFeePaid, PaymentDate, PaymentTransaction

4. **payments**
   - INSERT: create_payment_record()

5. **activity_log**
   - Implicit via log_activity() calls

## No Issues Found
✅ All MySQL queries use parameterized statements (safe from injection)
✅ Transaction handling via db.py context managers
✅ Proper status enum checks
✅ FK integrity maintained
✅ Audit logging in place

## Action Items (Priority Order)
1. **HIGH**: Remove _sync_member_events_to_sheets() and call (api_payments.py)
2. **HIGH**: Remove sync_*_to_sheets() calls from payment_handlers.py + payment_actions.py
3. **MEDIUM**: Remove sheets_sync imports from all files
4. **MEDIUM**: Test approve/reject flows end-to-end
5. **LOW**: Verify email webhook works correctly

## Decision: Scheduled Sync Strategy
✅ All Sheets updates deferred to sync_jobs/sync_runners
✅ No real-time webhook calls from payment API
✅ Members/Events/Payments sync on schedule (see CLAUDE.md § SHEETS SYNC ARCHITECTURE)
✅ Scheduled jobs handle: export_members, export_events, export_payments, import_changes
