"""
pytest configuration and shared fixtures for mmr-admin tests.

No live DB required for unit tests — all DB calls are mocked via unittest.mock.
Integration tests (tests/integration/) require a real test DB and are skipped by default.
Run integration tests with: pytest tests/integration/ --run-integration

Flask client fixture
--------------------
The `client` fixture provides a Flask test client with:
  - DEV_BYPASS_AUTH=true  → skips OAuth, no session required
  - db.get_conn mocked     → no live MySQL connection needed

Usage in smoke tests:
    def test_my_endpoint(client):
        r = client.get('/api/something')
        assert r.status_code == 200
"""
import sys
import os
import pytest
from unittest.mock import MagicMock, patch

# Must be set BEFORE app is imported so auth decorators see it
os.environ.setdefault('DEV_BYPASS_AUTH', 'true')
os.environ.setdefault('TESTING', 'true')

# Add mmr-admin root and tests dir to path so imports work the same as runtime
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, os.path.dirname(__file__))

# Stub mysql.connector before any app module imports it.
# This lets us import and test Flask routes without a MySQL installation.
# MySQLError must be a real Exception subclass — Flask's error handler registration
# calls issubclass() on it, which fails if it's a MagicMock.
#
# Skip the mock when --run-integration is active so the real mysql.connector
# is available for testcontainers to use.
_run_integration = '--run-integration' in sys.argv

if not _run_integration:
    class _FakeMySQLError(Exception):
        def __init__(self, msg='', errno=None, **kw):
            super().__init__(msg)
            self.errno = errno

    _connector_mock = MagicMock()
    _connector_mock.Error = _FakeMySQLError
    _connector_mock.pooling = MagicMock()
    _connector_mock.pooling.MySQLConnectionPool = MagicMock()

    _mysql_mock = MagicMock()
    _mysql_mock.connector = _connector_mock

    sys.modules.setdefault('mysql', _mysql_mock)
    sys.modules.setdefault('mysql.connector', _connector_mock)
    sys.modules.setdefault('mysql.connector.pooling', _connector_mock.pooling)
    sys.modules.setdefault('mysql.connector.errors', _connector_mock)


def pytest_addoption(parser):
    parser.addoption(
        '--run-integration',
        action='store_true',
        default=False,
        help='Run integration tests that require a live MySQL database',
    )


def pytest_configure(config):
    config.addinivalue_line(
        'markers',
        'integration: marks test as requiring a live database (skipped by default)',
    )


def pytest_collection_modifyitems(config, items):
    if not config.getoption('--run-integration'):
        skip_integration = pytest.mark.skip(reason='Pass --run-integration to run DB tests')
        for item in items:
            if 'integration' in item.keywords:
                item.add_marker(skip_integration)


# ---------------------------------------------------------------------------
# Flask app + mock DB fixtures
# ---------------------------------------------------------------------------

def _make_mock_cursor(rows=None):
    """Return a mock MySQL cursor that yields `rows` from fetchall()."""
    cur = MagicMock()
    cur.fetchall.return_value = rows if rows is not None else []
    cur.rowcount = len(rows) if rows else 0
    cur.nextset.return_value = None   # stops _drain_results loop immediately
    return cur


def _make_mock_conn(rows=None):
    """Return a mock MySQL connection whose cursor returns `rows`."""
    conn = MagicMock()
    conn.is_connected.return_value = True
    conn.cursor.return_value = _make_mock_cursor(rows)
    return conn


@pytest.fixture(scope='session')
def app():
    """Flask app with auth bypassed and DB fully mocked (no MySQL needed)."""
    with patch('db.get_conn', return_value=_make_mock_conn()):
        import app as flask_app
        flask_app.app.config.update(TESTING=True, SECRET_KEY='test-secret')
        yield flask_app.app


@pytest.fixture()
def client(app):
    """Test client for one test; each test gets a fresh request context."""
    return app.test_client()


@pytest.fixture()
def mock_query():
    """
    Patch db.query in every api_* module for one test.

    Usage:
        def test_foo(client, mock_query):
            mock_query.return_value = [{'MemberID': 'A0001', 'Status': 'active'}]
            r = client.get('/api/members/A0001/card')
            assert r.json['MemberID'] == 'A0001'
    """
    # Each api module does `from db import query` so we must patch each binding.
    import importlib, pkgutil, pathlib
    mmr_admin_root = pathlib.Path(__file__).parent.parent

    targets = []
    for f in mmr_admin_root.glob('api_*.py'):
        mod_name = f.stem
        try:
            mod = importlib.import_module(mod_name)
            if hasattr(mod, 'query'):
                targets.append(f'{mod_name}.query')
        except Exception:
            pass

    mock = MagicMock(return_value=[])
    patches = [patch(t, mock) for t in targets]
    for p in patches:
        p.start()
    yield mock
    for p in patches:
        p.stop()


# ---------------------------------------------------------------------------
# Integration fixtures (re-exported so pytest discovers them from conftest.py)
# ---------------------------------------------------------------------------

from conftest_integration import mysql_container, db_session, db  # noqa: E402, F401
