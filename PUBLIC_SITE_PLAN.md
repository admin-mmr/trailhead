# MMR Public Site & Membership — Development Plan

**Scope:** Build the public-facing pages for `mmr-webapp`, refine the member registration + payment flow, and add content-management forms to `mmr-admin` so non-devs can maintain it.

**Stack (already in place):** Next.js 14 on Azure Static Web Apps · MySQL on Azure · JWT auth · Azure Storage · Azure Communication Services (email) · GitHub Actions deploy.

**Execution mode:** Claude CoWork "Vibe Coding" — short focused sessions (2–3 hrs), one deliverable per session, CoWork drafts the code/migrations/scaffolding while the maintainer reviews and steers. See §9 for cadence.

**Reference site for style/structure:** [dashingwhippets.org](https://www.dashingwhippets.org)

---

## 0. Locked decisions — 2026-05-19

These supersede the open questions previously in §7:

| Decision | Choice | Implication |
|---|---|---|
| Payment rail | **Stripe Checkout (credit card)** | Retire the current Gmail → manual-match → `sp_link_transaction` workflow |
| Auth required to pay | **Yes** — member logs in, then pays | New `/join` creates the account first (email + password set), then sends them straight into Stripe Checkout. Renewals happen from `/portal/profile`. |
| Renewal cadence | **Anniversary-based, per member** | No more club-wide renewal window. Each member's `paid_until` = previous expiration (or join date) + 1 yr. |
| Trial | **None** — pay-to-activate | Removes the existing 30-day trial logic. |
| Subscription vs. one-time | **One-time annual charge** (default; assumption) | Stripe subscription auto-renew is rejected for v1 (members dislike auto-charges); reminder emails 30 + 7 days before expiry handle renewals. |
| Tiers | **Individual $30, Family $50** (carried over) | Two prices in Stripe; family = links one or more dependent records to a `FamilyID`. |
| Existing members | **Honor current ExpirationDate** | They keep what they already paid for; on next renewal they go through Stripe. No re-collection at cutover. |
| Bilingual (EN / 中文) | **Deferred to v2** | Build EN first; add `/zh/*` routing later. |

Items still open: refund/cancellation policy wording, code of conduct text source, sponsor tier definitions, race-record self-submission. Listed in §7.

---

## 1. What's already done

| Feature | Route(s) | Status |
|---|---|---|
| Home, Login, Auth flows | `/`, `/login`, `/auth/*` | ✅ exists — may need visual polish |
| Join page (form skeleton) | `/join` | ✅ exists — extend for payment |
| FAQ | `/faq` | ✅ exists — content review |
| Member portal | `/portal`, `/portal/profile`, `/portal/nyrr`, `/portal/photos/*` | ✅ exists |
| Manage your membership | `/portal/profile` | ✅ exists — verify covers renewal/cancel |
| Payment proof flow | `/payment-proof`, `/portal/payment-proof` | ✅ exists |
| Admin sync | `/admin/sync` | ✅ exists |

---

## 2. New routes to build

### About Us
| Route | Source | Notes |
|---|---|---|
| `/about` | MDX (`content/about/overview.mdx`) | Mission, history, what MMR is |
| `/about/board` | MySQL → `board_members` | Photo grid, role, bio — refreshes yearly |
| `/contact` | Form + Azure Comm Services | Writes to `contact_submissions`, emails admins |

### Membership
| Route | Source | Notes |
|---|---|---|
| `/membership` | MDX | Benefits overview |
| `/membership/join` *(redirect or rename `/join`)* | Form + Stripe | Registration + payment |
| `/membership/manage` *(redirect to `/portal/profile`)* | Existing | Already built |

### Training
| Route | Source | Notes |
|---|---|---|
| `/training` | MDX intro + MySQL → `training_plans` | List of plans |
| `/training/plans/[slug]` | MySQL → `training_plans` + PDF in Azure Storage | Individual plan detail |
| `/training/runs` | MySQL → `weekly_runs` | Day/time/location/pace group, map embed |
| `/training/coaches` | MySQL → `coaches` | Photo, bio, specialty |

### Racing
| Route | Source | Notes |
|---|---|---|
| `/racing` | MySQL → `races` (upcoming + recent recaps) | Race with MMR |
| `/racing/records` | MySQL → `team_records` | Filterable by distance/gender/age |

### Standalone
| Route | Source | Notes |
|---|---|---|
| `/sponsors` | MySQL → `sponsors` | Tiered display |
| `/code-of-conduct` | MDX | Static content |

---

## 3. Member registration + payment flow (Stripe direct, no trial)

### 3.1 New member join
```
/join → step 1: account form (name, email, phone, password, T-shirt size,
                              emergency contact, tier=Individual|Family,
                              CoC checkbox)
      ↓
   POST /api/auth/register → create member row (Status='pending_payment',
                                                 ExpirationDate=NULL)
      ↓ auto-login, then redirect to:
   /membership/checkout → server creates Stripe Checkout session
                          (price_individual_30 OR price_family_50)
      ↓
   ┌─ success → Stripe webhook /api/stripe/webhook
   │           → idempotent on event.id (stripe_events table)
   │           → set Status='active', ExpirationDate=NOW()+1yr,
   │             insert into payments (PaymentMethod='Stripe',
   │             StripeChargeID, Amount, PaymentDate)
   │           → email "Welcome, you're in" via Azure Comm Services
   │           → redirect to /portal/profile?welcome=1
   └─ cancel  → /membership/checkout?cancelled=1 (account stays pending_payment)
```

### 3.2 Renewal (anniversary-based)
```
Logged-in member visits /portal/profile
   → banner appears when ExpirationDate is within 60 days (or already passed)
   → "Renew now" button → /portal/renew
   → Stripe Checkout (same price IDs, customer_email prefilled)
   → webhook: ExpirationDate = MAX(ExpirationDate, NOW()) + 1yr
                                                       ^ extends from existing
                                                         expiry, not from today,
                                                         so early renewers don't
                                                         lose days
   → email receipt + "see you next year"
```

### 3.3 Renewal reminders (cron)
Nightly job in `mmr-admin/cron_renewal_reminders.py`:
- 30 days before `ExpirationDate`: friendly heads-up email
- 7 days before: second nudge
- 1 day after: "your membership expired — click to renew" (sets Status='lapsed' after 30 days grace)

### 3.4 Webhook reliability
- New table `stripe_events (event_id PK, type, processed_at)` — webhook checks before processing
- Nightly reconciliation cron compares Stripe charges (last 7 days) against `payments` table; logs any drift to `activity_log` with severity='warning'
- All Stripe failures route to the existing V007 error_context table

---

## 3.5 Deprecation — what gets retired

Once the Stripe flow is live, these existing components are removed:

| Component | Why | Migration |
|---|---|---|
| `api_payments.py` autoguess endpoints (`/api/payments/autoguess-all`, `/manual-approve`) | No more manual matching needed | Archive routes; keep read-only "view history" endpoints |
| `sp_link_transaction()` MySQL procedure | Replaced by webhook insert | Drop in MIGRATION_V0xx after 30-day quiet period |
| `gmail_transactions` table | No more Gmail-based matching | Keep historical data; stop new inserts (disable the GAS poller) |
| `/payment-proof` + `/portal/payment-proof` routes | No screenshots needed | Redirect to `/portal/renew` |
| `config.renewal_start_date` / `renewal_end_date` | Anniversary-based — no club-wide window | Drop config keys |
| `submissions.PaymentStatus='pending'` workflow | Account is created at the same moment as Stripe Checkout | Existing pending submissions get a one-shot cleanup script |
| Existing 30-day trial logic | Pay-to-activate | Remove trial-extension code paths in `api_members.py` |

**Cutover plan:** Run both systems in parallel for 30 days, then deprecate. Existing members are *not* re-charged — they keep their current `ExpirationDate` and only meet Stripe at their next anniversary.

---

## 4. Schema additions

```sql
CREATE TABLE board_members (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(100) NOT NULL,
  bio TEXT,
  photo_url VARCHAR(500),
  email VARCHAR(255),
  term_year INT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE coaches (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  specialty VARCHAR(200),
  bio TEXT,
  photo_url VARCHAR(500),
  certifications TEXT,
  contact_email VARCHAR(255),
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE weekly_runs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  day_of_week TINYINT NOT NULL,            -- 0=Sunday..6=Saturday
  start_time TIME NOT NULL,
  location_name VARCHAR(200) NOT NULL,
  location_address VARCHAR(500),
  location_lat DECIMAL(10,8),
  location_lng DECIMAL(11,8),
  pace_group VARCHAR(50),                  -- "Easy 9–10 min/mi"
  distance_miles DECIMAL(4,1),
  description TEXT,
  coach_id INT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (coach_id) REFERENCES coaches(id)
);

CREATE TABLE training_plans (
  id INT PRIMARY KEY AUTO_INCREMENT,
  slug VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  goal_distance VARCHAR(50),               -- "Marathon", "Half", "5K"
  duration_weeks INT,
  level VARCHAR(50),                       -- "Beginner", "Intermediate", "Advanced"
  description TEXT,
  full_plan_url VARCHAR(500),              -- PDF in Azure Storage
  is_published BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE team_records (
  id INT PRIMARY KEY AUTO_INCREMENT,
  distance VARCHAR(50) NOT NULL,           -- "5K", "Marathon"
  gender ENUM('M','F','X') NOT NULL,
  age_group VARCHAR(20),                   -- "Overall", "M40-49"
  time_seconds INT NOT NULL,
  athlete_name VARCHAR(100) NOT NULL,
  member_id INT NULL,
  race_name VARCHAR(200),
  race_date DATE,
  race_location VARCHAR(200),
  is_verified BOOLEAN DEFAULT FALSE,
  INDEX idx_distance_gender (distance, gender),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE TABLE races (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(200) NOT NULL,
  race_date DATE NOT NULL,
  distance VARCHAR(50),
  location VARCHAR(200),
  registration_url VARCHAR(500),
  description TEXT,
  recap_mdx TEXT,                          -- post-race recap
  is_team_event BOOLEAN DEFAULT FALSE,
  INDEX idx_date (race_date)
);

CREATE TABLE sponsors (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(200) NOT NULL,
  tier VARCHAR(50),                        -- "Gold", "Silver", "Bronze", "Partner"
  logo_url VARCHAR(500),
  website_url VARCHAR(500),
  description TEXT,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  display_order INT DEFAULT 0
);

CREATE TABLE contact_submissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  subject VARCHAR(200),
  message TEXT NOT NULL,
  status ENUM('new','read','replied','archived') DEFAULT 'new',
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

All schema changes go in `basecamp/migrations/` per your existing convention.

---

## 5. mmr-admin additions

Non-dev users (board members, coaches, treasurer) need forms to manage content. Add to `mmr-admin`:

| Module | Capabilities | Who uses it |
|---|---|---|
| Board Members | CRUD, photo upload, reorder | President / Secretary |
| Coaches | CRUD, photo upload | Training Director |
| Weekly Runs | CRUD, map picker for lat/lng | Training Director |
| Training Plans | CRUD, PDF upload | Coaches |
| Team Records | CRUD, verify toggle, link to member | Records Keeper |
| Races | CRUD, MDX editor for recaps | Race Director |
| Sponsors | CRUD, logo upload | Sponsorship Chair |
| Contact Inbox | List, mark read, reply, archive | Whoever monitors |

**Auth:** reuse JWT — add a `role IN ('member','admin','board')` field on `members`, gate `mmr-admin` routes accordingly.

---

## 6. Phased delivery

### Phase 1 — Static skeleton + nav *(Week 1–2, ~30–40 hrs)*
- Top nav + footer with full IA (About / Membership / Training / Racing / FAQ / Sponsors / Login)
- Mobile responsive shell, design tokens
- MDX pages: `/about`, `/membership`, `/code-of-conduct`, `/sponsors` (placeholder list)
- Refresh `/faq`
- Contact form `/contact` + email send via Azure Comm Services + write to `contact_submissions`
- **Done when:** every nav link routes to a real page, contact form sends to admin inbox, site looks coherent on mobile

### Phase 2 — Dynamic read paths *(Week 3–4, ~35–50 hrs)*
- Run migrations for all 8 new tables
- Seed initial data (board, coaches, weekly runs, records — from existing spreadsheets/Google Sheets)
- Public pages reading from DB with Next.js ISR (revalidate ~5 min):
  - `/about/board`
  - `/training` + `/training/plans/[slug]`
  - `/training/runs`
  - `/training/coaches`
  - `/racing` + race detail
  - `/racing/records` with client-side filter
  - `/sponsors` tiered
- **Done when:** all dynamic pages render from MySQL, ISR validated, fallback handles empty states

### Phase 3 — mmr-admin write paths *(Week 5–6, ~40–60 hrs)*
- Admin auth gate (role check)
- CRUD UIs for all 8 entities
- Image upload component → Azure Storage (max 800px wide, WebP, signed URLs)
- MDX editor for race recaps (TipTap or simple `<textarea>` + preview)
- Map picker for weekly run lat/lng (Leaflet + OSM, no API key needed)
- **Done when:** a board member who has never seen the code can log in and update content end-to-end

### Phase 4 — Membership join + Stripe *(Week 7, ~25–40 hrs)*
- Migration V0xx: `stripe_events`, `payments.StripeChargeID`, `members.Status` enum adds `'pending_payment'`, `'lapsed'`
- `/join` form: account + tier + CoC → POST `/api/auth/register` (Status='pending_payment')
- `/membership/checkout`: server creates Stripe Checkout session (Individual $30 / Family $50 price IDs from env)
- Webhook handler `/api/stripe/webhook`: idempotent on `event.id`, sets Status='active' + ExpirationDate
- `/portal/renew` for anniversary renewals (extends from existing expiry, not from today)
- "Welcome" + receipt emails via Azure Comm Services
- Renewal reminder cron (30 / 7 days before, 1 day after) — see §3.3
- Reconciliation cron — see §3.4
- Deprecate `/payment-proof` (redirect → `/portal/renew`)
- **Done when:** brand-new user can register → pay → log in → see active membership in `/portal/profile`; existing member can renew from portal; expired member receives reminder emails on cron schedule

### Phase 5 — Polish + launch *(Week 8, ~15–25 hrs)*
- SEO: sitemap.xml, robots.txt, OG tags, meta descriptions
- Analytics: Plausible or GA4
- Accessibility pass (aXe)
- Lighthouse 90+ on all public pages
- Cross-browser/device sanity check
- Soft launch to 5–10 members for feedback
- **Done when:** Lighthouse green, sitemap submitted, no broken links, board has signed off

**Total: ~145–215 hrs.** That's **6–9 weeks part-time** (15–25 hrs/wk) or **3–5 weeks full-time**. At freelancer rates with Claude Code: **$12K–32K**. Solo with your own time: just time + ~$100/mo Claude Max + existing Azure spend.

---

## 7. Decisions still open

Locked decisions moved to §0. These remain:

1. **Refund/cancellation policy:** drives Stripe configuration + FAQ copy. Typical clubs: no refunds after 7 days, prorated only for medical reasons.
2. **Coach contact:** publish emails publicly, or route through `/contact`?
3. **Team records:** board-only entry, or member self-submit with review queue?
4. **Sponsor tiers:** what levels exist and what does each get?
5. **Code of Conduct:** existing draft, adapt from Dashing Whippets, or write from scratch?
6. **Domain:** which one launches public?
7. **Family tier semantics:** one login per family with multiple members linked, or each family member gets their own login but shares billing?

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Content not ready (bios, photos, CoC text) | Start collecting in Phase 1 — board needs ~2 weeks of prep |
| Stripe webhook fails / duplicate charges | Idempotency on `event.id` + nightly reconciliation cron (reuse `PAYMENTS_FUZZY_MATCH` infra) |
| Member data inconsistency between Stripe + DB + Google Sheets | Define DB as source of truth; GAS sync runs one-way DB → Sheets |
| Image bloat in Azure Storage | Enforce max dimensions + WebP at upload time |
| Renewals get forgotten | If one-time charge: cron emails 30 + 7 days before expiry |
| Bus factor (only you know the system) | Keep README + CLAUDE.md current; admin docs in `mmr-admin/README` |

---

## 9. How to execute with Claude CoWork (Vibe Coding)

**The cadence:** short, focused CoWork sessions (2–3 hrs each) with a single concrete deliverable per session. CoWork drafts code/migrations/scaffolding inside the workspace folder; the maintainer reviews diffs, runs `npm run verify` + `python3 mmr-admin/test_imports.py` locally, and commits.

**Session-level breakdown** (rough — adjust as scope shifts):

| Phase | Sessions | What each session ships |
|---|---|---|
| **Phase 1 — Skeleton + nav** | 4–6 | (1) nav + footer + design tokens · (2) `/about` + `/membership` + `/code-of-conduct` MDX · (3) `/sponsors` placeholder · (4) `/contact` form + email · (5) `/faq` refresh · (6) mobile responsive pass |
| **Phase 2 — Dynamic reads** | 5–7 | (1) all 8 migrations + seeds from existing Sheets · (2) `/about/board` · (3) `/training` + plan detail · (4) `/training/runs` + `/training/coaches` · (5) `/racing` + recap · (6) `/racing/records` with client filter · (7) ISR tuning |
| **Phase 3 — mmr-admin CMS** | 6–8 | (1) admin auth gate + role · (2) Board CRUD · (3) Coaches + Runs CRUD · (4) Training Plans + PDF upload · (5) Races + MDX recap · (6) Team Records + verify toggle · (7) Sponsors · (8) Contact inbox |
| **Phase 4 — Stripe** | 3–4 | (1) migration + Stripe price IDs + `/join` flow · (2) `/membership/checkout` + webhook · (3) `/portal/renew` + reminder cron · (4) reconciliation cron + deprecate `/payment-proof` |
| **Phase 5 — Launch** | 2–3 | (1) SEO + analytics · (2) a11y + Lighthouse · (3) soft launch + feedback fixes |

**Per session — the loop:**
1. **Open CoWork**, paste the session's deliverable from the table above as the prompt
2. CoWork reads the relevant existing files (route, component, migration sibling), drafts the change set
3. Maintainer reviews diffs in the workspace folder, runs `npm run verify` locally
4. CoWork addresses any failures, then maintainer commits using a semantic message (`feat:`, `fix:`, `chore:`) and pushes
5. Update `_context.md` with the 3-line session note before closing CoWork

**Guardrails that apply every session:**
- DB changes always paired with a `MIGRATION_V###` file ending in the self-registration INSERT (per CLAUDE.md)
- Frontend: TS strict mode, `lib/access.ts` gates any new authenticated route
- Backend: shared modules edited in `basecamp/python/` first, synced via `./scripts/sync-shared-modules.sh`
- Build verification: `npm run build 2>&1 | tail -n 50` after any Next.js change
- Token discipline: one file read per cycle, diff-first edits — per CLAUDE.md

**Total CoWork sessions across all 5 phases:** ~20–28. At 2–3 hrs each that's the same 145–215 hr estimate from §6, just sliced into chewable pieces.

---

## 10. Out of scope (for now)

- E-commerce shop (use Stripe Payment Links if needed later)
- Newsletter / email marketing platform
- Instagram embed
- Photo CV pipeline (`photo-manager` — already excluded)
- WeChat matching, NYRR sync — already built elsewhere in the monorepo
