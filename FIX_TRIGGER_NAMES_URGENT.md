# 🔴 URGENT: Wrong Trigger Names Found

## The Problem

The diagnostic output showed the **actual trigger names in the database are different**:

**What we tried to drop:**
- members_after_insert
- members_after_update

**What actually exists:**
- `trg_members_after_insert` ⚠️ **THIS IS THE BROKEN ONE**
- `trg_members_after_update` ⚠️ **THIS IS THE BROKEN ONE**

The `trg_` prefixed triggers reference the dropped columns and are causing the error!

## Quick Fix (Manual SQL)

Run this on Azure MySQL immediately:

```bash
mysql-mmr mmrdb
```

Then:

```sql
DROP TRIGGER IF EXISTS trg_members_after_insert;
DROP TRIGGER IF EXISTS trg_members_after_update;
```

Done! That's it.

## Verify

```sql
SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'members';
```

Should show only:
- members_insert_created_unix
- members_insert_lastlogin_unix
- members_update_created_unix
- members_update_lastlogin_unix

(NOT trg_members_*)

## Then Retry Cron

After dropping those 2 triggers, re-run the member status update and it should succeed!

---

## Why This Happened

The old consolidated.sql schema file had triggers named `trg_members_after_insert` and `trg_members_after_update`, but our workflow was trying to drop triggers with different names. The `trg_` prefix wasn't in our list!

The good news: Only 2 triggers need to be dropped (not 18). Everything else is fine.
