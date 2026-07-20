"""
NYRR Step-1 finisher fetch — divide-and-conquer over the NYRR finishers-filter API.

Split out of sync_worker.py (Bug J — CLAUDE.md 400-LOC hard rule).

Public API
----------
FinisherFetcher(client, event_id, event_code, conn, cursor, jobs, lock)
  .run(force_reload)  →  (rows_written: int, total_finishers: int)
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Optional

import mysql.connector.errors

from nyrr_api import NyrrFinisher
from sync_worker_fetch_helpers import FinisherFetcherSplitMixin

logger = logging.getLogger(__name__)

MAX_RETRIES  = 3
RETRY_DELAY  = 2   # seconds between lock-timeout retries

# Per-run cap on divide-and-conquer probe calls (pageSize=1 totalItems lookups).
# Bounds the worst-case probe explosion on huge events so a single load can't
# monopolize the NYRR API. When the budget is hit the recursion unwinds cleanly
# and keeps whatever rows it fetched; because _already_synced skips subtrees
# that MySQL already holds, simply re-running the load RESUMES from where it
# paused and eventually completes. Override via env for big backfills.
PROBE_BUDGET = int(os.environ.get("NYRR_PROBE_BUDGET", "600"))

# MySQL 5.7-compatible UPSERT (VALUES(col) syntax — no `AS new_row` alias from 8.0.19+)
_UPSERT_SQL = """
    INSERT INTO nyrr_event_runners
      (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
       age, gender, city, state_province, bib_number,
       finish_time, pace, overall_place, gender_place,
       age_grade_time, age_grade_place, age_grade_percent,
       team_code, scan_timestamp)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
    ON DUPLICATE KEY UPDATE
      runner_name       = VALUES(runner_name),
      first_name        = VALUES(first_name),
      last_name         = VALUES(last_name),
      age               = VALUES(age),
      gender            = VALUES(gender),
      city              = VALUES(city),
      state_province    = VALUES(state_province),
      finish_time       = VALUES(finish_time),
      pace              = VALUES(pace),
      overall_place     = VALUES(overall_place),
      gender_place      = VALUES(gender_place),
      age_grade_time    = VALUES(age_grade_time),
      age_grade_place   = VALUES(age_grade_place),
      age_grade_percent = VALUES(age_grade_percent),
      team_code         = COALESCE(VALUES(team_code), team_code),
      scan_timestamp    = NOW()
"""


class FinisherFetcher(FinisherFetcherSplitMixin):
    """Fetch all finishers for one event using divide-and-conquer age/gender/pace splitting.

    Holds all Step-1 mutable state so the inner helpers can share it without
    Python closures referencing the outer _sync_worker frame.

    Divide-and-conquer + reconciliation-cache methods live in
    FinisherFetcherSplitMixin (sync_worker_fetch_helpers.py).
    """

    def __init__(
        self,
        client: Any,
        event_id: int,
        event_code: str,
        conn: Any,
        cursor: Any,
        jobs: Dict[str, Any],
        lock: Any,
        probe_budget: int = PROBE_BUDGET,
    ) -> None:
        self.client       = client
        self.event_id     = event_id
        self.event_code   = event_code
        self.conn         = conn
        self.cursor       = cursor
        self._jobs        = jobs
        self._lock        = lock
        self.rows_written    = 0
        self.pages_written   = 0
        self.total_finishers = 0
        # Probe budget (per run). _probe_count increments on every API probe;
        # _budget_hit latches True once exceeded so recursion unwinds & we warn once.
        self.probe_budget = probe_budget
        self._probe_count = 0
        self._budget_hit  = False
        # Cache: (age, gender) -> row_count, built once at run() start.
        # None = not yet populated.
        self._db_cache: Optional[Dict[tuple, int]] = None

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------

    def run(self, force_reload: bool, mmr_only: bool = False) -> tuple[int, int]:
        """Execute Step 1. Returns (rows_written, total_finishers).

        mmr_only=True: fetch only team MMR runners, skip full divide-and-conquer.
        """
        if force_reload:
            self._preflight_and_delete()

        # Pass 0: MMR members first (teamCode=MMR, covers all ages)
        mmr_total = self._probe(team_code="MMR")
        logger.info(f"  └─ MMR members totalItems={mmr_total}")
        if mmr_total > 0:
            if mmr_total <= 500:
                self._upsert_pages("MMR", team_code="MMR", sort_desc=False)
            else:
                logger.warning(f"  └─ MMR has {mmr_total} members (>500). Fetching both directions.")
                self._upsert_pages("MMR asc",  team_code="MMR", sort_desc=False)
                self._upsert_pages("MMR desc", team_code="MMR", sort_desc=True)
        self._update_job(rows_written=self.rows_written,
                         message=f'Step 1: MMR pass done ({self.rows_written} MMR runners).'
                                 + ('' if mmr_only else ' Starting divide & conquer...'))

        if mmr_only:
            return self.rows_written, mmr_total

        # Pass 1+: divide & conquer the full field by age
        self.total_finishers = self._probe()
        logger.info(f"  └─ Total finishers (all ages) = {self.total_finishers}")
        self._update_job(nyrr_finisher_count=self.total_finishers)

        # Top-level fast path: if MySQL already holds the whole event, skip
        # the entire divide & conquer (saves ~hundreds of API calls on large
        # events that have been ingested before).
        if self.total_finishers > 0 and self._already_synced(self.total_finishers):
            logger.info(f"  └─ ⏭️  Event already fully synced "
                        f"({self.total_finishers} rows), skipping divide & conquer")
            self._update_job(message=f'Step 1: Event already synced '
                                     f'({self.total_finishers} rows). Skipping.')
            return self.rows_written, self.total_finishers

        self._build_db_cache()
        self._divide_and_conquer(0, 100)
        if self._budget_hit:
            logger.warning(
                "  └─ Step 1 paused for %s: probe budget reached at %d/%d runners "
                "after %d probes. Re-run to resume.",
                self.event_code, self.rows_written, self.total_finishers, self._probe_count,
            )
            self._update_job(message=(
                f'Step 1 paused: probe budget ({self.probe_budget}) reached at '
                f'{self.rows_written}/{self.total_finishers} runners. Re-run to resume.'))
        return self.rows_written, self.total_finishers

    # ------------------------------------------------------------------
    # Preflight + destructive delete
    # ------------------------------------------------------------------

    def _preflight_and_delete(self) -> None:
        preflight_total = self.client._post("runners/finishers-filter", {
            "eventCode": self.event_code,
            "pageIndex": 1,
            "pageSize": 1,
        }).get("totalItems", 0)
        if preflight_total <= 0:
            raise RuntimeError(
                f"NYRR API returned 0 finishers for eventCode={self.event_code!r}. "
                f"Refusing destructive reload. Verify event_code format (URL slug vs canonical)."
            )
        logger.info(f"🗑️  force_reload: Deleting runners for event_id={self.event_id} "
                    f"(preflight ok: {preflight_total} finishers)...")
        self.cursor.execute(
            "DELETE FROM nyrr_event_runners WHERE nyrr_event_id = %s", (self.event_id,)
        )
        self.conn.commit()
        logger.debug(f"  └─ Deleted {self.cursor.rowcount} rows")

    # ------------------------------------------------------------------
    # Low-level helpers
    # ------------------------------------------------------------------

    def _probe(self, age_from=None, age_to=None, gender=None, team_code=None,
               pace_min=None, pace_max=None, sort_column="bib",
               sort_desc=False, return_pace=False):
        """Single pageSize=1 call to get totalItems for a filter combination."""
        self._probe_count += 1
        data = self.client._post("runners/finishers-filter", {
            "eventCode": self.event_code,
            "ageFrom":   age_from,
            "ageTo":     age_to,
            "gender":    gender,
            "teamCode":  team_code,
            "paceFrom":  pace_min,
            "paceTo":    pace_max,
            "sortColumn":     sort_column,
            "sortDescending": sort_desc,
            "pageIndex": 1,
            "pageSize":  1,
        })
        if return_pace:
            items = data.get("items", [])
            pace = items[0].get("pace") if items else None
            if pace and pace.count(':') == 1:
                pace = "00:" + pace
            return data.get("totalItems", 0), pace
        return data.get("totalItems", 0)

    def _upsert_pages(self, label, age_from=None, age_to=None, gender=None,
                      team_code=None, pace_min=None, pace_max=None, sort_desc=False):
        """Fetch all pages for a filter set and upsert into DB."""
        for page_num, page_raw in enumerate(self.client._paginate_streaming(
            "runners/finishers-filter",
            {
                "eventCode":      self.event_code,
                "ageFrom":        age_from,
                "ageTo":          age_to,
                "gender":         gender,
                "teamCode":       team_code,
                "paceFrom":       pace_min,
                "paceTo":         pace_max,
                "sortColumn":     "bib",
                "sortDescending": sort_desc,
            },
        ), 1):
            page_runners = [NyrrFinisher.from_api(item) for item in page_raw]
            row_tuples = [
                (
                    self.event_id,
                    str(r.runner_id),
                    f"{r.first_name} {r.last_name}".strip(),
                    r.first_name, r.last_name,
                    r.age, r.gender,
                    getattr(r, 'city', '') or '',
                    r.state_province, r.bib,
                    r.overall_time, r.pace,
                    r.overall_place, r.gender_place,
                    getattr(r, 'age_grade_time', '') or '',
                    getattr(r, 'age_grade_place', None),
                    getattr(r, 'age_grade_percent', None),
                    team_code,  # None for general passes; 'MMR' for Pass 0
                )
                for r in page_runners
            ]

            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    t0 = time.time()
                    self.cursor.executemany(_UPSERT_SQL, row_tuples)
                    self.conn.commit()
                    elapsed = time.time() - t0
                    self.rows_written  += len(row_tuples)
                    self.pages_written += 1
                    break
                except mysql.connector.errors.DatabaseError as e:
                    if e.errno == 1205 and attempt < MAX_RETRIES:
                        logger.warning(f"  └─ Lock timeout [{label}] page {page_num} "
                                       f"attempt {attempt}/{MAX_RETRIES}, retrying...")
                        self.conn.rollback()
                        time.sleep(RETRY_DELAY * attempt)
                    else:
                        raise

            logger.debug(f"  └─ [{label}] page {page_num}: {len(row_tuples)} rows in {elapsed:.3f}s, "
                         f"total={self.rows_written}")

            with self._lock:
                if self._jobs.get(self.event_code, {}).get('cancel_requested'):
                    raise InterruptedError("Sync cancelled by user")

    # ------------------------------------------------------------------
    # Job state helper
    # ------------------------------------------------------------------

    def _update_job(self, **kwargs: Any) -> None:
        with self._lock:
            job = self._jobs.get(self.event_code)
            if job is not None:
                job.update(kwargs)
