# `inactive` Lock — Quick Reference

## What Is It?

Once a member's status is set to `inactive`, the daily cron job will **SKIP them entirely** and never auto-change their status based on expiration date.

## Why?

To allow admins to mark members as "do not contact" without expiration dates interfering. Examples:
- Member moved away
- Duplicate account (merged with another)
- Explicitly asked to be removed
- Hard bounce / invalid email
- Any reason for permanent "do not contact"

## How to Use

### Mark as Inactive (Manual Override)
```sql
UPDATE members SET Status = 'inactive' WHERE MemberID = 'A0042';
```

**Result:** Cron job will skip A0042 forever (unless you unlock it).

### Unlock Inactive Member
To allow cron job to recalculate their status again:
```sql
UPDATE members SET Status = 'active' WHERE MemberID = 'A0042';
```

Now the cron job will recalculate based on their expiration date.

### Check Locked Members
```sql
SELECT MemberID, Email, Expiration, Status
FROM members
WHERE Status = 'inactive'
ORDER BY Expiration DESC;
```

---

## Logic Flow

```
Cron job runs for every member:

1. Is status = 'inactive'?
   ├─ YES → SKIP (locked, don't change)
   └─ NO → Continue to step 2

2. Is Expiration >= TODAY()?
   ├─ YES → Set to 'active'
   └─ NO → Continue to step 3

3. Is Expiration >= 2026-01-01?
   ├─ YES → Set to 'expired' (can renew)
   └─ NO → Continue to step 4

4. Is Expiration NULL?
   ├─ YES + has pending payment → Set to 'pending'
   ├─ YES + no pending payment → Set to 'inactive'
   └─ NO → Already handled in step 3
```

---

## Example Scenarios

### Scenario 1: Moved Away (Permanent Removal)
```
TODAY: Admin marks member as inactive
  UPDATE members SET Status = 'inactive' WHERE MemberID = 'A0099';

TOMORROW: Cron job runs
  Sees A0099 status = 'inactive' → SKIPS
  Never sends reminders, never updates status

6 MONTHS LATER: Admin updates their expiration date by accident
  Cron job runs
  Still sees A0099 status = 'inactive' → Still SKIPS
  Status is locked!
```

### Scenario 2: Renewing Member (NOT Locked)
```
TODAY: Member's status = 'expired' (auto-set by cron)
  Cron job set it because Expiration = 2024-12-31

TOMORROW: Member renews, admin updates Expiration = 2027-12-31
  UPDATE members SET Expiration = '2027-12-31' WHERE MemberID = 'A0055';

NEXT CRON RUN: Cron job runs
  Sees A0055 status = 'expired' (not 'inactive')
  Checks expiration: 2027-12-31 >= TODAY() → YES
  Changes to 'active'
  Status is NOT locked!
```

### Scenario 3: Duplicate Account (Merge)
```
TODAY: Admin marks duplicate account as inactive
  UPDATE members SET Status = 'inactive' WHERE MemberID = 'A0077';
  (Records are kept for history, but never contacted)

CRON JOB (4x daily): Ignores A0077
  (No reminders, no updates)

FUTURE: If you ever need to restore, just unlock:
  UPDATE members SET Status = 'active' WHERE MemberID = 'A0077';
```

---

## Comparison: Expired vs Inactive

| Aspect | `expired` | `inactive` |
|--------|-----------|-----------|
| **Auto-set by cron?** | ✅ YES (expiration between 2026-01-01 and today) | ❌ NO (manual only) |
| **Locked?** | ❌ NO (cron can change it) | ✅ YES (cron skips it) |
| **Send reminders?** | ✅ YES (can renew) | ❌ NO (do not contact) |
| **Use case** | Member lapsed recently, may renew | Member definitely won't renew |

---

## Key Rules

1. **`inactive` is a lock** — once set, cron won't touch it
2. **To un-lock** → manually change status to anything else
3. **Expired members are NOT locked** — cron can change them based on expiration
4. **Manual override** → set `inactive` to override expiration logic
5. **No auto-revert** → setting to `inactive` is permanent until you undo it

---

## Admin Commands

### Check current status breakdown
```sql
SELECT Status, COUNT(*) as count FROM members GROUP BY Status ORDER BY count DESC;
```

### Find all inactive (locked) members
```sql
SELECT MemberID, Email, Expiration, LastLogin FROM members WHERE Status = 'inactive' ORDER BY Expiration DESC;
```

### Find expired members (not locked)
```sql
SELECT MemberID, Email, Expiration, LastLogin FROM members WHERE Status = 'expired' ORDER BY Expiration DESC;
```

### Lock a member as inactive
```sql
UPDATE members SET Status = 'inactive' WHERE MemberID = 'A0042';
```

### Unlock a member (allow cron to recalculate)
```sql
UPDATE members SET Status = 'active' WHERE MemberID = 'A0042';
```

### Bulk lock (use with caution!)
```sql
-- Mark all members expired before 2025-01-01 as inactive
UPDATE members
SET Status = 'inactive'
WHERE Expiration < '2025-01-01' AND Status != 'inactive';
```

---

## FAQ

**Q: Can I change an inactive member's expiration date without unlocking them?**
A: Yes, but the cron job will still skip them. The `inactive` lock overrides expiration.

**Q: What if I set someone to `inactive` by mistake?**
A: Just change them back to `active` (or `expired` if their expiration is past). Cron will recalculate on the next run.

**Q: Do inactive members ever get contacted?**
A: No. The cron job skips them entirely, so their status never changes to something that would trigger reminders.

**Q: Can I set multiple members to `inactive` at once?**
A: Yes, use an UPDATE with a WHERE clause (see "Bulk lock" above).

**Q: What's the difference between `inactive` and deleting the member?**
A: `inactive` keeps the record for history (audit trail). Deleted members are gone. Use `inactive` if you might need the record later.
