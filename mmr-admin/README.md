# MMR Admin

Admin ops dashboard for MMR — NYRR event management, member admin,
data sync, and MySQL data browsing. (Formerly nyrr-viewer.)

## Quick start

```bash
# 1. Load DB credentials
source load-env.sh

# 2. Install dependencies
pip install -r mmr-admin/requirements.txt

# 3. Enable pre-commit hooks (one-time per clone)
git config core.hooksPath .githooks

# 4. Run
python mmr-admin/app.py

# 5. Open http://localhost:5050
```

## Features

**Events tab** — filterable table of all NYRR events with status, runner
counts, and match percentages. Click any event to drill into its runners.
"Discover New Events" fetches the latest from the NYRR API. "Load Results"
triggers a background fetch of MMR team runners + auto-matching.

**Data Browser tab** — click any MySQL table to browse its contents with
pagination and sortable columns.

**Sync Log tab** — recent processing log entries showing every pipeline
run, its status, and any errors.

## Project structure

```
mmr-admin/
├── app.py              ← Entry point — Flask app setup + blueprint registration
├── db.py               ← Database connection, query/execute helpers, table init
├── auth.py             ← OAuth (Google/Microsoft), password login, role decorators
├── helpers.py          ← DateEncoder, json_response, error handlers
├── api_admin.py        ← Admin CRUD routes
├── api_events.py       ← Events list, discover, upcoming, stats
├── api_runners.py      ← Match/unmatch, member search, runner history
├── api_data.py         ← Table browser, user settings, processing log, DB config
├── api_sync.py         ← Background NYRR data load worker
├── test_imports.py     ← Circular import detection (runs in pre-commit hook)
└── templates/
    └── index.html      ← React/Babel single-page frontend
```

## Pre-commit hook

When you commit changes to any `.py` file in this directory, a pre-commit hook
automatically runs `test_imports.py` to catch circular or broken imports.

```bash
# Enable hooks (one-time per clone, from repo root)
git config core.hooksPath .githooks

# Run manually any time
python3 test_imports.py

# Or via pytest
python3 -m pytest test_imports.py -v
```

## Environment variables

| Var | Default | Description |
|-----|---------|-------------|
| `MYSQL_HOST` | `localhost` | MySQL host |
| `MYSQL_USER` | `root` | MySQL user |
| `MYSQL_PASSWORD` | (empty) | MySQL password |
| `MYSQL_DATABASE` | `mmrdb` | Database name |
| `MYSQL_SSL_DISABLED` | `false` | Set `true` for local dev |
| `PORT` | `5050` | HTTP listen port |
