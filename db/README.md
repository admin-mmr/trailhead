# Database — MMR (Misty Mountain Runners)

**Target:** Azure MySQL · `mmrdb` on `mmr-mysql.mysql.database.azure.com`

## Directory layout

```
db/
├── migrations/      Active migrations (run in numeric order)
│   ├── 0001_sync_metadata.sql
│   ├── 0006_nyrr_runner_info.sql
│   ├── 0007_nyrr_tables.sql
│   └── 0008_year_born_guess.sql
├── schemas/         Human-readable reference copies (NOT the source of truth — regenerate from live DB)
│   ├── mmr_consolidated.sql   Full schema (v1–v10 merged)
│   ├── nyrr.sql               NYRR tables
│   ├── sync.sql               Sync infrastructure
│   └── members.sql            (placeholder — see mmr_consolidated.sql)
├── queries/         Reusable inspection / snapshot queries
│   ├── mmr_db_inspector.sql
│   ├── schema_snapshot.sql
│   └── schema_snapshot_query.sql
└── archive/         Legacy v1–v10 migrations (historical reference only)
    └── mmr_migration_v1.sql … v10_admins.sql
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

## Generating a fresh schema snapshot

```bash
mysql … < db/queries/schema_snapshot_query.sql > db/queries/schema_snapshot.sql
```
