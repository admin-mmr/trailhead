"""
Contract tests for sync job status strings.

Pins the backend status vocabulary ('queued'|'running'|'done'|'error') and
the server-side last-import chain — catching the class of bug where
sync_jobs emits 'done' but a consumer filters for 'completed', causing
"Last imported: Never" even after a successful sync.

Architecture note: operation/completedAt live only in the MySQL sync_jobs
table (Operation, CompletedAt); the in-memory dicts no longer carry them.
PaymentsPanel reads GET /api/sync/last-import and polls via
window.pollUntilDone — there is no client-side job filtering anymore.

No live DB required — MySQL writes are asserted via a mocked db.execute.

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

STATIC_DIR   = pathlib.Path(__file__).parent.parent / 'static'
TEMPLATES_DIR = pathlib.Path(__file__).parent.parent / 'templates'
PAYMENTS_JS  = STATIC_DIR / 'PaymentsPanel.js'
SYNC_PANEL   = TEMPLATES_DIR / 'sync-panel.html'
INDEX_HTML   = TEMPLATES_DIR / 'index.html'
SYNC_RUNNERS = pathlib.Path(__file__).parent.parent / 'sync_runners.py'
SYNC_JOBS_PY  = pathlib.Path(__file__).parent.parent / 'sync_jobs.py'

VALID_TERMINAL_STATUSES = {'done', 'error'}
VALID_ALL_STATUSES      = {'queued', 'running', 'done', 'error'}


# ---------------------------------------------------------------------------
# 0. Server-side last-import contract.
#
#    The 'Last imported: Never' display no longer filters jobs client-side.
#    Since commit 8d81782 the in-memory job dicts carry no operation/completedAt
#    — those live only in the MySQL sync_jobs table (Operation, CompletedAt),
#    and PaymentsPanel reads GET /api/sync/last-import instead.
#
#    The chain that must not break:
#      launch_job persists Operation → update_job stamps CompletedAt on
#      done/error → /api/sync/last-import selects Operation='import_transactions'
#      AND Status='done' → returns Unix SECONDS → PaymentsPanel reads
#      r.completedAt and multiplies by 1000 for new Date().
# ---------------------------------------------------------------------------

class TestServerSideLastImportContract:

    def test_launch_job_persists_operation_to_mysql(self):
        """launch_job must write Operation to sync_jobs — /api/sync/last-import
        filters on it, so a job inserted without it never counts as an import."""
        from unittest.mock import MagicMock
        from sync_jobs import launch_job

        done = threading.Event()
        def noop(job_id): done.set()

        db_execute = MagicMock()
        with patch(_DB_PATCH, return_value=db_execute):
            launch_job(noop, initial_message='test', operation='import_transactions')
        done.wait(timeout=3)

        assert db_execute.called, "launch_job must INSERT into sync_jobs"
        sql, params = db_execute.call_args[0]
        assert 'Operation' in sql
        assert 'import_transactions' in params, (
            f"launch_job must pass the operation into the INSERT params. Got: {params}"
        )

    def test_update_job_stamps_completed_at_on_done(self):
        """update_job(status='done') must set CompletedAt=NOW() in MySQL.
        Without it, /api/sync/last-import's CompletedAt IS NOT NULL filter never
        matches — 'Last imported: Never' shows even after a successful sync."""
        from unittest.mock import MagicMock
        from sync_jobs import update_job

        db_execute = MagicMock()
        with patch(_DB_PATCH, return_value=db_execute):
            update_job('any-job-id', status='done', message='finished', progress=100)

        assert db_execute.called
        sql = db_execute.call_args[0][0]
        assert 'CompletedAt = NOW()' in sql, (
            f"update_job must stamp CompletedAt when status='done'. SQL was: {sql}"
        )

    def test_update_job_stamps_completed_at_on_error(self):
        from unittest.mock import MagicMock
        from sync_jobs import update_job

        db_execute = MagicMock()
        with patch(_DB_PATCH, return_value=db_execute):
            update_job('any-job-id', status='error', message='boom')

        sql = db_execute.call_args[0][0]
        assert 'CompletedAt = NOW()' in sql

    def test_update_job_no_completed_at_while_running(self):
        """Non-terminal updates must NOT stamp CompletedAt — a running job that
        already shows a completion time would report imports that never finished."""
        from unittest.mock import MagicMock
        from sync_jobs import update_job

        db_execute = MagicMock()
        with patch(_DB_PATCH, return_value=db_execute):
            update_job('any-job-id', status='running', message='working')

        sql = db_execute.call_args[0][0]
        assert 'CompletedAt' not in sql, (
            f"update_job must not stamp CompletedAt for status='running'. SQL was: {sql}"
        )

    def test_last_import_endpoint_returns_unix_seconds(self, client, mock_query):
        """/api/sync/last-import must return Unix SECONDS — PaymentsPanel does
        ts*1000 before new Date(); emitting milliseconds would display wrong dates."""
        from datetime import datetime
        completed = datetime(2026, 7, 1, 12, 0, 0)
        mock_query.return_value = [{'CompletedAt': completed}]

        r = client.get('/api/sync/last-import')
        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert j['completedAt'] == completed.timestamp()
        assert j['completedAt'] < 1e12, (
            "completedAt looks like milliseconds — backend must emit seconds"
        )

    def test_last_import_sql_filters_done_import_transactions(self, client, mock_query):
        """The endpoint's SQL must filter Status='done' (backend vocabulary — the
        original bug was filtering on 'completed') and Operation='import_transactions'."""
        from datetime import datetime
        mock_query.return_value = [{'CompletedAt': datetime(2026, 7, 1)}]

        client.get('/api/sync/last-import')

        sql, params = mock_query.call_args[0]
        assert "Status = 'done'" in sql, (
            f"last-import must filter Status = 'done', never 'completed'. SQL: {sql}"
        )
        assert 'import_transactions' in params
        assert 'CompletedAt IS NOT NULL' in sql

    def test_last_import_falls_back_to_gmail_timestamp(self, client, mock_query):
        """With no sync_jobs record (e.g. after a DB wipe), the endpoint must fall
        back to MAX(Timestamp) in gmail_transactions rather than returning None."""
        from datetime import datetime
        latest_tx = datetime(2026, 6, 15, 8, 30, 0)

        def qside(sql, *a, **kw):
            if 'sync_jobs' in sql:
                return []
            return [{'ts': latest_tx}]

        mock_query.side_effect = qside
        r = client.get('/api/sync/last-import')
        j = r.get_json()
        assert j['ok'] is True
        assert j['completedAt'] == latest_tx.timestamp()

    def test_last_import_returns_none_when_no_data(self, client, mock_query):
        """No jobs and no transactions → ok:true with completedAt:null (the frontend
        renders 'Never') — not a 500."""
        mock_query.return_value = []
        r = client.get('/api/sync/last-import')
        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert j['completedAt'] is None


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

    def test_payments_panel_reads_last_import_endpoint(self):
        """
        fetchLastSync must read GET /api/sync/last-import and use r.completedAt.
        The 'done' filtering moved server-side (the endpoint's SQL filters
        Status='done' — pinned in TestServerSideLastImportContract); the old
        client-side jobs filter is gone by design.
        """
        assert PAYMENTS_JS.exists(), f"PaymentsPanel.js not found at {PAYMENTS_JS}"
        src = PAYMENTS_JS.read_text()

        assert '/api/sync/last-import' in src, (
            "PaymentsPanel.js fetchLastSync must call /api/sync/last-import. "
            "Filtering /api/sync/jobs client-side misses jobs after a process "
            "restart (in-memory store is empty) — 'Last imported: Never'."
        )
        assert 'completedAt' in src, (
            "PaymentsPanel.js must read r.completedAt from the last-import "
            "response to populate the Last imported display."
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

    def test_no_raw_setinterval_polling(self):
        """
        PaymentsPanel.js must not manage its own setInterval — all job polling
        goes through window.pollUntilDone (CLAUDE.md polling pattern), whose
        stop-on-'done' behaviour is pinned by TestPollUntilDoneUtility. A raw
        setInterval here is how the poll-forever-after-success bug came back
        once already ('completed' vs 'done' vocabulary drift).
        """
        src = PAYMENTS_JS.read_text()
        assert 'setInterval' not in src, (
            "PaymentsPanel.js must not use a raw setInterval for job polling — "
            "delegate to window.pollUntilDone (defined in index.html)."
        )
        assert 'pollUntilDone' in src

    def test_poll_stop_condition_not_done_only_via_completed(self):
        """
        pollSyncJob must not rely solely on 'completed' to stop — it must use
        window.pollUntilDone, which checks for 'done'. If it still has its own
        setInterval, that block must include 'done' in the stop condition.
        """
        src = PAYMENTS_JS.read_text()
        # After the refactor, the correct check is that pollUntilDone is used
        # (which handles 'done' internally). A direct setInterval that only checks
        # 'completed' is the bug pattern.
        if 'pollUntilDone' in src:
            # Delegating to utility — pass, it handles 'done' correctly.
            return
        # Legacy path: own setInterval must include 'done'
        assert "'done'" in src, (
            "pollSyncJob must check for status 'done' (backend vocabulary). "
            "Checking only 'completed' means the interval never stops."
        )

    def test_ui_refresh_triggered_on_done(self):
        """
        Regression: fetchLastSync() and loadAll() must fire on sync success.
        After the refactor, PaymentsPanel delegates to pollUntilDone whose
        onDone callback must call both.
        """
        src = PAYMENTS_JS.read_text()
        # After refactor: onDone callback in pollSyncJob must call fetchLastSync + loadAll
        assert 'fetchLastSync' in src, "fetchLastSync() must be called on sync success"
        assert 'loadAll' in src, "loadAll() must be called on sync success"
        # They must be in the onDone callback, not gated on 'completed'
        on_done_idx = src.find('onDone')
        if on_done_idx != -1:
            on_done_block = src[on_done_idx:on_done_idx + 200]
            assert 'fetchLastSync' in on_done_block or 'loadAll' in on_done_block, (
                "onDone callback in pollSyncJob must call fetchLastSync() and/or loadAll(). "
                "Without this, the payments panel never refreshes after a successful sync."
            )

    def test_ui_refresh_not_gated_solely_on_completed(self):
        """
        Regression: the refresh branch must not be `if (status === 'completed')` only.
        Backend emits 'done', so that gate means fetchLastSync/loadAll are never called.
        """
        src = PAYMENTS_JS.read_text()

        lines = src.splitlines()
        for i, line in enumerate(lines):
            if 'fetchLastSync' in line:
                # Scan the few lines before for the guarding if
                context = lines[max(0, i - 4):i + 1]
                for ctx_line in context:
                    stripped = ctx_line.strip()
                    if stripped.startswith('if') and 'completed' in stripped and "'done'" not in stripped:
                        pytest.fail(
                            f"fetchLastSync is gated solely on 'completed': {stripped!r}. "
                            "Backend emits 'done', so this branch never executes. "
                            "Add \"|| status === 'done'\" to the condition."
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


# ---------------------------------------------------------------------------
# 4. Backend TTL expiry — status endpoint returns 404 for stale terminal jobs
# ---------------------------------------------------------------------------

SYNC_ROUTES = pathlib.Path(__file__).parent.parent / 'api_sheets_sync_routes.py'


class TestJobTTLExpiry:

    def test_ttl_constant_defined_in_routes(self):
        """
        api_sheets_sync_routes.py must define _JOB_TTL_SECONDS so stale completed
        jobs return 404 instead of 200, stopping any frontend poller regardless of
        which code version is running in the browser.
        """
        src = SYNC_ROUTES.read_text()
        assert '_JOB_TTL_SECONDS' in src, (
            "api_sheets_sync_routes.py must define _JOB_TTL_SECONDS. "
            "Without a TTL, completed jobs are served forever, causing infinite polling loops."
        )

    def test_ttl_value_is_reasonable(self):
        """TTL must be between 60 and 3600 seconds (1 min – 1 hour)."""
        src = SYNC_ROUTES.read_text()
        match = re.search(r'_JOB_TTL_SECONDS\s*=\s*(\d+)', src)
        assert match, "_JOB_TTL_SECONDS must be assigned an integer value"
        ttl = int(match.group(1))
        assert 60 <= ttl <= 3600, (
            f"_JOB_TTL_SECONDS={ttl} is outside the sensible range [60, 3600]. "
            "Too low and legitimate long-running jobs expire mid-poll; too high and "
            "stale pollers keep hammering the backend."
        )

    def test_status_endpoint_returns_404_for_expired_jobs(self):
        """
        api_sync_status must return 404 (not 200) when a terminal job exceeds TTL.
        This stops any frontend poller via the !r.ok code path.
        """
        src = SYNC_ROUTES.read_text()
        # The handler must check age against TTL and return a 404 response
        assert '_JOB_TTL_SECONDS' in src, "TTL constant must exist in routes"
        assert '404' in src, "status endpoint must return 404 for expired jobs"
        assert 'age' in src or 'updatedAt' in src or 'completedAt' in src, (
            "status endpoint must compute job age to decide expiry"
        )

    def test_payments_panel_uses_poll_until_done(self):
        """
        pollSyncJob must delegate to window.pollUntilDone rather than managing
        its own setInterval. This ensures all edge cases (TTL expiry, network errors,
        max-poll cap) are handled by the single shared utility.
        """
        src = PAYMENTS_JS.read_text()
        assert 'pollUntilDone' in src, (
            "PaymentsPanel.js must call window.pollUntilDone instead of managing "
            "its own setInterval. Direct setInterval usage bypasses the shared "
            "error-handling and TTL-expiry logic."
        )

    def test_sync_panel_uses_poll_until_done(self):
        """
        sync-panel.html's pollJobStatus must also delegate to window.pollUntilDone.
        """
        src = SYNC_PANEL.read_text()
        assert 'pollUntilDone' in src, (
            "sync-panel.html must call window.pollUntilDone instead of its own "
            "setInterval loop. Without this, it has separate error-handling logic "
            "that can drift out of sync with the shared contract."
        )


# ---------------------------------------------------------------------------
# 5. pollUntilDone utility — defined in index.html, handles all stop conditions
# ---------------------------------------------------------------------------

class TestPollUntilDoneUtility:

    def test_utility_defined_in_index_html(self):
        """window.pollUntilDone must be defined in index.html for all components to use."""
        src = INDEX_HTML.read_text()
        assert 'pollUntilDone' in src, (
            "index.html must define window.pollUntilDone. "
            "This is the single source of truth for all sync job polling."
        )

    def test_utility_handles_not_ok(self):
        """pollUntilDone must call onError and stop when !r.ok (e.g. 404 TTL expiry)."""
        src = INDEX_HTML.read_text()
        # Find the pollUntilDone block
        start = src.find('pollUntilDone')
        block = src[start:start + 3000]
        assert '!r.ok' in block or '!r ||' in block, (
            "pollUntilDone must handle !r.ok (404 expired, 401 session) by stopping. "
            "Without this, any !r.ok response loops forever."
        )

    def test_utility_has_max_polls_cap(self):
        """pollUntilDone must have a maxPolls safety cap to prevent infinite loops."""
        src = INDEX_HTML.read_text()
        start = src.find('pollUntilDone')
        block = src[start:start + 3000]
        assert 'maxPolls' in block, (
            "pollUntilDone must accept a maxPolls parameter. "
            "Without a cap, a stuck job (never reaches 'done'/'error') "
            "would poll forever even with all other guards in place."
        )

    def test_utility_handles_network_errors(self):
        """pollUntilDone must catch network/parse errors and stop the interval."""
        src = INDEX_HTML.read_text()
        start = src.find('pollUntilDone')
        block = src[start:start + 3000]
        assert 'catch' in block, (
            "pollUntilDone must have a try/catch around the fetch. "
            "An uncaught network error leaves the interval running."
        )

    def test_utility_stops_on_done(self):
        """pollUntilDone must call onDone and stop when job.status === 'done'."""
        src = INDEX_HTML.read_text()
        start = src.find('pollUntilDone')
        block = src[start:start + 3000]
        assert "'done'" in block, "pollUntilDone must check for status 'done'"
        assert 'onDone' in block, "pollUntilDone must call onDone callback"

    def test_utility_returns_cleanup_function(self):
        """pollUntilDone must return a cleanup function so callers can cancel early."""
        src = INDEX_HTML.read_text()
        start = src.find('pollUntilDone')
        block = src[start:start + 3000]
        assert 'return () =>' in block or 'return function' in block, (
            "pollUntilDone must return a cleanup function. "
            "Without this, callers (e.g. useEffect return) cannot cancel the poller "
            "on component unmount, causing state-update-on-unmounted-component errors."
        )

    def test_payments_panel_calls_cleanup_on_unmount(self):
        """PaymentsPanel useEffect must call the cleanup fn returned by pollUntilDone."""
        src = PAYMENTS_JS.read_text()
        assert 'stopPollRef' in src, (
            "PaymentsPanel.js must store the pollUntilDone cleanup in a ref "
            "(e.g. stopPollRef) so it can be called on unmount."
        )
        # The useEffect cleanup must call stopPollRef.current
        assert 'stopPollRef.current' in src, (
            "PaymentsPanel.js useEffect must call stopPollRef.current() on unmount "
            "to cancel any in-flight poller when the component is removed from the DOM."
        )
