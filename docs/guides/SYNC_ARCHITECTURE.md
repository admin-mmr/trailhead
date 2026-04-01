

# --- Merged from mmr-admin/SYNC_TAB_ARCHITECTURE.md ---

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


# --- Merged from mmr-admin/SYNC_VERBOSE_DEBUG.md ---

# Sync Verbose Debug — Raw Data Inspection & Comparison

## Overview

All sync operations (members, events, payments, transactions) now have **verbose debug logging** that shows:
1. **Raw data from Google Sheets** (column names, first 3 rows)
2. **Raw data from MySQL** (column names, first 3 rows)
3. **Field-by-field comparison** for each row
4. **Exact reason** why each row was inserted, updated, or skipped

Additionally, you can use **helper functions** to extract and compare raw data directly from the **Python Code Editor** without running the full sync.

## Method 1: View Sync Logs in Admin Portal

### Run a Sync & View Log

1. Go to **Admin Portal** → **Sync** tab
2. Click on a sync operation (Members, Events, Payments, or Import Transactions)
3. Wait for completion (will show "Done")
4. Click **View Log** to expand the detailed log

### Example: Members Sync Log

```
✅ Members Sync Complete: 5 inserted, 3 updated, 95 skipped, 0 errors
📥 Fetched 103 members from MySQL
   Columns (15): MemberID, FirstName, LastName, Email, Phone, JoinDate, Status, ...
   [Row 1] M001: John Smith, LastUpdated=2026-03-31 10:30:00
   [Row 2] M002: Jane Doe, LastUpdated=2026-03-31 09:15:00
   [Row 3] M003: Bob Johnson, LastUpdated=2026-03-30 14:20:00
📊 Fetched 98 members from Google Sheets
   Columns (15): MemberID, FirstName, LastName, Email, Phone, JoinDate, Status, ...
   [Row 1] M001: John Smith, LastUpdated=2026-03-31 10:30:00
   [Row 2] M002: Jane Doe, LastUpdated=2026-03-31 09:15:00
   [Row 3] M003: Bob Johnson, LastUpdated=2026-03-30 14:20:00
✅ M004: New Member (NEW)
   → LastUpdated=2026-03-31 11:00:00
✅ M005: Another New (NEW)
   → LastUpdated=2026-03-31 11:05:00
🔄 M001: John Smith (MySQL newer: 2026-03-31 10:30:00 > 2026-03-31 10:25:00)
⊘ M002: Jane Doe (skipped (Sheets newer or equal))
⊘ M003: Bob Johnson (skipped (Sheets newer or equal))
📤 Appended batch 1/1: 2 new members to Sheets
📤 Updated batch 1/1: 1 member in Sheets
```

**Key insights from this log:**
- MySQL has 103 members, Google Sheets has 98
- First 3 rows show the data structure (column names, sample values)
- 5 new members will be added (M004, M005, ...)
- 3 existing members updated (where MySQL is newer)
- 95 members skipped (no changes needed)

## Method 2: Use Debug Helper Functions from Python Code Editor

### Quick Start

Go to **Admin Portal** → **Python Code** tab and paste:

```python
# Import all debug helpers
from sync_debug_helpers import *

# Get raw Google Sheets data
google_members = get_google_members_for_debug()
print(f"Google has {len(google_members)} members")

# Get raw MySQL data
mysql_members = get_mysql_members_for_debug()
print(f"MySQL has {len(mysql_members)} members")

# Compare
comparison = compare_members()
print(f"New in Google: {comparison['new_in_google']}")
print(f"Missing in Google: {comparison['missing_in_google']}")
```

**Output:**
```
Google has 98 members
MySQL has 103 members
New in Google: ['M101', 'M102']
Missing in Google: ['M004', 'M005', 'M006', ...]
```

### Available Helper Functions

All helpers are in `sync_debug_helpers.py` and callable from **Python Code Editor**.

#### Data Fetchers (Get raw data)

**Members:**
```python
from sync_debug_helpers import get_google_members_for_debug, get_mysql_members_for_debug

google = get_google_members_for_debug()  # List of dicts
mysql = get_mysql_members_for_debug()    # List of dicts
```

**Events:**
```python
from sync_debug_helpers import get_google_events_for_debug, get_mysql_events_for_debug

google = get_google_events_for_debug()
mysql = get_mysql_events_for_debug()
```

**Payments:**
```python
from sync_debug_helpers import get_google_payments_for_debug, get_mysql_payments_for_debug

google = get_google_payments_for_debug()
mysql = get_mysql_payments_for_debug()
```

**Transactions:**
```python
from sync_debug_helpers import get_google_transactions_for_debug, get_mysql_transactions_for_debug

google = get_google_transactions_for_debug()
mysql = get_mysql_transactions_for_debug()
```

#### Comparison Functions

**Compare counts & IDs:**
```python
from sync_debug_helpers import compare_members, compare_events, compare_payments, compare_transactions

result = compare_members()
# Returns:
# {
#   'google_count': 98,
#   'mysql_count': 103,
#   'new_in_google': [...],
#   'missing_in_google': [...],
#   'in_both': [...]
# }

print(f"Google: {result['google_count']}, MySQL: {result['mysql_count']}")
print(f"New rows in Google: {len(result['new_in_google'])}")
print(f"Missing from Google: {len(result['missing_in_google'])}")
```

**Show field-by-field diff for one record:**
```python
from sync_debug_helpers import show_member_diff, show_event_diff

# Member comparison
diff = show_member_diff('M001')
print(diff)

# Output:
# {
#   'member_id': 'M001',
#   'in_google': True,
#   'in_mysql': True,
#   'fields': {
#     'FirstName': {'value': 'John', 'match': True},
#     'LastName': {'value': 'Smith', 'match': True},
#     'Email': {'google': 'john@old.com', 'mysql': 'john@new.com', 'match': False},
#     ...
#   }
# }
```

## Common Debug Workflows

### Workflow 1: "Why didn't my new members sync?"

```python
from sync_debug_helpers import *
import json

google = get_google_members_for_debug()
mysql = get_mysql_members_for_debug()

# Compare
comp = compare_members(google, mysql)
new_in_google = comp['new_in_google']

if not new_in_google:
    print("✓ All Google members already in MySQL")
else:
    print(f"✗ {len(new_in_google)} new members in Google:")
    for member_id in new_in_google[:5]:
        google_by_id = {m['MemberID']: m for m in google}
        member = google_by_id[member_id]
        print(f"  {member_id}: {member.get('FirstName')} {member.get('LastName')}")
```

### Workflow 2: "Why is this member not being updated?"

```python
from sync_debug_helpers import show_member_diff
import json

# Get specific member diff
diff = show_member_diff('M001')

print(f"In Google: {diff['in_google']}, In MySQL: {diff['in_mysql']}")
print(f"\nField differences:")

for field, info in diff['fields'].items():
    if not info.get('match', False):
        google_val = info.get('google')
        mysql_val = info.get('mysql')
        print(f"  {field}:")
        print(f"    Google: {repr(google_val)}")
        print(f"    MySQL:  {repr(mysql_val)}")
```

### Workflow 3: "Compare all fields for an event"

```python
from sync_debug_helpers import show_event_diff
import json

# Get event diff
diff = show_event_diff('EV-123456')

# Pretty print
print(json.dumps(diff, indent=2, default=str))
```

### Workflow 4: "Show me first 5 events with most differences"

```python
from sync_debug_helpers import get_google_events_for_debug, get_mysql_events_for_debug

google = get_google_events_for_debug()
mysql = get_mysql_events_for_debug()

google_by_id = {e['EventID']: e for e in google}
mysql_by_id = {e['EventID']: e for e in mysql}

common_ids = set(google_by_id.keys()) & set(mysql_by_id.keys())

# Count field differences for each event
diffs = {}
for event_id in common_ids:
    g = google_by_id[event_id]
    m = mysql_by_id[event_id]
    diff_count = sum(1 for k in g.keys() if str(g.get(k)) != str(m.get(k, '')))
    if diff_count > 0:
        diffs[event_id] = diff_count

# Show top 5
for event_id, count in sorted(diffs.items(), key=lambda x: x[1], reverse=True)[:5]:
    print(f"{event_id}: {count} fields differ")
```

### Workflow 5: "Find rows that would be updated in next sync"

```python
from sync_debug_helpers import get_mysql_members_for_debug, get_google_members_for_debug
from sync_debug_helpers import _parse_datetime

google = get_google_members_for_debug()
mysql = get_mysql_members_for_debug()

google_by_id = {m['MemberID']: m for m in google}
mysql_by_id = {m['MemberID']: m for m in mysql}

to_update = []

for member_id in mysql_by_id.keys():
    if member_id not in google_by_id:
        continue

    mysql_member = mysql_by_id[member_id]
    google_member = google_by_id[member_id]

    mysql_updated = mysql_member.get('LastUpdated')
    google_updated = google_member.get('LastUpdated')

    mysql_dt = _parse_datetime(mysql_updated)
    google_dt = _parse_datetime(google_updated)

    if mysql_dt and google_dt and mysql_dt > google_dt:
        to_update.append((member_id, mysql_dt, google_dt))

print(f"Would update {len(to_update)} members")
for member_id, mysql_ts, google_ts in to_update[:5]:
    print(f"  {member_id}: MySQL={mysql_ts} > Google={google_ts}")
```

## Understanding the Data Structure

### Members Fields
```python
# Sample member from Google/MySQL
{
    'MemberID': 'M001',
    'FirstName': 'John',
    'LastName': 'Smith',
    'Email': 'john@example.com',
    'Phone': '555-1234',
    'JoinDate': '2020-01-15',
    'Status': 'Active',
    'LastUpdated': '2026-03-31 10:30:00',
    # ... more fields
}
```

**Key field for sync comparison:** `LastUpdated` (timestamp)

### Events Fields
```python
{
    'EventID': 'EV-1234567-123',
    'EventName': 'Spring Marathon',
    'EventStartDate': '2026-04-15',
    'EventEndDate': '2026-04-15',
    'Location': 'Central Park',
    'EventCapacity': 500,
    'UpdatedAt': '2026-03-31T10:30:00',
    # ... more fields
}
```

**Key field for sync comparison:** `UpdatedAt` (timestamp)

### Payments Fields
```python
{
    'PaymentID': 'PAY-001',
    'MemberID': 'M001',
    'Amount': 75.00,
    'PaymentDate': '2026-03-30',
    'PaymentMethod': 'Credit Card',
    'Status': 'Completed',
    # ... more fields
}
```

**Sync logic:** Newer MySQL records push to Google

### Transactions (Gmail) Fields
```python
{
    'MessageId': 'msg_abc123',
    'Memo': 'Payment for race entry',
    'Notes': 'Previous notes',
    'ProcessedTime': '2026-03-31T10:00:00',
    'WebAppID': 'WEB-001',
    # ... more fields
}
```

**Key field for comparison:** `Memo` → `Notes` (imported field name differs)

## Debugging Guide

### Check if Google webhook is working
```python
from sync_debug_helpers import get_google_members_for_debug

try:
    members = get_google_members_for_debug()
    print(f"✓ Google webhook working, fetched {len(members)} rows")
except Exception as e:
    print(f"✗ Google webhook error: {e}")
```

### Check if MySQL is accessible
```python
from sync_debug_helpers import get_mysql_members_for_debug

try:
    members = get_mysql_members_for_debug()
    print(f"✓ MySQL accessible, {len(members)} members")
except Exception as e:
    print(f"✗ MySQL error: {e}")
```

### Find timestamp format mismatches
```python
from sync_debug_helpers import get_google_events_for_debug, get_mysql_events_for_debug
from sync_debug_helpers import _parse_datetime

google = get_google_events_for_debug()
mysql = get_mysql_events_for_debug()

# Check if timestamps parse correctly
for event in google[:3]:
    ts = event.get('UpdatedAt')
    parsed = _parse_datetime(ts)
    print(f"Google: {repr(ts)} → {parsed}")

for event in mysql[:3]:
    ts = event.get('UpdatedAt')
    parsed = _parse_datetime(ts)
    print(f"MySQL: {repr(ts)} → {parsed}")
```

## Toggling Verbose Mode

To reduce verbosity in sync logs, edit the sync functions in `api_sheets_sync.py`:

```python
verbose_mode = True  # Change to False to disable first-row logging
```

Current functions with verbose mode:
- `_sync_members_to_sheets()`
- `_sync_events_to_sheets()`
- `_sync_payments_to_sheets()`
- `_import_transactions()`

## See Also

- `PYTHON_CODE_EDITOR_README.md` — How to use Python Code tab
- `SYNC_TAB_ARCHITECTURE.md` — Overall sync design
- `GMAIL_IMPORT_DEBUG.md` — Transaction import debugging


# --- Merged from mmr-admin/VERBOSE_IMPORT_LOGGING.md ---

# Verbose Import Logging for Gmail Transactions

## Overview

The Gmail transactions import now includes **verbose logging** that shows:
1. **What data is read from Google Sheets** (columns, first 5 rows)
2. **What data already exists in MySQL** (transaction count, structure)
3. **Field-by-field comparison** for each transaction
4. **Why each transaction was inserted, updated, or skipped** (detailed reasoning)

## How to Use

### Method 1: View Import Log in Admin Portal

1. Go to **Admin Portal** → **Sync** tab → **📥 Import Transactions**
2. Click **Import from Google**
3. Wait for job to complete (see "Running..." → "Done")
4. Click **View Log** to expand the detailed log
5. Scroll through to see all transactions and their status

### Method 2: Run Analysis in Python Code Editor

Go to **Admin Portal** → **Python Code** tab and use the analysis template:

```python
# Analyze last import
results = query("""
  SELECT id, action, status, inserted, updated,
         raw_row_count, error_message, created_at
  FROM sync_log
  WHERE action = 'transaction_import'
  ORDER BY created_at DESC
  LIMIT 5
""")

for log_entry in results:
    print(f"\n{log_entry['created_at']}: {log_entry['status']}")
    print(f"  Read from Google: {log_entry['raw_row_count']} rows")
    print(f"  Inserted: {log_entry['inserted']}, Updated: {log_entry['updated']}")
    if log_entry['error_message']:
        print(f"  Error: {log_entry['error_message']}")
```

## Log Output Format

### Example Log Output

```
📥 Fetched 127 transactions from Google Sheets
   Columns: MessageId, Memo, ProcessedTime, WebAppID
   [Row 1] MessageId=msg_abc123, Memo='Payment for 5K', ProcessedTime=2026-03-31T10:30:00, WebAppID=WEB-001
   [Row 2] MessageId=msg_def456, Memo='Race registration', ProcessedTime=2026-03-31T11:00:00, WebAppID=WEB-002
   [Row 3] MessageId=msg_ghi789, Memo='Late entry fee', ProcessedTime=2026-03-31T11:15:00, WebAppID=WEB-003
   [Row 4] MessageId=msg_jkl012, Memo='Correction', ProcessedTime=2026-03-31T11:30:00, WebAppID=WEB-004
   [Row 5] MessageId=msg_mno345, Memo='Sponsor gift', ProcessedTime=2026-03-31T12:00:00, WebAppID=WEB-005
📥 Found 120 existing transactions in MySQL
Processing transactions...
✅ msg_abc123: INSERTED (new)
   → Memo='Payment for 5K', ProcessedTime=2026-03-31T10:30:00
✅ msg_def456: INSERTED (new)
   → Memo='Race registration', ProcessedTime=2026-03-31T11:00:00
🔄 msg_existing789: UPDATED — Memo changed: 'Old note' → 'Updated memo'
⊘ msg_existing012: skipped — Memo matches Notes: 'No change'
⊘ msg_existing345: skipped — Both Memo and Notes empty — no change
🔄 msg_existing678: UPDATED — Memo changed: '' → 'New note added'
✅ Import Complete: 12 inserted, 5 updated, 110 skipped, 0 errors
```

## Understanding the Output

### New Transactions (✅ INSERTED)
```
✅ msg_abc123: INSERTED (new)
   → Memo='Payment for 5K', ProcessedTime=2026-03-31T10:30:00
```
- MessageId not found in MySQL
- Will create new row in `gmail_transactions` table
- Shows the Memo and ProcessedTime that were imported

### Updated Transactions (🔄 UPDATED)
```
🔄 msg_existing789: UPDATED — Memo changed: 'Old note' → 'Updated memo'
```
- MessageId exists in MySQL
- The Memo in Google Sheets differs from Notes in MySQL
- Will update the Notes column with new Memo value
- Shows the before/after values

### Skipped Transactions (⊘ skipped)
```
⊘ msg_existing012: skipped — Memo matches Notes: 'No change'
⊘ msg_existing345: skipped — Both Memo and Notes empty — no change
```
- MessageId exists in MySQL
- No update needed (Memo in Sheets matches Notes in MySQL)
- Shows the reason (match, both empty, etc.)

## Key Metrics

The import log shows:
- **Total rows from Google:** Raw count of transactions fetched
- **Existing in MySQL:** How many were already in the database
- **Inserted:** New transactions added
- **Updated:** Existing transactions with changed Memo
- **Skipped:** Rows with no changes needed
- **Errors:** Failed inserts/updates with error details

## Debugging Import Issues

### Issue: 0 Inserted, 0 Updated

**Check in the log:**
```python
# Query the sync log for the failed import
results = query("""
  SELECT * FROM sync_log
  WHERE action = 'transaction_import'
  ORDER BY created_at DESC LIMIT 1
""")

row = results[0]
print(f"Status: {row['status']}")
print(f"Google rows read: {row['raw_row_count']}")
print(f"Inserted: {row['inserted']}, Updated: {row['updated']}")
print(f"Error: {row['error_message']}")
```

**Common causes:**
- `raw_row_count = 0` → Google Sheets fetch failed (check GAS webhook)
- All rows skipped → All transactions already in MySQL with matching Notes
- Missing MessageId → Google Sheets column mismatch

### Issue: Expected More Rows

**Compare counts:**
```python
# How many rows are in the gmail_transactions table?
results = query("SELECT COUNT(*) as cnt FROM gmail_transactions")
print(f"Total in MySQL: {results[0]['cnt']}")

# How many have been processed?
results = query("SELECT COUNT(*) as cnt FROM gmail_transactions WHERE ProcessedTime IS NOT NULL")
print(f"Processed: {results[0]['cnt']}")

# How many are unprocessed?
results = query("SELECT COUNT(*) as cnt FROM gmail_transactions WHERE ProcessedTime IS NULL")
print(f"Unprocessed: {results[0]['cnt']}")
```

## Verbose Mode Control

The logging detail is controlled by `verbose_mode` in the import code:

```python
verbose_mode = True  # Shows first 5 rows in detail
```

- `verbose_mode = True` → Shows detailed comparison for first 5 rows + all errors
- `verbose_mode = False` → Shows only summary (imported count, errors)

To change, edit `api_sheets_sync.py` line ~880 in `_import_transactions()` function.

## Fields Being Imported

The import watches these fields from Google Sheets:

| Field | MySQL Column | Purpose |
|-------|--------------|---------|
| MessageId | MessageId | Unique email message ID (primary key) |
| Memo | Notes | Message memo/note text |
| ProcessedTime | ProcessedTime | When message was processed |
| WebAppID | WebAppID | Reference to web app transaction |

**Important:**
- Memo from Google → Notes in MySQL (different column names!)
- Only "Memo" field triggers updates
- Other fields (ProcessedTime, WebAppID) don't trigger updates

## Next Steps

### After Reviewing Logs

1. **If all inserted:** Success! ✅
2. **If many skipped:** Check if Memo/Notes match
3. **If errors:** Check error message in log for specific rows
4. **If 0 rows:** Verify Google Sheets has data (check `raw_row_count`)

### To Compare Data

Use **Python Code Editor** to query and compare:

```python
# Find transactions in MySQL but not matching Google
# (requires manual comparison with Google data)

results = query("""
  SELECT MessageId, Memo, Notes, ProcessedTime
  FROM gmail_transactions
  WHERE Notes IS NULL OR Notes = ''
  ORDER BY created_at DESC
  LIMIT 20
""")

print(f"Found {len(results)} transactions with empty Notes")
for txn in results:
    print(f"  {txn['MessageId']}: Memo={repr(txn['Memo'])}")
```

## See Also

- `PYTHON_CODE_EDITOR_README.md` — How to use Python Code tab for analysis
- `SYNC_TAB_ARCHITECTURE.md` — Overall sync design
- `api_sheets_sync.py` → `_import_transactions()` function (lines ~869-1000)


# --- Merged from SHEETS_DIAGS_GUIDE.md ---

# Google Sheets Diagnostic Functions

New execution points added to read, update, and compare Google Sheets data for members, payments, and webapp_events.

## New Diagnostic Functions

### 1. `compare_sheets_vs_db()` — SYNC COMPARISON
Compares Google Sheets data against MySQL database for all major tables.

**Compares:**
- Members sheet vs `members` table
- Payments sheet vs `payments` table
- WebApp Events sheet vs `webapp_events` table

**Returns:** Row counts for each, sync status (✓ synced / ⚠ out of sync), overall recommendation

**Use case:** Quick sync health check to spot discrepancies between Sheets and database

---

### 2. `get_sheets_members(limit=50)` — READ MEMBERS
Fetches recent member records from Google Sheets via GAS webhook.

**Webhook action:** `get_members`

**Returns:**
- List of member dicts (up to limit)
- Total count in Google Sheets
- Sample column names

**Sample columns:** MemberID, FirstName, LastName, Email, Phone, MembershipStatus, MembershipExpiry, JoinDate

**Use case:** Verify member data is present in Sheets, spot missing/stale records

---

### 3. `get_sheets_payments(limit=50)` — READ PAYMENTS
Fetches recent payment records from Google Sheets via GAS webhook.

**Webhook action:** `get_payments`

**Returns:**
- List of payment dicts (up to limit)
- Total count in Google Sheets
- Sample column names

**Sample columns:** PaymentID, MemberID, Amount, PaymentDate, PaymentMethod, PayerName, TransactionReference

**Use case:** Verify payment data is synced to Sheets, check for missing transactions

---

### 4. `get_sheets_events(limit=50)` — READ EVENTS
Fetches recent webapp_event records from Google Sheets via GAS webhook.

**Webhook action:** `get_events`

**Returns:**
- List of event dicts (up to limit)
- Total count in Google Sheets
- Sample column names

**Sample columns:** EventID, EventName, EventDate, Location, MemberID, BibNumber, RegistrationDate

**Use case:** Verify event registrations are logged in Sheets, spot missed syncs

---

### 5. `get_sheets_transactions(limit=50)` — READ TRANSACTIONS
Fetches recent transaction records from Google Sheets (email import source).

**Webhook action:** `get_transactions`

**Returns:**
- List of transaction dicts (up to limit)
- Total count in Google Sheets
- Sample column names

**Sample columns:** MessageId, TimeStamp, Sender, Amount, TransactionNumber, Subject

**Use case:** Verify transactions from email imports are in Sheets before DB processing

---

### 6. `update_sheets_members(rows)` — UPDATE MEMBERS
Updates member records in Google Sheets.

**Parameters:**
- `rows`: List of member dicts (each must have `MemberID` + fields to update)

**Webhook action:** `update_members`

**Returns:** Count of rows sent and updated

**Example:**
```python
rows_to_update = [
    {
        'MemberID': '123',
        'MembershipStatus': 'Active',
        'LastUpdated': '2026-03-31'
    }
]
result = update_sheets_members(rows_to_update)
# Returns: {status: 'ok', rows_sent: 1, rows_updated: 1}
```

---

### 7. `update_sheets_payments(rows)` — UPDATE PAYMENTS
Updates payment records in Google Sheets.

**Parameters:**
- `rows`: List of payment dicts (each must have `PaymentID` + fields to update)

**Webhook action:** `update_payments`

**Returns:** Count of rows sent and updated

---

### 8. `update_sheets_events(rows)` — UPDATE EVENTS
Updates event records in Google Sheets.

**Parameters:**
- `rows`: List of event dicts (each must have `EventID` + fields to update)

**Webhook action:** `update_events`

**Returns:** Count of rows sent and updated

---

## Data Flow: GAS Webhook Integration

```
Python Function (api_sheets_diags.py)
        ↓
_call_gas_webhook(payload: {action, ...})
        ↓
Fetch SheetsWebhookUrl from MySQL Config table
        ↓
POST to GAS webhook with action + optional rows
        ↓
GAS receives POST → routes to handler
  - get_members → reads Members sheet → returns array
  - get_payments → reads Payments sheet → returns array
  - get_events → reads WebApp Events sheet → returns array
  - get_transactions → reads Transactions sheet → returns array
  - update_members → writes rows → returns {updated: N}
  - update_payments → writes rows → returns {updated: N}
  - update_events → writes rows → returns {updated: N}
        ↓
GAS returns: {ok: true, data: {...}}
        ↓
Python function parses response
        ↓
Returns rich debug result with row counts, sample columns, etc.
```

---

## Testing the Functions

### List all available diagnostic functions
```bash
curl -X GET http://localhost:5000/api/py-exec/list \
  -H "Authorization: Bearer <token>"
```

### Get recent members from Sheets
```bash
curl -X GET http://localhost:5000/api/py-exec/run/get_sheets_members \
  -H "Authorization: Bearer <token>"
```
**Expected:** List of members, row count, sample columns

### Compare Sheets vs DB
```bash
curl -X GET http://localhost:5000/api/py-exec/run/compare_sheets_vs_db \
  -H "Authorization: Bearer <token>"
```
**Expected:** Comparison table showing sync status for members/payments/events

### Execute custom Python with Sheets functions
```bash
curl -X POST http://localhost:5000/api/py-exec/execute \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "
from api_sheets_diags import get_sheets_members, compare_sheets_vs_db
members = get_sheets_members(limit=5)
sync = compare_sheets_vs_db()
print(f'Members: {members[\"row_count\"]}')
print(f'Sync status: {sync[\"summary\"][\"overall_status\"]}')
"
  }'
```

---

## Error Handling

### "SheetsWebhookUrl not configured"
**Cause:** Config table doesn't have the GAS webhook URL
**Fix:** Set the webhook URL in MySQL Config table:
```sql
INSERT INTO Config (ConfigKey, ConfigValue)
VALUES ('SheetsWebhookUrl', 'https://script.google.com/macros/d/...')
ON DUPLICATE KEY UPDATE ConfigValue = VALUES(ConfigValue);
```

### HTTP errors or GAS errors in response
**Cause:** Webhook request failed or GAS handler crashed
**Solution:** Check Azure Application Logs for `[webhook_client]` entries, and check GAS execution logs

### Empty data returned
**Cause:** Google Sheets might be empty or GAS returned empty array
**Fix:** Check the GAS spreadsheet directly to verify data exists

---

## Module Architecture

| Module | Size | Purpose |
|--------|------|---------|
| `api_python_exec.py` | 681 lines | Core execution engine + diagnostic orchestration |
| `api_email_diags.py` | 230 lines | Email pipeline diagnostics (webhook, Gmail, activity logs) |
| `api_sheets_diags.py` | 436 lines | Google Sheets read/write diagnostics |

All modules follow the same pattern:
- Leaf modules: No inter-module imports (only db + stdlib)
- Orchestrator: api_python_exec.py imports from both leaf modules
- Rich debug output: All functions return status, row counts, sample data, timestamps

---

## Related Files

- `mmr-admin/api_python_exec.py` — Execution engine that registers and runs diagnostic functions
- `mmr-admin/api_sheets_diags.py` — Google Sheets diagnostics module
- `mmr-admin/api_email_diags.py` — Email pipeline diagnostics module
- `mmr-admin/api_sheets_sync.py` — Main sync logic (uses GAS webhook)
- GAS repository: `sheets_api_handlers.gs` — GAS handlers for read/write operations

---

**Last updated:** 2026-03-31
**Author:** Claude (Cowork)
