"""
Tests for connection lifecycle in api_events.py auto-match endpoint.

Verifies that get_conn() is always followed by conn.close() — i.e. the
connection is returned to the pool — regardless of whether the operation
succeeds, fails mid-execution, or the event is not found.

Pool size is 5.  Before the fix, every call to /api/events/<id>/auto-match
leaked one slot; 5 calls exhausted the pool permanently until restart.
"""
import pytest
from unittest.mock import MagicMock, patch, call


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_cursor(rowcount=0):
    cur = MagicMock()
    cur.rowcount = rowcount
    cur.fetchall.return_value = []
    return cur


def _make_conn(rowcount=0):
    conn = MagicMock()
    conn.cursor.return_value = _make_cursor(rowcount)
    return conn


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def events_client(app):
    """Reuse the session-scoped app fixture from conftest."""
    return app.test_client()


# ---------------------------------------------------------------------------
# auto-match connection lifecycle tests
# ---------------------------------------------------------------------------

class TestAutoMatchConnLifecycle:
    """conn.close() must always be called so the pool slot is returned."""

    def test_close_called_on_success(self, events_client):
        """Happy path: event exists, auto-match runs, conn is closed."""
        mock_conn = _make_conn(rowcount=3)

        with patch('api_events.query', return_value=[{'id': 42}]), \
             patch('api_events.get_conn', return_value=mock_conn) as mock_get:

            r = events_client.post('/api/events/42/automatch')

        assert r.status_code == 200
        mock_get.assert_called_once()
        mock_conn.close.assert_called_once()

    def test_close_called_on_db_error(self, events_client):
        """If a cursor.execute() raises, conn is still closed (no pool leak)."""
        mock_conn = _make_conn()
        mock_conn.cursor.return_value.execute.side_effect = Exception('DB exploded')

        with patch('api_events.query', return_value=[{'id': 42}]), \
             patch('api_events.get_conn', return_value=mock_conn) as mock_get:

            r = events_client.post('/api/events/42/automatch')

        assert r.status_code == 500
        mock_get.assert_called_once()
        mock_conn.close.assert_called_once()

    def test_rollback_called_on_db_error(self, events_client):
        """On failure the transaction is rolled back before the slot is released."""
        mock_conn = _make_conn()
        mock_conn.cursor.return_value.execute.side_effect = Exception('oops')

        with patch('api_events.query', return_value=[{'id': 42}]), \
             patch('api_events.get_conn', return_value=mock_conn):

            events_client.post('/api/events/42/automatch')

        mock_conn.rollback.assert_called_once()

    def test_no_conn_acquired_when_event_not_found(self, events_client):
        """Early-exit (404) must not acquire a connection at all."""
        with patch('api_events.query', return_value=[]), \
             patch('api_events.get_conn') as mock_get:

            r = events_client.post('/api/events/99/automatch')

        assert r.status_code == 404
        mock_get.assert_not_called()

    def test_pool_not_exhausted_after_multiple_calls(self, events_client):
        """
        Simulate pool_size=5 by tracking open vs closed connections.
        Before the fix every call leaked one slot; 5 calls → exhaustion.
        """
        conns = [_make_conn(rowcount=1) for _ in range(7)]
        conn_iter = iter(conns)

        with patch('api_events.query', return_value=[{'id': 1}]), \
             patch('api_events.get_conn', side_effect=conn_iter):

            for _ in range(7):
                r = events_client.post('/api/events/1/automatch')
                assert r.status_code == 200

        # Every acquired connection must have been returned
        for conn in conns:
            conn.close.assert_called_once(), \
                "conn.close() not called — pool slot would have been leaked"

    def test_commit_called_on_success(self, events_client):
        """Successful match must commit before closing."""
        mock_conn = _make_conn(rowcount=2)

        with patch('api_events.query', return_value=[{'id': 5}]), \
             patch('api_events.get_conn', return_value=mock_conn):

            r = events_client.post('/api/events/5/automatch')

        assert r.status_code == 200
        # commit before close
        commit_idx = [c[0] for c in mock_conn.method_calls].index('commit')
        close_idx  = [c[0] for c in mock_conn.method_calls].index('close')
        assert commit_idx < close_idx, "commit() must precede close()"
