# Sync Tab Architecture

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MMR Admin Portal                              │
├──────────────────────────────────────────────────────────────────┤
│ Tabs: Events | Payments | Members | Sync | Data | Logs | Query   │
│                                     ↓                             │
│                            ┌──────────────┐                       │
│                            │  SyncPanel   │                       │
│                            └──────────────┘                       │
│                          /          |          \                  │
│          ┌───────────────┴─┐     ┌──┴──────────────┬────────────┐│
│          │                 │     │                 │            ││
│   MySQL→Google      Import Txns  Google→MySQL    │    │        ││
│   (3 subtabs)           (1 tab)   (1 tab)     │    │            ││
│   - Members             - Import   - Dry-run  │    │        React││
│   - Events              Now                    │    │     compon ││
│   - Payments                                   │    │        ent ││
│                                                │    │            ││
└────────────────────────────────────────────────┴────┴────────────┘
                    │                    │
         ┌──────────▼────────────┐  ┌────▼──────────────┐
         │   api_sheets_sync.py  │  │  Job Tracker      │
         ├──────────────────────┤  ├───────────────────┤
         │ 5 Endpoints:          │  │ job_id → {        │
         │ • members             │  │  status,          │
         │ • events              │  │  message,         │
         │ • payments            │  │  progress %,      │
         │ • import-txns         │  │  result/log       │
         │ • dry-run             │  │ }                 │
         └──────────────────────┘  └───────────────────┘
                    │
         ┌──────────▼────────────┐
         │   Background Threads  │
         ├──────────────────────┤
         │ _sync_members()      │
         │ _sync_events()       │
         │ _sync_payments()     │
         │ _import_txns()       │
         │ _dry_run()           │
         └──────────────────────┘
                    │
         ┌──────────▼────────────┐
         │  GAS Webhook          │
         │  (Future Integration) │
         ├──────────────────────┤
         │ • Get Sheets data    │
         │ • Push updates       │
         │ • Compare records    │
         └──────────────────────┘
                    │
         ┌──────────▼────────────┐
         │  Google Sheets        │
         │  (Members, Events,    │
         │   Payments, Txns)     │
         └──────────────────────┘
```

---

## Data Flow: MySQL → Google (Members Example)

```
┌────────────────┐
│  Admin clicks  │
│  "Sync Members"│
└────────┬───────┘
         │
         ▼
┌────────────────────────────────┐
│ POST /api/sync/mysql-to-google │
│       /members                  │
└────────┬───────────────────────┘
         │ Returns immediately with job_id
         │
         ▼
┌────────────────────────────────────┐
│ Start async worker thread:          │
│ _sync_members_to_sheets(job_id)    │
└────────┬──────────────────────────┘
         │
         ├─ Fetch all members from MySQL
         │  SELECT * FROM members
         │
         ├─ Call GAS webhook (TODO)
         │  POST https://gas-webhook
         │  action: "get_members"
         │  → Returns: {memberID, lastUpdated}[]
         │
         ├─ Compare by MemberID
         │  For each MySQL member:
         │    - If not in Sheets → append
         │    - If in Sheets:
         │      - Check LastUpdated
         │      - If MySQL newer → update all fields
         │      - Else → skip
         │
         ├─ Call GAS webhook (TODO)
         │  POST https://gas-webhook
         │  action: "append_members" | "update_members"
         │  → Writes to Sheets
         │
         ├─ Collect log (inserted, updated, errors)
         │
         ▼
┌────────────────────────────────┐
│ Update job status:              │
│ status: "done"                  │
│ message: "✅ Synced 150 members"│
│ result: {                       │
│   inserted: 10,                 │
│   updated: 5,                   │
│   log: "..."                    │
│ }                               │
└────────┬───────────────────────┘
         │
         ├─ Send email to admin@mmrunners.org
         │  Subject: "MMR Sync Report: MySQL → Google: Members"
         │  Body: Summary + detail lines + full log
         │
         ▼
┌────────────────────────────────┐
│ Frontend polls /api/sync/status│
│ Displays: progress bar, logs   │
│ Auto-closes when done          │
└────────────────────────────────┘
```

---

## Frontend UI: Job Status Display

```
┌────────────────────────────────────────────────────┐
│  Recent Jobs                                        │
├────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────┐  │
│ │ sync_17126584_a1b2c3d4                       │  │
│ │ ✅ done                                       │  │
│ │ ✅ Members Sync Complete: 150 synced, 0 err  │  │
│ │ ████████████████████████████████████ 100%    │  │
│ │ ▼ View Log                                    │  │
│ │   Fetched 150 members from MySQL              │  │
│ │   Appended 10 new members to Sheets          │  │
│ │   Updated 5 existing members in Sheets        │  │
│ │   Email sent to admin@mmrunners.org          │  │
│ └──────────────────────────────────────────────┘  │
│ ┌──────────────────────────────────────────────┐  │
│ │ sync_17126500_x7y8z9w0                       │  │
│ │ 🔄 running                                    │  │
│ │ Syncing 487 payments to Google Sheets...     │  │
│ │ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░ 35% │  │
│ └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

---

## Job State Machine

```
         ┌──────────┐
         │ "queued" │
         └────┬─────┘
              │
              ▼
         ┌──────────┐
         │ "running"│◄──────┐
         └────┬─────┘       │
              │         Polling
              │         every 1s
              ▼
         ┌──────────┐
    ┌───►│  "done"  │
    │    └──────────┘
    │
    ├───►│ "error"  │
    │    └──────────┘
    │
    └─ If status !== "running"
       → Stop polling, display final result
```

---

## API Response Format

### POST /api/sync/mysql-to-google/members

**Request:**
```json
POST /api/sync/mysql-to-google/members
```

**Response (immediate):**
```json
{
  "ok": true,
  "job_id": "sync_1234567890_abcdefgh"
}
```

---

### GET /api/sync/status/{job_id}

**While running:**
```json
{
  "ok": true,
  "data": {
    "status": "running",
    "message": "Syncing 487 members to Google Sheets...",
    "progress": 35,
    "created_at": "2026-03-31T02:23:45.123456"
  }
}
```

**When done:**
```json
{
  "ok": true,
  "data": {
    "status": "done",
    "message": "✅ Members Sync Complete: 150 synced, 0 errors",
    "progress": 100,
    "created_at": "2026-03-31T02:23:45.123456",
    "result": {
      "operation": "members_to_sheets",
      "inserted": 10,
      "updated": 140,
      "errors": 0,
      "inserted_list": ["M001", "M002", ...],
      "log": "📥 Fetched 150 members from MySQL\n✓ M001: sync John Doe\n..."
    }
  }
}
```

**If error:**
```json
{
  "ok": true,
  "data": {
    "status": "error",
    "message": "❌ Sync failed: Network timeout",
    "progress": 100,
    "result": {
      "error": "Network timeout",
      "log": "..."
    }
  }
}
```

---

## Threading & Concurrency

- **Main request thread**: Returns job_id immediately (non-blocking)
- **Worker thread** (daemon): Runs sync logic in background
- **Job tracking**: Thread-safe dict with `_sync_jobs_lock`
- **No database locks**: Worker commits after each batch (from NYRR sync pattern)

---

## Email Report Format

```
Subject: MMR Sync Report: MySQL → Google: Members

Body:
✅ Members Sync Complete: 150 inserted/updated, 0 errors

Details (150 items):
  • M001 (John Doe)
  • M002 (Jane Smith)
  • ... (next 48 items)
  ... and 100 more

---
Full Log:
📥 Fetched 150 members from MySQL
✓ M001: sync John Doe (new)
✓ M002: sync Jane Smith (updated)
... (100+ log lines)

Generated: 2026-03-31T02:23:45Z
```

---

## Error Handling

| Scenario | Code | Response |
|----------|------|----------|
| Missing SheetsWebhookUrl | → | Email fails, logged but sync continues |
| Network timeout to GAS | → | `status: "error"`, message shown, retry available |
| Invalid data in MySQL | → | Logged as error in result, continue |
| Job not found | 404 | `{ok: false, error: "Job not found"}` |

---

**Architecture Last Updated:** 2026-03-31 02:23 UTC
