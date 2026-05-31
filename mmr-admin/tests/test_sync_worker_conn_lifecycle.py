"""
Tests for connection lifecycle in sync_worker.py error-path helpers.

Before the fix, _db_log_cancellation() and _db_log_error() closed conn2 only
on the final success line inside the try block. If get_conn() or any
cur2.execute() raised, the except clause swallowed the error and conn2 was
never returned to the pool — leaking a slot. Because these run on the worker's
error/cancel paths (exactly when the DB is already flaky), a few failures
exhausted the small pool and produced "pool exhausted".

These tests verify conn2.close() is called whether the DB work succeeds or
raises mid-statement.
"""
import pytest
from unittest.mock import MagicMock, patch


def _make_conn(execute_side_effect=None):
    conn = MagicMock()
    cur = MagicMock()
    cur.rowcount = 1
    if execute_side_effect is not None:
        cur.execute.side_effect = execute_side_effect
    conn.cursor.return_value = cur
    return conn


# ---------------------------------------------------------------------------
# _db_log_cancellation
# ---------------------------------------------------------------------------

class TestDbLogCancellationConnLifecycle:
    """conn2.close() must run on both success and exception paths."""

    def test_close_called_on_success(self):
        mock_conn = _make_conn()
        with patch('sync_worker.get_conn', return_value=mock_conn):
            import sync_worker
            sync_worker._db_log_cancellation(123)
        mock_conn.close.assert_called_once()

    def test_close_called_on_execute_exception(self):
        """Pool slot must be returned even when an UPDATE/INSERT raises."""
        mock_conn = _make_conn(execute_side_effect=Exception('update failed'))
        with patch('sync_worker.get_conn', return_value=mock_conn):
            import sync_worker
            sync_worker._db_log_cancellation(123)  # must not propagate
        mock_conn.close.assert_called_once()

    def test_no_crash_when_get_conn_fails(self):
        """If get_conn() itself raises, the helper swallows it and does not crash."""
        with patch('sync_worker.get_conn', side_effect=Exception('pool exhausted')):
            import sync_worker
            sync_worker._db_log_cancellation(123)  # no exception, nothing to close


# ---------------------------------------------------------------------------
# _db_log_error
# ---------------------------------------------------------------------------

class TestDbLogErrorConnLifecycle:
    """conn2.close() must run on both success and exception paths."""

    def test_close_called_on_success(self):
        mock_conn = _make_conn()
        with patch('sync_worker.get_conn', return_value=mock_conn):
            import sync_worker
            sync_worker._db_log_error(123, 'boom')
        mock_conn.close.assert_called_once()

    def test_close_called_on_execute_exception(self):
        """Pool slot must be returned even when a statement raises."""
        mock_conn = _make_conn(execute_side_effect=Exception('insert failed'))
        with patch('sync_worker.get_conn', return_value=mock_conn):
            import sync_worker
            sync_worker._db_log_error(123, 'boom')  # must not propagate
        mock_conn.close.assert_called_once()

    def test_no_crash_when_get_conn_fails(self):
        with patch('sync_worker.get_conn', side_effect=Exception('pool exhausted')):
            import sync_worker
            sync_worker._db_log_error(123, 'boom')
