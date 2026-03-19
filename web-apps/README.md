# Misty Mountain Runners — Web Apps Repository

**Organization**: Misty Mountain Runners (MMR) | [mmrunners.org](https://mmrunners.org)
**Type**: Chinese-American running nonprofit, New York
**Tech lead**: Cathy Lin

---

## Repository Structure

```
web-apps/
├── mmr-webapp/          Next.js 14 app — new website, member portal, Azure backend
├── gas/
│   ├── membership/      Google Apps Script — membership management (legacy/parallel)
│   └── nyrr/            Google Apps Script — NYRR data sync
├── events/              Meipian-extracted event posts (yyyymmdd-event-name/)
├── partner/
│   └── 湘舍动公益文件系统/  Partner nonprofit — Google Drive file system project
├── docs/                Repo-wide documentation, planning, Azure guides
│   ├── azure/           Azure + GitHub setup manuals, migration guides, roadmap
│   ├── membership/      Membership blueprint, website prototype
│   ├── assets/          Shared image assets (QR codes, logos)
│   └── prd-archive/     Old PRD versions (PRDv1–PRDv4)
└── scripts/             Utility scripts (Meipian extractor, codebase snapshot)
```

---

## Sub-Projects

### mmr-webapp — New Website & Backend
Next.js 14 app with Azure backend, replacing the legacy GAS system.
Auto-deploys to Azure Static Web Apps on every push to `main`.

**Quick start:**
```bash
cd mmr-webapp
cp .env.local.example .env.local   # fill in secrets — never commit this file
npm install
npm run dev                         # http://localhost:3000
```

Full technical reference: [`mmr-webapp/MMR_PROJECT_BRIEF.md`](mmr-webapp/MMR_PROJECT_BRIEF.md)
Living product spec: [`mmr-webapp/docs/PRD_v5.md`](mmr-webapp/docs/PRD_v5.md)

---

### gas/membership — Membership Management GAS
Google Apps Script running against the Membership Master Google Sheet.
Includes a scheduled trigger to fetch Gmail payment data (Zelle/Venmo) automatically.
Remains in production during MySQL migration; will be read-only roster export once migration is complete.

```bash
cd gas/membership
npm install
npx clasp push    # deploy to Google Apps Script
```

---

### gas/nyrr — NYRR Data Sync GAS
Google Apps Script that syncs NYRR race results into Google Sheets for member portal display.

```bash
cd gas/nyrr
npm install
npx clasp push
```

---

### events/ — Event Articles
Static HTML event posts extracted from Meipian. Each folder is named `yyyymmdd-event-slug/`:
```
events/20260222-lanshan-annual-gala/
events/20260301-washington-heights-5k/
events/20260315-nyc-half-marathon/
```
Use `scripts/extract_meipian.py` to extract new posts from Meipian URLs.

---

### partner/湘舍动公益文件系统
Collaboration with 湘舍动公益 nonprofit on a Google Drive file management system
for a race face-detection application. Work in progress — see development plan inside the folder.

---

## People & Access

| Person | GitHub | Azure | Google Sheets |
|---|---|---|---|
| Cathy Lin (tech lead) | ✅ Admin | ✅ Admin | ✅ |
| Volunteers (1–2) | — | ✅ Admin | ✅ |
| Volunteers (~10) | — | — | ✅ Read-only nightly export |
| Members | — | — | — (web portal only) |

---

## Key Links & Resources

| Resource | Value |
|---|---|
| Website | https://mmrunners.org |
| Azure resource group | `mmr-resources` |
| Azure Static Web App | `mmr-webapp` |
| MySQL server | `mmr-mysql.mysql.database.azure.com` / db: `mmrdb` |
| Storage account | `mmrunnersstorage` |
| Communication Services | `mmr-comms` |
| Zelle | `treasurer@mmrunners.org` |
| Venmo | `@MMRunners` |

---

## .gitignore — What Must Never Be Committed

| Pattern | Reason |
|---|---|
| `.env.local`, `.env` | Contains secrets (DB password, JWT secret, API keys) |
| `node_modules/` | Install locally via `npm install` |
| `.DS_Store`, `Thumbs.db` | macOS/Windows OS junk |
| `~$*.docx`, `~$*.xlsx` | Word/Excel temp lock files |
| `.next/`, `dist/`, `build/`, `out/` | Build artifacts |
| `coverage/` | Test output |

**If `.DS_Store` was already committed**, remove it from tracking:
```bash
git rm --cached .DS_Store
git rm --cached "**/.DS_Store"
git commit -m "chore: remove .DS_Store from tracking"
```

---

## License
MIT — see [LICENSE](LICENSE)
