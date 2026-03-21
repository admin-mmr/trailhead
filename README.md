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
```bash
# Web app
cd web-apps/mmr-webapp && npm install && npm run dev

# Photo pipeline
cd photo-manager && pip install -r requirements.txt

# Shared library
cd basecamp && pip install -r requirements.txt
```
