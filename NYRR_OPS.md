# NYRR Processing & Maintenance

Operational reference for the NYRR sync pipeline and the **NYRR Count Reconciliation** admin panel.

> ⚠️ Project rule (CLAUDE.md) says docs go into `CLAUDE.md`. This file exists as an explicit override at the user's request — keep it focused on **operations** (what to run, what columns mean, how to recover). Architecture/design notes should still go in `CLAUDE.md`.

Last updated: 2026-05-26 (V028: `mmr_finisher_count` column added; probes now persist live counts)

---

## 1. NYRR Count Reconciliation panel — column reference

UI: `mmr-admin/templates/nyrr-reconcile.html` · Backend: `mmr-admin/api_nyrr_reconcile.py`

The panel shows one row per past event (`nyrr_events.event_date < CURDATE()`), newest first. **All counts for the initial page load come from the DB only** — no NYRR API calls. The `🔍 Probe` button is what hits NYRR live.

| Column | On page load (`GET /api/nyrr/reconcile`) | After Probe (`POST /api/nyrr/reconcile/<id>/probe`) |
|---|---|---|
| **Event / Code / Date** | `nyrr_events.event_name`, `event_code`, `event_date` | unchanged |
| **Status** | `nyrr_events.processing_status` (`Pending` / `InProgress` / `Completed` / `Error`) | May flip to `Completed` if Coverage ≥ 98% |
| **NYRR Total** | `nyrr_events.nyrr_finisher_count` (stored from last sync **or last probe**; `—` if NULL/0) | Live: `POST runners/finishers-filter` with `eventCode=<code>, pageSize=1` → `totalItems`. Persisted to `nyrr_finisher_count` on every probe. Shown with a small `live` badge. |
| **DB Total** | `COUNT(*) FROM nyrr_event_runners WHERE nyrr_event_id = e.id` | Same `COUNT(*)`, re-run |
| **Coverage** | `db_total / nyrr_total × 100`, computed in JS. Green ≥ 98%, amber ≥ 90%, red below | Same, recomputed with live numbers |
| **NYRR MMR** | `nyrr_events.mmr_finisher_count` (NEW in V028; stored from last probe; `—` if NULL = never probed) | Live: `POST runners/finishers-filter` with `eventCode=<code>, teamCode='MMR', pageSize=1` → `totalItems`. Persisted to `mmr_finisher_count` on every probe. |
| **DB MMR** | `SUM(team_code = 'MMR')` on `nyrr_event_runners` | Same, re-run |
| **Action** | `🔍 Probe` button if `processing_status != 'Completed'`; `✓ Done` otherwise | After probe, if Coverage ≥ 98% the button is replaced with `✓ Done` |

### What "Probe" does, precisely

`POST /api/nyrr/reconcile/<event_id>/probe` (`api_nyrr_reconcile.py:92`):

1. Two cheap NYRR API hits — both `runners/finishers-filter` with `pageSize=1`, so only the `totalItems` counter is read (no finisher rows downloaded). One for the total finisher count, one filtered to `teamCode='MMR'`.
2. Re-counts the local DB (`COUNT(*)` + `SUM(team_code='MMR')`).
3. **Always** persists the live values to `nyrr_events`, regardless of threshold:
   - `nyrr_finisher_count = <live NYRR total>`
   - `mmr_finisher_count  = <live NYRR MMR>`
4. **Additionally**, if `db_total >= 0.98 × nyrr_total` (the `COMPLETE_THRESHOLD` constant):
   - `processing_status = 'Completed'`
   - Appends a note: `[reconciled: <db>/<nyrr> runners]`
5. Returns `{nyrr_total, nyrr_mmr, db_total, db_mmr, pct, gap, marked_complete}`.

> Behavior change (2026-05-26): Before V028, the probe only wrote `nyrr_finisher_count` *and only* on auto-complete. Sub-threshold probes are now also persisted, and `mmr_finisher_count` is captured for the first time.

**`🔍 Probe All Incomplete`** loops over every visible row that isn't already `Completed` and calls the same endpoint once each (sequential, awaited).

### Why some `Completed` rows show NYRR Total = `—`

These are the events in your screenshot like `26BKHST3`, `26MIND`, `26WSHALF`. The cell shows `—` because **`nyrr_events.nyrr_finisher_count` is NULL or 0**. The Probe button is hidden on Completed rows, so you currently can't re-verify from the UI. Three causes, ordered by likelihood:

1. **Legacy completion** — event was synced before `nyrr_finisher_count` started being written. Most rows in the screenshot fit this.
2. **Bug A scenario (now fixed, historical rows not backfilled)** — sync wrote 0 finishers due to an empty NYRR response. CLAUDE.md → NYRR Bug Tracker → row A (fixed 2026-05-25). Pre-fix rows still carry the bad value.
3. **`event_code` is still a slug** (rows like `rising-nyrr-spring-jamboree`, `rnyrr-at-rbc-race-for-the-kids-4m` showing `0/0` in your screenshot). Bug L (fixed 2026-05-25) auto-resolves slug→canonical on next sync.

> The cause is **not** `event_url` being broken. The probe uses `event_code`, not `event_url`, to hit `runners/finishers-filter`. `event_url` is only the human-facing link to `results.nyrr.org/event/<code>/finishers`.

### Recovery for "Completed + NYRR Total = `—`"

Three options, simplest first:

```bash
# A — one row, via API (works for any row, ignores the UI gating):
curl -X POST http://localhost:5001/api/nyrr/reconcile/<event_id>/probe

# B — backfill a known event by code:
mmr   # loads venv + env
python3 basecamp/ops/sync_nyrr_events.py --mode single --event-code 26WASH

# C — reconcile slug-form codes (Bug L path):
python3 basecamp/ops/sync_nyrr_reconcile.py --mode reconcile
# add --include-upcoming to also try future events; --dry-run to preview

# D - backfill:
mmr && nohup python3 basecamp/ops/sync_nyrr_events.py --mode weekly > /tmp/nyrr_backfill.log 2>&1 &

```

A UI-side fix (always show Probe, even on Completed rows) is on the wishlist but not done yet.

---

## 2. Sync pipeline — what actually runs

End-to-end the NYRR pipeline has four pieces. Source of truth for shared code is **`basecamp/python/`**; CI auto-copies `nyrr_api.py` etc. into `mmr-admin/` (see CLAUDE.md → "SHARED PYTHON MODULES").

### 2.1 CLI / GitHub Actions entry — `basecamp/ops/sync_nyrr_events.py`

| Mode | Function | What it does |
|---|---|---|
| `--mode daily --batch-size N` | `run_daily_pipeline` | Discover today's events + sync N pending events. Also runs reconcile Step 2.5 (past-date only). |
| `--mode weekly` | `run_weekly_pipeline` | Same as daily but no batch cap; reconcile includes upcoming events. **Also runs member↔finisher auto-matching** (`run_auto_matcher`, line ~262). |
| `--mode single --event-code <CODE>` | `run_single_event` | Reprocess one event end-to-end. |
| `--mode reconcile [--include-upcoming] [--dry-run]` | `run_reconcile_only` | Slug→canonical reconciliation only (no finisher fetch). |

**This CLI is now the manual/local path only.** Unattended automation moved to the in-app scheduler (`mmr-admin/nyrr_scheduler.py`) — see [§ Automated pipeline](#automated-pipeline-unattended) below. The old `.github/workflows/sync-nyrr-weekly.yml` was deleted. **Key difference:** the CLI weekly pipeline auto-matches members; the in-app scheduler does **not** (matching gap — see runbook).

### 2.2 Background worker — `mmr-admin/sync_worker.py` + `sync_worker_fetch.py` + `sync_worker_backfill.py`

Called from both the CLI pipeline and the admin UI's "▶ Load" button.

**Step 0 — Slug resolution.** Before any sync work, if `event_code` contains `-` (it's a slug), `_resolve_slug_to_event` calls NYRR `events/search` and word-overlaps it against canonical events. On a confident match (score ≥ 0.4) it updates the row to the canonical code **and** the canonical `event_url`. Past-date events whose slug fails to resolve abort here (prevents Bug A's destructive empty fetch).

**Step 1 — Finisher fetch (`FinisherFetcher` in `sync_worker_fetch.py`).**
Hit `runners/finishers-filter` paged through all results. If a single shard exceeds NYRR's 1000-row page cap, `_split_by_pace` bisects by `[pace_min, pace_max]` (Bug M fix: tracks both ends, splits midpoint = `avg(min,max)`). On UPSERT writes to `nyrr_event_runners` it uses MySQL 5.7 `VALUES(col)` syntax (Bug B fix).

**Step 2 — `teams/teamRunners` for MMR.**
Pulls just the MMR roster for this event (smaller payload than scanning all finishers).

**Step 3 — Team-code backfill (`TeamBackfiller` in `sync_worker_backfill.py`).**
For each MMR runner returned by Step 2, `UPDATE nyrr_event_runners SET team_code='MMR' WHERE runner_id = ...`. If Step 1 missed the runner (e.g. mid-pace-shard 1000-cap edge), `INSERT` instead.

**Final status (Bug A fix).** `processing_status='Completed'` is only set when `rows_written > 0`. Empty fetches surface as `Error` with the failure visible in the UI job state.

### 2.3 Auto-matching members ↔ finishers — `mmr-admin/api_events.py`

Separate from sync. Once an event is `Completed`, runners can be matched to MMR members. Trigger: `POST /api/events/<event_id>/automatch` (`api_events.py:174`).

Four tiers, applied in order, each setting `match_method` on the runner row:

| Tier | Match rule | Method label |
|---|---|---|
| 1 | Exact `members.NYRRRunnerName` (stored) | `nyrrname` |
| 2 | first + last + (age ± 1) + gender (M→Male, W→Female, X→Other) | `auto_strict` |
| 3 | first **OR** last + (age ± 1) + gender. Requires birth year (Bug F fix). | `auto_partial` |
| 4 | rapidfuzz `token_set_ratio ≥ 90` + age ± 2. **Runs in a background thread** via `api_events_fuzzy.py` (`POST /api/events/<id>/fuzzy-match`, `GET /…/status` polls). | `auto_fuzzy` |

Each tier also writes `members.NYRRRunnerName` and `members.YearBornGuess` if missing (helper: `_backfill_member_name_and_year`).

---

## 3. Where each piece of data lives

### MySQL tables

| Table | Key columns | Used for |
|---|---|---|
| `nyrr_events` | `id`, `event_code` (UNIQUE), `event_url`, `event_date`, `processing_status`, `nyrr_finisher_count`, `mmr_finisher_count`, `mmr_runner_count`, `mmr_matched_count`, `notes` | One row per NYRR event. `event_code` is canonical (e.g. `H2026`) after reconcile; pre-reconcile it may be a slug. |
| `nyrr_event_runners` | `id`, `nyrr_event_id`, `runner_id`, `team_code`, `mmr_member_id`, `match_method`, `confidence_score` | One row per finisher. `mmr_member_id` is set by automatch. |
| `schema_migrations` | `version`, `description`, `executed_at` | Migration audit trail. Every `MIGRATION_V*.sql` self-registers here. |

### Key columns the reconciliation panel reads

- `nyrr_events.nyrr_finisher_count` — what shows as "NYRR Total". Written by sync workers (Step 1 final commit) and by every probe (V028+).
- `nyrr_events.mmr_finisher_count` — NEW in V028. NYRR-reported MMR finisher count, written by every probe. Shown as "NYRR MMR" on initial page load; `NULL` = never probed.
- `nyrr_events.mmr_runner_count` — DB-derived MMR count cache (updated by `_reconcile_event_mmr` and Step 3 backfill). Distinct from `mmr_finisher_count`: the former is what's in our DB, the latter is what NYRR says.
- `nyrr_events.mmr_matched_count` — MMR runners successfully matched to MMR members by `automatch`.
- `nyrr_events.processing_status` — drives Status column + Probe button visibility.

### REST endpoints (Flask blueprint `nyrr_reconcile_bp`)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/nyrr/reconcile` | List past events with stored counts |
| POST | `/api/nyrr/reconcile/<id>/probe` | Live probe + auto-complete if ≥ 98% |
| POST | `/api/nyrr/reconcile/<id>/tag-mmr` | Re-tag `team_code='MMR'` for one event (no full re-sync) |
| POST | `/api/nyrr/reconcile/tag-mmr-batch` | Batch re-tag, body: `{since, until, limit, only_zero_mmr}` |
| POST | `/api/discover/reconcile-slugs` | Admin trigger for the slug→canonical scan (in `api_events_discovery.py`) |

---

## 4. Maintenance playbook

<a id="automated-pipeline-unattended"></a>
### Automated pipeline (unattended) — the fully-automated runbook

**Where it runs & cost.** Automation runs *inside* the Azure App Service `mmr-nyrr-viewer`
via `mmr-admin/nyrr_scheduler.py` (APScheduler background thread), **not** GitHub Actions.
Gated by env `ENABLE_NYRR_SCHEDULER=1` (set on prod 2026-07-18). **Marginal cost = $0** — it
uses already-paid App Service compute. (GitHub Actions minutes are also free on this *public*
repo, but the DB is Azure MySQL, typically reachable only from Azure — which is why automation
lives in-app rather than in a GitHub cron.)

**Two scheduled jobs** (crons overridable via `NYRR_DISCOVERY_CRON` / `NYRR_FINISHER_CRON`):

| Job | Default cron (UTC) | Function | What it does |
|---|---|---|---|
| Discovery | `0 6 1 * *` (1st of month, 06:00) | `run_discovery` → `discover_current_events()` | Pulls new/upcoming races from NYRR `events/search` into `nyrr_events`. |
| Finisher pipeline | `0 2 * * 2` (Tue 02:00) | `run_finisher_pipeline` | 1) promote upcoming events past their date → loadable; 2) sequentially load finisher results for every `Pending` past event (reuses `sync_worker.start_sync`, blocks per-event); 3) reconcile slug-coded event codes. |

**What is / isn't automated** (the "fully automated" checklist):

| Capability | Automated? | By what |
|---|---|---|
| Discover upcoming/new event info | ✅ | Discovery job (monthly) |
| Fetch runner/finisher results | ✅ | Finisher pipeline (weekly) |
| Slug → canonical `event_code` reconcile | ✅ | Finisher pipeline step 3 |
| **Match finishers ↔ MMR members** (Tier 1+2) | ✅ | Finisher pipeline step 2b — `_automatch_one` → `api_events.run_event_automatch` after each event loads (added 2026-07-19). Tier-4 fuzzy stays on-demand (`POST /api/events/<id>/fuzzy-match`). |

**Lead-time caveat on upcoming events.** `events/search` only lists a race once NYRR posts
it *toward results* — not months ahead. The Haku widget / nyrr.org calendar sit behind Queue-it
bot protection that 403s server-to-server requests, so they can't be a discovery source. Net:
upcoming-event lead time is short (days/weeks, not months). This is a NYRR-side limit, not a bug.

**Verify the scheduler is alive & working** (`adm-logs` streams Azure logs):
```bash
adm-logs | grep -i '\[scheduler\]'
# Healthy startup line:
#   [scheduler] started — discovery '0 6 1 * *', finisher '0 2 * * 2'
# Per-run lines to expect: "discovery done: …", "N pending past events to load",
#   "<CODE> → done", "reconcile: …", "finisher pipeline done".
adm-status         # App Service must be Running, or nothing fires
```
If you see `[scheduler] disabled` → `ENABLE_NYRR_SCHEDULER` isn't set on the App Service.
If you see `another worker owns the scheduler; skipping` on all workers → normal (only one
gunicorn worker runs it). If the App Service scales to multiple **instances**, add a DB lease
(see docstring) — the file lock only guards workers within one instance.

**Manually trigger the weekly pipeline** (don't wait for Tuesday) — run the CLI, which does the
same discover + fetch + reconcile + match end-to-end:
```bash
mmr
python3 basecamp/ops/sync_nyrr_events.py --mode weekly     # discover + fetch + reconcile + MATCH
```

**Matching is now automated end-to-end** (2026-07-19). `run_finisher_pipeline` calls
`_automatch_one` after each event loads (`api_events.run_event_automatch`, Tier 1+2). Expect log
lines like `<CODE> auto-matched N runner(s)`. Only **Tier-4 fuzzy** stays on-demand (large-event
OOM guard): kick it from the UI or `POST /api/events/<id>/fuzzy-match` when the Match Queue shows
unresolved single-name candidates.

### Post-run glance
- Check the `NYRR Count Reconciliation` panel after each sync. Anything `Pending` or with
  `Coverage < 90%` (red) is worth probing (recovery flows below).

### Local re-sync of a problem event
```bash
mmr                                                # cd + venv + env
adm-debug 26WASH                                   # local Flask single-event debug
runner-summary 26WASH                              # MySQL summary
python3 basecamp/ops/sync_nyrr_events.py \
        --mode single --event-code 26WASH         # full re-sync via CLI
```

### Quick DB state check
```bash
python3 - <<'EOF'
import sys; sys.path.insert(0, 'mmr-admin')
from db import query
for r in query("SELECT processing_status, COUNT(*) AS n FROM nyrr_events GROUP BY processing_status"):
    print(f"  {r['processing_status']}: {r['n']}")
print(f"Total runners: {query('SELECT COUNT(*) AS n FROM nyrr_event_runners')[0]['n']}")
print(f"Matched:       {query('SELECT COUNT(*) AS n FROM nyrr_event_runners WHERE mmr_member_id IS NOT NULL')[0]['n']}")
EOF
```

### Find suspect rows
```sql
-- Completed but no stored NYRR total (the screenshot's `—` rows):
SELECT id, event_code, event_date, db_total, nyrr_finisher_count
FROM nyrr_events e
LEFT JOIN (
    SELECT nyrr_event_id, COUNT(*) AS db_total
    FROM nyrr_event_runners GROUP BY nyrr_event_id
) r ON r.nyrr_event_id = e.id
WHERE e.processing_status = 'Completed'
  AND (e.nyrr_finisher_count IS NULL OR e.nyrr_finisher_count = 0)
ORDER BY e.event_date DESC;

-- Slug-form codes still in the table (Bug L candidates):
SELECT id, event_code, event_date, event_url
FROM nyrr_events
WHERE event_code LIKE '%-%'
  AND event_date < CURDATE()
ORDER BY event_date DESC;

-- Events with 0 MMR runners despite Completed status:
SELECT e.event_code, e.event_date, e.mmr_runner_count,
       SUM(r.team_code = 'MMR') AS db_mmr
FROM nyrr_events e
LEFT JOIN nyrr_event_runners r ON r.nyrr_event_id = e.id
WHERE e.processing_status = 'Completed'
  AND e.event_date >= '2024-01-01'
GROUP BY e.id
HAVING db_mmr = 0
ORDER BY e.event_date DESC;
```

### Recovery flows

**Coverage looks low but sync says Completed** → Click `🔍 Probe All Incomplete` (only acts on non-Completed rows). For Completed rows, hit the endpoint directly:
```bash
curl -X POST http://localhost:5001/api/nyrr/reconcile/<event_id>/probe
```

**`team_code='MMR'` got clobbered (no full re-sync needed)**:
```bash
# Single event:
curl -X POST http://localhost:5001/api/nyrr/reconcile/<event_id>/tag-mmr
# Batch (all 2024+ events with mmr_runner_count = 0):
curl -X POST http://localhost:5001/api/nyrr/reconcile/tag-mmr-batch \
     -H 'Content-Type: application/json' \
     -d '{"since":"2024-01-01","only_zero_mmr":true,"limit":200}'
```

**Slug-form `event_code` after upcoming→completed transition**:
```bash
python3 basecamp/ops/sync_nyrr_reconcile.py --mode reconcile --dry-run
python3 basecamp/ops/sync_nyrr_reconcile.py --mode reconcile
```

### Known issues & open work

- **UI gap** — `🔍 Probe` is hidden on `Completed` rows, so you can't re-verify them from the panel. Mitigation: use the curl call above or the daily cron.
- **Bug Tracker M (pace-bisection infinite loop)** — fixed 2026-05-25 in both `basecamp/python/nyrr_finisher_splitter.py` and `mmr-admin/sync_worker_fetch.py`. If you ever see a sync job re-fetching the same pace range, that file diverged again.
- **NYRR API auth** — `NyrrApiClient` reads creds from the macOS Keychain on local; from GitHub Actions secrets in CI. No `.env` files in version control.

---

## 5. File map (quick reference)

```
mmr-admin/
  api_nyrr_reconcile.py        — the Reconciliation panel's REST endpoints
  api_events.py                — automatch (tiers 1-3), event detail
  api_events_fuzzy.py          — Tier 4 fuzzy matcher (background thread)
  api_events_discovery.py      — "Discover New Events" + slug reconcile trigger
  sync_worker.py               — orchestrator + slug resolution
  sync_worker_fetch.py         — FinisherFetcher (Step 1)
  sync_worker_backfill.py      — TeamBackfiller (Step 3)
  sync_worker_reconcile.py     — slug → canonical reconcile (Bug L)
  templates/nyrr-reconcile.html — the panel UI (React component)
  templates/dashboard-panel.html — NYRR Todos panel (event discovery + matching)

basecamp/
  python/nyrr_api.py            — REST client (source of truth)
  python/nyrr_api_models.py     — NyrrEvent / NyrrTeam dataclasses
  python/nyrr_finisher_splitter.py — pace-bisection helper
  ops/sync_nyrr_events.py       — CLI entry (--mode daily/weekly/single/reconcile)
  ops/sync_nyrr_reconcile.py    — CLI for slug reconcile only

.github/workflows/
  sync-nyrr-weekly.yml          — Tuesday 02:00 UTC cron (currently manual-only)
```

See **CLAUDE.md → NYRR BUG TRACKER** for the active bug list and **ACTION PLAN P1c** for the match-queue roadmap.

---

## 6. Data scope policy — full vs. MMR-only load

Two load modes govern how many finishers are fetched per event. Stored in `nyrr_events.load_mode ENUM('full','mmr_only')` (added in MIGRATION_V029).

| Mode | Events | What is fetched | Steps run |
|---|---|---|---|
| `full` | `event_date >= 2025-01-01` (and all future events) | All finishers via `runners/finishers-filter` (Steps 1+2+3) | Step 1: full finisher fetch → Step 2: MMR team roster → Step 3: backfill `team_code='MMR'` |
| `mmr_only` | `event_date < 2025-01-01`, back to 2015 | Only MMR-listed runners via `teams/MMR/teamRunners` (Steps 2+3 only) | **Skip Step 1.** Step 2: MMR team roster → Step 3: upsert with `team_code='MMR'`. Mark `Completed` when `rows_written > 0`. |

**Why MMR-only for pre-2025:** Fetching 5000+ finishers per event × ~10 events/year × 10 years = ~500k rows we don't need. For Hall of Fame purposes, only runners who actively listed MMR as their club count.

**Discovery of pre-2025 events:** Use `events/search?year=<Y>` (2015–2024) filtered to events where `teams/MMR/teamRunners` returns at least 1 row. The `--mode backfill-mmr-only` CLI flag (added in P1e) handles this.

**load_mode assignment rules:**
- New event discovered with `event_date >= 2025-01-01` → `full`
- New event discovered with `event_date < 2025-01-01` → `mmr_only`
- Existing rows default to `full`; migration backfills pre-2025 rows to `mmr_only`

---

## 7. Hall of Fame — requirements

**Goal:** Surface the all-time best MMR performance per race series, per age-gender category.

### What counts as an MMR result
- `nyrr_event_runners.team_code = 'MMR'` (runner listed MMR as their club at race time)
- Runner does **not** need to be matched to an MMR member (`mmr_member_id` may be NULL)
- Covers all events from MMR's first NYRR race through present

### Event series grouping
Events are grouped into a **series** (e.g., "NYC Half Marathon", "Queens 10K", "NYC Marathon"). Multiple calendar years of the same race share one series row. Stored in `nyrr_event_series` table (added in MIGRATION_V029); each `nyrr_events` row has a `series_id FK`.

Admin can assign `series_id` manually or via bulk name-pattern match. Unassigned events appear in a "Needs grouping" bucket.

### Age-gender categories (8 total)
Age is read from `nyrr_event_runners.age` (set at race time by NYRR).

| Category | Filter |
|---|---|
| Men Open | `gender IN ('M','Male')` |
| Men 40+ | same + `age >= 40` |
| Men 50+ | same + `age >= 50` |
| Men 60+ | same + `age >= 60` |
| Women Open | `gender IN ('W','F','Female')` |
| Women 40+ | same + `age >= 40` |
| Women 50+ | same + `age >= 50` |
| Women 60+ | same + `age >= 60` |

"Open" = all ages, no lower bound. Best time = `MIN(finish_time)` comparing as `TIME` (finish_time is stored as `HH:MM:SS` string; cast via `TIME_TO_SEC(CONCAT('00:',finish_time))` for sub-1hr races or `TIME_TO_SEC(finish_time)` directly).

### API shape (see CLAUDE.md ACTION PLAN P1f for full spec)
- `GET /api/hof/series` — list of series with name, best overall finish, category count
- `GET /api/hof/series/<slug>` — all 8 categories, best time + runner name + year per category, all-time podium (top 3 per category)
- `GET /api/hof/event/<event_code>` — same but scoped to one specific year's race

### Pages
- **Admin panel tab** `🏆 Hall of Fame` (new `templates/hof-panel.html`) — includes series management (assign events to series, edit series names)
- **Public Next.js page** `/hall-of-fame` — read-only, no auth required
