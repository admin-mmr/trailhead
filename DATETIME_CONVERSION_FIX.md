# Datetime Format Conversion Fix

## Problem
Google Sheets sends timestamps in ISO 8601 format:
```
2026-03-19T20:26:21.843Z
```

But MySQL DATETIME expects:
```
2026-03-19 20:26:21
```

This caused sync errors:
```
ERROR - Incorrect datetime value: '2026-03-19T20:26:21.843Z' for column 'LastUpdated' at row 1
```

## Solution
Added `convert_datetime_to_mysql()` function that:

1. **Converts ISO 8601 with milliseconds**
   - Input: `2026-03-19T20:26:21.843Z`
   - Output: `2026-03-19 20:26:21`

2. **Converts ISO 8601 without milliseconds**
   - Input: `2026-03-19T20:26:21Z`
   - Output: `2026-03-19 20:26:21`

3. **Preserves MySQL format**
   - Input: `2026-03-19 20:26:21`
   - Output: `2026-03-19 20:26:21` (unchanged)

4. **Converts date-only strings**
   - Input: `2026-03-19`
   - Output: `2026-03-19 00:00:00`

5. **Handles invalid/empty values**
   - Returns None for invalid dates (field skipped)
   - Logs warning for debugging

## Applied To
Updated `_update_member()` method to convert datetime fields:
- Created
- Expiration
- LastUpdated
- MembershipFeePaid
- PaymentDate
- PaymentTransaction
- LastLoginDate
- ProfileLastUpdated

## Testing
Try the sync again:
```bash
cd basecamp
source load-env.sh
./run-sync.sh Main members
```

Should now show:
```
INFO - Member balthatucanb@gmail.com already exists but has field changes, updating...
INFO - Updated member: balthatucanb@gmail.com
```

No more datetime format errors!
