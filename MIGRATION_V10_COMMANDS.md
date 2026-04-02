# Migration V10 — MySQL Members & Member_Log Schema Update

## Status Changes
Updated the members table `Status` enum to clarify member lifecycle:
- **active** — current member, pay reminders OK
- **expired** — membership lapsed, can renew; send reminders OK
- **inactive** — confirmed not renewing (left, moved away); no more reminders
- **pending** — rare; initiated membership or upgrade, payment not yet received

## SQL Migration Commands

### V10-b: ALTER members table
```sql
ALTER TABLE members
  CHANGE COLUMN Status Status enum('active','expired','inactive','pending') NOT NULL DEFAULT 'pending' COMMENT 'active=paying; expired=may renew (send reminders); inactive=left (no reminders); pending=awaiting payment',
  DROP COLUMN WebApp,
  DROP COLUMN PaymentCheck,
  DROP COLUMN apple_sub,
  DROP KEY apple_sub,
  DROP COLUMN yahoo_sub,
  DROP KEY yahoo_sub,
  DROP COLUMN facebook_sub,
  DROP KEY uq_members_facebook;
```

**Why:**
- **Status enum update:** expands from 3 values ('active', 'not active', 'pending') to 4 ('active', 'expired', 'inactive', 'pending'). Uses 'expired' and 'inactive' to distinguish members who *may* renew vs. those who definitively won't.
- **Column drops:** WebApp, PaymentCheck, apple_sub, yahoo_sub, facebook_sub are no longer in the Google Sheets Membership Master and are not synced. Dropping now prevents confusion during sync operations.

### V10-c: ALTER member_log table
```sql
ALTER TABLE member_log
  CHANGE COLUMN LastLoginDate LastLogin   datetime DEFAULT NULL COMMENT 'Last login timestamp (UTC)',
  CHANGE COLUMN PaymentDate   PaymentDate date     DEFAULT NULL COMMENT 'Payment date (YYYY-MM-DD)',
  CHANGE COLUMN Expiration    Expiration  date     DEFAULT NULL COMMENT 'Membership expiration date (YYYY-MM-DD)',
  DROP COLUMN WebApp,
  DROP COLUMN PaymentCheck;
```

**Why:**
- **Column renames:** Align with members table (LastLoginDate → LastLogin). Adds clarifying comments on all datetime/date columns so auditors understand the intent.
- **Column drops:** Consistent with members table cleanup (V10-b).
- **No unix columns:** The member_log table is append-only audit history. Log entries never trigger conflict resolution, and nothing syncs against log rows. Adding unix timestamp columns would add maintenance with zero benefit.

---

## How to Run

### Prerequisites
- SSH access to Azure MySQL (mmrdb, Sweden Central)
- Use the `mysql-mmr` alias (configured with credentials from Keychain):
  ```bash
  security find-generic-password -s mmr_mysql_host -w 2>/dev/null
  ```

### Execute (in order)
```bash
# Run V10-b
mysql-mmr mmrdb <<EOF
ALTER TABLE members
  CHANGE COLUMN Status Status enum('active','expired','inactive','pending') NOT NULL DEFAULT 'pending' COMMENT 'active=paying; expired=may renew (send reminders); inactive=left (no reminders); pending=awaiting payment',
  DROP COLUMN WebApp,
  DROP COLUMN PaymentCheck,
  DROP COLUMN apple_sub,
  DROP KEY apple_sub,
  DROP COLUMN yahoo_sub,
  DROP KEY yahoo_sub,
  DROP COLUMN facebook_sub,
  DROP KEY uq_members_facebook;
EOF

# Run V10-c
mysql-mmr mmrdb <<EOF
ALTER TABLE member_log
  CHANGE COLUMN LastLoginDate LastLogin   datetime DEFAULT NULL COMMENT 'Last login timestamp (UTC)',
  CHANGE COLUMN PaymentDate   PaymentDate date     DEFAULT NULL COMMENT 'Payment date (YYYY-MM-DD)',
  CHANGE COLUMN Expiration    Expiration  date     DEFAULT NULL COMMENT 'Membership expiration date (YYYY-MM-DD)',
  DROP COLUMN WebApp,
  DROP COLUMN PaymentCheck;
EOF

echo "✅ Migrations complete. Export new schema:"
mysqldump -u mmradmin -p $(security find-generic-password -s mmr_mysql_pass -w 2>/dev/null) -h $(security find-generic-password -s mmr_mysql_host -w 2>/dev/null) --no-data mmrdb > db/schema_snapshot.sql
```

### Verify
```bash
# After running migrations, verify Status enum values:
mysql-mmr mmrdb -e "SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='members' AND COLUMN_NAME='Status';"
# Output should be: enum('active','expired','inactive','pending')

# Verify columns are gone:
mysql-mmr mmrdb -e "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='members' AND COLUMN_NAME IN ('WebApp','PaymentCheck','apple_sub','yahoo_sub','facebook_sub');"
# Output should be empty.
```

---

## Post-Migration Updates (Python / GAS)

After running V10-b and V10-c, update:

1. **mmr-admin/sync_engine.py** — Remove WebApp/PaymentCheck/LastLoginDate/ProfileLastUpdated from MEMBERS_SYNC_COLUMNS
2. **mmr-admin/api_sheets_sync.py** — Remove WebApp/PaymentCheck from column mappings
3. **mmr-admin/payment_handlers.py** — `source='WebApp'` is a *value* in payments.Source, not a column; leave as-is
4. **basecamp/python/sync_engine.py** — Same as #1
5. **GAS code.gs** — Already updated (see session log 2026-04-02 17:35 UTC)
6. **db/schema_snapshot.sql** — Run export command above after migrations complete

---

## Testing Plan

1. Run both migrations on Azure MySQL (mmrdb)
2. Export new schema to db/schema_snapshot.sql
3. Update Python files (see above)
4. Build & test: `npm run build && npm run test`
5. Deploy to Azure App Services (mmr-admin Flask + web-apps Next.js)
6. Test Sync tab in Admin Portal:
   - **Import Transactions**: verify 526 matched (no false updates)
   - **MySQL → Google**: verify all 4 Status values sync correctly
7. Monitor sync_jobs for errors over 24h

---

## References
- _context.md: See 2026-04-02 17:29 UTC, 2026-04-02 17:35 UTC session notes
- Current CSV: 26 columns (WebApp, PaymentCheck removed)
- Schema before: 30 columns (with oauth subs, etc.)
- Schema after: 26 columns (matches CSV + 3 unix timestamp system columns)
