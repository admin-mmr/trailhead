"""
Auth matrix enforcer for mmr-admin.

Regression test for the 2026-07 security audit: several API routes
(`/api/export-schema`, `/api/export-schema-ddl`, all `/api/py-exec/*`) were
reachable with no authentication at all, or with `login_required` but no
role check, despite exposing full DB schema dumps / arbitrary Python
execution. auth.py's `login_required` / `require_role` decorators stamp
markers (`_auth_login_required`, `_auth_min_role`) on the wrapped view
function specifically so this test can assert on them without needing a
live session or DB — it inspects the decorator stack, not response codes.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_auth_matrix.py -v
"""
import os
import sys
import pathlib
import pytest
from unittest.mock import MagicMock, patch

HERE = pathlib.Path(__file__).parent

# ---------------------------------------------------------------------------
# Routes that are intentionally public (no login_required) — CORS reads used
# by the public webapp Hall of Fame page. Everything else must be protected.
# ---------------------------------------------------------------------------

PUBLIC_ROUTES = {
    ('GET', '/api/hof/series'),
    ('GET', '/api/hof/series/<slug>'),
    ('GET', '/api/hof/event/<event_code>'),
    ('GET', '/api/hof/distances'),
    # Commit SHA + deploy timestamp only — no data, intentionally public
    # (matches the webapp footer build-stamp pattern). See api_data.py.
    ('GET', '/api/version'),
}

EXCLUDED_PREFIXES = (
    '/auth/',
    '/login',
    '/logout',
    '/favicon',
    '/templates/',
    '/static/',
)
EXCLUDED_EXACT = {'/', '/query'}

# Routes that must require *at least* admin (not just login) — the specific
# endpoints this audit fixed. Regressing any of these back to bare
# login_required (or no auth) must fail this test.
MIN_ROLE_ADMIN_ROUTES = {
    ('GET', '/api/export-schema'),
    ('GET', '/api/export-schema-ddl'),
    ('GET', '/api/py-exec/list'),
    ('POST', '/api/py-exec/run/<fn_name>'),
    ('POST', '/api/py-exec/code'),
    ('GET', '/api/py-exec/health'),
    # Reads arbitrary config-table keys (incl. SheetsWebhookUrl) by name
    ('GET', '/api/config/get'),
    # 2026-10: member PII (name, email, WeChat ID, payments). Any member with a
    # portal password can sign in via /auth/password, so login alone is not admin.
    ('GET', '/api/district/list'),
    ('GET', '/api/district/districts'),
    ('GET', '/api/district/member-status-values'),
    ('POST', '/api/district/export-csv'),
    ('POST', '/api/district/export-all-districts'),
    ('POST', '/api/district/export-all-sheet'),
    # Data browser: any table, incl. members.password_hash
    ('GET', '/api/tables'),
    ('GET', '/api/tables/<table_name>'),
    # Repoints the app's global DB connection
    ('POST', '/api/connection/set'),
    # Bookmarkable district head-count page — member data, admins only
    ('GET', '/district/<district>'),
}

# Routes that only need a session (no admin role). Every other non-public
# route must require at least admin — the admin shell is for admins only.
LOGIN_ONLY_ROUTES = {
    # The shell reads the caller's role from here; must work for role 'none'.
    ('GET', '/api/me'),
}


def _normalize_path(path: str) -> str:
    import re
    return re.sub(r'<[^:>]+:([^>]+)>', r'<\1>', path)


def _is_excluded(path: str) -> bool:
    if path in EXCLUDED_EXACT:
        return False
    return any(path.startswith(p) for p in EXCLUDED_PREFIXES)


def _load_app():
    os.environ.setdefault('DEV_BYPASS_AUTH', 'true')
    os.environ.setdefault('TESTING', 'true')
    sys.path.insert(0, str(HERE.parent))

    class _FakeMySQLError(Exception):
        def __init__(self, msg='', errno=None, **kw):
            super().__init__(msg)
            self.errno = errno

    cm = MagicMock()
    cm.Error = _FakeMySQLError
    cm.pooling = MagicMock()
    for mod in ('mysql', 'mysql.connector', 'mysql.connector.pooling',
                'mysql.connector.errors'):
        sys.modules.setdefault(mod, cm)

    with patch('db.get_conn', return_value=MagicMock()):
        import app as flask_app
    return flask_app.app


def _iter_routes(app):
    """Yield (method, normalized_path, view_func) for every non-excluded route."""
    for rule in app.url_map.iter_rules():
        path = str(rule)
        if path in EXCLUDED_EXACT or _is_excluded(path):
            continue
        normalized = _normalize_path(path)
        view_func = app.view_functions[rule.endpoint]
        for method in sorted(rule.methods - {'HEAD', 'OPTIONS'}):
            yield method, normalized, view_func


def pytest_generate_tests(metafunc):
    if metafunc.function.__name__ not in (
        'test_route_requires_login', 'test_sensitive_route_requires_admin_role',
        'test_route_requires_admin_by_default',
    ):
        return

    try:
        app = _load_app()
        routes = sorted(
            {(m, p) for m, p, _ in _iter_routes(app)} - PUBLIC_ROUTES
        )
        by_key = {(m, p): f for m, p, f in _iter_routes(app)}
    except Exception:
        routes, by_key = [], {}

    if metafunc.function.__name__ == 'test_route_requires_login':
        ids = [f"{m} {p}" for m, p in routes]
        metafunc.parametrize('method,path,view_func',
                              [(m, p, by_key[(m, p)]) for m, p in routes],
                              ids=ids)
    elif metafunc.function.__name__ == 'test_route_requires_admin_by_default':
        admin_routes = [r for r in routes if r not in LOGIN_ONLY_ROUTES]
        ids = [f"{m} {p}" for m, p in admin_routes]
        metafunc.parametrize('method,path,view_func',
                              [(m, p, by_key[(m, p)]) for m, p in admin_routes],
                              ids=ids)
    else:
        admin_routes = [r for r in routes if r in MIN_ROLE_ADMIN_ROUTES]
        ids = [f"{m} {p}" for m, p in admin_routes]
        metafunc.parametrize('method,path,view_func',
                              [(m, p, by_key[(m, p)]) for m, p in admin_routes],
                              ids=ids)


def test_route_requires_login(method, path, view_func):
    """
    Every API route not explicitly allowlisted as public must be wrapped in
    @login_required.

    FAIL = a new route was added without auth, or an existing one lost it.
    FIX  = add @login_required, or add the route to PUBLIC_ROUTES above if
           it's genuinely meant to be public (and confirm that's intended).
    """
    assert getattr(view_func, '_auth_login_required', False), (
        f"\n\n  Route {method} {path} has no @login_required decorator."
        f"\n  If this route is genuinely public, add it to PUBLIC_ROUTES in"
        f"\n  tests/test_auth_matrix.py. Otherwise add @login_required."
    )


def test_sensitive_route_requires_admin_role(method, path, view_func):
    """
    Routes that expose full schema dumps or arbitrary Python execution must
    require @require_role('admin') on top of @login_required — this is the
    specific gap the 2026-07 audit found and fixed.
    """
    min_role = getattr(view_func, '_auth_min_role', None)
    assert min_role in ('admin', 'super_admin'), (
        f"\n\n  Sensitive route {method} {path} requires role '{min_role}'"
        f" but must require at least 'admin'."
        f"\n  This route was flagged in the 2026-07 security audit — do not"
        f" relax its role requirement without discussing the risk."
    )


def test_route_requires_admin_by_default(method, path, view_func):
    """
    Every non-public route must require at least admin, unless it is listed
    in LOGIN_ONLY_ROUTES. A session is not enough: /auth/password signs in
    any member with a portal password (role 'none').

    FAIL = a new route has @login_required but no @require_role('admin').
    FIX  = add @require_role('admin') after @login_required, or add the route
           to LOGIN_ONLY_ROUTES if a non-admin genuinely needs it.
    """
    min_role = getattr(view_func, '_auth_min_role', None)
    assert min_role in ('admin', 'super_admin'), (
        f"\n\n  Route {method} {path} has no @require_role('admin')."
        f"\n  Non-admin members can sign in to mmr-admin, so login alone"
        f"\n  is not authorization. Add @require_role('admin'), or list the"
        f"\n  route in LOGIN_ONLY_ROUTES if a non-admin really needs it."
    )


def test_login_only_routes_still_exist():
    app = _load_app()
    live = {(m, p) for m, p, _ in _iter_routes(app)}
    stale = LOGIN_ONLY_ROUTES - live
    assert not stale, f"LOGIN_ONLY_ROUTES references routes that no longer exist: {stale}"


@pytest.fixture
def real_auth_client():
    """Test client with DEV_BYPASS_AUTH off, so the decorators actually run."""
    app = _load_app()
    import auth
    with patch.object(auth, 'DEV_BYPASS_AUTH', False):
        yield app.test_client()


def _sign_in(client, email):
    with client.session_transaction() as sess:
        sess['user'] = {'email': email, 'role': 'none'}


def test_index_shows_no_access_page_for_non_admin(real_auth_client):
    _sign_in(real_auth_client, 'member@example.com')
    with patch('auth.get_user_role', return_value=None):
        resp = real_auth_client.get('/')
    assert resp.status_code == 403
    body = resp.get_data(as_text=True)
    assert 'No admin access' in body
    assert 'member@example.com' in body
    assert '/logout' in body


def test_index_escapes_email_on_no_access_page(real_auth_client):
    _sign_in(real_auth_client, '<script>x</script>@example.com')
    with patch('auth.get_user_role', return_value=None):
        body = real_auth_client.get('/').get_data(as_text=True)
    assert '<script>x</script>' not in body


def test_index_serves_shell_for_admin(real_auth_client):
    _sign_in(real_auth_client, 'someone@example.com')
    with patch('auth.get_user_role', return_value='admin'):
        resp = real_auth_client.get('/')
    assert resp.status_code == 200
    assert 'No admin access' not in resp.get_data(as_text=True)


def test_district_list_denies_non_admin_member(real_auth_client):
    _sign_in(real_auth_client, 'member@example.com')
    with patch('auth.get_user_role', return_value=None):
        resp = real_auth_client.get('/api/district/list')
    assert resp.status_code == 403


def test_public_routes_still_exist(app=None):
    """
    Sanity check: PUBLIC_ROUTES isn't silently growing stale (e.g. a route
    was renamed/removed but the allowlist entry never cleaned up, which
    would hide a route that should be re-checked).
    """
    app = _load_app()
    live = {(m, p) for m, p, _ in _iter_routes(app)}
    stale = PUBLIC_ROUTES - live
    assert not stale, f"PUBLIC_ROUTES references routes that no longer exist: {stale}"
