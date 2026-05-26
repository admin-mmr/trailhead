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
import time
from typing import Any, Dict, Optional

import mysql.connector.errors

from nyrr_api import NyrrFinisher
from nyrr_finisher_splitter import _pace_to_seconds, _seconds_to_pace

logger = logging.getLogger(__name__)

MAX_RETRIES  = 3
RETRY_DELAY  = 2   # seconds between lock-timeout retries

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


class FinisherFetcher:
    """Fetch all finishers for one event using divide-and-conquer age/gender/pace splitting.

    Holds all Step-1 mutable state so the inner helpers can share it without
    Python closures referencing the outer _sync_worker frame.
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

        self._divide_and_conquer(0, 100)
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
    # Reconciliation helper
    # ------------------------------------------------------------------

    def _already_synced(self, expected: int, *, age_from=None, age_to=None,
                        gender=None, pace_min=None, pace_max=None) -> bool:
        """Return True if MySQL already holds `expected` rows for this shard.

        Builds the WHERE clause dynamically so None criteria are omitted.
        Pace strings are zero-padded ("00:MM:SS") so VARCHAR comparison is safe.
        """
        if expected == 0:
            return False
        sql = ("SELECT COUNT(*) FROM nyrr_event_runners "
               "WHERE nyrr_event_id = %s")
        params = [self.event_id]
        if age_from is not None:
            sql += " AND age >= %s";  params.append(age_from)
        if age_to is not None:
            sql += " AND age <= %s";  params.append(age_to)
        if gender is not None:
            sql += " AND gender = %s"; params.append(gender)
        if pace_min is not None and pace_min != "00:00:00":
            sql += " AND pace >= %s";  params.append(pace_min)
        if pace_max is not None:
            sql += " AND pace <= %s";  params.append(pace_max)
        self.cursor.execute(sql, params)
        row = self.cursor.fetchone()
        mysql_count = row[0] if row else 0
        return mysql_count == expected

    # ------------------------------------------------------------------
    # Divide-and-conquer
    # ------------------------------------------------------------------

    # _pace_to_seconds / _seconds_to_pace live in nyrr_finisher_splitter (module-level),
    # imported above — no local copies here.

    def _split_by_pace(self, age_from, age_to, gender, pace_min, pace_max, depth=0):
        """Bisect pace range until each shard <= 500.

        Tracks BOTH pace_min and pace_max (previously only pace_max was
        tracked — right-recursion never narrowed, upper-pace half was
        never fetched, infinite loop on the right side).
        """
        indent = "  " * (depth + 3)
        total = self._probe(age_from=age_from, age_to=age_to, gender=gender,
                            pace_min=pace_min, pace_max=pace_max)
        label = f"age {age_from}-{age_to} gender={gender} pace {pace_min}-{pace_max}"
        logger.info(f"{indent}└─ {label}: {total} items")
        if total == 0:
            return
        if total <= 500:
            if self._already_synced(total, age_from=age_from, age_to=age_to,
                                    gender=gender, pace_min=pace_min, pace_max=pace_max):
                logger.info(f"{indent}└─ ⏭️  {label}: {total} already in DB, skipping")
                return
            self._upsert_pages(label, age_from=age_from, age_to=age_to, gender=gender,
                               pace_min=pace_min, pace_max=pace_max, sort_desc=False)
        else:
            min_sec = _pace_to_seconds(pace_min)
            max_sec = _pace_to_seconds(pace_max)
            if max_sec - min_sec <= 1:
                if self._already_synced(total, age_from=age_from, age_to=age_to,
                                        gender=gender, pace_min=pace_min, pace_max=pace_max):
                    logger.info(f"{indent}└─ ⏭️  {label}: collapsed range, {total} already in DB, skipping")
                    return
                logger.warning(f"{indent}└─ {label}: range collapsed; fetching anyway")
                self._upsert_pages(label, age_from=age_from, age_to=age_to, gender=gender,
                                   pace_min=pace_min, pace_max=pace_max, sort_desc=False)
                return
            mid_sec = (min_sec + max_sec) // 2
            mid_pace = _seconds_to_pace(mid_sec)
            self._split_by_pace(age_from, age_to, gender, pace_min, mid_pace,  depth + 1)
            self._split_by_pace(age_from, age_to, gender, mid_pace, pace_max,  depth + 1)

    def _divide_and_conquer(self, age_from, age_to, gender=None, depth=0):
        indent = "  " * (depth + 2)
        label = f"age {age_from}-{age_to}" + (f" gender={gender}" if gender else "")
        total = self._probe(age_from=age_from, age_to=age_to, gender=gender)
        logger.info(f"{indent}└─ {label}: totalItems={total}")
        self._update_job(message=f'Step 1: Fetching {label} ({total} runners)...')

        if total == 0:
            return
        if total <= 500:
            if self._already_synced(total, age_from=age_from, age_to=age_to, gender=gender):
                logger.info(f"{indent}└─ ⏭️  {label}: {total} already in DB, skipping")
                return
            self._upsert_pages(label, age_from=age_from, age_to=age_to, gender=gender, sort_desc=False)
        elif age_from == age_to:
            if gender is not None:
                # Already split by gender; split further by pace
                _, max_pace = self._probe(age_from=age_from, age_to=age_to, gender=gender,
                                          sort_column="pace", sort_desc=True, return_pace=True)
                max_pace = max_pace or "00:20:00"
                self._split_by_pace(age_from, age_to, gender,
                                    "00:00:00", max_pace, depth + 1)
            else:
                for g in ("M", "W", "X"):
                    self._divide_and_conquer(age_from, age_to, gender=g, depth=depth + 1)
                # Catch runners with no/blank gender
                total_all = self._probe(age_from=age_from, age_to=age_to)
                gendered  = sum(self._probe(age_from=age_from, age_to=age_to, gender=g) for g in ("M", "W", "X"))
                if total_all > gendered:
                    self._upsert_pages(f"age {age_from} ungendered asc",  age_from=age_from, age_to=age_to, sort_desc=False)
                    self._upsert_pages(f"age {age_from} ungendered desc", age_from=age_from, age_to=age_to, sort_desc=True)
        else:
            mid = (age_from + age_to) // 2
            self._divide_and_conquer(age_from, mid,   gender=gender, depth=depth + 1)
            self._divide_and_conquer(mid + 1, age_to, gender=gender, depth=depth + 1)

        self._update_job(rows_written=self.rows_written)

    # ------------------------------------------------------------------
    # Job state helper
    # ------------------------------------------------------------------

    def _update_job(self, **kwargs: Any) -> None:
        with self._lock:
            job = self._jobs.get(self.event_code)
            if job is not None:
                job.update(kwargs)
