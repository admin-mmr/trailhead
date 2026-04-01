# Sync Tab: Next Steps (GAS Integration)

**Current Status:** Framework complete, ready for Google Apps Script integration
**Files:** `mmr-admin/api_sheets_sync.py`, `templates/index.html`, `app.py`
**Commit:** `1aaead2`

---

## Quick Start: Adding GAS Integration

### Step 1: Implement `_call_gas_webhook()` helper

Add this to `api_sheets_sync.py` (around line 50):

```python
def _call_gas_webhook(payload: Dict) -> Dict:
    """Call the Google Apps Script webhook to fetch/push Sheets data."""
    webhook_url = _get_config_value('SheetsWebhookUrl', '')
    if not webhook_url:
        logger.warning("SheetsWebhookUrl not configured — skipping webhook call")
        return {}

    import requests
    try:
        resp = requests.post(webhook_url, json=payload, timeout=30)
        if resp.status_code != 200:
            raise Exception(f"HTTP {resp.status_code}: {resp.text[:500]}")

        body = resp.json()
        if not body.get('ok'):
            raise Exception(f"GAS error: {body.get('error', body)}")

        return body.get('data', {})
    except Exception as e:
        logger.error(f"GAS webhook failed: {e}")
        raise
```

---

### Step 2: Replace TODOs in `_sync_members_to_sheets()`

**Current placeholder (lines 140-150):**
```python
# TODO: Fetch members from Google Sheets via GAS webhook
# For now, simulate with a placeholder request to GAS
# sheets_data = _call_gas_webhook({'action': 'get_members'})
```

**Replace with:**
```python
# Fetch members from Google Sheets
sheets_members = _call_gas_webhook({'action': 'get_members'})
sheets_by_id = {m['MemberID']: m for m in sheets_members}

inserted = []
updated = []

for member in members_rows:
    member_id = member['MemberID']
    mysql_updated = member.get('LastUpdated')

    if member_id not in sheets_by_id:
        # New member — append to Sheets
        try:
            _call_gas_webhook({
                'action': 'append_members',
                'rows': [member]  # Send all fields
            })
            inserted.append(member_id)
            log_lines.append(f"✅ {member_id}: appended (new)")
        except Exception as e:
            errors.append(f"{member_id}: {e}")
            log_lines.append(f"❌ {member_id}: {e}")
    else:
        # Existing member — check versioning
        sheets_updated = sheets_members_by_id[member_id].get('LastUpdated')
        if mysql_updated > sheets_updated:
            # MySQL is newer — update Sheets
            try:
                _call_gas_webhook({
                    'action': 'update_members',
                    'rows': [member]
                })
                updated.append(member_id)
                log_lines.append(f"✅ {member_id}: updated (MySQL newer)")
            except Exception as e:
                errors.append(f"{member_id}: {e}")
                log_lines.append(f"❌ {member_id}: {e}")
        else:
            log_lines.append(f"⊘ {member_id}: skipped (Sheets newer)")
```

---

### Step 3: Similar replacements for events & payments

**In `_sync_events_to_sheets()` (line ~180):**
```python
sheets_events = _call_gas_webhook({'action': 'get_events'})
sheets_by_id = {e['EventID']: e for e in sheets_events}
# ... same versioning logic using EventID
```

**In `_sync_payments_to_sheets()` (line ~220):**
```python
sheets_payments = _call_gas_webhook({'action': 'get_payments'})
sheets_by_id = {p['PaymentID']: p for p in sheets_payments}
# ... similar logic for PaymentID
```

---

### Step 4: Implement `_import_transactions()`

**Replace TODO at line ~260:**
```python
# Fetch gmail_transactions from Google Sheets
sheets_txns = _call_gas_webhook({'action': 'get_transactions'})

# Get existing MessageIds from MySQL
existing_ids = set()
conn = get_conn()
cursor = conn.cursor()
cursor.execute("SELECT MessageId FROM gmail_transactions")
for row in cursor.fetchall():
    existing_ids.add(row[0])

inserted = []
updated = []

for txn in sheets_txns:
    message_id = txn.get('MessageId')
    memo = txn.get('Memo', '')

    if message_id not in existing_ids:
        # New transaction — insert
        try:
            execute("""
                INSERT INTO gmail_transactions
                (MessageId, Memo, Notes, ProcessedTime)
                VALUES (%s, %s, %s, NOW())
            """, [message_id, memo, ''])
            inserted.append(message_id)
            log_lines.append(f"✅ {message_id}: inserted")
        except Exception as e:
            errors.append(str(e))
            log_lines.append(f"❌ {message_id}: {e}")
    else:
        # Existing — check if Memo differs from Notes
        cursor.execute(
            "SELECT Notes FROM gmail_transactions WHERE MessageId = %s",
            [message_id]
        )
        row = cursor.fetchone()
        if row and row[0] != memo:
            try:
                execute(
                    "UPDATE gmail_transactions SET Notes = %s WHERE MessageId = %s",
                    [memo, message_id]
                )
                updated.append(message_id)
                log_lines.append(f"✅ {message_id}: updated Notes")
            except Exception as e:
                errors.append(str(e))

cursor.close()
conn.close()
```

---

### Step 5: Implement `_dry_run_google_to_mysql()`

**Replace TODO at line ~310:**
```python
# Fetch all data from Sheets
sheets_members = _call_gas_webhook({'action': 'get_members'})
sheets_events = _call_gas_webhook({'action': 'get_events'})
sheets_payments = _call_gas_webhook({'action': 'get_payments'})

# Fetch from MySQL
mysql_members = query("SELECT MemberID, LastUpdated FROM members")
mysql_events = query("SELECT EventID, EventName FROM webapp_events")
mysql_payments = query("SELECT PaymentID FROM payments")

# Build sets for comparison
mysql_member_ids = {m['MemberID'] for m in mysql_members}
mysql_event_ids = {e['EventID'] for e in mysql_events}
mysql_payment_ids = {p['PaymentID'] for p in mysql_payments}

sheets_member_ids = {m['MemberID'] for m in sheets_members}
sheets_event_ids = {e['EventID'] for e in sheets_events}
sheets_payment_ids = {p['PaymentID'] for p in sheets_payments}

diffs = []

# Members
only_in_sheets = sheets_member_ids - mysql_member_ids
only_in_mysql = mysql_member_ids - sheets_member_ids
diffs.append(f"Members: {len(only_in_sheets)} in Sheets only, {len(only_in_mysql)} in MySQL only")
if only_in_sheets:
    diffs.append(f"  In Sheets only: {list(only_in_sheets)[:10]}")
if only_in_mysql:
    diffs.append(f"  In MySQL only: {list(only_in_mysql)[:10]}")

# Events
only_in_sheets = sheets_event_ids - mysql_event_ids
only_in_mysql = mysql_event_ids - sheets_event_ids
diffs.append(f"Events: {len(only_in_sheets)} in Sheets only, {len(only_in_mysql)} in MySQL only")

# Payments
only_in_sheets = sheets_payment_ids - mysql_payment_ids
only_in_mysql = mysql_payment_ids - sheets_payment_ids
diffs.append(f"Payments: {len(only_in_sheets)} in Sheets only, {len(only_in_mysql)} in MySQL only")

log_lines.insert(0, f"🔍 Dry-run comparison complete: {len(diffs)} differences found")
log_lines.extend(diffs)
```

---

## GAS Webhook Actions Checklist

Create these in your Google Apps Script:

- [ ] `get_members` → Return all members from Sheets with MemberID, FirstName, LastName, ..., LastUpdated
- [ ] `get_events` → Return all events with EventID, EventName, ..., EventStatus
- [ ] `get_payments` → Return recent payments with PaymentID, Amount, ...
- [ ] `get_transactions` → Return gmail_transactions with MessageId, Memo, Notes, ...
- [ ] `append_members` → Add new member rows to Members sheet
- [ ] `update_members` → Update existing member rows in Members sheet
- [ ] `append_events` → Add new event rows
- [ ] `update_events` → Update existing event rows
- [ ] `append_payments` → Add new payment rows
- [ ] `update_payments` → Update existing payment rows

Each action should return:
```json
{
  "ok": true,
  "data": [...]  // or {success_count: N, error_count: M}
}
```

On error:
```json
{
  "ok": false,
  "error": "Human-readable error message"
}
```

---

## Testing Checklist

After implementing GAS integration:

- [ ] Members sync: new members appended, existing updated if MySQL newer
- [ ] Events sync: status/name changes reflected in Sheets
- [ ] Payments sync: recent payments visible in Sheets
- [ ] Import: new gmail_transactions inserted, Memo→Notes updates work
- [ ] Dry-run: differences detected and displayed (no DB changes)
- [ ] Email reports: sent with correct summary + details
- [ ] Job polling: UI shows real-time progress (status, progress %, logs)
- [ ] Error handling: network errors, missing config, invalid data logged gracefully
- [ ] Thread safety: multiple concurrent syncs don't interfere

---

## Files to Modify

| File | What | Complexity |
|------|------|------------|
| `api_sheets_sync.py` | Add `_call_gas_webhook()` + replace 5 TODOs | Medium |
| GAS webhook script | Create 10 actions | Medium-High |
| `config` table (MySQL) | Ensure `SheetsWebhookUrl` is set | Low |

---

## Reference Docs

- **`SYNC_IMPLEMENTATION.md`** — Full feature spec
- **`mmr-admin/SYNC_TAB_ARCHITECTURE.md`** — API specs + data flows
- **`api_sheets_sync.py`** — Source code with TODOs

---

**Last Updated:** 2026-03-31 02:23 UTC
**Framework Status:** ✅ Complete
**GAS Integration Status:** ⏳ Ready for implementation
