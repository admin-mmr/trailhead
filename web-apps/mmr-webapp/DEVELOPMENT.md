# MMR Webapp Development Guide

## Local Setup

```bash
cd mmr-webapp
npm install
npm run dev
```

Server runs at `http://localhost:3000`

---

## Before Pushing to GitHub

The project uses **3 layers of verification** to catch errors early:

### 1️⃣ Pre-commit Hook (Automatic)

When you run `git commit`, a pre-commit hook automatically runs:
```bash
npm run lint && npm run build
```

If either fails, your commit is blocked. **This is a feature** — it prevents broken code from being committed.

**Fix linting errors:**
```bash
npm run lint -- --fix
```

### 2️⃣ Manual Verification (Before Push)

Before pushing, run:
```bash
npm run verify
```

This runs a full lint + build check and prints a detailed report. Use this to verify everything works before pushing.

### 3️⃣ GitHub Actions (After Push)

When you push to `main`, GitHub Actions runs:
- `npm run build`
- Azure deployment (if build succeeds)

---

## Common Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build (catches errors) |
| `npm run lint` | Check code style |
| `npm run lint -- --fix` | Auto-fix style issues |
| `npm run typecheck` | Check TypeScript types only |
| `npm run verify` | Full verification (lint + build) |

---

## Troubleshooting

### "Pre-commit hook failed"

The hook ran `lint` or `build` and found errors. Fix them:

```bash
npm run lint -- --fix
npm run build
```

Then try committing again — the hook will re-run automatically.

### "Can't commit because lint failed"

Some issues require manual fixes. Check the error message and update the files, then:

```bash
npm run lint -- --fix    # Auto-fix what you can
git add .
git commit -m "fix: code style issues"
```

### "Skipping hooks temporarily?"

If you absolutely need to skip hooks (not recommended), use:
```bash
git commit --no-verify
```

But this disables the safety net — you'll rely on GitHub Actions to catch errors.

---

## Database Environment Variables

Create `.env.local` in this directory (git-ignored) with:

```bash
DATABASE_URL=mysql://mmradmin:YOUR_PASSWORD@mmr-mysql-v4.mysql.database.azure.com:3306/mmrdb?ssl=true
JWT_SECRET=your-long-random-string-here
AZURE_STORAGE_CONNECTION_STRING=...
AZURE_COMM_CONNECTION_STRING=...
```

Copy from `.env.example` if you need a template.

---

## Build Caching

Next.js build caches in `.next/`. To force a clean build:
```bash
rm -rf .next && npm run build
```
