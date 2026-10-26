### 10-26 UTC — mmr-admin: admin role required on every non-public route
Changed: Any member with a portal `password_hash` could sign in at admin.mmrunners.org (`/auth/password` → role `'none'`) and, since most routes were `@login_required`-only, read every member's PII via `/api/district/*` + CSV exports and the Data Browser (`/api/tables/members`, incl. `password_hash`), or repoint the DB (`/api/connection/set`). Added `@require_role('admin')` to all 53 such routes (only `/api/me` stays login-only); `/` now shows a "No admin access" page (403) for role `'none'`. `test_auth_matrix.py` now enforces admin-by-default via `LOGIN_ONLY_ROUTES`.
Status: `pytest mmr-admin/tests` green (1609 passed). Not deployed.
Next: consider `super_admin` for `/api/connection/set`; escape `error` in `render_login()` (reflected into `/login?error=` HTML).

### 10-06 15:30 UTC — my.mmrunners.org outage: SWA custom domain binding had vanished
Changed: Site failed with a TLS cert-name mismatch (DNS CNAME intact, but `mmr-webapp` had `customDomains: []`, no delete in the 90-day activity log). Re-bound via `az staticwebapp hostname set` → Ready 15:15 UTC, cert CN=my.mmrunners.org. SWA app settings `NEXTAUTH_URL` + `NEXT_PUBLIC_APP_URL` → `https://my.mmrunners.org`; deploy workflow's build-time `NEXTAUTH_URL` changed to match (it is inlined at build, so the app setting alone did nothing). OAuth redirect URIs for Google + Entra added by user.
Status: domain + HTTPS verified 200; auth URLs switch on the next deploy of this commit.
Next: after deploy, confirm `/api/auth/providers` shows my.mmrunners.org callbacks + test a Google login. Rotate the MySQL password (exposed in plain text in SWA `DATABASE_URL`). Weekly renewal-reminders run failed 09-29 (likely missing `JOB_SECRET`).

### 09-23 UTC — Static HTML playground at /playground
Changed: NEW `web-apps/mmr-webapp/public/playground/` for standalone HTML pages served as-is (first page: `capstone-project-atlas.html`) + an `index.html` list; one `rewrites()` entry in `next.config.mjs` maps bare `/playground` to it. Public by default (unmatched prefix in `lib/access.ts`), all pages `noindex`.
Status: verified on local dev — `/playground`, `/playground/index.html` and the page all 200 and render.
Next: add a page = drop the `.html` in the folder + one `<li>` in `index.html`. `www.mmrunners.org` does not serve this app; use `orange-tree-0d70d110f.4.azurestaticapps.net`.
