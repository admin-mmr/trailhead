"""
Tests for the per-run probe budget in sync_worker_fetch.FinisherFetcher.

The divide-and-conquer finisher fetch makes a pageSize=1 "probe" for every
age/gender/pace shard. On pathological events this can explode into hundreds of
probes. PROBE_BUDGET caps probes per run; when hit, the recursion unwinds
cleanly and keeps whatever it fetched. Because _already_synced skips subtrees
MySQL already holds, simply re-running the load resumes from the pause point.

Verifies:
  1. A pathological tree (every probe reports "huge") stops near the budget
     instead of running away or hitting Python's recursion limit.
  2. _budget_hit latches True and run() surfaces a "paused" job message.
  3. On re-run, fully-synced subtrees are skipped without any fetch.

No live DB or NYRR API required — _probe / _already_synced / _upsert_pages are
patched. mysql.connector is stubbed by conftest.py.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_sync_worker_budget.py -v
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sync_worker_fetch import FinisherFetcher, PROBE_BUDGET


def _make_fetcher(budget):
    return FinisherFetcher(
        client=None, event_id=1, event_code='TEST',
        conn=None, cursor=None, jobs={}, lock=None, probe_budget=budget,
    )


def test_budget_default_is_positive():
    assert PROBE_BUDGET > 0


def test_pathological_tree_stops_near_budget():
    """Every probe says 'huge', so d&c always tries to split. With a small
    budget it must unwind without a runaway or RecursionError."""
    budget = 50
    f = _make_fetcher(budget)

    def fake_probe(*a, **k):
        f._probe_count += 1  # mirror the real _probe's increment
        return (9999, "00:30:00") if k.get('return_pace') else 9999

    f._probe = fake_probe
    f._already_synced = lambda *a, **k: False
    f._upsert_pages = lambda *a, **k: None
    f._update_job = lambda **k: None
    f._build_db_cache = lambda: None

    sys.setrecursionlimit(10000)
    f._divide_and_conquer(0, 100)

    assert f._budget_hit is True
    # Bounded overshoot: a few extra probes inside an already-entered frame are
    # fine; a runaway is not.
    assert f._probe_count <= budget + 20


def test_budget_message_surfaced_via_update_job():
    """_budget_exhausted should push a 'paused' message once."""
    f = _make_fetcher(1)
    messages = []
    f._update_job = lambda **k: messages.append(k.get('message', ''))
    f._probe_count = 5  # already over budget=1

    assert f._budget_exhausted() is True
    # latched: a second call must not emit again
    assert f._budget_exhausted() is True
    paused = [m for m in messages if 'budget' in m.lower()]
    assert len(paused) == 1


def test_resume_skips_fully_synced_subtree():
    """When MySQL already holds the data, a fresh run fetches nothing."""
    f = _make_fetcher(PROBE_BUDGET)
    f._probe = lambda *a, **k: (9999, "00:30:00") if k.get('return_pace') else 9999
    f._already_synced = lambda *a, **k: True
    f._update_job = lambda **k: None

    def _boom(*a, **k):
        raise AssertionError("should not fetch when shard already synced")

    f._upsert_pages = _boom
    f._divide_and_conquer(0, 100)  # must not raise
    assert f._budget_hit is False
