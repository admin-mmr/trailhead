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
# 0. In-memory job dict field contract — the fetchLastSync filter depends on
#    these three fields being present on every job dict:
#      • operation   — must match 'import_transactions' to find the right job
#      • completedAt — must be non-None after terminal status, for sort/filter
#      • status      — must be 'done' for the filter to pass
#
#  Root bugs caught here:
#    a) _make_job omitted 'operation' → j.operation always undefined → filter never matched
#    b) launch_job didn't pass operation into _make_job → same result
#    c) update_job never set completedAt in memory → j.completedAt always None → filter never matched
#    d) fmtSyncTime used new Date(seconds) not new Date(seconds*1000) → displayed 1970 dates
# ---------------------------------------------------------------------------

class TestInMemoryJobFieldContract:

    def test_make_job_includes_operation(self):
        """`_make_job` must include 'operation' so fetchLastSync can filter by operation type."""
        from sync_jobs import _make_job
        job = _make_job('test-id', 'test', 'import_transactions')
        assert 'operation' in job, (
            "_make_job must include 'operation' in the job dict. "
            "Without it, j.operation is undefined in JS and fetchLastSync "
            "filter (j.operation === 'import_transactions') never matches."
        )
        assert job['operation'] == 'import_transactions'

    def test_launch_job_passes_operation_to_dict(self):
        """`launch_job` must store operation on the in-memory dict, not just in MySQL."""
        from sync_jobs import _jobs, launch_job, _lock

        done = threading.Event()
        def noop(job_id): done.set()

        with patch(_DB_PATCH, return_value=None):
            job_id = launch_job(noop, initial_message='test', operation='import_transactions')
        done.wait(timeout=3)

        with _lock:
            job = _jobs.get(job_id, {})
        assert job.get('operation') == 'import_transactions', (
            f"launch_job must pass operation to the in-memory job dict. "
            f"Got: {job.get('operation')!r}. "
            "Without this, fetchLastSync's j.operation filter always fails."
        )

    def test_make_job_includes_completed_at_as_none(self):
        """`_make_job` must include 'completedAt' key (initially None)."""
        from sync_jobs import _make_job
        job = _make_job('test-id', 'test', 'import_transactions')
        assert 'completedAt' in job, (
            "_make_job must include 'completedAt' key (set to None initially). "
            "Without the key, update_job's 'not _jobs[job_id].get(completedAt)' "
            "guard works but JS sort (new Date(undefined)) breaks silently."
        )
        assert job['completedAt'] is None

    def test_update_job_sets_completed_at_in_memory_on_done(self):
        """`update_job` must set completedAt in the in-memory dict when status→done."""
        from sync_jobs import _jobs, launch_job, update_job, _lock

        done_event = threading.Event()
        def worker(job_id):
            update_job(job_id, status='running', message='working')
            update_job(job_id, status='done', message='finished', progress=100)
            done_event.set()

        with patch(_DB_PATCH, return_value=None):
            job_id = launch_job(worker, initial_message='test', operation='import_transactions')
        done_event.wait(timeout=3)

        with _lock:
            job = _jobs.get(job_id, {})

        assert job.get('completedAt') is not None, (
            "update_job must set completedAt in the in-memory dict when status='done'. "
            "Without this, fetchLastSync's j.completedAt filter is always falsy — "
            "'Last imported: Never' shows even after a successful sync."
        )
        assert isinstance(job['completedAt'], float), (
            f"completedAt must be a Unix timestamp (float). Got: {job.get('completedAt')!r}"
        )

    def test_completed_at_is_unix_seconds_not_milliseconds(self):
        """completedAt must be Unix seconds (time.time()), not milliseconds.
        The JS side multiplies by 1000 before passing to new Date().
        If the backend emits milliseconds, JS would multiply again → wrong date.
        """
        from sync_jobs import _jobs, launch_job, update_job, _lock

        done_event = threading.Event()
        def worker(job_id):
            update_job(job_id, status='done', message='done', progress=100)
            done_event.set()

        with patch(_DB_PATCH, return_value=None):
            job_id = launch_job(worker, initial_message='test', operation='import_transactions')
        done_event.wait(timeout=3)

        with _lock:
            job = _jobs.get(job_id, {})

        ts = job.get('completedAt', 0)
        assert ts < 1e12, (
            f"completedAt={ts} looks like milliseconds (>1e12). "
            "Backend must emit Unix seconds. JS does ts*1000 before new Date()."
        )
        # Should be within 10 seconds of now
        assert abs(time.time() - ts) < 10, (
            f"completedAt={ts} is not close to now ({time.time():.0f}). "
            "Likely set incorrectly."
        )

    def test_fetch_last_sync_filter_works_end_to_end(self):
        """
        Simulate what fetchLastSync does: filter list_jobs() result for
        operation='import_transactions', status='done', completedAt truthy.
        A job created and completed via launch_job/update_job must survive this filter.
        """
        from sync_jobs import _jobs, launch_job, update_job, list_jobs, _lock

        done_event = threading.Event()
        def worker(job_id):
            update_job(job_id, status='running', message='importing')
            update_job(job_id, status='done', message='702 rows imported', progress=100)
            done_event.set()

        with patch(_DB_PATCH, return_value=None):
            with patch('sync_jobs.list_jobs', wraps=lambda: list(dict(_jobs).values())):
                job_id = launch_job(worker, initial_message='test', operation='import_transactions')
                done_event.wait(timeout=3)

                with _lock:
                    all_jobs = list(_jobs.values())

        # Apply the exact JS filter from fetchLastSync
        matched = [
            j for j in all_jobs
            if j.get('operation') == 'import_transactions'
            and j.get('status') == 'done'
            and j.get('completedAt')
        ]

        assert matched, (
            "No jobs survived the fetchLastSync filter "
            "(operation='import_transactions' AND status='done' AND completedAt truthy). "
            "This is why 'Last imported: Never' shows even after a successful sync. "
            f"Jobs in store: {[{k: v for k, v in j.items() if k in ('operation','status','completedAt')} for j in all_jobs]}"
        )


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
        PaymentsPanel.js must use 'done' (backend vocabulary) for its success
        state. Using 'completed' is the bug fixed in commit 876f11d.
        """
        assert PAYMENTS_JS.exists(), f"PaymentsPanel.js not found at {PAYMENTS_JS}"
        src = PAYMENTS_JS.read_text()

        # Must contain the correct success-state comparison
        assert "=== 'done'" in src, (
            "PaymentsPanel.js must compare its sync state to 'done'. "
            "If this is 'completed', the success UI never renders."
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

    def test_poll_stop_condition_includes_done(self):
        """
        Regression: pollSyncJob's clearInterval must trigger on status === 'done'.

        Bug: the interval callback checked (status === 'completed' || status === 'error')
        but the backend emits 'done'. The interval never fired clearInterval, so the
        poller ran forever after every successful sync (visible as repeated
        '[FETCH] Job ... COMPLETE status=done, still being polled' in Flask logs).

        Fix: condition must include 'done'.
        """
        src = PAYMENTS_JS.read_text()

        # After the refactor, polling is delegated to window.pollUntilDone,
        # which stops on 'done' internally (asserted by the index.html tests).
        if 'pollUntilDone' in src:
            return
        # Legacy path: own setInterval must have a branch that stops on 'done'
        assert "status === 'done'" in src, (
            "The poll stop condition must include status === 'done'. "
            "Without this, the 2-second interval runs forever after a successful sync."
        )

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
        After the two-step refactor, handleSyncNow's success branch (the .then
        after both imports) must call both.
        """
        src = PAYMENTS_JS.read_text()
        assert 'fetchLastSync' in src, "fetchLastSync() must be called on sync success"
        assert 'loadAll' in src, "loadAll() must be called on sync success"
        # They must be inside handleSyncNow's success chain
        sync_idx = src.find('const handleSyncNow')
        assert sync_idx != -1, "handleSyncNow must be defined in PaymentsPanel.js"
        sync_block = src[sync_idx:sync_idx + 1200]
        assert 'fetchLastSync' in sync_block and 'loadAll' in sync_block, (
            "handleSyncNow's success branch must call fetchLastSync() and loadAll(). "
            "Without this, the payments panel never refreshes after a successful sync."
        )

    def test_sync_now_imports_transactions_then_members(self):
        """
        Contract: the Payments sync sequence must import Gmail transactions AND
        new members (both Sheets → MySQL), transactions first. Also auto-runs
        once per page load on the initial Payments view.
        """
        src = PAYMENTS_JS.read_text()
        tx_idx = src.find('/api/sync/import/transactions')
        mem_idx = src.find('/api/sync/import/members')
        assert tx_idx != -1, "PaymentsPanel must POST /api/sync/import/transactions"
        assert mem_idx != -1, "PaymentsPanel must POST /api/sync/import/members"
        assert tx_idx < mem_idx, (
            "Transactions import must run before the members import in handleSyncNow"
        )
        assert '__paymentsAutoSyncStarted' in src, (
            "Initial Payments load must auto-trigger the import sequence exactly "
            "once per page load (window.__paymentsAutoSyncStarted guard)"
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
