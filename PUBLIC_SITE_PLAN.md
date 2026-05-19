# MMR Public Site & Membership — Development Plan

**Scope:** Build the public-facing pages for `mmr-webapp`, refine the member registration + payment flow, and add content-management forms to `mmr-admin` so non-devs can maintain it.

**Stack (already in place):** Next.js 14 on Azure Static Web Apps · MySQL on Azure · JWT auth · Azure Storage · Azure Communication Services (email) · GitHub Actions deploy.

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

## 3. Member registration + payment flow (no trial)

```
/join → form (name, email, phone, T-shirt size, emergency contact, CoC checkbox)
      ↓
   Stripe Checkout session (server creates, redirects)
      ↓
   ┌─ success → Stripe webhook → upsert member (status=active, paid_until=+1yr)
   │           → send password-setup email via Azure Comm Services
   │           → redirect to /auth/setup-password?token=...
   └─ cancel  → /join?cancelled=1
```

**Key decisions to lock down:**
- One-time annual charge vs. Stripe subscription with auto-renew?
- Membership tiers (single price, or e.g. Student / Regular / Family)?
- Refund/cancellation policy?

**Webhook reliability:** add idempotency on Stripe `event.id`, plus a nightly reconciliation cron (your `PAYMENTS_FUZZY_MATCH` infra already handles this pattern).

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
- Extend `/join` form with all required fields + CoC checkbox
- Server route: create Stripe Checkout session
- Webhook handler `/api/stripe/webhook`: idempotent member upsert
- Email "Welcome — set your password" via Azure Comm Services
- Hook into existing `/auth/setup-password` flow
- Renewal: depends on subscription vs one-time decision (see §3)
- **Done when:** brand-new user can join, pay, set password, log in, and see their membership active in `/portal/profile`

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

## 7. Decisions needed from you before Phase 4

These don't block Phase 1–2 but should be locked by end of Phase 2:

1. **Payment model:** annual one-time charge, or Stripe subscription with auto-renew?
2. **Membership tiers:** single price, or Student/Regular/Family/etc.?
3. **Refund/cancellation policy:** drives Stripe configuration and FAQ copy
4. **Bilingual EN / 中文?** The team name 岚山跑团 suggests yes — affects routing (`/zh/about`) and content strategy
5. **Coach contact:** publish emails or route through `/contact`?
6. **Team records:** board-only entry, or member self-submit with review queue?
7. **Sponsor tiers:** what levels exist and what does each get?
8. **Code of Conduct:** existing draft or write from scratch?
9. **Domain:** which one launches public?

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

## 9. How to execute with Claude Code

1. Drop this plan in repo root as `PUBLIC_SITE_PLAN.md`
2. Update `CLAUDE.md` to reference it and note the existing conventions (pre-commit hooks, `npm run verify`, `lib/access.ts` for new routes)
3. Open Phase 1 as a GitHub issue, point Claude Code at the repo + plan, work through it route by route
4. Each PR: one route or one module, run `npm run verify` before push (your existing flow)
5. Phase 3 and 4 changes touch the DB — always paired with a migration in `basecamp/migrations/`

---

## 10. Out of scope (for now)

- E-commerce shop (use Stripe Payment Links if needed later)
- Newsletter / email marketing platform
- Instagram embed
- Photo CV pipeline (`photo-manager` — already excluded)
- WeChat matching, NYRR sync — already built elsewhere in the monorepo
