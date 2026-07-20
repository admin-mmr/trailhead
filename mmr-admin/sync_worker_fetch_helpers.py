"""
Divide-and-conquer + reconciliation mixin for sync_worker_fetch.FinisherFetcher.

Split out of sync_worker_fetch.py (CLAUDE.md 400-LOC hard rule). Holds the
recursive age/gender/pace splitting and the DB reconciliation cache. These are
pure methods on the fetcher — they rely on attributes and helpers
(`self._probe`, `self._upsert_pages`, `self._update_job`, `self.cursor`, …)
provided by FinisherFetcher, so they live in a mixin the class inherits from.
No behavior change.
"""

from __future__ import annotations

import logging
from typing import Dict

from nyrr_finisher_splitter import _pace_to_seconds, _seconds_to_pace

logger = logging.getLogger(__name__)


class FinisherFetcherSplitMixin:
    """Reconciliation cache + divide-and-conquer for FinisherFetcher.

    Not instantiated on its own — mixed into FinisherFetcher, which supplies
    the state (`self._db_cache`, `self.cursor`, `self.event_id`, …) and the
    low-level `_probe` / `_upsert_pages` / `_update_job` helpers.
    """

    # ------------------------------------------------------------------
    # Reconciliation helpers
    # ------------------------------------------------------------------

    def _build_db_cache(self) -> None:
        """Load per-(age, gender) row counts into self._db_cache in one query.

        Called once before divide-and-conquer starts. Lets _already_synced
        answer age/gender questions without extra DB round-trips — eliminates
        redundant probes when a shard was partially synced in a prior run.
        """
        self.cursor.execute(
            "SELECT age, gender, COUNT(*) "
            "FROM nyrr_event_runners "
            "WHERE nyrr_event_id = %s "
            "GROUP BY age, gender",
            (self.event_id,),
        )
        cache: Dict[tuple, int] = {}
        for age, gender, cnt in self.cursor.fetchall():
            cache[(age, gender)] = cnt
        self._db_cache = cache
        total_cached = sum(cache.values())
        logger.debug(f"  └─ DB cache built: {len(cache)} (age,gender) buckets, "
                     f"{total_cached} rows total")

    def _cached_count(self, *, age_from=None, age_to=None, gender=None) -> int:
        """Sum cache entries matching the given age range and optional gender."""
        total = 0
        for (age, g), cnt in self._db_cache.items():
            if age_from is not None and age < age_from:
                continue
            if age_to is not None and age > age_to:
                continue
            if gender is not None and g != gender:
                continue
            total += cnt
        return total

    def _already_synced(self, expected: int, *, age_from=None, age_to=None,
                        gender=None, pace_min=None, pace_max=None) -> bool:
        """Return True if MySQL already holds `expected` rows for this shard.

        For age/gender queries uses the in-memory cache (built once at run
        start) to avoid extra DB round-trips. Falls through to a live DB
        query only for pace-range sub-shards, which the cache doesn't track.
        """
        if expected == 0:
            return False
        # Pace queries: cache has no pace granularity — hit DB directly.
        if pace_min is not None or pace_max is not None:
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
            return (row[0] if row else 0) == expected
        # Age/gender queries: use cache.
        if self._db_cache is not None:
            return self._cached_count(age_from=age_from, age_to=age_to,
                                      gender=gender) == expected
        # Cache not ready (shouldn't happen) — fall back to DB.
        sql = ("SELECT COUNT(*) FROM nyrr_event_runners "
               "WHERE nyrr_event_id = %s")
        params = [self.event_id]
        if age_from is not None:
            sql += " AND age >= %s";  params.append(age_from)
        if age_to is not None:
            sql += " AND age <= %s";  params.append(age_to)
        if gender is not None:
            sql += " AND gender = %s"; params.append(gender)
        self.cursor.execute(sql, params)
        row = self.cursor.fetchone()
        return (row[0] if row else 0) == expected

    # ------------------------------------------------------------------
    # Divide-and-conquer
    # ------------------------------------------------------------------

    # _pace_to_seconds / _seconds_to_pace live in nyrr_finisher_splitter (module-level),
    # imported above — no local copies here.

    def _budget_exhausted(self) -> bool:
        """True once this run has spent its probe budget. Latches _budget_hit
        and warns once so the recursion can unwind without spamming logs."""
        if self._probe_count < self.probe_budget:
            return False
        if not self._budget_hit:
            self._budget_hit = True
            logger.warning(
                "  └─ ⛔ probe budget (%d) reached for %s after %d rows — "
                "pausing divide & conquer. Re-run the load to resume "
                "(already-synced shards are skipped).",
                self.probe_budget, self.event_code, self.rows_written,
            )
            self._update_job(message=(
                f'Step 1: probe budget ({self.probe_budget}) reached — paused at '
                f'{self.rows_written} rows. Re-run to resume.'))
        return True

    def _split_by_pace(self, age_from, age_to, gender, pace_min, pace_max, depth=0):
        """Bisect pace range until each shard <= 500.

        Tracks BOTH pace_min and pace_max (previously only pace_max was
        tracked — right-recursion never narrowed, upper-pace half was
        never fetched, infinite loop on the right side).
        """
        if self._budget_exhausted():
            return
        indent = "  " * (depth + 3)
        total = self._probe(age_from=age_from, age_to=age_to, gender=gender,
                            pace_min=pace_min, pace_max=pace_max)
        label = f"age {age_from}-{age_to} gender={gender} pace {pace_min}-{pace_max}"
        logger.info(f"{indent}└─ {label}: {total} items")
        if total == 0:
            return
        # Shard-level fast path: skip whole subtree if NYRR count == MySQL count.
        # Applies at every depth, so no need to push down to <=500.
        if self._already_synced(total, age_from=age_from, age_to=age_to,
                                gender=gender, pace_min=pace_min, pace_max=pace_max):
            logger.info(f"{indent}└─ ⏭️  {label}: {total} already in DB, skipping subtree")
            return
        if total <= 500:
            self._upsert_pages(label, age_from=age_from, age_to=age_to, gender=gender,
                               pace_min=pace_min, pace_max=pace_max, sort_desc=False)
        else:
            min_sec = _pace_to_seconds(pace_min)
            max_sec = _pace_to_seconds(pace_max)
            if max_sec - min_sec <= 1:
                # Already-synced check at top of function caught this if applicable.
                logger.warning(f"{indent}└─ {label}: range collapsed; fetching anyway")
                self._upsert_pages(label, age_from=age_from, age_to=age_to, gender=gender,
                                   pace_min=pace_min, pace_max=pace_max, sort_desc=False)
                return
            mid_sec = (min_sec + max_sec) // 2
            mid_pace = _seconds_to_pace(mid_sec)
            self._split_by_pace(age_from, age_to, gender, pace_min, mid_pace,  depth + 1)
            self._split_by_pace(age_from, age_to, gender, mid_pace, pace_max,  depth + 1)

    def _divide_and_conquer(self, age_from, age_to, gender=None, depth=0):
        if self._budget_exhausted():
            return
        indent = "  " * (depth + 2)
        label = f"age {age_from}-{age_to}" + (f" gender={gender}" if gender else "")
        total = self._probe(age_from=age_from, age_to=age_to, gender=gender)
        logger.info(f"{indent}└─ {label}: totalItems={total}")
        self._update_job(message=f'Step 1: Fetching {label} ({total} runners)...')

        if total == 0:
            return
        # Shard-level fast path: skip whole subtree if MySQL already matches NYRR.
        if self._already_synced(total, age_from=age_from, age_to=age_to, gender=gender):
            logger.info(f"{indent}└─ ⏭️  {label}: {total} already in DB, skipping subtree")
            return
        if total <= 500:
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
