# Member Status Update — Migration V10

## Summary of Changes

Updated the daily member status refresh logic to:
1. Distinguish members who may renew (`expired`) from those who won't (`inactive`)
2. **Lock `inactive` status** — once set, the cron job will never auto-change it (manual override feature)

### New Status Logic

Using expiration date as the single source of truth, **with manual override for `inactive`**:

| Status | Rule | Send Reminders? | Cron Changes? |
|--------|------|-----------------|---|
| **active** | `Expiration >= TODAY()` | N/A (current member) | ✅ Can change |
| **expired** | `TODAY() > Expiration >= 2026-01-01` | ✅ YES — can renew | ✅ Can change |
| **inactive** | **LOCKED** — set manually, never auto-changed | ❌ NO — "do not contact" | ❌ **SKIP** (manual override) |
| **pending** | `Expiration IS NULL` + has pending Membership payment | ✅ YES — awaiting payment | ✅ Can change |

### What Changed

**Old Logic:**
- `active` → Expiration >= NOW()
- `not active` → Expiration < NOW() with no pending event
- `pending` → Expiration < NOW() + has pending event
- `skipped` → NULL expiration, no pending event

**New Logic (V10):**
- Clear distinction: `expired` (may renew) vs `inactive` (won't renew)
- **CRITICAL: `inactive` is a LOCK** — once set, never auto-changed by cron job
- NULL expiration → `inactive` (unless pending payment or already manually set)
- Uses **date comparison** instead of datetime (cleaner, less ambiguous)
- Cutoff date `2026-01-01` makes the intent explicit
- Admins can mark members as "do not contact" by setting status to `inactive`

---

## Manual Override: Locking Status to `inactive`

The most important feature of V10 is the **`inactive` lock**:

### Use Case
You manually set a member's status to `inactive` to mark them as "do not contact" (e.g., they explicitly asked to be removed, moved away, etc.). The daily cron job will **NEVER** overwrite this setting, even if you change their expiration date later.

### How It Works

**Python Logic:**
```python
# First thing: check if already inactive
if old_status == "inactive":
    counts["inactive"] += 1
    continue  # SKIP this member entirely
```

**Result:**
- Daily cron job runs → sees member is `inactive` → skips them completely
- If you later update their `Expiration` date → cron job still skips them
- To un-lock: Manually change status back to `active` / `expired` / `pending` in MySQL

### Example Workflow

```
Admin: "Mark A0042 as inactive—they're moving away."
  → UPDATE members SET Status = 'inactive' WHERE MemberID = 'A0042'

Cron job runs tomorrow
  → Sees A0042 is inactive
  → Skips it (doesn't recalculate)

6 months later: Admin updates expiration date by mistake
Cron job runs
  → Still sees A0042 is inactive
  → Still skips it (locked!)

Admin realizes the mistake
  → UPDATE members SET Status = 'active' WHERE MemberID = 'A0042'
  → Now cron job will recalculate status normally
```

### When to Use `inactive`
- Member explicitly asked to be removed from mailing list
- Member moved away / no longer contact info
- Duplicate account / merged with another member
- Hard bounce / invalid email address
- Any reason you want "permanent do not contact"

### When NOT to Use `inactive`
- Member's membership expired recently → use `expired` (auto-set by cron)
- Member will renew next month → use `expired` (auto-set by cron)
- Temporarily blocking communications → use custom field or notes, not status

---

## Files Modified

### 1. basecamp/ops/update_member_status.py
**Updated:** Python script that runs the daily member status refresh

Changes:
- New status logic with 4 conditions (active/expired/inactive/pending)
- Uses date comparison instead of datetime.now()
- Explicit cutoff date `2026-01-01`
- Updated counts dict keys: `not_active` → `expired` + `inactive`
- Logging updated to show `expired` / `inactive` breakdown

Example output:
```
Status breakdown: 185 active, 45 expired, 12 inactive, 3 pending
Status changes to apply: 18 member(s)
```

### 2. .github/workflows/update-member-status.yml
**Updated:** GitHub Actions workflow definition

Changes:
- Updated status logic comments to match V10
- Workflow remains on `workflow_dispatch` trigger (manual only for now)
- Can be re-enabled for automatic scheduling if desired
- Success: Email sent to admin@mmrunners.org with status breakdown

---

## How to Deploy

### 1. Deploy Code
Push to main — GitHub Actions will deploy on next run:
```bash
git add basecamp/ops/update_member_status.py
git add .github/workflows/update-member-status.yml
git commit -m "chore: Member status V10 — expired vs inactive distinction"
git push origin main
```

### 2. Run Status Update (First Time)

**Option A: Manual via GitHub Actions UI**
1. Go to `.github/workflows/update-member-status.yml`
2. Click "Run workflow" → Choose `dry_run=true` first
3. Review logs to see what will change
4. Run again with `dry_run=false` to apply

**Option B: Run Python Script Directly**
```bash
cd basecamp/ops/
python3 update_member_status.py --dry-run
# Review output
python3 update_member_status.py  # live
```

**Option C: Manual SQL (see STATUS_UPDATE_MANUAL_SQL.md)**
- Use provided SQL commands to update in bulk
- No pending event detection (Python version has this)

### 3. Enable Automatic Daily Refresh (Optional)

Uncomment the `workflow_run` trigger in `.github/workflows/update-member-status.yml`:

```yaml
on:
  workflow_run:
    workflows: ["Full Bidirectional Sync"]  # or whatever sync job you prefer
    types: [completed]
  workflow_dispatch:
```

Then member status will refresh automatically 4x daily after sync completes.

---

## Data Alignment

The new status values match the schema enum from **Migration V10-b**:

```sql
ALTER TABLE members
  CHANGE COLUMN Status Status enum('active','expired','inactive','pending')
```

All tools now align:
- ✅ MySQL schema enum
- ✅ Python status update script
- ✅ TypeScript types (already updated in web-apps)
- ✅ Google Sheets column (Status)

---

## Testing

### Dry-Run First (Recommended)

```bash
python3 basecamp/ops/update_member_status.py --dry-run
```

Output:
```
2026-04-02 18:25:30 - INFO - Status breakdown: 185 active, 45 expired, 12 inactive, 3 pending
2026-04-02 18:25:30 - INFO - Status changes to apply: 18 member(s)
2026-04-02 18:25:30 - INFO - [DRY] member1@example.com      not active → expired
2026-04-02 18:25:30 - INFO - [DRY] member2@example.com      not active → inactive
...
```

### Verify After Running

```sql
SELECT Status, COUNT(*) FROM members GROUP BY Status ORDER BY COUNT(*) DESC;
```

---

## Rollback Plan

If something goes wrong:

**Revert Code:**
```bash
git revert <commit-hash>
git push origin main
```

**Reset Status to Old Logic (Manual):**
```sql
-- Mark expired as 'not active'
UPDATE members SET Status = 'not active'
WHERE Status = 'expired';

-- Keep inactive as 'not active'
UPDATE members SET Status = 'not active'
WHERE Status = 'inactive';

-- Re-run old Python script (from git history)
```

---

## Cutoff Date Explanation

**Why 2026-01-01?**

- Represents the most recent membership year-end
- Members who expired **after** this date may have let it lapse recently → send reminders
- Members who expired **before** this date clearly abandoned membership → no reminders
- Date is explicit and easy to update next year (change to 2027-01-01)

---

## Related Files

- `MIGRATION_V10_COMMANDS.md` — Schema changes (Status enum, column drops)
- `db/schema_snapshot.sql` — Current MySQL schema with 4-value Status enum
- `web-apps/config/types.ts` — TypeScript types (already supports 4 statuses)

---

## Questions?

- **How often does status refresh?** Currently: manual via GitHub UI. Can be automated (see "Enable Automatic Daily Refresh")
- **What about pending payments?** Handled by Python script (checks webapp_events table). SQL version doesn't do this.
- **Can I change 2026-01-01?** Yes, just edit the `cutoff_inactive = date(2026, 1, 1)` line in the Python script.
- **What if Expiration is NULL?** Treated as `inactive` (no reminder) unless pending payment exists.
