# trailhead 🏔️

MMR Digital Platform — the complete technical stack for Misty Mountain Runners (岚山跑团).

## Structure
```
trailhead/
├── web-apps/           # Next.js member portal + Google Apps Script
│   ├── mmr-webapp/     # Azure Static Web App (Next.js 14)
│   └── gas/membership/ # Google Sheets membership system
├── photo-manager/      # Python CV photo pipeline
└── basecamp/           # Shared library + documentation
    ├── python/         # Google Workspace, DB sync
    ├── schemas/        # MySQL schema (source of truth)
    ├── migrations/     # DB versioned migrations
    ├── ops/            # Monitoring + cron jobs
    └── docs/           # Project documentation
```

## Quick Start

**First time?** Start here:
- [`MONOREPO.md`](MONOREPO.md) — How all three services work together
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — How to deploy to production
- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — Upcoming features (OAuth, data sync, activity logging)

**First-time setup:**

```bash
# Enable pre-commit hooks (one-time per clone)
git config core.hooksPath .githooks
```

**Local development:**

```bash
# Web app
cd web-apps/mmr-webapp && npm install && npm run dev

# Photo pipeline
cd photo-manager && pip install -r requirements.txt

# Shared library
cd basecamp && pip install -r requirements.txt
```

## Documentation

| Document | Purpose |
|----------|---------|
| [`MONOREPO.md`](MONOREPO.md) | Architecture, data flow, how services integrate |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Azure secrets, GitHub Actions, GAS push, migrations |
| [`AZURE_RESOURCES.md`](AZURE_RESOURCES.md) | Exact Azure service names, connection strings, environment variables |
| [`PROJECT_PLAN.md`](PROJECT_PLAN.md) | Roadmap: data sync, OAuth, activity logging |
| [`web-apps/README.md`](web-apps/README.md) | Web app structure, GAS scripts, events |
| [`web-apps/mmr-webapp/DEVELOPMENT.md`](web-apps/mmr-webapp/DEVELOPMENT.md) | Local dev, pre-commit hooks, verification |
| [`photo-manager/README.md`](photo-manager/README.md) | Photo CV pipeline, Azure Face, OCR |
| [`basecamp/README.md`](basecamp/README.md) | Shared library, schema, Python utilities |
