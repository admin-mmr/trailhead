"""
Tests for sync_worker load_mode gating (V029).

Verifies:
  1. When load_mode='mmr_only', Step 1 (FinisherFetcher) is NOT called.
  2. When FinisherFetcher.run() returns rows_written=0 on a full sync, the
     event is marked 'Error' (not 'Completed').
  3. When FinisherFetcher.run() returns rows_written>0, the event is marked
     'Completed'.
  4. api_sync.py reads load_mode from the DB row and overrides mmr_only.

No live DB or NYRR API required — everything is mocked.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_sync_worker_modes.py -v
"""
from __future__ import annotations

import sys
import os
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, call

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_event(event_id=1, event_code='TEST01', load_mode='full'):
    """Minimal nyrr_events row dict as returned by api_sync query()."""
    return {
        'id': event_id,
        'event_code': event_code,
        'event_name': 'Test Event',
        'event_date': '2025-01-15',
        'is_upcoming': 0,
        'load_mode': load_mode,
    }


def _make_job_after_sync(
    event_code: str,
    rows_written: int,
    mmr_only: bool = False,
) -> dict:
    """
    Run _sync_worker in a thread with heavily mocked dependencies.
    Returns the in-memory job dict once the thread finishes.
    """
    from sync_worker import _sync_worker, _jobs, _jobs_lock

    # Stub DB helpers so we never touch MySQL.
    mock_conn   = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    fake_finisher_fetcher = MagicMock()
    fake_finisher_fetcher.run.return_value = (rows_written, rows_written)
    fake_finisher_fetcher.pages_written = 1

    fake_backfiller = MagicMock()
    fake_backfiller._process_team.return_value = (0, 0)

    fake_client = MagicMock()
    # search_teams returns an empty list so Steps 2+3 trivially complete.
    fake_client.search_teams.return_value = []

    with (
        patch('sync_worker.get_conn', return_value=mock_conn),
        patch('sync_worker.query', side_effect=_mock_query),
        patch('sync_worker.execute', return_value=None),
        patch('sync_worker.FinisherFetcher', return_value=fake_finisher_fetcher),
        patch('sync_worker.TeamBackfiller', return_value=fake_backfiller),
        patch('sync_worker.NyrrApiClient', return_value=fake_client),
        patch('sync_worker._db_final_status', return_value=None),
        patch('sync_worker._db_log_error', return_value=None),
    ):
        # Clear any leftover job state.
        with _jobs_lock:
            _jobs.pop(event_code, None)

        t = threading.Thread(
            target=_sync_worker,
            args=(1, event_code, False, mmr_only),
            daemon=True,
        )
        t.start()
        t.join(timeout=10)

        with _jobs_lock:
            return dict(_jobs.get(event_code, {}))


def _mock_query(sql, params=None):
    """Minimal query stub: returns sensible defaults for DB reads."""
    sql_lower = sql.lower()
    if 'event_name' in sql_lower or 'event_year' in sql_lower:
        return [{'event_name': 'Test Event', 'event_year': 2025}]
    if 'event_date' in sql_lower:
        from datetime import date
        return [{'event_date': date(2025, 1, 15)}]
    if 'count(*) as cnt' in sql_lower:
        return [{'cnt': 0}]
    if 'count(*)' in sql_lower:
        return [{'cnt': 0}]
    return []


# ---------------------------------------------------------------------------
# Test: mmr_only=True → FinisherFetcher.run(mmr_only=True), Steps 2+3 skipped
# ---------------------------------------------------------------------------

def test_mmr_only_calls_fetcher_with_mmr_only_flag():
    """FinisherFetcher.run() must receive mmr_only=True when mmr_only mode is on."""
    from sync_worker import _sync_worker, _jobs, _jobs_lock

    mock_conn   = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    captured_mmr_only = {}

    def fake_run(force_reload, mmr_only=False):
        captured_mmr_only['value'] = mmr_only
        return (5, 5)   # 5 runners written

    fake_fetcher = MagicMock()
    fake_fetcher.run.side_effect = fake_run
    fake_fetcher.pages_written = 1

    fake_client = MagicMock()

    with (
        patch('sync_worker.get_conn', return_value=mock_conn),
        patch('sync_worker.query', side_effect=_mock_query),
        patch('sync_worker.execute', return_value=None),
        patch('sync_worker.FinisherFetcher', return_value=fake_fetcher),
        patch('sync_worker.NyrrApiClient', return_value=fake_client),
        patch('sync_worker._db_final_status', return_value=None),
        patch('sync_worker._db_log_error', return_value=None),
    ):
        with _jobs_lock:
            _jobs.pop('MMRONLY01', None)

        t = threading.Thread(
            target=_sync_worker,
            args=(1, 'MMRONLY01', False, True),   # mmr_only=True
            daemon=True,
        )
        t.start()
        t.join(timeout=10)

    assert captured_mmr_only.get('value') is True, (
        "FinisherFetcher.run() should be called with mmr_only=True"
    )


def test_mmr_only_skips_team_enumeration():
    """When mmr_only=True and rows_written>0, search_teams (Step 2) must NOT be called."""
    from sync_worker import _sync_worker, _jobs, _jobs_lock

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = MagicMock()

    fake_fetcher = MagicMock()
    fake_fetcher.run.return_value = (3, 3)
    fake_fetcher.pages_written = 1

    fake_client = MagicMock()

    with (
        patch('sync_worker.get_conn', return_value=mock_conn),
        patch('sync_worker.query', side_effect=_mock_query),
        patch('sync_worker.execute', return_value=None),
        patch('sync_worker.FinisherFetcher', return_value=fake_fetcher),
        patch('sync_worker.NyrrApiClient', return_value=fake_client),
        patch('sync_worker._db_final_status', return_value=None),
        patch('sync_worker._db_log_error', return_value=None),
    ):
        with _jobs_lock:
            _jobs.pop('MMRONLY02', None)

        t = threading.Thread(
            target=_sync_worker,
            args=(1, 'MMRONLY02', False, True),
            daemon=True,
        )
        t.start()
        t.join(timeout=10)

    fake_client.search_teams.assert_not_called()


def test_mmr_only_completes_when_rows_written():
    """mmr_only sync with rows_written>0 → status='done'."""
    job = _make_job_after_sync('MMRONLY03', rows_written=7, mmr_only=True)
    assert job.get('status') == 'done', f"Expected 'done', got {job.get('status')!r}"


# ---------------------------------------------------------------------------
# Test: full sync, rows_written=0 → Error (not Completed)
# ---------------------------------------------------------------------------

def test_full_sync_zero_rows_marks_error():
    """Full sync returning 0 rows must set status='error', not 'done'."""
    job = _make_job_after_sync('ZEROFULL', rows_written=0, mmr_only=False)
    assert job.get('status') == 'error', (
        f"Expected 'error' when NYRR returns 0 finishers, got {job.get('status')!r}"
    )


def test_full_sync_nonzero_rows_marks_done():
    """Full sync returning >0 rows must set status='done'."""
    job = _make_job_after_sync('NONZERO01', rows_written=42, mmr_only=False)
    assert job.get('status') == 'done', (
        f"Expected 'done' for non-zero rows, got {job.get('status')!r}"
    )


# ---------------------------------------------------------------------------
# Test: api_sync.py reads load_mode and overrides mmr_only
# ---------------------------------------------------------------------------

def test_api_sync_overrides_mmr_only_from_db():
    """api_sync: event with load_mode='mmr_only' must set mmr_only=True
    regardless of what the request body says."""
    import importlib
    import flask

    # Minimal Flask test app
    app = flask.Flask(__name__)
    app.config['TESTING'] = True

    captured = {}

    def fake_start_sync(event_id, event_code, force_reload, mmr_only=False):
        captured['mmr_only'] = mmr_only

    db_row = _make_event(load_mode='mmr_only')

    with (
        patch('api_sync.query', return_value=[db_row]),
        patch('api_sync.start_sync', side_effect=fake_start_sync),
    ):
        import api_sync
        # Re-import to pick up patch
        importlib.reload(api_sync)

        with (
            patch('api_sync.query', return_value=[db_row]),
            patch('api_sync.start_sync', side_effect=fake_start_sync),
            patch('api_sync.login_required', lambda f: f),   # bypass auth
        ):
            app.register_blueprint(api_sync.sync_bp)
            with app.test_client() as client:
                resp = client.post(
                    '/api/load/1',
                    json={'force_reload': False, 'mmr_only': False},  # caller passes False
                    content_type='application/json',
                )

    # DB load_mode='mmr_only' should override the caller's mmr_only=False.
    assert captured.get('mmr_only') is True, (
        f"api_sync should derive mmr_only=True from load_mode='mmr_only', "
        f"got mmr_only={captured.get('mmr_only')!r}"
    )
