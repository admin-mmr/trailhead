"""
NYRR finishers-filter divide-and-conquer fetcher (decoupled from any web/DB layer).

Why this module exists
----------------------
NYRR's runners/finishers-filter endpoint caps every query at ~500 rows
(returns HTTP 400 "Please use the advanced filter to find more" past that).
To pull every finisher for a large event (e.g. 25 000 runners), we must
issue many narrow sub-queries whose individual totalItems is under the cap.

This splitter recursively narrows by age range, then gender, then pace until
each leaf shard is fetchable, and yields each page as a list of NyrrFinisher.
The caller decides what to do with each page (upsert, count, etc.) — the
splitter never touches a DB or job-state object.

Adapted from mmr-admin/sync_worker_fetch.py (which uses the same algorithm
but is tied to Flask's _jobs/_lock).  This is the basecamp source of truth;
mmr-admin's variant can later be refactored to delegate here.

Public API
----------
    splitter = FinisherSplitter(client, event_code='B2026')
    for label, page in splitter.iter_pages():
        for runner in page:               # runner is a NyrrFinisher
            upsert_runner(cursor, ..., runner, ...)
        conn.commit()
    print(splitter.total_finishers)       # set after the first probe

Optional progress callback (any kwargs you want to receive):
    splitter = FinisherSplitter(
        client, event_code='B2026',
        progress_cb=lambda **kw: print(kw),
    )
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Iterator, List, Optional, Tuple

from nyrr_api_models import NyrrFinisher

logger = logging.getLogger(__name__)

DEFAULT_TARGET_SIZE = 500          # NYRR's per-query cap
DEFAULT_FALLBACK_MAX_PACE = "00:20:00"
GENDERS = ("M", "W", "X")


def _pace_to_seconds(pace: str) -> int:
    parts = pace.split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    return 0


def _seconds_to_pace(seconds: int) -> str:
    return f"00:{seconds // 60:02d}:{seconds % 60:02d}"


class FinisherSplitter:
    """Iterate every finisher of an event via divide-and-conquer probes."""

    def __init__(
        self,
        client: Any,
        event_code: str,
        *,
        target_size: int = DEFAULT_TARGET_SIZE,
        max_age: int = 100,
        progress_cb: Optional[Callable[..., None]] = None,
        should_skip_shard: Optional[Callable[..., bool]] = None,
    ) -> None:
        self.client            = client
        self.event_code        = event_code
        self.target_size       = target_size
        self.max_age           = max_age
        self.progress_cb       = progress_cb or (lambda **kw: None)
        # Optional callback: receives (age_from, age_to, gender, pace_min,
        # pace_max, expected) and returns True if MySQL already has `expected`
        # rows matching that shard — splitter then skips the entire subtree.
        self.should_skip_shard = should_skip_shard or (lambda **kw: False)
        self.total_finishers   = 0
        self.pages_yielded     = 0
        self.rows_yielded      = 0

    # ------------------------------------------------------------------
    # Public iteration
    # ------------------------------------------------------------------

    def iter_pages(self) -> Iterator[Tuple[str, List[NyrrFinisher]]]:
        """Yield (label, page) tuples — one tuple per under-cap shard page.

        `label` is a short human-readable description of the slice the page
        came from (e.g. "age 30-30 gender=M" or "age 0-100").
        """
        self.total_finishers = self._probe()
        logger.info(
            f"  [splitter] event_code={self.event_code} "
            f"totalItems={self.total_finishers} (cap={self.target_size})"
        )
        self.progress_cb(
            event="probe", label="all", total=self.total_finishers,
        )
        if self.total_finishers == 0:
            return
        # Top-level fast path: if MySQL already holds the full event, skip everything.
        if self.should_skip_shard(expected=self.total_finishers):
            logger.info(
                f"  [splitter] event_code={self.event_code}: "
                f"{self.total_finishers} rows already in DB, skipping entire event"
            )
            return
        yield from self._divide_and_conquer(0, self.max_age, gender=None, depth=0)
        logger.info(
            f"  [splitter] done: {self.pages_yielded} pages, "
            f"{self.rows_yielded} rows yielded "
            f"(server reported total={self.total_finishers})"
        )

    # ------------------------------------------------------------------
    # Low-level probes + page fetch
    # ------------------------------------------------------------------

    def _probe(
        self,
        *,
        age_from: Optional[int] = None,
        age_to: Optional[int] = None,
        gender: Optional[str] = None,
        pace_min: Optional[str] = None,
        pace_max: Optional[str] = None,
        sort_column: str = "bib",
        sort_desc: bool = False,
        return_pace: bool = False,
    ):
        """Single pageSize=1 call returning totalItems (+ first-item pace optionally)."""
        data = self.client._post(
            "runners/finishers-filter",
            {
                "eventCode": self.event_code,
                "ageFrom":   age_from,
                "ageTo":     age_to,
                "gender":    gender,
                "paceFrom":  pace_min,
                "paceTo":    pace_max,
                "sortColumn":     sort_column,
                "sortDescending": sort_desc,
                "pageIndex": 1,
                "pageSize":  1,
            },
        )
        total = data.get("totalItems", 0)
        if return_pace:
            items = data.get("items", [])
            pace = items[0].get("pace") if items else None
            if pace and pace.count(":") == 1:
                pace = "00:" + pace
            return total, pace
        return total

    def _fetch_pages(
        self,
        label: str,
        *,
        age_from: Optional[int] = None,
        age_to: Optional[int] = None,
        gender: Optional[str] = None,
        pace_min: Optional[str] = None,
        pace_max: Optional[str] = None,
        sort_desc: bool = False,
    ) -> Iterator[Tuple[str, List[NyrrFinisher]]]:
        """Stream every page of one shard, yielding (label, page) per page."""
        body = {
            "eventCode":      self.event_code,
            "ageFrom":        age_from,
            "ageTo":          age_to,
            "gender":         gender,
            "paceFrom":       pace_min,
            "paceTo":         pace_max,
            "sortColumn":     "bib",
            "sortDescending": sort_desc,
        }
        page_num = 0
        for raw_page in self.client._paginate_streaming("runners/finishers-filter", body):
            page_num += 1
            page = [NyrrFinisher.from_api(r) for r in raw_page]
            self.pages_yielded += 1
            self.rows_yielded  += len(page)
            self.progress_cb(
                event="page", label=label, page_num=page_num, count=len(page),
                cumulative_rows=self.rows_yielded,
            )
            logger.info(
                f"  [splitter] {label} page {page_num}: "
                f"+{len(page)} runners (cumulative: {self.rows_yielded})"
            )
            yield label, page

    # ------------------------------------------------------------------
    # Divide & conquer over age, then gender, then pace
    # ------------------------------------------------------------------

    def _divide_and_conquer(
        self,
        age_from: int,
        age_to: int,
        gender: Optional[str],
        depth: int,
    ) -> Iterator[Tuple[str, List[NyrrFinisher]]]:
        indent = "  " * (depth + 2)
        label = f"age {age_from}-{age_to}" + (f" gender={gender}" if gender else "")
        total = self._probe(age_from=age_from, age_to=age_to, gender=gender)
        logger.info(f"{indent}[splitter] {label}: totalItems={total}")
        self.progress_cb(event="probe", label=label, total=total)

        if total == 0:
            return
        # Shard-level fast path: if MySQL count for this slice already equals
        # NYRR's total, skip the whole subtree (no need to split to <=target_size).
        if self.should_skip_shard(
            age_from=age_from, age_to=age_to, gender=gender, expected=total,
        ):
            logger.info(f"{indent}[splitter] {label}: {total} already in DB, skipping subtree")
            return
        if total <= self.target_size:
            yield from self._fetch_pages(
                label, age_from=age_from, age_to=age_to, gender=gender,
            )
            return

        if age_from == age_to:
            # Single-year leaf still over cap → split by gender, then pace.
            if gender is not None:
                _, max_pace = self._probe(
                    age_from=age_from, age_to=age_to, gender=gender,
                    sort_column="pace", sort_desc=True, return_pace=True,
                )
                max_pace = max_pace or DEFAULT_FALLBACK_MAX_PACE
                yield from self._split_by_pace(
                    age_from, age_to, gender,
                    pace_min="00:00:00", pace_max=max_pace, depth=depth + 1,
                )
            else:
                for g in GENDERS:
                    yield from self._divide_and_conquer(
                        age_from, age_to, gender=g, depth=depth + 1,
                    )
                # Catch runners NYRR returns with blank/missing gender:
                # if sum(gendered) < total_all, fetch the leftover both ways.
                total_all = self._probe(age_from=age_from, age_to=age_to)
                gendered  = sum(
                    self._probe(age_from=age_from, age_to=age_to, gender=g)
                    for g in GENDERS
                )
                if total_all > gendered:
                    yield from self._fetch_pages(
                        f"age {age_from} ungendered asc",
                        age_from=age_from, age_to=age_to, sort_desc=False,
                    )
                    yield from self._fetch_pages(
                        f"age {age_from} ungendered desc",
                        age_from=age_from, age_to=age_to, sort_desc=True,
                    )
            return

        # Bisect the age range
        mid = (age_from + age_to) // 2
        yield from self._divide_and_conquer(age_from, mid,   gender=gender, depth=depth + 1)
        yield from self._divide_and_conquer(mid + 1, age_to, gender=gender, depth=depth + 1)

    # ------------------------------------------------------------------
    # Pace-bisection terminal splitter
    # ------------------------------------------------------------------

    def _split_by_pace(
        self,
        age_from: int,
        age_to: int,
        gender: str,
        *,
        pace_min: str,
        pace_max: str,
        depth: int,
    ) -> Iterator[Tuple[str, List[NyrrFinisher]]]:
        """Recursively bisect a pace range until each shard is <= target_size.

        CRITICAL: tracks BOTH pace_min and pace_max so the right-half
        recursion narrows properly. (Previously only pace_max was tracked,
        causing infinite loop on the right child AND missing all runners
        in the upper half of the pace range.)
        """
        indent = "  " * (depth + 3)
        total = self._probe(
            age_from=age_from, age_to=age_to, gender=gender,
            pace_min=pace_min, pace_max=pace_max,
        )
        label = f"age {age_from}-{age_to} gender={gender} pace {pace_min}-{pace_max}"
        logger.info(f"{indent}[splitter] {label}: {total} items")

        if total == 0:
            return
        # Shard-level fast path on pace shards too.
        if self.should_skip_shard(
            age_from=age_from, age_to=age_to, gender=gender,
            pace_min=pace_min, pace_max=pace_max, expected=total,
        ):
            logger.info(f"{indent}[splitter] {label}: {total} already in DB, skipping subtree")
            return
        if total <= self.target_size:
            yield from self._fetch_pages(
                label, age_from=age_from, age_to=age_to, gender=gender,
                pace_min=pace_min, pace_max=pace_max,
            )
            return

        # Bisect: left=[pace_min, mid], right=[mid, pace_max]
        min_sec = _pace_to_seconds(pace_min)
        max_sec = _pace_to_seconds(pace_max)
        # Guard against zero-width ranges (would loop forever otherwise)
        if max_sec - min_sec <= 1:
            logger.warning(
                f"{indent}[splitter] {label}: pace range collapsed to <=1s "
                f"but still {total} items > cap. Fetching anyway (will hit "
                f"API limit and stop)."
            )
            yield from self._fetch_pages(
                label, age_from=age_from, age_to=age_to, gender=gender,
                pace_min=pace_min, pace_max=pace_max,
            )
            return

        mid_sec = (min_sec + max_sec) // 2
        mid_pace = _seconds_to_pace(mid_sec)
        yield from self._split_by_pace(
            age_from, age_to, gender,
            pace_min=pace_min, pace_max=mid_pace, depth=depth + 1,
        )
        yield from self._split_by_pace(
            age_from, age_to, gender,
            pace_min=mid_pace, pace_max=pace_max, depth=depth + 1,
        )
