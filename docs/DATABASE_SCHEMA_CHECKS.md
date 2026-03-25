# Database Schema & Integrity Checks

This guide covers three complementary tools for inspecting and monitoring the MySQL database schema and data integrity.

## Quick Reference

| Tool | Purpose | Output | When to Use |
|------|---------|--------|------------|
| **`schema_inspector.py`** | Python-based inspector with data integrity checks | Console + optional JSON | Daily checks, CI/CD, automated validation |
| **`schema_snapshot_query.sql`** | Structure-only snapshot for version control | `.sql` file (git-trackable) | After migrations, before committing changes |
| **`mmr_db_inspector.sql`** | Full diagnostic with row counts and runtime data | Console (live data) | Manual inspection, troubleshooting, monitoring |

---

## 1. Python Schema Inspector (`schema_inspector.py`)

**Location:** `basecamp/ops/schema_inspector.py`

**Best for:** Automated daily checks, CI/CD pipelines, detecting schema drift, data integrity validation.

### Setup (one-time)

```bash
cd basecamp
source load-env.sh  # Load DATABASE_URL and credentials
```

### Commands

```bash
# Quick summary: tables + row counts
python3 ops/schema_inspector.py --summary

# Full validation: checks schema against expected tables
python3 ops/schema_inspector.py --validate

# All table details: columns, keys, indexes, foreign keys
python3 ops/schema_inspector.py --all

# Specific table details
python3 ops/schema_inspector.py --table members
python3 ops/schema_inspector.py --table payments

# Export schema as JSON (for diffing/archiving)
python3 ops/schema_inspector.py --json > schema-$(date +%Y%m%d-%H%M%S).json

# Default (runs summary + validation)
python3 ops/schema_inspector.py
```

### What It Checks

- ✅ All expected tables present (members, payments, webapp_events, etc.)
- ✅ Column definitions (type, nullability, keys)
- ✅ Primary keys, unique constraints, foreign keys
- ✅ Indexes (including non-unique indexes)
- ✅ Foreign key referential integrity
- ✅ NULL constraint violations
- ✅ Duplicate values in UNIQUE columns

### Example Output

```
✅ Connected to MySQL
   Host: mmr-mysql-v4.mysql.database.azure.com
   Database: mmrdb

======================================================================
TABLE SUMMARY
======================================================================
Table Name                         Rows      Status

activity_log                          5      📊 Has data
config                                8      📊 Has data
gmail_transactions                   42      📊 Has data
members                             156      📊 Has data
payments                             89      📊 Has data
...
```

---

## 2. Structure Snapshot (`schema_snapshot_query.sql`)

**Location:** `web-apps/mmr-webapp/db/schema_snapshot_query.sql`

**Best for:** Version control, tracking schema changes in git, pre/post-migration validation.

### Why Structure-Only?

Row counts, CREATE_TIME, and UPDATE_TIME change during normal app operation and cause false-positive diffs. This snapshot captures only the _structure_, making it ideal for git tracking.

### Commands

```bash
cd web-apps/mmr-webapp

# Generate structure snapshot
mysql-mmr < db/schema_snapshot_query.sql > db/schema_snapshot.sql

# View the snapshot (git-tracked)
git diff db/schema_snapshot.sql

# After a schema migration, re-generate and commit
mysql-mmr < db/schema_snapshot_query.sql > db/schema_snapshot.sql
git add db/schema_snapshot.sql
git commit -m "Update schema snapshot after migration"
```

### What's Captured

1. **Tables** — engine (InnoDB), charset (utf8mb4), collation
2. **Columns** — type, nullability, defaults, constraints, comments
3. **Indexes** — all keys (PK, UNIQUE, non-unique)
4. **Foreign Keys** — referential constraints and rules
5. **Views** — full view definitions
6. **Routines** — stored procedures and functions

### Example Workflow

```bash
# Before migration
mysql-mmr < db/schema_snapshot_query.sql > db/schema_snapshot.sql.bak

# Run migration
mysql-mmr < db/archive/mmr_migration_v10.sql

# Re-snapshot after migration
mysql-mmr < db/schema_snapshot_query.sql > db/schema_snapshot.sql

# Check diff
git diff db/schema_snapshot.sql

# If correct, commit
git add db/schema_snapshot.sql
git commit -m "feat: add new payment status column"
```

---

## 3. Full Database Inspector (`mmr_db_inspector.sql`)

**Location:** `web-apps/mmr-webapp/db/mmr_db_inspector.sql`

**Best for:** Live diagnostics, troubleshooting, understanding current data state.

### Commands

```bash
cd web-apps/mmr-webapp

# Run full inspection
mysql-mmr < db/mmr_db_inspector.sql

# Save to file for review
mysql-mmr < db/mmr_db_inspector.sql > db-inspection-$(date +%Y%m%d-%H%M%S).txt
```

### What's Included

1. **Tables** — engine, charset, estimated row count, data size, creation time
2. **Columns** — all column definitions (same as schema_snapshot)
3. **Indexes** — all indexes and keys
4. **Foreign Keys** — referential constraints
5. **Views** — view definitions
6. **Routines** — stored procedures and functions
7. **Migration History** — which migrations have been applied
8. **Members Columns** — verifies OAuth columns (google_sub, microsoft_sub, etc.)
9. **Config Table** — current configuration values
10. **Recent Activity Logs** — last 20 activity entries (debugging)
11. **Payment & Event Summary** — aggregate counts by source/type

### Example Output Section

```
=== 1. TABLES ===
table              engine  collation           est_rows  size_kb   created               last_updated
activity_log       InnoDB  utf8mb4_unicode_ci  5         32.5      2025-03-01 08:15:00   2025-03-25 14:32:10
config             InnoDB  utf8mb4_unicode_ci  8         16.1      2025-02-15 12:00:00   2025-03-20 09:45:30
members            InnoDB  utf8mb4_unicode_ci  156       245.7     2025-01-20 10:30:00   2025-03-25 16:20:15
...

=== 11. PAYMENTS — source breakdown ===
Source        count  earliest            latest
gmail         42     2025-01-15 08:10:00 2025-03-24 15:30:45
stripe        47     2025-02-01 10:20:00 2025-03-25 14:15:22
```

---

## Daily Automated Check (Optional)

To set up a **daily automated schema check**, use the Cowork schedule feature:

```bash
# This will create a scheduled task that runs daily at 9 AM
# (See docs/SCHEDULE.md for detailed setup)
```

The scheduled task can:
- Run `python3 basecamp/ops/schema_inspector.py --summary --validate`
- Save output with a timestamp
- Alert you if any schema drift is detected
- Email or Slack notification on failures (if configured)

---

## Troubleshooting

### "Connection failed" when running inspector

**Check:**
```bash
cd basecamp
source load-env.sh
echo $DATABASE_URL  # Should show valid MySQL URL
```

**Verify MySQL alias:**
```bash
which mysql-mmr
```

If missing, update your `.bashrc` or `.zshrc`:
```bash
alias mysql-mmr="mysql -h mmr-mysql-v4.mysql.database.azure.com -u $(echo $DATABASE_URL | cut -d'@' -f1 | cut -d':' -f2 | cut -d'/' -f3) -p"
```

### "Access denied" when running SQL queries

**Check Azure firewall:**
- Go to Azure Portal → mmr-mysql-v4 → Networking
- Verify your IP is in the "Firewall rules" list
- Or allow "Allow public network access" (less secure)

### Large row counts but snapshot looks correct

**This is normal.** The `schema_snapshot_query.sql` intentionally ignores row counts and timestamps to prevent git diffs from being polluted by normal app activity. Use `mmr_db_inspector.sql` if you need live row counts.

---

## Integration with CI/CD

Example GitHub Actions snippet (`.github/workflows/schema-check.yml`):

```yaml
name: Daily Schema Check

on:
  schedule:
    - cron: '0 9 * * *'  # 9 AM UTC daily
  workflow_dispatch:

jobs:
  schema-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      - name: Install MySQL client
        run: sudo apt-get install -y mysql-client
      - name: Run schema inspector
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          cd basecamp
          python3 ops/schema_inspector.py --validate
          if [ $? -ne 0 ]; then
            echo "Schema validation failed!"
            exit 1
          fi
```

---

## See Also

- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — General debugging steps
- [LOCAL_SETUP.md](./LOCAL_SETUP.md) — Setting up mysql-mmr alias and credentials
- [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md) — CI/CD setup and secrets
