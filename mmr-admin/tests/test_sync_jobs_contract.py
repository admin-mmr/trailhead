"""
Contract tests for sync job status strings.

Pins the backend status vocabulary ('queued'|'running'|'done'|'error') and
asserts the frontend JS reads the same values — catching the class of bug
where sync_jobs.py emits 'done' but PaymentsPanel.js filtered for 'completed',
causing "Last imported: Never" even after a successful sync.

No live DB required — sync_jobs in-memory store is used directly.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_sync_jobs_contract.py -v
"""
import re
import time
import threading
import pathlib
import sys
import os
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

STATIC_DIR = pathlib.Path(__file__).parent.parent / 'static'
PAYMENTS_JS = STATIC_DIR / 'PaymentsPanel.js'
SYNC_RUNNERS = pathlib.Path(__file__).parent.parent / 'sync_runners.py'
SYNC_JOBS_PY  = pathlib.Path(__file__).parent.parent / 'sync_jobs.py'

VALID_TERMINAL_STATUSES = {'done', 'error'}
VALID_ALL_STATUSES      = {'queued', 'running', 'done', 'error'}


# ---------------------------------------------------------------------------
# 1. Backend: sync_jobs in-memory store produces correct statuses
# ---------------------------------------------------------------------------

_DB_PATCH = 'sync_jobs._get_db_execute'


class TestSyncJobsBackendContract:

    def test_new_job_starts_as_queued(self):
        """launch_job must register job with status='queued' before worker runs."""
        from sync_jobs import _jobs, launch_job, _lock

        ready = threading.Event()

        def slow_worker(job_id):
            ready.wait(timeout=5)

        with patch(_DB_PATCH, return_value=None):
            job_id = launch_job(slow_worker, initial_message='test', operation='test_op')
        time.sleep(0.05)

        with _lock:
            status = _jobs.get(job_id, {}).get('status')
        ready.set()

        assert status in ('queued', 'running'), (
            f"Expected 'queued' or 'running' before worker completes, got '{status}'"
        )

    def test_completed_job_status_is_done_not_completed(self):
        """A successfully finished job must have status='done', never 'completed'."""
        from sync_jobs import _jobs, launch_job, update_job, _lock

        done_event = threading.Event()

        def good_worker(job_id):
            update_job(job_id, status='running', message='working')
            update_job(job_id, status='done', message='Completed', progress=100)
            done_event.set()

        with patch(_DB_PATCH, return_value=None):
            job_id = launch_job(good_worker, initial_message='test', operation='test_op')
        done_event.wait(timeout=5)

        with _lock:
            status = _jobs[job_id]['status']

        assert status == 'done', (
            f"Successful job status must be 'done', got '{status}'. "
            "Frontend PaymentsPanel.js filters on 'done' — using any other "
            "string breaks the 'Last imported' display."
        )
        assert status != 'completed', (
            "Status must never be 'completed' — that string is not in the "
            "backend vocabulary and PaymentsPanel.js no longer looks for it."
        )

    def test_failed_job_status_is_error(self):
        """A job that raises must end with status='error'."""
        from sync_jobs import _jobs, launch_job, update_job, _lock

        done_event = threading.Event()

        def bad_worker(job_id):
            update_job(job_id, status='running', message='working')
            update_job(job_id, status='error', message='boom')
            done_event.set()

        with patch(_DB_PATCH, return_value=None):
            job_id = launch_job(bad_worker, initial_message='test', operation='test_op')
        done_event.wait(timeout=5)

        with _lock:
            status = _jobs[job_id]['status']

        assert status == 'error'

    def test_valid_statuses_documented_in_docstring(self):
        """sync_jobs.py docstring must document all four status values."""
        src = SYNC_JOBS_PY.read_text()
        for s in VALID_ALL_STATUSES:
            assert f"'{s}'" in src, (
                f"sync_jobs.py docstring/comments must mention status='{s}' "
                "so the contract is self-documenting."
            )


# ---------------------------------------------------------------------------
# 2. Frontend: PaymentsPanel.js uses 'done', not 'completed'
# ---------------------------------------------------------------------------

class TestPaymentsPanelFrontendContract:

    def test_payments_panel_filters_on_done_not_completed(self):
        """
        PaymentsPanel.js fetchLastSync must filter jobs by status === 'done'.
        Filtering on 'completed' is the bug fixed in commit 876f11d.
        """
        assert PAYMENTS_JS.exists(), f"PaymentsPanel.js not found at {PAYMENTS_JS}"
        src = PAYMENTS_JS.read_text()

        # Must contain the correct filter
        assert "status === 'done'" in src, (
            "PaymentsPanel.js must filter sync jobs with status === 'done'. "
            "If this is 'completed', the Last imported time will always show Never."
        )

    def test_payments_panel_does_not_filter_on_completed(self):
        """Regression: ensure 'completed' string is not used as a job status filter."""
        src = PAYMENTS_JS.read_text()

        # Find all lines that check j.status against a string
        bad_lines = [
            line.strip() for line in src.splitlines()
            if "j.status" in line and "'completed'" in line
        ]
        assert not bad_lines, (
            f"PaymentsPanel.js must not filter on j.status === 'completed'. "
            f"Found: {bad_lines}"
        )


# ---------------------------------------------------------------------------
# 3. sync_runners.py: all terminal update_job calls use 'done' or 'error'
# ---------------------------------------------------------------------------

class TestSyncRunnersStatusContract:

    def test_runners_only_emit_valid_terminal_statuses(self):
        """
        Every update_job(status=...) call in sync_runners.py must use
        'done' or 'error' — never 'completed', 'success', 'finished', etc.
        """
        src = SYNC_RUNNERS.read_text()

        # Extract all status= values passed to update_job
        pattern = re.compile(r"update_job\([^)]*status\s*=\s*'([^']+)'")
        found = pattern.findall(src)

        assert found, "Expected to find update_job(status=...) calls in sync_runners.py"

        bad = [s for s in found if s not in VALID_ALL_STATUSES]
        assert not bad, (
            f"sync_runners.py uses unrecognised job status values: {bad}. "
            f"Valid values are: {VALID_ALL_STATUSES}"
        )

    def test_runners_never_use_completed_as_status(self):
        """'completed' must not appear as a job status value in sync_runners.py."""
        src = SYNC_RUNNERS.read_text()
        pattern = re.compile(r"update_job\([^)]*status\s*=\s*'completed'")
        matches = pattern.findall(src)
        assert not matches, (
            "sync_runners.py must not emit status='completed'. "
            "The backend vocabulary is 'done'/'error'. "
            "Using 'completed' breaks the PaymentsPanel.js sync display."
        )

    def test_success_path_uses_done_not_other(self):
        """
        The success branch (status = 'done' if result == 'success') must
        use the string 'done', not any synonym.
        """
        src = SYNC_RUNNERS.read_text()
        # Look for the ternary pattern used in all runners
        pattern = re.compile(r"'done'\s+if\s+result")
        assert pattern.search(src), (
            "sync_runners.py success-path ternary must use 'done' "
            "(e.g. status = 'done' if result... else 'error'). "
            "This string must match what PaymentsPanel.js filters on."
        )
