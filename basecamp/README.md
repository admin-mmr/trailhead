# basecamp

Shared library used by all MMR services:
- `web-apps/` — Next.js webapp + Google Apps Script
- `photo-manager/` — Python CV pipeline

## Contents

| Directory | Purpose |
|-----------|---------|
| `python/` | Shared Python services (Google Workspace, DB sync) |
| `schemas/` | MySQL source-of-truth schema definitions |
| `migrations/` | Versioned DB schema changes |
| `ops/` | Monitoring, cron jobs, health checks |
| `docs/` | Project documentation and shared specs |
