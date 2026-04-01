# Database — MMR (Misty Mountain Runners)

**Target:** Azure MySQL · `mmrdb` on `mmr-mysql.mysql.database.azure.com`

## Directory layout

```
db/
├── schema_snapshot.sql        SOURCE OF TRUTH — regenerate with mysqldump after migrations
├── migrations/                Active migrations (run in numeric order, 0001–0014)
├── queries/                   Reusable inspection / diagnostic queries
│   ├── mmr_db_inspector.sql       Full diagnostic (data + config + activity)
│   ├── schema_snapshot_query.sql  Drift detection (structure only, no row counts)
│   └── check_event_data.sql       Ad-hoc event data checks
├── schemas/                   Deprecated reference copies — kept until schema_snapshot.sql confirmed complete
│   ├── mmr_consolidated.sql       Full schema (v1–v10 merged)
│   ├── nyrr.sql, sync.sql, members.sql
│   └── migration_v5_payment_statuses.sql, set_payment_config.sql
└── archive/                   Legacy v1–v10 migrations (historical reference only)
    └── mmr_migration_v1.sql … mmr_migration_v10_admins.sql
```

## Running migrations

Migrations are plain SQL — apply them in numeric order. Each uses
`CREATE TABLE IF NOT EXISTS` for idempotency.

```bash
source basecamp/load-env.sh   # loads MYSQL_HOST, MYSQL_USER, etc.
mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" \
      --ssl-mode=REQUIRED < db/migrations/0007_nyrr_tables.sql
```

The `schema_migrations` table in production tracks which migrations have
been applied.

## Schema tools

Three tools for different purposes:

### Snapshot (source of truth)
After migrations, regenerate the canonical schema file:
```bash
mysqldump --login-path=mmr --no-data mmrdb > db/schema_snapshot.sql
```
Commit this file to track schema history.

### Drift detection
Before changes, check live schema against snapshot:
```bash
mysql --login-path=mmr mmrdb < db/queries/schema_snapshot_query.sql > /tmp/live_schema.txt
diff db/schema_snapshot.sql /tmp/live_schema.txt
```
Intentionally excludes row counts and timestamps to avoid false positives.

### Full diagnostic
Debug data anomalies, config, recent activity:
```bash
mysql --login-path=mmr mmrdb < db/queries/mmr_db_inspector.sql
```
