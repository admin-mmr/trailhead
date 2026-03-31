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
