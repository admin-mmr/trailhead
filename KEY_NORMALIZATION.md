# Key Normalization: Sheets → MySQL Column Mapping

## The Problem

**Google Apps Script (GAS) webhook returns camelCase keys:**
```json
{
  "memberID": "A0001",
  "firstName": "John",
  "lastUpdated": "2026-04-02T10:30:00Z"
}
```

**MySQL schema uses PascalCase columns:**
```sql
SELECT MemberID, FirstName, LastUpdated FROM members;
```

**They don't match** → need normalization before comparison.

---

## Solution: `_normalize_gas_keys()` Function

**Location:** `api_sheets_sync.py` lines ~340–410

**What it does:**
1. Takes a row dict from GAS webhook (camelCase keys)
2. Maps each camelCase key to PascalCase using `CASE_MAP` dict
3. Returns normalized row with MySQL column names

**Example:**
```python
# Input from GAS webhook
gas_row = {
    'memberID': 'A0001',
    'firstName': 'John',
    'lastName': 'Doe',
    'lastUpdated': '2026-04-02T10:30:00Z'
}

# After normalization
normalized = _normalize_gas_keys(gas_row)
# Result:
# {
#     'MemberID': 'A0001',
#     'FirstName': 'John',
#     'LastName': 'Doe',
#     'LastUpdated': '2026-04-02T10:30:00Z'
# }
```

---

## Where It's Called

### Members Sync (line ~520)
```python
sheets_data = _call_gas_webhook({'action': 'get_members'})
sheets_members = sheets_data if isinstance(sheets_data, list) else []
# Normalize camelCase to PascalCase ← HERE
sheets_members = [_normalize_gas_keys(row) for row in sheets_members]
sheets_by_id = {m['MemberID']: m for m in sheets_members if 'MemberID' in m}
```

### Events Sync (similar pattern, line ~795)
```python
sheets_events = sheets_data if isinstance(sheets_data, list) else []
# Normalize camelCase to PascalCase ← HERE
sheets_events = [_normalize_gas_keys(row) for row in sheets_events]
sheets_by_id = {e['EventID']: e for e in sheets_events if 'EventID' in e}
```

### Payments Sync (similar pattern, line ~950)
```python
sheets_payments = sheets_data if isinstance(sheets_data, list) else []
sheets_payments = [_normalize_gas_keys(row) for row in sheets_payments]
sheets_by_id = {p['PaymentID']: p for p in sheets_payments if 'PaymentID' in p}
```

---

## Complete Case Mapping

### Members Table
| camelCase | PascalCase |
|-----------|-----------|
| memberID | MemberID |
| firstName | FirstName |
| lastName | LastName |
| familyID | FamilyID |
| wechatID | WeChatID |
| lastUpdated | LastUpdated |
| membershipFeePaid | MembershipFeePaid |
| paymentDate | PaymentDate |
| paymentTransaction | PaymentTransaction |
| joinYear | JoinYear |
| phoneNumber | PhoneNumber |
| lastLogin | LastLogin |

### WebApp Events Table
| camelCase | PascalCase |
|-----------|-----------|
| eventID | EventID |
| eventType | EventType |
| expiresAt | ExpiresAt |
| paymentIntent | PaymentIntent |
| paymentMethod | PaymentMethod |
| payerName | PayerName |
| memoField | MemoField |
| last4Digits | Last4Digits |
| matchedMessageId | MatchedMessageId |
| matchedTransactionNumber | MatchedTransactionNumber |
| adminApprover | AdminApprover |
| approvalDate | ApprovalDate |

### Payment History Table
| camelCase | PascalCase |
|-----------|-----------|
| paymentID | PaymentID |
| transactionReference | TransactionReference |
| periodStart | PeriodStart |
| periodEnd | PeriodEnd |
| processedBy | ProcessedBy |
| processedDate | ProcessedDate |

### Gmail Transactions Table
| camelCase | PascalCase |
|-----------|-----------|
| messageId | MessageId |
| transactionNumber | TransactionNumber |
| transactionDate | TransactionDate |
| originalMemo | OriginalMemo |
| processedTime | ProcessedTime |

### Common Fields
| camelCase | PascalCase |
|-----------|-----------|
| timestamp | Timestamp |
| created | Created |
| sender | Sender |
| amount | Amount |
| memo | Memo |
| subject | Subject |
| notes | Notes |
| source | Source |

---

## How It Enables Matching

### Before Normalization (❌ Would fail)
```python
mysql_row = {'MemberID': 'A0001', 'FirstName': 'John', ...}
sheets_row = {'memberID': 'A0001', 'firstName': 'John', ...}

if 'FirstName' in sheets_row:  # ❌ Key doesn't exist
    # Never reached
```

### After Normalization (✅ Works)
```python
mysql_row = {'MemberID': 'A0001', 'FirstName': 'John', ...}
sheets_row = _normalize_gas_keys({'memberID': 'A0001', 'firstName': 'John', ...})
# sheets_row = {'MemberID': 'A0001', 'FirstName': 'John', ...}

if 'FirstName' in sheets_row:  # ✅ Key exists now
    compare_values(mysql_row['FirstName'], sheets_row['FirstName'])
```

---

## Key Lookup by Primary Key

**After normalization, keys are looked up by primary key:**

```python
# Normalize all Sheets rows
sheets_members = [_normalize_gas_keys(row) for row in sheets_members]

# Index by PascalCase primary key
sheets_by_id = {m['MemberID']: m for m in sheets_members if 'MemberID' in m}

# Lookup by MySQL primary key (same format now)
for mysql_member in mysql_rows:
    member_id = mysql_member['MemberID']  # PascalCase
    if member_id in sheets_by_id:         # Lookup works because both are PascalCase
        sheets_member = sheets_by_id[member_id]
        # Now we can compare safely
```

---

## Fallback Behavior

If a key is **not** in `CASE_MAP`, it's kept as-is:

```python
# If GAS webhook sends an unknown key (e.g., 'customField')
gas_row = {'memberID': 'A0001', 'customField': 'value'}
normalized = _normalize_gas_keys(gas_row)
# Result:
# {
#     'MemberID': 'A0001',        ← mapped
#     'customField': 'value'       ← kept as-is (not in CASE_MAP)
# }
```

This allows forward compatibility: if GAS adds new fields, they pass through unchanged and don't break the sync.

---

## Critical: Order of Operations

**✅ Correct (normalized before lookup):**
```python
1. Fetch Sheets data (camelCase)
2. Normalize to PascalCase
3. Index by PascalCase key
4. Lookup MySQL rows by PascalCase key
5. Compare normalized rows
```

**❌ Wrong (lookup before normalization):**
```python
1. Fetch Sheets data (camelCase)
2. Index by camelCase key (e.g., sheets_by_id['memberID'] = row)
3. Try to lookup MySQL row by PascalCase key (e.g., sheets_by_id['MemberID'])
4. KeyError: 'MemberID' ← FAILS because key is 'memberID' (camelCase)
```

---

## Code Review Checklist

When adding a new table to sync:

- [ ] Add camelCase → PascalCase mappings to `CASE_MAP` in `_normalize_gas_keys()`
- [ ] Call `_normalize_gas_keys()` on all Sheets rows **before** indexing by primary key
- [ ] Use PascalCase (MySQL column names) in all downstream comparisons
- [ ] Test with GAS webhook data (camelCase) to verify mappings work

---

## Future Improvement

The `CASE_MAP` could be moved to `sync_engine.py` as a config dict to avoid duplication if other sync tools (basecamp/ops, etc.) also need key normalization.

Current location: **api_sheets_sync.py, function `_normalize_gas_keys()` (lines ~340–410)**

