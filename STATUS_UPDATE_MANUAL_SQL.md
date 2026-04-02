# Manual Status Update SQL Commands

If you want to manually update member statuses based on the new V10 logic without waiting for the cron job, you can run these SQL commands directly.

## ⚠️ CRITICAL: `inactive` Lock

**Once you set a member's status to `inactive`, the cron job will NEVER auto-change it.**

This allows you to mark members as "do not contact" permanently. Examples:
- Member moved away, don't send reminders
- Duplicate account, merged with another
- Explicitly requested removal from mailing list

To unlock an inactive member, manually change their status back to `active`, `expired`, or `pending`.

## Prerequisites
- SSH access to Azure MySQL (mmrdb, Sweden Central)
- Use `mysql-mmr` alias or manual connection

## One-Time Status Update (Manual)

This directly applies the new V10 status logic in SQL. You can dry-run first by viewing the results, then execute the updates.

### Preview What Will Change

```sql
-- View members that will change status (expired)
SELECT MemberID, Email, Status, Expiration, 'expired' AS new_status
FROM members
WHERE Expiration < CURDATE()
  AND Expiration >= '2026-01-01'
  AND Status != 'expired'
LIMIT 20;

-- View members that will change status (inactive)
SELECT MemberID, Email, Status, Expiration, 'inactive' AS new_status
FROM members
WHERE (Expiration < '2026-01-01' OR Expiration IS NULL)
  AND Status NOT IN ('inactive', 'pending')
LIMIT 20;

-- View members that will stay active
SELECT MemberID, Email, Status, Expiration, 'active' AS new_status
FROM members
WHERE Expiration >= CURDATE()
  AND Status != 'active'
LIMIT 20;
```

### Apply Updates (One Statement Per Status)

**1. Mark as `expired` (membership lapsed but may renew):**
```sql
UPDATE members
SET Status = 'expired'
WHERE Expiration < CURDATE()
  AND Expiration >= '2026-01-01'
  AND Status != 'expired';
```
Expected: Updates members with past expiration dates between 2026-01-01 and today.

**2. Mark as `inactive` (confirmed not renewing):**
```sql
UPDATE members
SET Status = 'inactive'
WHERE Expiration < '2026-01-01'
  AND Status != 'inactive';
```
Expected: Updates members with expiration before 2026-01-01.

**3. Mark NULL expiration as `inactive` (unless pending payment):**
```sql
UPDATE members
SET Status = 'inactive'
WHERE Expiration IS NULL
  AND Status NOT IN ('pending', 'inactive');
```
Expected: Updates members with no expiration date (who aren't already pending).

**4. Ensure `active` status for current/future dates:**
```sql
UPDATE members
SET Status = 'active'
WHERE Expiration >= CURDATE()
  AND Status != 'active';
```
Expected: Updates members whose expiration is today or in the future.

---

## Alternative: Run All Updates in Transaction

To apply all four changes atomically (all succeed or all fail):

```sql
START TRANSACTION;

-- Expired (past but >= 2026-01-01)
UPDATE members
SET Status = 'expired'
WHERE Expiration < CURDATE()
  AND Expiration >= '2026-01-01'
  AND Status != 'expired';

-- Inactive (before 2026-01-01)
UPDATE members
SET Status = 'inactive'
WHERE Expiration < '2026-01-01'
  AND Status != 'inactive';

-- Inactive (NULL expiration, not pending)
UPDATE members
SET Status = 'inactive'
WHERE Expiration IS NULL
  AND Status NOT IN ('pending', 'inactive');

-- Active (current/future)
UPDATE members
SET Status = 'active'
WHERE Expiration >= CURDATE()
  AND Status != 'active';

COMMIT;
```

---

## Verify After Update

After running the updates, check the new status breakdown:

```sql
SELECT Status, COUNT(*) AS count
FROM members
GROUP BY Status
ORDER BY count DESC;
```

Expected output (varies by your data):
```
active     | 185
expired    | 45
inactive   | 12
pending    | 3
```

Check for NULL expirations:
```sql
SELECT COUNT(*) FROM members WHERE Expiration IS NULL;
```

---

## Notes

- The SQL commands above match the logic in `basecamp/ops/update_member_status.py` (updated in V10)
- The Python script runs automatically via GitHub Actions (cron job 4x daily)
- Cutoff date `2026-01-01` distinguishes:
  - **Expired (>= 2026-01-01):** Members who may want to renew → send reminders
  - **Inactive (< 2026-01-01):** Members confirmed not renewing → no reminders
- The Python version checks for pending Membership payment events; the SQL version above does NOT. If you want to preserve pending status, use the Python script instead.

---

## Rollback (if needed)

If you make a mistake, restore from backup or revert by setting all to 'active':

```sql
UPDATE members SET Status = 'active' WHERE Status IN ('expired', 'inactive');
```

Then run the Python script to recalculate correctly.
