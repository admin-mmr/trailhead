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

## Creating Schema Changes

When you need to add or modify the database:

1. **Edit the source of truth**: `basecamp/schemas/members.sql`
2. **Create a migration**: `basecamp/migrations/0003_add_new_field.sql`
   ```sql
   -- Example: Add year_born field
   ALTER TABLE members ADD COLUMN year_born INT NULL;
   UPDATE schema_migrations SET version = '0003' WHERE 1;
   ```
3. **Test locally** against your MySQL instance
4. **Deploy to production**: See [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
5. **Update service code** that reads/writes the new field

## Running Cron Jobs

Cron jobs live in `ops/`. To schedule them:

1. Add to GitHub Actions workflow (`.github/workflows/cron.yml`)
2. Or deploy to Azure Container Instances for scheduled execution
3. See [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for details
