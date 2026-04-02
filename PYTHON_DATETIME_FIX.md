# Python DateTime Fix

## Issue
GitHub Actions error:
```
AttributeError: 'datetime.date' object has no attribute 'date'
File "basecamp/ops/update_member_status.py", line 151
  exp_date = expiration.date() if expiration else None
```

## Root Cause
The `Expiration` column from MySQL can be returned as either:
- `datetime.datetime` object (when fetched as DATETIME)
- `datetime.date` object (when fetched as DATE)

The code was calling `.date()` unconditionally, which fails if it's already a `date` object.

## Solution
Added type checking to handle both cases:

```python
# Convert expiration to date (handle both datetime and date objects)
if expiration is None:
    exp_date = None
elif isinstance(expiration, datetime):
    # It's a datetime object, convert to date
    exp_date = expiration.date()
else:
    # It's already a date object
    exp_date = expiration
```

## File Changed
- `basecamp/ops/update_member_status.py` (lines 150-158)

## Verification
The script now handles both:
- `None` → `None`
- `datetime(2026, 3, 31, 14, 30, 45)` → `date(2026, 3, 31)`
- `date(2026, 3, 31)` → `date(2026, 3, 31)` (unchanged)

## Commit
```bash
git add basecamp/ops/update_member_status.py
git commit -m "fix: Handle both datetime and date objects for Expiration column"
git push origin main
```
