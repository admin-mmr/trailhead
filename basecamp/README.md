# basecamp 🏕️

Shared library used by all MMR services:
- `web-apps/` — Next.js webapp + Google Apps Script
- `photo-manager/` — Python CV pipeline

For the big picture, see [`../MONOREPO.md`](../MONOREPO.md).

## Contents

| Directory | Purpose |
|-----------|---------|
| `python/` | Shared Python services (Google Workspace, DB sync) |
| `schemas/` | MySQL source-of-truth schema definitions |
| `migrations/` | Versioned DB schema changes |
| `ops/` | Monitoring, cron jobs, health checks |
| `docs/` | Project documentation and shared specs |

## How Other Services Use basecamp

### From web-apps (Node.js)

```typescript
// Import schema for reference
import schema from '../../basecamp/schemas/members.sql';

// Call sync endpoint (GAS trigger)
POST /api/members/sync
```

### From photo-manager (Python)

```python
from basecamp.python.google_workspace import GoogleDriveClient, GoogleSheetsClient
from basecamp.python.mysql_sync import sync_google_sheets_to_mysql, get_member_by_email

# Access shared Google Workspace service account
drive = GoogleDriveClient()
sheets = GoogleSheetsClient()

# Sync member data to MySQL
sync_google_sheets_to_mysql('Membership Master')

# Look up member
member = get_member_by_email('user@example.com')
```

## Latest Schema Migrations

### ✅ Migration v4 (March 2026) — Member Schema Refactor
**File**: `migrations/mmr_migration_v4.sql`

Member schema refactored to align with Google Sheets canonical header:
- **DROP**: `NYRRMemberID` column (no longer tracked)
- **RENAME**: `NYRRMemberName` → `NYRRRunnerName` (more descriptive)
- **ADD**: `YearBorn SMALLINT` (for age disambiguation in NYRR bib matching)

**Related Changes**:
- `types/index.ts` — Member interface updated
- `lib/db/members.ts` — Functions updated for new fields
- `basecamp/ops/sync_sheets_to_mysql.py` — Sync script fixed (3 critical bugs)

**Verification**:
✅ npm run typecheck (0 errors)
✅ npm run lint (0 warnings)
✅ npm run build (successful)

---

## Creating Schema Changes

When you need to add or modify the database:

1. **Edit the source of truth**: `basecamp/schemas/members.sql`
2. **Create a migration**: `migrations/0005_your_change.sql` (increment version number)
   ```sql
   -- Example: Add new field
   ALTER TABLE members ADD COLUMN your_field VARCHAR(100) NULL;
   UPDATE schema_migrations SET version = '0005' WHERE 1;
   ```
3. **Test locally** against your MySQL instance
4. **Deploy to production**: See [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
5. **Update service code** that reads/writes the new field
6. **Update documentation**: Add section to [`../PROJECT_PLAN.md`](../PROJECT_PLAN.md) under "Completed Work"

## Running Cron Jobs

Cron jobs live in `ops/`. To schedule them:

1. Add to GitHub Actions workflow (`.github/workflows/cron.yml`)
2. Or deploy to Azure Container Instances for scheduled execution
3. See [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for details
