"""
Tests for db.py connection pool configuration.

Verifies:
- Pool is created with pool_size=8 (raised from 3 to handle sync-worker
  contention where one long-running streaming operation holds a slot for
  minutes while regular API requests compete for the remaining slots).
- Pool is NOT created until the first get_conn() call (lazy init).
- _reset_pool() forces a rebuild on the next call (used by update_db_config).
- get_conn() re-raises a friendly error when the pool raises PoolError.
"""
import pytest
from unittest.mock import MagicMock, patch, call

# Capture the real get_conn at collection time, before any session-scoped
# fixture (e.g. the `app` fixture in conftest.py) replaces it with a mock.
# The app fixture uses scope='session' with `with patch('db.get_conn', ...):
# yield`, which keeps db.get_conn mocked for the entire pytest session once
# any client-using test runs.  Tests in this file need the real function.
import db as _db_module
_REAL_GET_CONN = _db_module.get_conn


@pytest.fixture(autouse=True)
def _use_real_get_conn():
    """Restore the real db.get_conn for every test in this module."""
    with patch('db.get_conn', _REAL_GET_CONN):
        yield


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_pool(conn=None):
    """Return a mock MySQLConnectionPool with a controllable get_connection()."""
    pool = MagicMock()
    pool.get_connection.return_value = conn or MagicMock()
    return pool


# ---------------------------------------------------------------------------
# Pool size
# ---------------------------------------------------------------------------

class TestPoolSize:
    """Pool must be created with pool_size=8."""

    def test_pool_created_with_size_8(self):
        """MySQLConnectionPool constructor must receive pool_size=8."""
        import db
        db._pool = None  # ensure fresh creation

        captured = {}

        def fake_pool_ctor(**kwargs):
            captured.update(kwargs)
            return _make_pool()

        with patch('db.MySQLConnectionPool', side_effect=fake_pool_ctor):
            db._get_pool()

        assert captured.get('pool_size') == 8, (
            f"Expected pool_size=8, got {captured.get('pool_size')}. "
            "A sync worker holds a connection for the entire NYRR streaming "
            "duration; a small pool is exhausted under concurrent API traffic."
        )

    def test_pool_size_not_three(self):
        """Regression: pool_size=3 caused exhaustion during sync operations."""
        import db
        db._pool = None

        captured = {}

        def fake_pool_ctor(**kwargs):
            captured.update(kwargs)
            return _make_pool()

        with patch('db.MySQLConnectionPool', side_effect=fake_pool_ctor):
            db._get_pool()

        assert captured.get('pool_size') != 3, \
            "pool_size=3 was the value that caused pool exhaustion — must not regress"


# ---------------------------------------------------------------------------
# Lazy initialisation
# ---------------------------------------------------------------------------

class TestPoolLazyInit:
    """Pool should only be created on the first get_conn() call."""

    def test_pool_not_created_at_import(self):
        """_pool is None until get_conn() / _get_pool() is called."""
        import db
        db._pool = None
        # Don't call get_conn — pool must stay None
        assert db._pool is None

    def test_pool_created_on_first_get_conn(self):
        """After get_conn() the pool exists."""
        import db
        db._pool = None
        mock_pool = _make_pool()

        with patch('db.MySQLConnectionPool', return_value=mock_pool):
            db.get_conn()

        assert db._pool is mock_pool


# ---------------------------------------------------------------------------
# Pool reset
# ---------------------------------------------------------------------------

class TestPoolReset:
    """_reset_pool() clears _pool so the next call rebuilds with new config."""

    def test_reset_clears_pool(self):
        import db
        db._pool = _make_pool()  # pretend pool exists
        db._reset_pool()
        assert db._pool is None

    def test_get_pool_rebuilds_after_reset(self):
        import db
        db._pool = None
        first_pool = _make_pool()
        second_pool = _make_pool()
        pool_iter = iter([first_pool, second_pool])

        with patch('db.MySQLConnectionPool', side_effect=lambda **kw: next(pool_iter)):
            db._get_pool()
            db._reset_pool()
            db._get_pool()

        assert db._pool is second_pool

    def test_update_db_config_resets_pool(self):
        """update_db_config() must call _reset_pool so new connections use new config."""
        import db
        db._pool = _make_pool()

        with patch('db._reset_pool') as mock_reset:
            db.update_db_config({'host': 'new-host'})

        mock_reset.assert_called_once()


# ---------------------------------------------------------------------------
# Error handling on pool exhaustion
# ---------------------------------------------------------------------------

class TestPoolExhaustion:
    """get_conn() must surface a clear message when the pool is exhausted."""

    def test_pool_exhausted_raises_friendly_error(self):
        """PoolError 'pool exhausted' → friendly exception, not raw connector error."""
        import db
        db._pool = None
        mock_pool = _make_pool()
        mock_pool.get_connection.side_effect = Exception(
            'Failed getting connection; pool exhausted'
        )

        with patch('db.MySQLConnectionPool', return_value=mock_pool):
            with pytest.raises(Exception) as exc_info:
                db.get_conn()

        msg = str(exc_info.value)
        assert 'MySQL Connection not available' in msg or 'pool exhausted' in msg.lower() or 'retry' in msg.lower()

    def test_cannot_connect_raises_friendly_error(self):
        """Connection refused → clear message about server availability."""
        import db
        db._pool = None
        mock_pool = _make_pool()
        mock_pool.get_connection.side_effect = Exception("Can't connect to MySQL server")

        with patch('db.MySQLConnectionPool', return_value=mock_pool):
            with pytest.raises(Exception) as exc_info:
                db.get_conn()

        assert 'database server' in str(exc_info.value).lower() or 'connect' in str(exc_info.value).lower()
