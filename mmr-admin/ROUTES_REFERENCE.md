# Sync Routes Reference

## Quick Route Map

All routes require `Authorization` header or active session (via `@login_required`).

### Export Routes (MySQL → Google Sheets)

```
POST /api/sync/export/members
  Launch: Sync all members to Main sheet
  Returns: { ok: true, job_id: "uuid" }

POST /api/sync/export/payments
  Launch: Sync all payments to Payment-History sheet
  Returns: { ok: true, job_id: "uuid" }

POST /api/sync/export/submissions
  Launch: Sync all submissions to Submissions sheet
  Returns: { ok: true, job_id: "uuid" }

POST /api/sync/export/transaction-meta
  Launch: Sync gmail_transactions metadata (Notes, UpdatedAt) to Transactions sheet
  Returns: { ok: true, job_id: "uuid" }
```

### Import Routes (Google Sheets → MySQL)

```
POST /api/sync/import/transactions
  Launch: Import gmail_transactions from Transactions sheet
  Field Mapping: Source (Sheets) → PaymentMethod (MySQL)
  Returns: { ok: true, job_id: "uuid" }
```

### Job Management Routes

```
GET /api/sync/jobs
  List all sync jobs (newest first)
  Returns: {
    ok: true,
    jobs: [
      {
        id: "uuid",
        status: "completed|running|queued|error",
        message: "✓ Synced 150 new + 45 updated rows to members",
        progress: 100,
        started_at: "2026-04-03T22:15:00Z",
        completed_at: "2026-04-03T22:16:30Z"
      },
      ...
    ]
  }

GET /api/sync/status/<job_id>
  Get status of specific job
  Returns: {
    ok: true,
    job: {
      id: "uuid",
      status: "completed",
      message: "...",
      inserted: 150,
      updated: 45,
      skipped: 0,
      progress: 100,
      started_at: "...",
      completed_at: "..."
    }
  }
```

## Example Usage

### 1. Start an Export Job

```bash
curl -X POST http://localhost:5000/api/sync/export/members \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

# Response:
# {
#   "ok": true,
#   "job_id": "abc123def456"
# }
```

### 2. Check Job Status

```bash
curl http://localhost:5000/api/sync/status/abc123def456 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Response:
# {
#   "ok": true,
#   "job": {
#     "id": "abc123def456",
#     "status": "running",
#     "message": "Writing 150 rows to Main...",
#     "progress": 45,
#     "started_at": "2026-04-03T22:15:00Z",
#     "completed_at": null
#   }
# }
```

### 3. List All Jobs

```bash
curl http://localhost:5000/api/sync/jobs \
  -H "Authorization: Bearer YOUR_TOKEN"

# Response:
# {
#   "ok": true,
#   "jobs": [
#     {
#       "id": "abc123def456",
#       "status": "completed",
#       "message": "✓ Synced 150 new + 45 updated rows to members",
#       "progress": 100,
#       "started_at": "2026-04-03T22:15:00Z",
#       "completed_at": "2026-04-03T22:16:30Z"
#     },
#     ...
#   ]
# }
```

## Implementation Checklist

To activate these routes, register the blueprint in `app.py`:

```python
# Around line 162, add:
from api_sheets_sync_routes import sheets_sync_bp as sheets_sync_routes_bp
app.register_blueprint(sheets_sync_routes_bp)
```

Then restart the Flask server and test:

```bash
curl -X POST http://localhost:5000/api/sync/export/members -H "Authorization: Bearer test"
```

## Config Definition (sync_config.py)

Each route uses one key from SYNC_CONFIG:

| Route | Config Key | Table | Columns |
|---|---|---|---|
| POST /api/sync/export/members | `export_members` | members | MemberID, Status, Created, Expiration, Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District, MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes, NYRRRunnerName, YearBorn, YearBornGuess, UpdatedAt |
| POST /api/sync/export/payments | `export_payments` | payments | PaymentID, MemberID, PaymentDate, Amount, CreatedAt, TransactionNumber, SubmissionID, PaymentType, PaymentMethod, PayerName, MemoField, Last4Digits, ProcessedBy, Source, Notes |
| POST /api/sync/export/submissions | `export_submissions` | submissions | CreatedAt, SubmissionID, Status, MemberID, SubmissionType, ExpiresAt, PaymentIntent, Amount, PaymentMethod, PayerName, PaymentDate, MemoField, Last4Digits, PaymentID, UpdatedByID, UpdatedAt |
| POST /api/sync/export/transaction-meta | `export_transaction_meta` | gmail_transactions | Notes, UpdatedAt |
| POST /api/sync/import/transactions | `import_transactions` | gmail_transactions | Timestamp, Sender, Amount, Memo, TransactionDate, TransactionNumber, MessageId, Subject, OriginalMemo, Source |

## Error Responses

```json
{
  "ok": false,
  "error": "Job not found"
}
```

Status codes:
- 200: Success (job started or status retrieved)
- 404: Job not found
- 401: Unauthorized
- 500: Server error
