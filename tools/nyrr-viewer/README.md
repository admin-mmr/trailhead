# NYRR Data Viewer

Interactive ops tool for reviewing NYRR events, browsing MySQL data,
and triggering result loads from the NYRR API.

## Quick start

```bash
# 1. Load DB credentials
source basecamp/load-env.sh

# 2. Install dependencies
pip install -r tools/nyrr-viewer/requirements.txt

# 3. Run
python tools/nyrr-viewer/app.py

# 4. Open http://localhost:5050
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

## Environment variables

| Var | Default | Description |
|-----|---------|-------------|
| `MYSQL_HOST` | `localhost` | MySQL host |
| `MYSQL_USER` | `root` | MySQL user |
| `MYSQL_PASSWORD` | (empty) | MySQL password |
| `MYSQL_DATABASE` | `mmrdb` | Database name |
| `MYSQL_SSL_DISABLED` | `false` | Set `true` for local dev |
| `PORT` | `5050` | HTTP listen port |
