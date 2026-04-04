# Payments API Reference — New Endpoints

## Overview

Four new endpoints were added to support the restored payments UI. All require `admin` role.

---

## 1. Member Quick Lookup (Tooltip)

### Endpoint
```
GET /api/payments/member-quick/<member_id>
```

### Authorization
- Requires: `login_required`, `require_role('admin')`

### Request
```bash
GET /api/payments/member-quick/A0123
```

### Response (200 OK)
```json
{
  "MemberID": "A0123",
  "FirstName": "John",
  "LastName": "Smith",
  "Email": "john@example.com",
  "Expiration": "2025-03-15",
  "Type": "Individual",
  "Gender": "M",
  "District": "Queens",
  "WeChatID": "john_wx"
}
```

### Error Responses
```json
{ "error": "Member not found" }  // 404
```

### Usage
- Frontend: Hover tooltip on MemberID chip
- Cached after first fetch in `_memberCache` object
- No redundant API calls if tooltip data exists

---

## 2. All Members (Fuzzy Search)

### Endpoint
```
GET /api/payments/member-quick/all
```

### Authorization
- Requires: `login_required`, `require_role('admin')`

### Request
```bash
GET /api/payments/member-quick/all
```

### Response (200 OK)
```json
{
  "data": [
    {
      "MemberID": "A0001",
      "FirstName": "Alice",
      "LastName": "Anderson",
      "Email": "alice@example.com",
      "Expiration": "2025-06-30",
      "Type": "Family",
      "District": "Manhattan"
    },
    {
      "MemberID": "A0002",
      "FirstName": "Bob",
      "LastName": "Baker",
      "Email": "bob@example.com",
      "Expiration": "2025-05-15",
      "Type": "Individual",
      "District": "Brooklyn"
    },
    ...
  ]
}
```

### Query Parameters
None (returns all members)

### Usage
- Frontend: Populate fuzzy search dropdown in quick-approve popover
- Fetched once on popover mount
- Filtered client-side as user types

### Performance
- ~500 members = ~50KB JSON
- Cached in component state
- Fuzzy match: O(n) per keystroke, but limited to 10 results

---

## 3. Gmail Candidates (Submission Filter)

### Endpoint
```
GET /api/payments/gmail-candidates/<submission_id>
```

### Authorization
- Requires: `login_required`, `require_role('admin')`

### Request
```bash
GET /api/payments/gmail-candidates/sub_abc123def456
```

### Response (200 OK)
```json
{
  "data": [
    {
      "MessageId": "gmail_msg_001",
      "Sender": "john@gmail.com",
      "Amount": 30.00,
      "Memo": "A0123 renewal",
      "OriginalMemo": "A0123 renewal",
      "TransactionDate": "2025-04-01",
      "TransactionNumber": "gmail_001",
      "Notes": null,
      "ProcessedTime": null,
      "MatchContext": "unmatched"
    },
    {
      "MessageId": "gmail_msg_002",
      "Sender": "jane@paypal.com",
      "Amount": 50.00,
      "Memo": "Family payment",
      "OriginalMemo": "Family payment",
      "TransactionDate": "2025-04-02",
      "TransactionNumber": "paypal_001",
      "Notes": "Linked to A0456: Family Membership",
      "ProcessedTime": "2025-04-02T12:30:00",
      "MatchContext": "matched"
    },
    ...
  ]
}
```

### Query Parameters
None

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `MessageId` | string | Gmail/transaction message ID |
| `Sender` | string | Email sender / bank |
| `Amount` | decimal | Transaction amount |
| `Memo` | string | Current memo (may contain MemberID) |
| `OriginalMemo` | string | Original memo from transaction |
| `TransactionDate` | date | Date of transaction |
| `TransactionNumber` | string | Reference number |
| `Notes` | string | Admin notes (NULL if unmatched) |
| `ProcessedTime` | datetime | When processed (NULL if unmatched) |
| `MatchContext` | string | One of: `unmatched`, `matched`, `processed` |

### Error Responses
```json
{ "error": "Submission not found" }  // 404
```

### Usage
- Frontend: Click submission row → filters Gmail table
- Shows candidates for that specific submission
- Includes both unmatched + already-processed transactions
- Match context badge indicates relationship

### Query Logic
```sql
WHERE (Notes IS NULL OR MatchContext IS NULL OR MatchContext = 'unmatched')
   OR Sender LIKE '%{submission.FirstName}%'
   OR Memo LIKE '%{submission.MemberID}%'
ORDER BY TransactionDate DESC
LIMIT 50
```

---

## 4. Admin Create Payment (Quick-Approve)

### Endpoint
```
POST /api/payments/admin-create
```

### Authorization
- Requires: `login_required`, `require_role('admin')`

### Request
```bash
POST /api/payments/admin-create
Content-Type: application/json

{
  "memberId": "A0123",
  "messageId": "gmail_msg_001",
  "paymentIntent": "Individual Membership",
  "notes": "Quick-approved from unmatched Gmail. Memo: A0123 renewal"
}
```

### Request Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `memberId` | string | Yes | Format: A followed by 4 digits (e.g., A0123) |
| `messageId` | string | Yes | Gmail transaction MessageId |
| `paymentIntent` | string | No | Default: "Individual Membership" |
| `notes` | string | No | Admin notes for this payment |

### Response (200 OK)
```json
{
  "ok": true,
  "message": "Payment created for A0123",
  "updated_members": ["A0123"]
}
```

### Error Responses

```json
// Missing fields
{ "error": "memberId and messageId required" }  // 400

// Invalid MemberID format
{ "error": "MemberID must be A followed by 4 digits (e.g. A0123)" }  // 400

// Member not found
{ "error": "Member A0123 not found" }  // 404

// Gmail transaction not found
{ "error": "Gmail transaction not found" }  // 404

// Database error
{ "error": "Duplicate entry for key 'PRIMARY'" }  // 500
```

### Side Effects

This endpoint does the following:

1. **Creates payment record**
   ```sql
   INSERT INTO payments (
     PaymentID, MemberID, Amount, PaymentIntent, PaymentDate, Source, ProcessedBy, CreatedAt
   ) VALUES (
     uuid(), 'A0123', 30.00, 'Individual Membership', '2025-04-01', 'Gmail', admin_id, NOW()
   )
   ```

2. **Updates Gmail transaction**
   ```sql
   UPDATE gmail_transactions
   SET Notes = 'Linked to A0123: Individual Membership',
       ProcessedTime = NOW(),
       MatchContext = 'matched'
   WHERE MessageId = 'gmail_msg_001'
   ```

3. **Updates member (if membership intent)**
   ```sql
   UPDATE members
   SET Status = 'active',
       Expiration = DATE_ADD(NOW(), INTERVAL 1 YEAR)
   WHERE MemberID = 'A0123'
   ```

4. **Triggers on database side:**
   - Payment creation trigger (if exists)
   - Activity log entry (if configured)
   - Email notifications (if configured)

### Usage
- Frontend: Click ⚡ Quick Approve button in popover
- Validates MemberID format
- Updates Gmail Notes for sync
- Extends member expiration by 1 year
- Closes popover and reloads data on success
- Shows toast notification with result

### Performance
- Single round-trip to server
- Creates payment + updates 2 tables (gmail_transactions, members)
- Total time: ~100-200ms

### Validation
```javascript
// Frontend validation before POST:
const mid = memberId.trim().toUpperCase();
if (!mid) { setError('MemberID required'); return; }
if (!/^A\d{4}$/.test(mid)) { 
  setError('MemberID must be A followed by 4 digits (e.g. A0123)');
  return;
}
```

---

## Integration with Existing Endpoints

### Dashboard
```
GET /api/payments/dashboard
→ Returns: {pending, matched, unmatched_gmail, approved_30d, rejected_30d, errors}
```
Used by: StatsCards component

### Pending Submissions
```
GET /api/payments/pending-submissions
→ Returns: [{SubmissionID, MemberID, FirstName, LastName, Amount, PaymentIntent, Status, Timestamp}]
```
Used by: PendingSubmissionsTable component

### Unmatched Gmail
```
GET /api/payments/unmatched-gmail
→ Returns: [{MessageId, Sender, Amount, Memo, TransactionDate, ...}]
```
Used by: GmailTable component (normal mode)

---

## Error Handling

All endpoints use the `@handle_api_errors` decorator, which catches exceptions and returns:

```json
{
  "error": "Internal server error (check logs)",
  "status": 500
}
```

Specific errors:
- **400**: Bad request (missing fields, invalid format)
- **404**: Resource not found
- **500**: Server error (database, validation, etc.)

---

## Rate Limiting

Not currently implemented. Consider adding:
- Max 100 requests/minute per admin
- Queue for bulk operations
- Exponential backoff for retries

---

## Testing

### cURL Examples

```bash
# 1. Quick member lookup
curl -H "Authorization: Bearer {token}" \
  http://localhost:5000/api/payments/member-quick/A0123

# 2. All members
curl -H "Authorization: Bearer {token}" \
  http://localhost:5000/api/payments/member-quick/all

# 3. Gmail candidates
curl -H "Authorization: Bearer {token}" \
  http://localhost:5000/api/payments/gmail-candidates/sub_abc123

# 4. Create payment
curl -X POST \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "memberId": "A0123",
    "messageId": "gmail_msg_001",
    "paymentIntent": "Individual Membership"
  }' \
  http://localhost:5000/api/payments/admin-create
```

### Browser Console

```javascript
// Test API
api('/api/payments/member-quick/A0123').then(r => console.log(r))

api('/api/payments/member-quick/all').then(r => console.log(r))

api('/api/payments/gmail-candidates/sub_abc123').then(r => console.log(r))

api('/api/payments/admin-create', {
  method: 'POST',
  body: JSON.stringify({
    memberId: 'A0123',
    messageId: 'gmail_msg_001',
    paymentIntent: 'Individual Membership'
  })
}).then(r => console.log(r))
```

---

## Monitoring & Debugging

Check server logs for:
```
[PaymentsPanel] API call: /api/payments/member-quick/...
[admin-create] Creating payment for A0123
[admin-create] Updated member: A0123
[admin-create] Error: ...
```

Check browser console for:
```
network requests in DevTools > Network tab
API responses with { ok: true } or { error: "..." }
```

---

## Future Enhancements

1. **Batch operations**
   - POST /api/payments/admin-batch-create
   - Accept array of {memberId, messageId, ...}

2. **Undo/Redo**
   - DELETE /api/payments/{paymentId}
   - Revert payment + restore Gmail Notes

3. **Advanced search**
   - GET /api/payments/gmail-search?q=...&date_range=...&amount_min=...&amount_max=...

4. **Member detail modal**
   - GET /api/payments/member/{memberId}/full
   - Returns member + family + recent payments

5. **Audit trail**
   - GET /api/payments/audit?limit=100&member_id=...
   - Returns all admin actions on payments

