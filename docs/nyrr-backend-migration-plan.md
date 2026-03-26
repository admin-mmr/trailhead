**NYRR Backend Migration**

Project Plan v3: GitHub Actions + MySQL + Admin Dashboard

Misty Mountain Runners --- trailhead Monorepo

March 26, 2026

  ------------- ------------------------------------------------
  **Owner**     admin\@mmrunners.org
  **Repo**      trailhead (monorepo)
  **Current**   GAS + Google Sheets
  **Target**    GitHub Actions + MySQL (Azure) + Next.js Admin
  **Status**    Draft v3
  ------------- ------------------------------------------------

1\. Executive Summary

This plan migrates the NYRR race data pipeline from Google Apps Script
to the trailhead monorepo's established stack: Python sync scripts in
basecamp/ops, MySQL on Azure as SSOT, GitHub Actions for scheduling, and
Next.js for the admin dashboard and member-facing views.

Key design principles: automate the easy 80--90% of runner-to-member
matching, surface only genuine ambiguity to humans, store all runners
(not just MMR) for future club expansion, and provide the admin with
full visibility into processing status and data quality.

2\. NYRR RunnerID Behavior

**Critical:** NYRR assigns a different RunnerID to the same person in
different events. There is no stable \"NYRR Member ID.\" However, any
RunnerID from any event can be used to call the runners/races endpoint
and get the same complete race history.

Implications:

-   **No NYRRMemberID column on members.** The link between MMR and NYRR
    lives in nyrr\_event\_runners.mmr\_member\_id, not on the member
    row.

-   **Any RunnerID is a valid lookup key.** Once we match a runner in
    one event, we can use any of their RunnerIDs to fetch their full
    history.

-   **The stable identity is the person's name,** which IS consistent
    across events, even though the ID is not.

3\. NYRR API Client (nyrr\_api.py)

The Python client ports nyrrApi.ts and adds coverage for all known
endpoints. Base URL: https://results.nyrr.org/api/v2. All endpoints use
POST with JSON bodies. The API is undocumented but reverse-engineered
from the results.nyrr.org frontend and the open-source nyrr-results-api
package.

3.1 Events

  ----------------------- ---------------- ------------------------------------------------------------------------------- ------------------------------------------------------------------------
  **Method**              **Endpoint**     **Parameters**                                                                  **Returns**
  search\_events()        events/search    year, searchString, distance, pageIndex, pageSize, sortColumn, sortDescending   Paginated event list with event codes, names, dates, distances, venue
  get\_event\_details()   events/details   eventCode                                                                       Single event with full metadata (venue, distance, logo, virtual flags)
  ----------------------- ---------------- ------------------------------------------------------------------------------- ------------------------------------------------------------------------

3.2 Runners

  ------------------------- -------------------------- ----------------------------------------------------------------- ------------------------------------------------------------------------------
  **Method**                **Endpoint**               **Parameters**                                                    **Returns**
  get\_event\_finishers()   runners/finishers-filter   eventCode, searchString, handicap, sort, page                     Paginated finishers: runnerId, name, bib, age, gender, time, pace, place
  get\_runner\_races()      runners/races              runnerId, year, distance, teamCode, various filters, sort, page   Full race history for a runner across all events
  get\_runner\_details()    runners/details            runnerId                                                          Event-specific runner detail: name, age, gender, city, team, bib, photo URL
  get\_runner\_profile()    runners/recentDetails      runnerId                                                          General profile (non-event-specific): name, age, city, first/last event year
  ------------------------- -------------------------- ----------------------------------------------------------------- ------------------------------------------------------------------------------

3.3 Teams

  ---------------------- ------------------- ----------------------------------- ------------------------------------------------------------------
  **Method**             **Endpoint**        **Parameters**                      **Returns**
  search\_teams()        teams/search        eventCode, searchWord, sort, page   Teams in an event: teamCode, teamName, teamType, runnersCount
  get\_team\_runners()   teams/teamRunners   eventCode, teamCode, sort, page     All runners for a team in an event (our primary MMR data source)
  ---------------------- ------------------- ----------------------------------- ------------------------------------------------------------------

3.4 Awards (New)

Not covered by the GAS scripts. Provides team placement and individual
award data per event.

  ----------------------------- ------------------------- --------------------------------------------------- -----------------------------------------------------------------------
  **Method**                    **Endpoint**              **Parameters**                                      **Returns**
  get\_team\_awards()           awards/teamAwards         eventCode, teamCode, gender?, minimumAge?           Team awards: place, summaryTime, runnersCount per age/gender category
  get\_team\_award\_runners()   awards/teamAwardRunners   eventCode, teamCode, teamGender?, teamMinimumAge?   Individual runners contributing to team awards: time, place, bib
  ----------------------------- ------------------------- --------------------------------------------------- -----------------------------------------------------------------------

3.5 Club Standings (New)

Seasonal club standings across all NYRR events. Not event-specific ---
gives MMR's ranking among all NYRR clubs.

  --------------------------- ----------------------------------- -------------------- ------------------------------------------------------------------
  **Method**                  **Endpoint**                        **Parameters**       **Returns**
  get\_standings\_years()     ClubStandings/getYears              (none)               Array of years with standings data
  get\_divisions\_results()   ClubStandings/getDivisionsResults   year                 All divisions with team rankings: M, W, X (non-binary)
  get\_division\_results()    ClubStandings/getDivisionResults    divisionCode, year   Team rankings within a division, with per-event points breakdown
  get\_teams()                ClubStandings/getTeams              year                 All teams registered for a given year
  --------------------------- ----------------------------------- -------------------- ------------------------------------------------------------------

**Gender note:** The NYRR API uses \"M\" (male), \"W\" (women/female),
and \"X\" (non-binary) for gender divisions. Our schema uses VARCHAR(10)
to accommodate all values without assuming a fixed enum.

4\. Database Schema

MySQL is the SSOT. Stores all runners from all events, not just MMR.

4.1 nyrr\_events

  --------------------------- ------------------------ --------------------------------------------
  **Column**                  **Type**                 **Notes**
  id                          INT AUTO\_INCREMENT PK   Surrogate key
  event\_code                 VARCHAR(30) UNIQUE       NYRR code (e.g. \"26WASH\")
  event\_name                 VARCHAR(255)             Full name
  event\_url                  VARCHAR(500)             Link to results.nyrr.org
  location                    VARCHAR(255)             Venue
  distance                    VARCHAR(50)              \"5K\", \"Marathon\", etc.
  event\_date                 DATE                     Race date
  event\_year                 SMALLINT                 For queries
  is\_upcoming                TINYINT(1)               Has the event occurred?
  is\_virtual                 TINYINT(1)               Virtual event flag (from API)
  processing\_status          ENUM(\...)               Pending/InProgress/Completed/Error
  processed\_at               DATETIME NULL            Last processing time
  processed\_by               VARCHAR(100)             System or admin email
  result\_count               INT DEFAULT 0            Runners ingested
  mmr\_runner\_count          INT DEFAULT 0            MMR team runners (for dashboard stats)
  mmr\_matched\_count         INT DEFAULT 0            Runners matched to members (for dashboard)
  notes                       TEXT                     Free-form
  created\_at / updated\_at   DATETIME                 Audit
  --------------------------- ------------------------ --------------------------------------------

4.2 nyrr\_event\_runners

Core results table. One row per runner per event. Stores all runners.

  --------------------------- ------------------------ ----------------------------------------------------------------
  **Column**                  **Type**                 **Notes**
  id                          INT AUTO\_INCREMENT PK   Surrogate key
  nyrr\_event\_id             INT FK → nyrr\_events    Event link
  nyrr\_runner\_id            VARCHAR(20)              Event-specific ID (NOT stable across events)
  runner\_name                VARCHAR(200)             Full name (consistent across events)
  first\_name                 VARCHAR(100)             First name
  last\_name                  VARCHAR(100)             Last name
  age                         SMALLINT NULL            Age as of event date
  gender                      VARCHAR(10)              \"M\", \"W\", or \"X\" (non-binary)
  state\_province             VARCHAR(50)              State/province
  bib\_number                 VARCHAR(20) NULL         NULL before race day
  finish\_time                VARCHAR(20) NULL         NULL if registered only
  pace                        VARCHAR(20) NULL         Per-mile pace
  overall\_place              INT NULL                 Finish position
  gender\_place               INT NULL                 Gender position
  team\_code                  VARCHAR(20)              \"MMR\", etc.
  is\_registered\_only        TINYINT(1)               Pre-race, no results yet
  mmr\_member\_id             VARCHAR(10) NULL FK      Matched member or NULL
  match\_method               ENUM(\...)               auto\_name / auto\_lastname / manual / not\_member / unmatched
  matched\_by                 VARCHAR(100) NULL        System or admin email who confirmed
  matched\_at                 DATETIME NULL            When match was made
  scan\_timestamp             DATETIME                 Last synced from NYRR
  created\_at / updated\_at   DATETIME                 Audit
  --------------------------- ------------------------ ----------------------------------------------------------------

**Unique key:** (nyrr\_event\_id, nyrr\_runner\_id). Gender is
VARCHAR(10) not CHAR(1) to accommodate NYRR's \"W\" and \"X\" values.
match\_method includes \"not\_member\" for runners flagged by admin as
not in our system.

4.3 nyrr\_processing\_log

  ----------------- ------------------------ -----------------------------------
  **Column**        **Type**                 **Notes**
  id                INT AUTO\_INCREMENT PK   
  run\_timestamp    DATETIME                 When the sync ran
  triggered\_by     VARCHAR(100)             System / admin
  nyrr\_event\_id   INT FK NULL              Event processed (NULL for batch)
  run\_status       ENUM(\...)               Success / PartialSuccess / Failed
  rows\_written     INT                      Rows inserted/updated
  error\_details    TEXT                     Error if failed
  created\_at       DATETIME                 
  ----------------- ------------------------ -----------------------------------

4.4 Members Table: One New Column

  --------------- --------------- ------------------------------------
  **Column**      **Type**        **Notes**
  YearBornGuess   SMALLINT NULL   System-inferred from NYRR age data
  --------------- --------------- ------------------------------------

Existing **NYRRRunnerName** (col 25) is written directly by both
auto-matcher and admin. No guess column --- whether system or human
confirmed it, the result is the same name. **YearBorn** (col 26) is
member-entered. **YearBornGuess** is system-inferred and helps
disambiguate same-surname members.

5\. Event Lifecycle

  --------------- ----------------------------- ------------------------------------------------- -------------------------------------------
  **Phase**       **Trigger**                   **Data Captured**                                 **Admin Action**
  1\. Discovery   Weekly sync                   Event metadata in nyrr\_events                    None --- automatic
  2\. Pre-Race    Daily refresh                 Registrants (is\_registered\_only=true, no bib)   Review registrant count on dashboard
  3\. Race Day    Daily refresh                 Bib numbers assigned                              None --- automatic
  4\. Post-Race   Daily promote + weekly sync   Results: time, pace, place. Auto-matcher runs.    Review unmatched runners in annotation UI
  5\. Photos      Photo upload                  Bib OCR → runner → member link                    Review photo-to-member links
  --------------- ----------------------------- ------------------------------------------------- -------------------------------------------

6\. Runner-to-Member Matching

**Principle:** Automate the easy 80--90%, only surface genuine ambiguity
to humans. The auto-matcher runs inline after each event ingestion. For
a club of \~200--300 members with mostly unique last names, the human
queue should be 2--4 runners per event, shrinking to near-zero as the
system matures.

6.1 Tier 1: Known Name Lookup (\~70%)

If a member's **NYRRRunnerName** is set (from a prior match), and the
NYRR runner's name matches case-insensitively, link immediately. This
handles all repeat appearances.

6.2 Tier 2: Unique Last Name (\~20%)

Compare unmatched runner last names against active MMR members. If
exactly one member and exactly one runner share a last name, auto-link.
Write the NYRR name to members.NYRRRunnerName so Tier 1 catches them
next time.

6.3 Tier 3: Human Review (\~10%)

Ambiguous cases: multiple same-surname members, no surname match, or
name discrepancy. Queued as match\_method = \"unmatched\" for the admin
annotation UI.

6.4 Match Propagation

When a match is confirmed (auto or manual):

-   **Write NYRRRunnerName** to the member row.

-   **Backfill mmr\_member\_id** on ALL nyrr\_event\_runners rows where
    runner\_name matches. One confirmation links a person across their
    entire race history.

-   **Update dashboard counters** (mmr\_matched\_count on nyrr\_events).

6.5 Birth Year Inference

NYRR age + event\_year → YearBornGuess (one of two possible years).
Helps disambiguate same-surname members in the admin UI.

7\. Admin NYRR Dashboard (/admin/nyrr)

A new section in the existing Next.js admin panel. Follows the
established patterns: client components, requireSession() + isAdmin()
auth, bilingual UI (en/zh), Tailwind styling, Lucide icons.

7.1 Overview Tab (/admin/nyrr)

At-a-glance monitoring of the entire NYRR pipeline.

  -------------------------- ---------------------------------------------------- ------------------------------------------------------------------------------
  **UI Element**             **Data Source**                                      **Content**
  Summary Cards (row of 4)   Aggregate queries                                    Total Events \| Upcoming Events \| Total MMR Runners \| Unmatched Queue size
  Processing Status Chart    nyrr\_events.processing\_status                      Bar chart: Pending / InProgress / Completed / Error counts
  Recent Events Table        nyrr\_events ORDER BY event\_date DESC               Event name, date, distance, status badge, MMR count, matched count, match %
  Sync History               nyrr\_processing\_log ORDER BY run\_timestamp DESC   Last 20 sync runs: timestamp, status, rows written, errors
  -------------------------- ---------------------------------------------------- ------------------------------------------------------------------------------

**Match health indicator:** Each event row shows a colored bar: green
(\>90% matched), yellow (70--90%), red (\<70%). Lets admin spot events
needing attention at a glance.

7.2 Event Detail View (/admin/nyrr/events/\[id\])

Drill-down into a single event. Shows all runners for that event with
their match status.

  --------------- --------------------------------------------------------------------------------------------------------
  **Section**     **Content**
  Event Header    Name, date, distance, location, NYRR link, processing status
  Stats Row       Total runners \| MMR runners \| Matched \| Unmatched \| Not-member
  Runners Table   Sortable/filterable: name, bib, age, gender, time, place, team, match status badge, linked member name
  Filter Bar      Dropdown: All \| MMR Only \| Matched \| Unmatched \| Not-Member
  Quick Match     Click an unmatched runner → opens candidate picker (same as annotation UI)
  --------------- --------------------------------------------------------------------------------------------------------

7.3 Match Review Tab (/admin/nyrr/match-review)

The human annotation interface. Two-panel layout:

**Left Panel --- Unmatched Runners**

-   Filtered list: team\_code = \"MMR\" AND match\_method =
    \"unmatched\".

-   Grouped by event. Each card: runner name, age, gender, event, date.

-   Badge showing total queue size.

**Right Panel --- Member Candidates**

-   Activated when admin clicks a runner. Shows MMR members matching by
    last name.

-   Candidate cards ranked by: last name match (required), first name
    substring, YearBorn proximity, gender match.

-   Each card shows: member name, ID, email, YearBorn (or guess),
    status, last event.

-   Actions: select a candidate (confirms match), \"Not a member\"
    (marks not\_member), \"Skip\" (leaves for later).

**Admin NYRRRunnerName Edit:** The annotation UI also lets admins
directly edit a member's NYRRRunnerName field. This handles cases where
the admin knows the NYRR name but the system didn't auto-match (e.g.,
the member recently changed their name). The edit triggers a full
backfill across all events.

7.4 Member NYRR Profile (/admin/nyrr/members/\[id\])

Admin view of a member's NYRR data. Shows:

-   NYRRRunnerName (editable by admin), YearBorn, YearBornGuess.

-   Full race history pulled from nyrr\_event\_runners where
    mmr\_member\_id matches.

-   Option to unlink (clear mmr\_member\_id + NYRRRunnerName) if a match
    was incorrect.

8\. Webapp Data Views (Best Practices)

The member-facing and admin-facing views follow these architectural
patterns, aligned with the existing mmr-webapp codebase.

8.1 API Route Design

  ---------------- -------------------------------------------------------------------------------------------------
  **Pattern**      **Implementation**
  Auth             requireSession() + isAdmin() for admin routes; requireSession() for member routes
  Response shape   { ok: true, data: \... } or { error: \"message\" } with appropriate HTTP status
  Pagination       Cursor-based for large lists: ?cursor=\<lastId\>&limit=20. Avoids OFFSET performance issues.
  Filtering        Query params mapped to WHERE clauses with parameterized SQL. Never string concatenation.
  Sorting          Whitelist of allowed sort columns. Default: event\_date DESC.
  Caching          export const dynamic = \"force-dynamic\" on admin routes. Consider revalidate on public routes.
  Error handling   try/catch with typed errors. Log to console.error. Return 500 with generic message.
  ---------------- -------------------------------------------------------------------------------------------------

8.2 API Routes

  ------------------------------------ ------------ ---------- ---------------------------------------------------------
  **Route**                            **Method**   **Auth**   **Purpose**
  /api/nyrr/events                     GET          Admin      List events with stats, filtering, pagination
  /api/nyrr/events/\[id\]              GET          Admin      Single event detail with all runners
  /api/nyrr/events/\[id\]/runners      GET          Admin      Paginated runner list for an event, with filters
  /api/nyrr/unmatched                  GET          Admin      Unmatched MMR runners across all events (review queue)
  /api/nyrr/candidates/\[lastName\]    GET          Admin      Member candidates for a last name (annotation UI)
  /api/nyrr/match                      POST         Admin      Confirm a runner-to-member match (triggers propagation)
  /api/nyrr/match/\[id\]               DELETE       Admin      Unlink a match
  /api/nyrr/members/\[id\]/edit-name   PATCH        Admin      Edit a member's NYRRRunnerName
  /api/nyrr/stats                      GET          Admin      Dashboard summary stats (counts, percentages)
  /api/nyrr/my-results                 GET          Member     Current member's race history (via mmr\_member\_id)
  /api/nyrr/upcoming                   GET          Public     Upcoming events list (for event countdown widget)
  ------------------------------------ ------------ ---------- ---------------------------------------------------------

8.3 Database Query Patterns

All queries use the existing lib/db/connection.ts pool with
parameterized statements.

-   **Indexed lookups:** nyrr\_events.event\_code,
    nyrr\_events.event\_date, nyrr\_event\_runners.last\_name,
    nyrr\_event\_runners.mmr\_member\_id,
    nyrr\_event\_runners.match\_method.

-   **Dashboard stats:** COUNT + GROUP BY queries on processing\_status
    and match\_method. Consider a materialized summary row updated by
    the sync job if these become expensive.

-   **Member history:** Single indexed query on mmr\_member\_id with
    JOIN to nyrr\_events for event metadata.

-   **Candidate search:** WHERE last\_name = ? on members table. Small
    result set for a club this size; no full-text search needed.

8.4 Frontend Page Structure

  --------------------- ---------------------------- ---------- ------------------------------------------------------
  **Page**              **Route**                    **Auth**   **Components**
  Admin Dashboard       /admin/nyrr                  Admin      Summary cards, status chart, events table, sync log
  Event Detail          /admin/nyrr/events/\[id\]    Admin      Event header, stats, runners table with inline match
  Match Review          /admin/nyrr/match-review     Admin      Two-panel: unmatched list + candidate picker
  Member NYRR Profile   /admin/nyrr/members/\[id\]   Admin      Name editor, race history, unlink button
  My Race History       /member/nyrr                 Member     Personal results table, PR highlights
  Upcoming Events       /events (public)             Public     Event cards with countdown, last-year stats
  --------------------- ---------------------------- ---------- ------------------------------------------------------

9\. GitHub Actions

Follows existing sync workflow pattern: Python 3.11, secrets, MySQL
direct write, log artifacts, failure email.

9.1 sync-nyrr-recurring.yml (Daily)

  --------------- --------------------------------------------------
  **Setting**     **Value**
  Trigger         Daily 4:00 AM UTC + manual dispatch
  Step 1          Discover new events + promote completed
  Step 2          Fetch registrants/results for pending (batch 10)
  Step 3          Run auto-matcher inline (Tier 1 + 2)
  Step 4          Update dashboard counters on nyrr\_events
  Step 5          Verify MySQL row counts
  Timeout         30 min
  Notifications   Email on failure
  --------------- --------------------------------------------------

9.2 sync-nyrr-weekly.yml (Sunday)

  ------------- ------------------------------------------------
  **Setting**   **Value**
  Trigger       Sunday 2:00 AM UTC + manual dispatch
  Purpose       Full backfill + club standings update
  Extra         Fetch ClubStandings data for seasonal rankings
  Timeout       60 min
  ------------- ------------------------------------------------

10\. Implementation Phases

Phase 1: Database + API Client (Week 1--2)

1.  Migration 0007: nyrr\_events, nyrr\_event\_runners,
    nyrr\_processing\_log.

2.  Migration 0008: YearBornGuess on members.

3.  Port to basecamp/python/nyrr\_api.py --- full endpoint coverage
    including awards and standings.

4.  Unit tests with mocked responses. Deploy migrations to Azure.

Phase 2: Sync Script + Auto-Matcher (Week 2--3)

5.  sync\_nyrr\_events.py: discovery, ingestion, promotion, inline Tier
    1+2 matching.

6.  GitHub Actions workflows (daily + weekly).

7.  Test with manual dispatch.

Phase 3: Admin Dashboard + Annotation UI (Week 3--4)

8.  Admin overview page: summary cards, events table, sync log.

9.  Event detail view with runner table and inline quick-match.

10. Two-panel match review page with candidate ranking.

11. Admin NYRRRunnerName editing with backfill propagation.

12. API routes for all admin operations.

Phase 4: Historical Backfill (Week 4)

13. One-time backfill of all NYRR events.

14. Run auto-matcher on historical data. Admin clears initial queue.

15. Verify vs. Google Sheets.

Phase 5: Member Portal + Photos (Week 5--6)

16. \"My Race History\" page for members.

17. Upcoming events with countdown.

18. bib\_analyzer.py queries nyrr\_event\_runners for photo linking.

Phase 6: Decommission GAS (Week 6+)

19. Disable GAS triggers after 2+ weeks reliable Actions.

20. Archive web-apps/gas/nyrr/.

11\. Risks and Mitigations

  ---------------------------- ------------ ----------------------------------------------------------------------------
  **Risk**                     **Impact**   **Mitigation**
  NYRR API changes             High         Rate limiting, retries, response validation. Monitor for breaking changes.
  RunnerID instability         Medium       Match by name, not ID. Propagate via NYRRRunnerName.
  False positive matches       Medium       match\_method + matched\_by audit trail. Admin can unlink.
  Large backfill timeout       Medium       Batch with checkpoints. 60-min Actions limit.
  Non-binary gender handling   Low          VARCHAR(10) accommodates M, W, X and future values.
  ---------------------------- ------------ ----------------------------------------------------------------------------

12\. Success Criteria

-   All historical NYRR data in MySQL with zero loss.

-   Daily + weekly Actions run unattended 2+ weeks.

-   Auto-matcher handles 90%+ of MMR runners without human action.

-   Admin review queue stabilizes at \<5 per event.

-   Admin dashboard provides full pipeline visibility with \<1s page
    loads.

-   Bib-to-photo resolution works end-to-end.

-   GAS decommissioned, no regression.
