"""
NYRR Event Sync Worker — Three-step background sync with job tracking.
Handles job state, cancellation, and error reporting.
"""

from __future__ import annotations

import logging
import threading
import time
import traceback
from datetime import datetime
from typing import Any, Dict

import mysql.connector.errors

from db import query, get_conn, execute
from nyrr_api import NyrrApiClient, NyrrFinisher

logger = logging.getLogger(__name__)

# In-flight jobs (event_code -> status dict)
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _process_finishers_batch():
    """Process finishers in batches with divide-and-conquer logic."""
    pass


def _sync_worker(event_id: int, event_code: str, force_reload: bool):
    """
    Background worker: three-step sync.

    Step 1: runners/finishers-filter (paginated, all runners)
    Step 2: teams/search (enumerate teams)
    Step 3: teams/teamRunners (backfill team_code by bib for each team)
    """
    logger.info(f"🚀 Sync worker started: event_id={event_id}, event_code={event_code}, force_reload={force_reload}")
    start_time = time.time()
    client = NyrrApiClient()
    conn = None

    # Initialize job status (must happen before any _jobs access)
    with _jobs_lock:
        _jobs[event_code] = {
            'status': 'running',
            'message': 'Starting three-step sync...',
            'step': 'init',
            'rows_written': 0,
            'teams_processed': 0,
            'started_at': datetime.utcnow().isoformat(),
        }

    try:
        # --- Step 1: Fetch and upsert finishers (streaming, per-page) ---
        logger.info("⏱️  STEP 1: Starting finishers fetch & upsert (streaming)...")
        step1_start = time.time()

        with _jobs_lock:
            _jobs[event_code]['step'] = 'step1_finishers'
            _jobs[event_code]['message'] = 'Step 1: Fetching and upserting finishers from NYRR API...'

        # Connect once for all pages
        conn = get_conn()
        conn.autocommit = False
        cursor = conn.cursor()
        logger.debug(f"  └─ DB connection acquired")

        # Delete if force_reload requested — but ONLY after we've confirmed NYRR has
        # data for this event. Otherwise an empty API response would wipe the table.
        # (Probe is cheap: pageSize=1 totalItems lookup.)
        if force_reload:
            try:
                preflight_total = client._post("runners/finishers-filter", {
                    "eventCode": event_code,
                    "pageIndex": 1,
                    "pageSize": 1,
                }).get("totalItems", 0)
            except Exception as preflight_err:
                logger.error(f"❌ Preflight probe failed for {event_code}: {preflight_err}")
                raise
            if preflight_total <= 0:
                logger.warning(
                    f"⚠️  Skipping DELETE: NYRR returned 0 finishers for eventCode={event_code!r}. "
                    f"Existing rows preserved."
                )
                raise RuntimeError(
                    f"NYRR API returned 0 finishers for eventCode={event_code!r}. "
                    f"Refusing destructive reload. Verify event_code format (URL slug vs canonical)."
                )
            logger.info(f"🗑️  force_reload=True: Deleting existing runners for event_id={event_id} (preflight ok: {preflight_total} finishers)...")
            cursor.execute("DELETE FROM nyrr_event_runners WHERE nyrr_event_id = %s", (event_id,))
            conn.commit()
            logger.debug(f"  └─ Deleted {cursor.rowcount} rows")

        # MySQL 5.7-compatible UPSERT. (The `NEW.col` alias syntax was added in MySQL 8.0.19
        # with `AS new_row`. We're on 5.7, so use the older — still-supported — VALUES(col).)
        upsert_sql = """
            INSERT INTO nyrr_event_runners
              (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
               age, gender, city, state_province, bib_number,
               finish_time, pace, overall_place, gender_place,
               age_grade_time, age_grade_place, age_grade_percent,
               scan_timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON DUPLICATE KEY UPDATE
              runner_name      = VALUES(runner_name),
              first_name       = VALUES(first_name),
              last_name        = VALUES(last_name),
              age              = VALUES(age),
              gender           = VALUES(gender),
              city             = VALUES(city),
              state_province   = VALUES(state_province),
              finish_time      = VALUES(finish_time),
              pace             = VALUES(pace),
              overall_place    = VALUES(overall_place),
              gender_place     = VALUES(gender_place),
              age_grade_time   = VALUES(age_grade_time),
              age_grade_place  = VALUES(age_grade_place),
              age_grade_percent = VALUES(age_grade_percent),
              scan_timestamp   = NOW()
        """

        MAX_RETRIES = 3
        RETRY_DELAY = 2  # seconds
        rows_written = 0
        pages_written = 0

        def _probe(age_from=None, age_to=None, gender=None, team_code=None, pace_min=None, pace_max=None, sort_column="bib", sort_desc=False, return_pace=False):
            """Single pageSize=1 call to get totalItems for a filter combination. Optionally return first item's pace."""
            data = client._post("runners/finishers-filter", {
                "eventCode": event_code,
                "ageFrom": age_from,
                "ageTo": age_to,
                "gender": gender,
                "teamCode": team_code,
                "paceFrom": pace_min,
                "paceTo": pace_max,
                "sortColumn": sort_column,
                "sortDescending": sort_desc,
                "pageIndex": 1,
                "pageSize": 1,
            })
            if return_pace:
                # Extract pace from first item if available
                items = data.get("items", [])
                pace = items[0].get("pace") if items else None
                if pace and pace.count(':') == 1:
                    pace = "00:" + pace
                return data.get("totalItems", 0), pace
            return data.get("totalItems", 0)

        def _upsert_pages(label, age_from=None, age_to=None, gender=None, team_code=None, pace_min=None, pace_max=None, sort_desc=False):
            """Fetch all pages for a given filter set and upsert to DB."""
            nonlocal rows_written, pages_written
            for page_num, page_raw in enumerate(client._paginate_streaming(
                "runners/finishers-filter",
                {
                    "eventCode": event_code,
                    "ageFrom": age_from,
                    "ageTo": age_to,
                    "gender": gender,
                    "teamCode": team_code,
                    "paceFrom": pace_min,
                    "paceTo": pace_max,
                    "sortColumn": "bib",
                    "sortDescending": sort_desc,
                },
            ), 1):
                page_runners = [NyrrFinisher.from_api(item) for item in page_raw]
                row_tuples = []
                for runner in page_runners:
                    full_name = f"{runner.first_name} {runner.last_name}".strip()
                    row_tuples.append((
                        event_id,
                        str(runner.runner_id),
                        full_name,
                        runner.first_name,
                        runner.last_name,
                        runner.age,
                        runner.gender,
                        getattr(runner, 'city', '') or '',
                        runner.state_province,
                        runner.bib,
                        runner.overall_time,
                        runner.pace,
                        runner.overall_place,
                        runner.gender_place,
                        getattr(runner, 'age_grade_time', '') or '',
                        getattr(runner, 'age_grade_place', None),
                        getattr(runner, 'age_grade_percent', None),
                    ))

                for attempt in range(1, MAX_RETRIES + 1):
                    try:
                        batch_start = time.time()
                        cursor.executemany(upsert_sql, row_tuples)
                        conn.commit()
                        batch_elapsed = time.time() - batch_start
                        rows_written += len(row_tuples)
                        pages_written += 1
                        break
                    except mysql.connector.errors.DatabaseError as e:
                        if e.errno == 1205 and attempt < MAX_RETRIES:
                            logger.warning(f"  └─ Lock timeout [{label}] page {page_num}, attempt {attempt}/{MAX_RETRIES}. Retrying in {RETRY_DELAY}s...")
                            conn.rollback()
                            time.sleep(RETRY_DELAY * attempt)
                        else:
                            raise

                logger.debug(f"  └─ [{label}] page {page_num}: {len(row_tuples)} rows in {batch_elapsed:.3f}s, total={rows_written}")

                # Check for cancellation after each page
                with _jobs_lock:
                    if _jobs.get(event_code, {}).get('cancel_requested'):
                        logger.info(f"🛑 Cancel detected mid-fetch [{label}] page {page_num}, rows_written={rows_written}")
                        raise InterruptedError("Sync cancelled by user")

        def _pace_to_seconds(pace_str: str) -> int:
            """Convert MM:SS or 00:MM:SS pace to seconds."""
            parts = pace_str.split(':')
            if len(parts) == 2:
                m, s = int(parts[0]), int(parts[1])
                return m * 60 + s
            elif len(parts) == 3:
                h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
                return h * 3600 + m * 60 + s
            return 0

        def _seconds_to_pace(seconds: int) -> str:
            """Convert seconds to 00:MM:SS pace."""
            m = seconds // 60
            s = seconds % 60
            return f"00:{m:02d}:{s:02d}"

        def _split_by_pace(age_from: int, age_to: int, gender: str, max_pace: str, depth: int = 0):
            """
            Recursively binary-split by pace until each shard <= 500 items.
            Called when age+gender combo is still >1000 after age/gender splitting.
            """
            indent = "  " * (depth + 3)

            # Base case: shard is small enough
            total_pace = _probe(age_from=age_from, age_to=age_to, gender=gender, pace_max=max_pace)
            label_pace = f"age {age_from}-{age_to} gender={gender} pace 00:00-{max_pace}"
            logger.info(f"{indent}└─ {label_pace}: {total_pace} items")

            if total_pace == 0:
                return

            if total_pace <= 500:
                _upsert_pages(label_pace, age_from=age_from, age_to=age_to, gender=gender,
                             pace_min="00:00", pace_max=max_pace, sort_desc=False)
            else:
                # Recursive case: split by pace
                logger.info(f"{indent}└─ Splitting pace range by half...")
                max_sec = _pace_to_seconds(max_pace)
                mid_sec = max_sec // 2
                mid_pace = _seconds_to_pace(mid_sec)

                _split_by_pace(age_from, age_to, gender, mid_pace, depth + 1)
                _split_by_pace(age_from, age_to, gender, max_pace, depth + 1)

        def _divide_and_conquer(age_from: int, age_to: int, gender=None, depth=0):
            """
            Recursively split age range until totalItems <= 1000, then fetch.
            - If <=500: single pass (sortAsc only)
            - If 501-1000: two passes (sortAsc + sortDesc) to guarantee all pages
            - If >1000 and age_from==age_to: split by gender M/W/X + null-gender pass
            - Otherwise: bisect the age range
            """
            indent = "  " * (depth + 2)
            label_base = f"age {age_from}-{age_to}" + (f" gender={gender}" if gender else "")
            total = _probe(age_from=age_from, age_to=age_to, gender=gender)
            logger.info(f"{indent}└─ {label_base}: totalItems={total}")

            with _jobs_lock:
                _jobs[event_code]['message'] = f'Step 1: Fetching age {age_from}-{age_to}{" "+gender if gender else ""} ({total} runners)...'

            if total == 0:
                return

            if total <= 500:
                _upsert_pages(label_base, age_from=age_from, age_to=age_to, gender=gender, sort_desc=False)
            elif age_from == age_to:
                # Can't split further by age — break by gender
                if gender is not None:
                    # Already split by gender and still >1000 — get max pace and split by pace
                    logger.info(f"{indent}⚠️  age={age_from} gender={gender} still {total} items — querying max pace...")
                    # Query sorted by pace descending to get slowest runner's pace
                    total_pace, max_pace = _probe(age_from=age_from, age_to=age_to, gender=gender,
                                                  sort_column="pace", sort_desc=True, return_pace=True)
                    if not max_pace:
                        max_pace = "00:20:00"  # Fallback
                    logger.info(f"{indent}└─ Max pace: {max_pace}")
                    _split_by_pace(age_from, age_to, gender, max_pace, depth=depth + 1)
                else:
                    logger.info(f"{indent}└─ Splitting age={age_from} by gender...")
                    for g in ("M", "W", "X"):
                        _divide_and_conquer(age_from, age_to, gender=g, depth=depth + 1)
                    # Catch runners with no/blank gender
                    total_ungendered = _probe(age_from=age_from, age_to=age_to)
                    mmr_gendered = sum(_probe(age_from=age_from, age_to=age_to, gender=g) for g in ("M", "W", "X"))
                    if total_ungendered > mmr_gendered:
                        logger.info(f"{indent}└─ age={age_from} ungendered pass ({total_ungendered - mmr_gendered} likely)")
                        _upsert_pages(f"age {age_from} ungendered asc",  age_from=age_from, age_to=age_to, sort_desc=False)
                        _upsert_pages(f"age {age_from} ungendered desc", age_from=age_from, age_to=age_to, sort_desc=True)
            else:
                # Bisect the age range
                mid = (age_from + age_to) // 2
                _divide_and_conquer(age_from, mid,      gender=gender, depth=depth + 1)
                _divide_and_conquer(mid + 1, age_to,    gender=gender, depth=depth + 1)

            with _jobs_lock:
                _jobs[event_code]['rows_written'] = rows_written

        # ── Pass 0: MMR members first (teamCode=MMR, covers all ages) ──────────
        mmr_total = _probe(team_code="MMR")
        logger.info(f"  └─ MMR members totalItems={mmr_total}")
        if mmr_total > 0:
            if mmr_total <= 500:
                _upsert_pages("MMR", team_code="MMR", sort_desc=False)
            else:
                logger.warning(f"  └─ MMR has {mmr_total} members (>500). Consider pre-filtering or splitting by district.")
                _upsert_pages("MMR asc",  team_code="MMR", sort_desc=False)
                _upsert_pages("MMR desc", team_code="MMR", sort_desc=True)
        with _jobs_lock:
            _jobs[event_code]['rows_written'] = rows_written
            _jobs[event_code]['message'] = f'Step 1: MMR pass done ({rows_written} rows). Starting divide & conquer...'

        # ── Pass 1+: divide & conquer the full field by age ───────────────────
        total_finishers = _probe()
        logger.info(f"  └─ Total finishers (all ages) = {total_finishers}")

        # Store total_finishers for later update to nyrr_events
        with _jobs_lock:
            _jobs[event_code]['nyrr_finisher_count'] = total_finishers

        _divide_and_conquer(0, 100)

        step1_elapsed = time.time() - step1_start
        logger.info(f"✅ STEP 1 complete: Upserted {rows_written} rows in {step1_elapsed:.2f}s ({rows_written/step1_elapsed:.1f} rows/sec, {pages_written} pages)")

        cursor.close()
        conn.close()
        conn = None
        logger.debug(f"  └─ DB connection closed")

        # --- Step 2: Enumerate all teams ---
        logger.info("⏱️  STEP 2: Fetching team list...")
        step2_start = time.time()

        with _jobs_lock:
            _jobs[event_code]['step'] = 'step2_teams'
            _jobs[event_code]['message'] = 'Step 2: Fetching team list...'

        logger.debug(f"  └─ Calling client.search_teams(event_code={event_code})...")
        teams = client.search_teams(event_code)
        step2_elapsed = time.time() - step2_start

        logger.info(f"✅ STEP 2 complete: {len(teams)} teams found in {step2_elapsed:.2f}s")
        with _jobs_lock:
            _jobs[event_code]['message'] = f'Step 2 complete: Found {len(teams)} teams. Backfilling team_code...'
            _jobs[event_code]['step2_elapsed_sec'] = step2_elapsed

        # --- Step 3: Backfill team_code for each team ---
        logger.info("⏱️  STEP 3: Backfilling team_code for each team...")
        step3_start = time.time()

        with _jobs_lock:
            _jobs[event_code]['step'] = 'step3_backfill'

        conn = get_conn()
        cursor = conn.cursor()
        logger.debug(f"  └─ DB connection acquired for backfill")

        total_backfilled = 0
        total_inserted = 0
        TEAM_BATCH_SIZE = 100  # Batch updates/inserts to avoid lock timeouts

        # Helper: fetch team runners, optionally filtered by age/gender
        def _get_team_runners_filtered(team_code_param, age_from=None, age_to=None, gender=None):
            """
            Fetch team runners with optional age/gender filtering.
            Note: NYRR API doesn't support these filters directly, so we fetch all and filter locally.
            For large teams (>500), this becomes problematic. We paginate locally instead.
            """
            return client.get_team_runners(event_code, team_code_param)

        # Helper: split large teams by age+gender
        def _process_team_runners(team_code_param, all_runners, depth=0):
            """
            If team has >500 runners, recursively split by age and gender.
            """
            indent = "    " * depth

            if len(all_runners) <= 500:
                # Base case: process directly
                logger.debug(f"{indent}├─ Processing {len(all_runners)} runners for {team_code_param}")
                return _upsert_team_runners(team_code_param, all_runners)

            # Recursive case: split by gender first
            logger.info(f"{indent}├─ {team_code_param}: {len(all_runners)} runners > 500, splitting by gender...")

            updates = 0
            inserts = 0

            # Split by gender (M, W, X, None)
            genders = {}
            for runner in all_runners:
                g = runner.gender or 'null'
                if g not in genders:
                    genders[g] = []
                genders[g].append(runner)

            for gender in ('M', 'W', 'X', 'null'):
                if gender in genders and genders[gender]:
                    gender_runners = genders[gender]
                    logger.debug(f"{indent}│ └─ Gender {gender if gender != 'null' else 'unspecified'}: {len(gender_runners)} runners")

                    if len(gender_runners) <= 500:
                        u, i = _upsert_team_runners(team_code_param, gender_runners)
                        updates += u
                        inserts += i
                    else:
                        # Further split by age within this gender
                        logger.info(f"{indent}│   └─ Still > 500, splitting by age groups...")
                        age_groups = {}
                        for runner in gender_runners:
                            age = runner.age or 0
                            age_group = (age // 5) * 5  # Group by 5-year spans
                            if age_group not in age_groups:
                                age_groups[age_group] = []
                            age_groups[age_group].append(runner)

                        for age_group in sorted(age_groups.keys()):
                            age_runners = age_groups[age_group]
                            logger.debug(f"{indent}│   ├─ Age {age_group}-{age_group+4}: {len(age_runners)} runners")
                            u, i = _upsert_team_runners(team_code_param, age_runners)
                            updates += u
                            inserts += i

            return updates, inserts

        # Helper: upsert a list of team runners to DB
        def _upsert_team_runners(team_code_param, runners_list):
            """
            Batch-backfill team_code on existing runner rows; insert any runner Step 1
            missed. Returns (updates_count, inserts_count).

            Strategy:
              1. UPDATE existing rows by (event_id, nyrr_runner_id) — fast path.
              2. For runners not found by UPDATE, INSERT them with team_code populated.
                 (Rare — only happens when Step 1's divide-and-conquer missed a shard.)
            """
            if not runners_list:
                return 0, 0

            update_sql = """
                UPDATE nyrr_event_runners
                SET team_code = %s,
                    scan_timestamp = NOW()
                WHERE nyrr_event_id = %s
                  AND nyrr_runner_id = %s
            """
            insert_sql = """
                INSERT INTO nyrr_event_runners
                  (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
                   age, gender, city, state_province, bib_number,
                   finish_time, pace, overall_place, gender_place,
                   team_code, scan_timestamp)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                  team_code = VALUES(team_code),
                  scan_timestamp = NOW()
            """

            updates = 0
            missing = []

            for runner in runners_list:
                try:
                    cursor.execute(update_sql, (
                        team_code_param,
                        event_id,
                        str(runner.runner_id),
                    ))
                    if cursor.rowcount > 0:
                        updates += cursor.rowcount
                    else:
                        missing.append(runner)
                except mysql.connector.errors.DatabaseError as e:
                    logger.warning(
                        f"  └─ Team-backfill UPDATE failed for runner {runner.runner_id} "
                        f"({team_code_param}): {e}"
                    )

            inserts = 0
            if missing:
                logger.debug(
                    f"  └─ {len(missing)} runners not in Step-1 set for team {team_code_param}; "
                    f"inserting fresh rows."
                )
                for runner in missing:
                    full_name = f"{runner.first_name} {runner.last_name}".strip()
                    try:
                        cursor.execute(insert_sql, (
                            event_id,
                            str(runner.runner_id),
                            full_name,
                            runner.first_name,
                            runner.last_name,
                            runner.age,
                            runner.gender,
                            getattr(runner, 'city', '') or '',
                            runner.state_province,
                            runner.bib,
                            runner.overall_time,
                            runner.pace,
                            runner.overall_place,
                            runner.gender_place,
                            team_code_param,
                        ))
                        inserts += cursor.rowcount or 0
                    except mysql.connector.errors.DatabaseError as e:
                        logger.warning(
                            f"  └─ Team-backfill INSERT failed for runner {runner.runner_id} "
                            f"({team_code_param}): {e}"
                        )

            try:
                conn.commit()
            except Exception:
                conn.rollback()
                raise

            return updates, inserts

        # Process each team
        for team_idx, team in enumerate(teams, 1):
            team_code = team.get('code')
            logger.info(f"  [{team_idx}/{len(teams)}] Processing team: {team_code}")

            with _jobs_lock:
                _jobs[event_code]['message'] = f'Step 3: Processing team {team_idx}/{len(teams)}: {team_code}...'
                _jobs[event_code]['teams_processed'] = team_idx

            try:
                all_runners = _get_team_runners_filtered(team_code)
                u, i = _process_team_runners(team_code, all_runners)
                total_backfilled += u
                total_inserted += i
            except Exception as team_err:
                logger.error(f"  └─ Error processing team {team_code}: {team_err}")

            with _jobs_lock:
                if _jobs.get(event_code, {}).get('cancel_requested'):
                    logger.info(f"🛑 Cancel detected after team {team_code}, teams_processed={team_idx}")
                    raise InterruptedError("Sync cancelled by user")

        step3_elapsed = time.time() - step3_start
        logger.info(f"✅ STEP 3 complete: Backfilled {total_backfilled}, inserted {total_inserted} in {step3_elapsed:.2f}s")

        # --- Final status update ---
        final_count = query(f"SELECT COUNT(*) as cnt FROM nyrr_event_runners WHERE nyrr_event_id = {event_id}")
        final_count_val = final_count[0]['cnt'] if final_count else 0

        elapsed = time.time() - start_time
        logger.info(f"✅ ALL STEPS COMPLETE in {elapsed:.2f}s total")

        with _jobs_lock:
            # 'done' iff we actually wrote runners; otherwise surface as error to the UI
            if rows_written > 0:
                _jobs[event_code]['status'] = 'done'
                _jobs[event_code]['message'] = f'Sync complete: {rows_written} runners, {len(teams)} teams, {total_backfilled} assignments'
            else:
                _jobs[event_code]['status'] = 'error'
                _jobs[event_code]['message'] = (
                    f'NYRR returned 0 finishers for eventCode={event_code!r}. '
                    f'Check event_code format (slug vs canonical).'
                )
                _jobs[event_code]['error_type'] = 'EmptyApiResponse'
            _jobs[event_code]['step'] = 'complete'
            _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()
            _jobs[event_code]['total_elapsed_sec'] = elapsed
            _jobs[event_code]['final_count'] = final_count_val

        # Update nyrr_events with final status.
        # CRITICAL: "Completed" must mean "we actually wrote runner rows", not just "the worker
        # threw no exception". A successful API call that returns 0 finishers is NOT a completion —
        # mark it 'Error' so admins notice (Bug A guard).
        if rows_written > 0:
            final_status = 'Completed'
            final_notes = 'Sync completed successfully'
            log_status = 'Success'
        else:
            final_status = 'Error'
            final_notes = (
                f"NYRR API returned 0 finishers for eventCode={event_code!r}. "
                f"Likely cause: event_code stored as URL slug, but runners/finishers-filter "
                f"expects canonical code. Verify with probe_finishers.py."
            )
            log_status = 'Failed'
            logger.warning(f"⚠️  Marking event as 'Error': rows_written=0 for {event_code}")

        try:
            logger.debug(f"  └─ Updating nyrr_events with final status={final_status}...")
            execute(
                """
                UPDATE nyrr_events
                SET processing_status = %s,
                    finisher_count = %s,
                    notes = %s
                WHERE id = %s
                """,
                (final_status, final_count_val, final_notes, event_id)
            )
            execute(
                """
                INSERT INTO nyrr_processing_log
                  (nyrr_event_id, triggered_by, run_status, rows_written, teams_processed, elapsed_sec, error_details)
                VALUES (%s, 'Viewer', %s, %s, %s, %s, %s)
                """,
                (event_id, log_status, rows_written, len(teams), int(elapsed),
                 None if rows_written > 0 else final_notes)
            )
            logger.debug(f"  └─ Final status recorded in DB ({final_status})")
        except Exception as update_err:
            logger.error(f"  └─ Warning: failed to update final status in DB: {update_err}")

    except (InterruptedError, KeyboardInterrupt) as cancel_err:
        elapsed = time.time() - start_time
        logger.info(f"🛑 Sync cancelled after {elapsed:.2f}s")

        with _jobs_lock:
            _jobs[event_code]['status'] = 'cancelled'
            _jobs[event_code]['message'] = f'Sync cancelled by user after {elapsed:.2f}s'
            _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()
            _jobs[event_code]['total_elapsed_sec'] = elapsed

        try:
            conn2 = get_conn()
            cur2 = conn2.cursor()
            cur2.execute(
                "UPDATE nyrr_events SET processing_status = 'Cancelled', notes = 'User cancelled' WHERE id = %s",
                (event_id,)
            )
            cur2.execute(
                """
                INSERT INTO nyrr_processing_log
                  (nyrr_event_id, triggered_by, run_status, error_details)
                VALUES (%s, 'Viewer', 'Cancelled', 'User requested cancellation')
                """,
                (event_id,)
            )
            conn2.commit()
            cur2.close()
            conn2.close()
            logger.debug(f"  └─ Cancellation recorded in DB")
        except Exception as log_err:
            logger.error(f"  └─ Failed to log cancellation to DB: {log_err}")

    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ Sync FAILED after {elapsed:.2f}s: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())

        error_msg = str(e)[:200]
        if hasattr(e, 'args') and e.args:
            error_msg = f"Invalid data: {error_msg}"
        else:
            error_msg = f"{type(e).__name__}: {error_msg}"

        with _jobs_lock:
            _jobs[event_code]['status'] = 'error'
            _jobs[event_code]['message'] = error_msg[:500]
            _jobs[event_code]['finished_at'] = datetime.utcnow().isoformat()
            _jobs[event_code]['total_elapsed_sec'] = elapsed
            _jobs[event_code]['error_type'] = type(e).__name__

        # Update event status to error
        try:
            logger.debug(f"  └─ Updating nyrr_events and nyrr_processing_log with error...")
            conn2 = get_conn()
            cur2 = conn2.cursor()
            cur2.execute(
                "UPDATE nyrr_events SET processing_status = 'Error', notes = %s WHERE id = %s",
                (str(e)[:500], event_id)
            )
            cur2.execute(
                """
                INSERT INTO nyrr_processing_log
                  (nyrr_event_id, triggered_by, run_status, rows_written, error_details)
                VALUES (%s, 'Viewer', 'Failed', 0, %s)
                """,
                (event_id, str(e)[:2000])
            )
            conn2.commit()
            cur2.close()
            conn2.close()
            logger.debug(f"  └─ Error status recorded in DB")
        except Exception as log_err:
            logger.error(f"  └─ Failed to log error to DB: {log_err}")

    finally:
        if conn:
            try:
                conn.close()
                logger.debug(f"  └─ Final cleanup: closed DB connection")
            except Exception as close_err:
                logger.warning(f"  └─ Error closing final DB connection: {close_err}")
