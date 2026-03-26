# Setup Summary: SQL Reorganization & NYRR Data Viewer

## What was done

### 1. SQL Files Reorganized ✅

All 22 SQL files consolidated under `db/` at the repo root:

```
db/
├── migrations/          → Production migrations (run in order)
│   ├── 0001_sync_metadata.sql
│   ├── 0006_nyrr_runner_info.sql
│   ├── 0007_nyrr_tables.sql
│   └── 0008_year_born_guess.sql
├── schemas/            → Reference copies (NOT source of truth)
│   ├── nyrr.sql
│   ├── sync.sql
│   ├── members.sql
│   └── mmr_consolidated.sql (v1-v10 merged)
├── queries/            → Utility scripts
│   ├── mmr_db_inspector.sql
│   ├── schema_snapshot.sql
│   └── schema_snapshot_query.sql
├── archive/            → Legacy v1-v10 (historical only)
│   └── mmr_migration_v1.sql ... v10_admins.sql
└── README.md           → How to run migrations
```

**Best practices applied:**
- Single sequence of numbered migrations (0001, 0006–0008)
- Each migration uses `CREATE TABLE IF NOT EXISTS` for idempotency
- Schema files are human-readable references, not executables
- Legacy files kept for historical reference, clearly separated

---

### 2. NYRR Data Viewer Web App ✅

A standalone Flask + React app for interactive MySQL data browsing and
NYRR API integration. Located at `tools/nyrr-viewer/`.

#### Features

**Events Tab**
- Filterable table of all NYRR events
- Status badges: Pending, In Progress, Completed, Error
- MMR runner counts + match percentage with color-coded progress bars
- Search by name/code, filter by status or year
- **"Discover New Events"** — calls NYRR API to fetch new events
- **"Load Results"** — triggers background fetch of MMR team runners
  - Upsets runners into nyrr_event_runners
  - Runs Tier-1 auto-matching (known NYRRRunnerName)
  - Updates event counters + processing log
- Click any event to drill into individual runners with full details

**Data Browser Tab**
- Browse ANY table in the MySQL database
- Click a table card to view its contents
- Pagination + sortable columns
- See row counts and data sizes at a glance

**Sync Log Tab**
- Recent processing history
- Shows every load job: timestamp, status, rows written, errors
- Useful for debugging failed loads

#### Running the app

```bash
# 1. Set up DB credentials
source basecamp/load-env.sh

# 2. Install dependencies
pip install -r tools/nyrr-viewer/requirements.txt

# 3. Run
python tools/nyrr-viewer/app.py

# 4. Open http://localhost:5050
```

The app listens on port 5050 (override with `PORT` env var).

#### Architecture

- **Backend:** Flask with raw SQL queries (parameterized for security)
- **Database:** Azure MySQL (`mmrdb`)
- **Frontend:** Single-page React app with Babel transpilation (no build step)
- **Background jobs:** Threading for non-blocking NYRR API calls
- **Styling:** Custom dark-mode CSS (matches ops tool aesthetic)

---

## Key improvements

1. **SQL clarity** — No more scattered migrations. Single source of truth.
2. **Interactive tools** — Ops can now trigger data loads without CLI/Python knowledge.
3. **Data visibility** — Browse the entire database from one tab.
4. **Error visibility** — Processing log shows every sync run and any failures.
5. **Offline-ready** — No external dependencies (no Google Sheets sync, just MySQL).

---

## Next steps (optional)

1. **Remove old SQL files** — Once you're confident in the new layout:
   ```bash
   rm -r basecamp/schemas basecamp/migrations basecamp/ops/*.sql
   rm web-apps/mmr-webapp/db/archive
   ```

2. **Add a migration runner** — Consider a lightweight tool like `dbmate` to
   enforce migration ordering and track `schema_migrations` table.

3. **Deploy the viewer** — Run on a server so your whole team can use it:
   ```bash
   # Production: use gunicorn
   pip install gunicorn
   gunicorn -w 4 -b 0.0.0.0:8080 app:app --chdir tools/nyrr-viewer
   ```

4. **Add auth** — The viewer currently has no login. Add simple auth if needed:
   ```python
   from functools import wraps

   @app.before_request
   def check_auth():
       token = request.headers.get('Authorization', '')
       if token != f'Bearer {os.environ.get("VIEWER_TOKEN")}':
           return jsonify({'ok': False, 'error': 'Unauthorized'}), 401
   ```

---

## Files created

| File | Lines | Purpose |
|------|-------|---------|
| `db/README.md` | 35 | Database organization guide |
| `tools/nyrr-viewer/app.py` | 613 | Flask API backend |
| `tools/nyrr-viewer/templates/index.html` | 600+ | React UI (single HTML file) |
| `tools/nyrr-viewer/requirements.txt` | 3 | Python dependencies |
| `tools/nyrr-viewer/README.md` | 40 | NYRR Viewer user guide |

All files are in `/mnt/trailhead/` (your workspace folder).
