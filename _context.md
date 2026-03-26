# Trailhead Project Context

Last updated: 2026-03-26
Last commit: 7603f74

---

## Current state

- Repo cleaned up: .gitignore, markdown conversion, review-app committed
- Web app: Next.js 14, NextAuth, Tailwind, i18n — deployable
- Photo manager: process_photos.py + bib_analyzer.py functional, review-app Flask running
- Database: Azure MySQL, schemas in db/schemas/
- NYRR viewer: Flask app, stable

## Open items

- [ ] (add open tasks here)

## Session log

### 2026-03-26 — workflow cleanup
- Deleted `azure-static-web-apps-brave-glacier-00ea1c60f.yml` — was trying to deploy nyrr-viewer (Flask/App Service) to SWA with `output_location: "build"`, causing every push to main to fail
- Remaining SWA workflow (`orange-tree`) deploys mmr-webapp — output_location is `""`, correct for Next.js

### 2026-03-26 — repo cleanup
- Converted docs to markdown
- Fixed .gitignore (excludes secrets, binaries, .docx)
- Committed review-app
- Status: clean build, main branch