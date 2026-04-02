# Fix MySQL Triggers for V10 Column Renames

## Issue
The GitHub Actions cron job failed because MySQL triggers still reference the old column names:
- `LastLoginDate` (renamed to `LastLogin`)
- `ProfileLastUpdated` (dropped entirely)

Error:
```
Unknown column 'LastLoginDate' in 'NEW'
```

## Solution
Run the migration to drop old triggers and recreate them with correct column names.

## SQL Commands to Run

Connect to Azure MySQL (mmrdb):
```bash
mysql-mmr mmrdb
```

Then run:

```sql
-- Drop old triggers that reference removed/renamed columns
DROP TRIGGER IF EXISTS members_update_lastlogindate_unix;
DROP TRIGGER IF EXISTS members_insert_lastlogindate_unix;
DROP TRIGGER IF EXISTS members_update_profilelastupdated_unix;
DROP TRIGGER IF EXISTS members_insert_profilelastupdated_unix;
DROP TRIGGER IF EXISTS members_update_createdat_unix;
DROP TRIGGER IF EXISTS members_insert_createdat_unix;

-- Create NEW triggers with correct column names

-- Trigger: members_update_lastlogin_unix
-- Syncs: LastLogin → last_login_unix
CREATE TRIGGER members_update_lastlogin_unix
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.LastLogin <> OLD.LastLogin OR
     (NEW.LastLogin IS NULL AND OLD.LastLogin IS NOT NULL) OR
     (NEW.LastLogin IS NOT NULL AND OLD.LastLogin IS NULL)
  THEN
    SET NEW.last_login_unix = IF(NEW.LastLogin IS NULL, 0, UNIX_TIMESTAMP(NEW.LastLogin));
  END IF;
END;
$$

-- Trigger: members_insert_lastlogin_unix
-- Syncs: LastLogin → last_login_unix (on INSERT)
CREATE TRIGGER members_insert_lastlogin_unix
BEFORE INSERT ON members
FOR EACH ROW
BEGIN
  IF NEW.LastLogin IS NOT NULL THEN
    SET NEW.last_login_unix = UNIX_TIMESTAMP(NEW.LastLogin);
  ELSE
    SET NEW.last_login_unix = 0;
  END IF;
END;
$$

-- Trigger: members_update_created_unix
-- Syncs: Created → created_at_unix
CREATE TRIGGER members_update_created_unix
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.Created <> OLD.Created OR
     (NEW.Created IS NULL AND OLD.Created IS NOT NULL) OR
     (NEW.Created IS NOT NULL AND OLD.Created IS NULL)
  THEN
    SET NEW.created_at_unix = IF(NEW.Created IS NULL, 0, UNIX_TIMESTAMP(NEW.Created));
  END IF;
END;
$$

-- Trigger: members_insert_created_unix
-- Syncs: Created → created_at_unix (on INSERT)
CREATE TRIGGER members_insert_created_unix
BEFORE INSERT ON members
FOR EACH ROW
BEGIN
  IF NEW.Created IS NOT NULL THEN
    SET NEW.created_at_unix = UNIX_TIMESTAMP(NEW.Created);
  ELSE
    SET NEW.created_at_unix = 0;
  END IF;
END;
$$
```

## Verify
After running, verify triggers exist:
```sql
SHOW TRIGGERS WHERE `Table` = 'members';
```

You should see:
- ✅ members_update_lastlogin_unix
- ✅ members_insert_lastlogin_unix
- ✅ members_update_created_unix
- ✅ members_insert_created_unix
- ❌ (NO members_update_lastlogindate_unix — old one, dropped)
- ❌ (NO members_update_profilelastupdated_unix — old one, dropped)

## Test
Re-run the member status update:
```bash
python3 basecamp/ops/update_member_status.py --dry-run
```

It should complete without trigger errors.

## Files Changed
- `db/migrations/0018_fix_triggers_v10_column_renames.sql` — Migration file (for reference/documentation)
- No other files need updating

## Notes
- Triggers are not critical data — they're just auto-sync logic
- Existing unix timestamp values are correct (backfilled separately)
- After this fix, any UPDATE to `LastLogin` or `Created` will auto-sync the unix columns
