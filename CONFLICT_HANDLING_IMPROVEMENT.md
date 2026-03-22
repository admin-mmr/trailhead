# Conflict Handling & Update Detection

## Current Issue

When syncing, if a member email already exists in the database, the sync just logs:
```
WARNING - Member balthatucanb@gmail.com already exists (conflict)
```

And then **skips updating it**, even if fields have changed in Google Sheets.

## Root Causes

1. **Column Name Mismatch**: The column mapping in `sync_sheets_to_mysql.py` still uses old names with spaces:
   ```python
   'First Name': 'FirstName',      # ❌ Wrong - should be 'FirstName'
   'Last Name': 'LastName',        # ❌ Wrong - should be 'LastName'
   'Payment Check': 'PaymentCheck', # ❌ Wrong - should be 'PaymentCheck'
   ```

2. **Missing Conflict Resolution**: When an 'added' row already exists:
   ```python
   if existing:
       logger.warning(f'Member {email} already exists (conflict)')
       return False  # ❌ Just skips without checking for changes
   ```

## Solution

### 1. Fix Column Mapping
Update the column mapping to use correct names without spaces:
```python
column_mapping = {
    'FirstName':            'FirstName',
    'LastName':             'LastName',
    'Status':               'Status',
    'Type':                 'Type',
    'Gender':               'Gender',
    'WeChatID':             'WeChatID',
    'District':             'District',
    'WebApp':               'WebApp',
    'PaymentCheck':         'PaymentCheck',      # No space!
    'Info':                 'Info',
    'LastUpdated':          'LastUpdated',       # No space!
    'MembershipFeePaid':    'MembershipFeePaid', # No space!
    'PaymentDate':          'PaymentDate',       # No space!
    'PaymentTransaction':   'PaymentTransaction',
    'JoinYear':             'JoinYear',
    'PhoneNumber':          'PhoneNumber',
    'LastLoginDate':        'LastLoginDate',
    'ProfileLastUpdated':   'ProfileLastUpdated',  # NEW
    'Notes':                'Notes',
    'NYRRRunnerName':       'NYRRRunnerName',
    'YearBorn':             'YearBorn',
}
```

### 2. Add Conflict Resolution Logic
When an 'added' row already exists, check if any fields have changed:
```python
if change_type == 'added':
    if existing:
        # Check if any fields have changed
        has_changes = False
        for sheets_col, mysql_col in column_mapping.items():
            sheet_value = row.get(sheets_col, '')
            db_value = existing.get(mysql_col, '')

            if str(sheet_value).strip() != str(db_value).strip():
                has_changes = True
                break

        if has_changes:
            # Treat as modified - update the row
            logger.info(f'Member {email} has field changes, updating...')
            change_type = 'modified'  # Switch to update mode
        else:
            # No changes - skip
            logger.info(f'Member {email} already exists with no changes')
            cursor.close()
            return False
    else:
        # New member - proceed with insert
        # ... existing INSERT logic
```

## What This Does

- **First sync**: All rows treated as 'added'
  - If member exists with same data → skip (no changes)
  - If member exists with different data → update (fields changed)
  - If member doesn't exist → insert (new member)

- **Second sync**: Diff detection works
  - Modified rows → update
  - Added rows → insert (or skip if exists with no changes)
  - Deleted rows → delete

## Testing

After fix, you should see:
```
INFO - Member balthatucanb@gmail.com has field changes, updating...
INFO - Updated member: balthatucanb@gmail.com
```

Instead of:
```
WARNING - Member balthatucanb@gmail.com already exists (conflict)
```

## Files to Update

- `basecamp/ops/sync_sheets_to_mysql.py`:
  - Line 236-258: Fix column mapping names
  - Line 195-199: Add conflict resolution logic
  - May need to fetch existing row data from DB to compare
