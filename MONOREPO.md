# trailhead Monorepo Guide 🏔️

How the three services (`web-apps`, `photo-manager`, `basecamp`) work together.

---

## The Big Picture

```
┌─────────────────────────────────────────────────────────────┐
│                      trailhead Monorepo                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │
│  │   web-apps       │  │  photo-manager   │  │  basecamp  │ │
│  │                  │  │                  │  │  (shared)  │ │
│  │  - Next.js app   │  │  - Python CV     │  │            │ │
│  │  - GAS scripts   │  │  - Photo OCR     │  │  - DB sync │ │
│  │  - API server    │  │  - Face detect   │  │  - Schemas │ │
│  │  - Azure static  │  │  - Quality pick  │  │  - Ops     │ │
│  │                  │  │  - Google Drive  │  │  - Docs    │ │
│  └────────┬─────────┘  └────────┬─────────┘  └────┬───────┘ │
│           │                     │                 │          │
│           └─────────────────────┴─────────────────┘          │
│                         ▼                                     │
│                  basecamp (shared)                           │
│              • Google Workspace API                          │
│              • MySQL sync & schema                           │
│              • Shared utilities                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Directory Layout

```
trailhead/
├── README.md                          ← Start here
├── MONOREPO.md                        ← You are here
├── DEPLOYMENT.md                      ← Deployment secrets & workflows
├── LICENSE
│
├── .github/
│   └── workflows/
│       └── azure-static-web-apps-*.yml  ← GitHub Actions (builds web-apps)
│
├── web-apps/                          ← 👥 Member portal + backend
│   ├── README.md
│   ├── mmr-webapp/
│   │   ├── DEVELOPMENT.md             ← Local dev setup
│   │   ├── app/                       ← Next.js App Router
│   │   ├── lib/
│   │   │   ├── db/                    ← MySQL connection
│   │   │   ├── auth/                  ← JWT, session
│   │   │   └── access.ts              ← Access control tiers
│   │   └── middleware.ts              ← Request routing + auth
│   ├── gas/
│   │   ├── membership/                ← Membership Google Sheets sync
│   │   └── nyrr/                      ← NYRR race results sync
│   └── events/                        ← Blog posts (extracted from Meipian)
│
├── photo-manager/                     ← 📸 Race photo pipeline
│   ├── README.md
│   ├── src/
│   │   ├── process_photos.py          ← Main orchestration
│   │   ├── bib_analyzer.py            ← Bib extraction
│   │   ├── photo_quality_picker.py    ← Quality scoring
│   │   └── modules/                   ← Azure, OCR, quality metrics
│   ├── requirements.txt
│   └── partner/                       ← Partner nonprofit collab
│
└── basecamp/                          ← 🏕️ Shared library
    ├── README.md
    ├── python/
    │   ├── google_workspace.py        ← Drive + Sheets API wrapper
    │   └── mysql_sync.py              ← Member sync to MySQL
    ├── schemas/
    │   └── members.sql                ← Source-of-truth schema
    ├── migrations/                    ← Versioned DB changes
    ├── ops/                           ← Cron jobs, monitoring
    └── docs/                          ← Shared documentation
```

---

## Data Flow

### 1. Member Signup → Web App → MySQL

```
Visitor fills /join form
    ↓
POST /api/auth/register
    ↓
lib/db/members.ts → MySQL (members table)
    ↓
JWT token issued → Set cookie
    ↓
Redirect to /portal
```

### 2. Google Sheets Sync (nightly cron)

```
Google Sheets (Membership Master)
    ↓
GAS script (gas/membership) → reads Google Sheets
    ↓
POST /api/members/sync
    ↓
basecamp/python/mysql_sync.py → MySQL
    ↓
Email alerts sent (payment received, renewal needed)
```

### 3. Photo Upload → Processing → Storage

```
Member uploads photos at /portal/upload
    ↓
Azure Storage → Google Drive
    ↓
photo-manager/src/process_photos.py
    • Extract bibs (bib_analyzer.py)
    • Detect faces (modules/azure_face.py)
    • Score quality (modules/quality.py)
    ↓
Results → back to Google Drive
    ↓
Member views at /portal/photos
```

### 4. Race Results Integration

```
NYRR API
    ↓
GAS script (gas/nyrr) → fetches results
    ↓
Google Sheets (NYRR Results)
    ↓
Web app reads results → displays on /portal/races
```

---

## Shared Library: `basecamp/`

All services use utilities from `basecamp/`:

### Google Workspace Module
```python
from basecamp.python.google_workspace import (
    GoogleDriveClient,
    GoogleSheetsClient,
    get_service_account_credentials
)

# Access shared service account (no per-user auth needed)
drive = GoogleDriveClient()
files = drive.list_files(folder_id='xyz123')
```

### MySQL Sync Module
```python
from basecamp.python.mysql_sync import (
    sync_google_sheets_to_mysql,
    get_member_by_email,
    update_member_profile
)

# One-way sync: Google Sheets → MySQL
sync_google_sheets_to_mysql('Membership Master')
```

### Schema
The **source of truth** for all database structure lives in `basecamp/schemas/`:
```
basecamp/schemas/
├── members.sql              ← Member profiles, status, payment
├── photos.sql               ← Photo metadata
├── races.sql                ← NYRR race results
└── ...
```

When you change the schema:
1. Create a new SQL file in `basecamp/migrations/` (e.g., `0003_add_year_born.sql`)
2. Update `basecamp/schemas/members.sql` (source of truth)
3. Run migration on production MySQL
4. Update code that reads/writes the new columns
5. Test in `web-apps/` and `photo-manager/`

---

## Environment Setup

Each service has its own `.env.local` (git-ignored):

### `web-apps/mmr-webapp/.env.local`
```bash
DATABASE_URL=mysql://mmradmin:***@mmr-mysql.mysql.database.azure.com/mmrdb?ssl=true
JWT_SECRET=your-long-random-string
AZURE_STORAGE_CONNECTION_STRING=***
AZURE_COMM_CONNECTION_STRING=***
NEXT_PUBLIC_APP_URL=https://www.mmrunners.org
```

### `photo-manager/.env.local`
```bash
AZURE_VISION_KEY=***
AZURE_VISION_ENDPOINT=https://***
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
GOOGLE_DRIVE_PHOTO_FOLDER_ID=folder_id
BASECAMP_PATH=../basecamp
```

### `gas/membership/.env.local` (in `package.json` scripts)
```bash
GOOGLE_APPS_SCRIPT_PROJECT_ID=***
```

**Critical:** Never commit `.env.local`. Use `.env.example` as a template.

---

## Local Development

### Start web-apps locally

```bash
cd web-apps/mmr-webapp
cp .env.local.example .env.local   # Fill in secrets
npm install
npm run dev                         # http://localhost:3000
```

### Test photo pipeline locally

```bash
cd photo-manager
pip install -r requirements.txt
python src/process_photos.py --dry-run  # Test without uploading
```

### Push GAS changes

```bash
cd web-apps/gas/membership
npm run build:copy && npm run push
```

---

## Deployment

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for:
- Azure secrets configuration
- GitHub Actions workflow
- GAS deployment via clasp
- Database migrations on production

---

## Common Tasks

### Add a new member field

1. Add SQL column to `basecamp/schemas/members.sql`
2. Create migration: `basecamp/migrations/0004_add_field.sql`
3. Update `web-apps/mmr-webapp/lib/db/members.ts` to read/write the field
4. If syncing from Google Sheets, update `basecamp/python/mysql_sync.py`
5. Deploy to production (see `DEPLOYMENT.md`)

### Sync Google Sheets → MySQL

```python
# One-time sync
from basecamp.python.mysql_sync import sync_google_sheets_to_mysql
sync_google_sheets_to_mysql('Membership Master')
```

Or trigger nightly via GitHub Actions (see `DEPLOYMENT.md`).

### Test new photo processing logic

```bash
cd photo-manager
python src/process_photos.py --event "20260315-nyc-half" --dry-run
```

### Monitor operations

Check `basecamp/ops/` for health checks, error logs, and cron job status.

---

## Troubleshooting

### "MySQL connection error"
- Check `DATABASE_URL` in `.env.local`
- Verify IP is allowlisted in Azure MySQL
- Test: `mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p`

### "Google Drive authorization failed"
- Verify `GOOGLE_APPLICATION_CREDENTIALS` path is correct
- Service account email must have folder access
- Check `basecamp/python/google_workspace.py` for details

### "Photo processing is slow"
- Azure Face API has rate limits (calls per second)
- Add delay: `time.sleep(0.5)` in `photo-manager/src/modules/azure_face.py`

### "GAS push fails"
- Check clasp version: `npx clasp --version` (should match `package.json`)
- Run `npm install` in `gas/membership/` first
- See `DEPLOYMENT.md` for GAS troubleshooting

---

## Support

For issues spanning multiple services:
1. Check the **Data Flow** section above
2. Verify environment variables in all affected `.env.local` files
3. Check logs in Azure / GitHub Actions
4. See service-specific READMEs:
   - [`web-apps/README.md`](web-apps/README.md)
   - [`photo-manager/README.md`](photo-manager/README.md)
   - [`basecamp/README.md`](basecamp/README.md)

---

## License

MIT — see [`LICENSE`](LICENSE)
