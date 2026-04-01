# Membership Fee Sync Endpoint

## Overview

New endpoint to synchronize membership fee payment data from the `payments` table to the `members` table in the Admin Portal.

## Endpoint Details

### POST `/api/sync/membership-fees`

**Purpose:** Update members table with latest payment data for Individual and Family Membership payments.

**Request Body (optional):**
```json
{
  "memberID": "M001"  // Optional: sync only specific member
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Synced N member(s)",
  "stats": {
    "checked": N,
    "updated": N,
    "errors": N
  }
}
```

## Logic

1. Query `payments` table for entries where:
   - `MembershipType` IN ('Individual Membership', 'Family Membership')
   - `MemberID` IS NOT NULL
   - `PaymentDate` IS NOT NULL

2. For each member, select the **most recent payment** only (by PaymentDate DESC)

3. Update `members` table only if:
   - `PaymentDate` in members is NULL, OR
   - New `PaymentDate` > existing `PaymentDate`

4. When updating, set:
   - `MembershipFeePaid` = `Amount`
   - `PaymentDate` = `PaymentDate`
   - `PaymentTransaction` = `TransactionReference`
   - `LastUpdated` = NOW()

## UI Integration

Added "💳 Membership Fees" sub-tab to **Sync Panel** in Admin Portal (`/admin`).

### Manual Trigger
- Click "Sync Membership Fees" button
- Optionally enter a MemberID to sync only that member
- Shows toast with results: `✅ Synced N member(s) (updated/checked)`

### Features
- Real-time feedback via toast notifications
- Optional single-member filtering
- Detailed stats: checked, updated, errors
- Requires `super_admin` or `admin` role
- Error handling with rollback on DB failures

## Implementation Files

- **Backend:** `mmr-admin/api_sync.py` (lines 101–202)
- **UI:** `mmr-admin/templates/index.html` (lines 1947–2026)

## Technical Notes

- Uses `ROW_NUMBER()` window function to select most recent payment per member
- Transactional: rolls back all updates if any error occurs
- Thread-safe: uses connection pool from `db.get_conn()`
- Logging: DEBUG (fetch query, skip reason) + INFO (summary)
- Requires authentication (`@login_required`)

## Testing

```bash
# Manual sync all members
curl -X POST http://localhost:5000/api/sync/membership-fees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>"

# Sync specific member
curl -X POST http://localhost:5000/api/sync/membership-fees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"memberID":"M001"}'
```

## Future Enhancements

- Auto-scheduled sync: Create cron job to run endpoint daily (e.g., 2 AM UTC)
- Dry-run mode: Preview changes without committing
- Exclude filters: Skip certain payment types or members
- Webhook notifications: Alert on sync completion
