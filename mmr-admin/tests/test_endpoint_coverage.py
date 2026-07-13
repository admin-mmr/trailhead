"""
Endpoint coverage enforcer for mmr-admin.

Every HTTP route registered in the Flask app must have at least one test
in the mmr-admin/tests/ directory. This file is both the enforcer AND the
record of which routes are covered by which test files.

How it works
------------
1. The Flask app's url_map is enumerated to get every live route + method.
2. A hand-maintained COVERAGE registry maps each (method, path_pattern) to
   the test file that covers it. Wildcards like <member_id> appear as <param>.
3. The parametrized test `test_route_has_coverage` fails for any route that
   is missing from the registry.

Adding a new endpoint
---------------------
1. Add the route to api_*.py as usual.
2. Add a smoke test in test_api_smoke.py or test_api_smoke_extended.py.
3. Add an entry here in COVERAGE — the test will fail until you do.

Auth routes (/auth/*, /login, /logout) and UI routes (/, /query, /templates/*)
are excluded — they are browser-facing HTML pages, not JSON API endpoints.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_endpoint_coverage.py -v
"""

import re
import pathlib
import pytest

HERE = pathlib.Path(__file__).parent

# ---------------------------------------------------------------------------
# Routes excluded from coverage requirement
# (browser pages, auth flows, favicon — not JSON API endpoints)
# ---------------------------------------------------------------------------

EXCLUDED_PREFIXES = (
    '/auth/',
    '/login',
    '/logout',
    '/favicon',
    '/templates/',
    '/static/',      # Flask built-in static file server
)
EXCLUDED_EXACT = {'/', '/query'}


# ---------------------------------------------------------------------------
# Coverage registry
# Map: (METHOD, normalized_path) → test_file_that_covers_it
#
# Normalize path by replacing <converter:param> → <param>
# e.g. /api/events/<int:event_id>/runners → /api/events/<event_id>/runners
# ---------------------------------------------------------------------------

COVERAGE: dict[tuple[str, str], str] = {
    # --- audit ---
    ('POST', '/api/audit/reconcile'):              'test_audit_members.py',
    ('GET',  '/api/audit/expiration-drift'):       'test_audit_members.py',
    ('POST', '/api/audit/renewal'):                'test_api_smoke.py',
    ('POST', '/api/audit/unmatch'):                'test_api_smoke_extended.py',

    # --- config ---
    ('GET',  '/api/config/get'):                   'test_api_smoke.py',

    # --- connection / data ---
    ('GET',  '/api/connection/config'):            'test_api_smoke_extended.py',
    ('GET',  '/api/connection/presets'):           'test_api_smoke_extended.py',
    ('POST', '/api/connection/set'):               'test_api_smoke_extended.py',
    ('GET',  '/api/log'):                          'test_api_smoke_extended.py',
    ('GET',  '/api/version'):                      'test_api_smoke_extended.py',
    ('GET',  '/api/tables'):                       'test_api_smoke_extended.py',
    ('GET',  '/api/tables/<table_name>'):          'test_api_smoke_extended.py',
    ('GET',  '/api/user-settings/<table_name>'):   'test_api_smoke_extended.py',
    ('PUT',  '/api/user-settings/<table_name>'):   'test_api_smoke_extended.py',
    ('POST', '/api/backfill-unix-timestamps'):     'test_api_smoke_extended.py',

    # --- schema ---
    ('GET',  '/api/export-schema'):                'test_api_smoke_extended.py',
    ('GET',  '/api/export-schema-ddl'):            'test_api_smoke_extended.py',

    # --- me ---
    ('GET',  '/api/me'):                           'test_api_smoke_extended.py',

    # --- districts ---
    ('GET',  '/api/districts'):                    'test_api_smoke.py',
    ('GET',  '/api/district/districts'):           'test_api_smoke_extended.py',
    ('GET',  '/api/district/list'):                'test_api_smoke_extended.py',
    ('POST', '/api/district/export-csv'):          'test_api_smoke_extended.py',
    ('POST', '/api/district/export-all-districts'):'test_api_smoke_extended.py',
    ('POST', '/api/district/export-all-sheet'):    'test_api_smoke_extended.py',
    ('GET',  '/api/district/member-status-values'): 'test_district_status_filter.py',

    # --- members ---
    ('GET',  '/api/members/search'):               'test_api_smoke.py',
    ('GET',  '/api/members/<member_id>/card'):     'test_api_smoke.py',
    ('GET',  '/api/members/<member_id>/family'):   'test_api_smoke_extended.py',
    ('GET',  '/api/members/<member_id>/overrides'):'test_api_smoke_extended.py',
    ('POST', '/api/members/<member_id>/status'):   'test_api_smoke.py',
    ('POST', '/api/members/<member_id>/revert-status'): 'test_api_smoke_extended.py',
    ('POST', '/api/members/<member_id>/mark-active'):   'test_api_smoke_extended.py',
    ('GET',  '/api/members/overrides/all'):             'test_members_status_changes.py',
    ('POST', '/api/members/revert-override'):           'test_members_status_changes.py',
    ('GET',  '/api/members/config/year-end'):           'test_api_smoke_extended.py',
    ('POST', '/api/members/<member_id>/district'): 'test_api_smoke_extended.py',
    ('POST', '/api/members/<member_id>/mark-unused'): 'test_members_unit.py',
    ('GET',  '/api/members/<member_id>/log-history'):    'test_member_log_restore.py',
    ('POST', '/api/members/<member_id>/restore-from-log'): 'test_member_log_restore.py',
    ('POST', '/api/members/family/assign-family-id'): 'test_api_smoke_extended.py',
    ('POST', '/api/members/family/add-member'):       'test_api_smoke_extended.py',
    ('POST', '/api/members/family/remove-member'):    'test_api_smoke_extended.py',
    ('POST', '/api/members/family/upgrade-and-add'):  'test_members_family_upgrade.py',

    # --- admins ---
    ('GET',  '/api/admins'):                       'test_api_smoke_extended.py',
    ('POST', '/api/admins'):                       'test_api_smoke_extended.py',
    ('DELETE','/api/admins/<email>'):              'test_api_smoke_extended.py',

    # --- payments ---
    ('GET',  '/api/payments/dashboard'):           'test_api_smoke.py',
    ('GET',  '/api/payments/pending-submissions'): 'test_api_smoke.py',
    ('GET',  '/api/payments/unmatched-gmail'):     'test_api_smoke.py',
    ('POST', '/api/payments/autoguess-all'):       'test_api_smoke.py',
    ('POST', '/api/payments/manual-approve'):      'test_api_response_format.py',
    ('POST', '/api/payments/cancel/<payment_id>'): 'test_api_smoke_extended.py',
    ('POST', '/api/payments/admin-create'):        'test_api_smoke_extended.py',
    ('GET',  '/api/payments/search-members'):      'test_api_smoke.py',
    ('GET',  '/api/payments/history'):             'test_api_smoke_extended.py',
    ('GET',  '/api/payments/autoguess-log'):       'test_api_smoke_extended.py',
    ('GET',  '/api/payments/member-quick/all'):    'test_api_response_format.py',
    ('GET',  '/api/payments/member-quick/<member_id>'): 'test_api_response_format.py',
    ('GET',  '/api/payments/submissions-for-member/<member_id>'): 'test_api_smoke_extended.py',
    ('GET',  '/api/payments/gmail-matching-candidates/<member_id>'): 'test_api_smoke_extended.py',
    ('GET',  '/api/payments/gmail-candidates/<submission_id>'): 'test_api_smoke_extended.py',
    ('GET',  '/api/payments/debug-candidates/<submission_id>'): 'test_api_smoke_extended.py',
    ('GET',  '/api/payments/debug/match/<submission_id>'): 'test_api_smoke_extended.py',
    ('GET',  '/api/payments/debug-autoguess/<transaction_number>'): 'test_api_smoke_extended.py',
    ('GET',  '/api/payments/test-fuzzy-match/<submission_id>'): 'test_api_smoke_extended.py',

    # --- events ---
    ('GET',  '/api/events'):                       'test_api_smoke_extended.py',
    ('GET',  '/api/events/<event_id>'):            'test_api_smoke_extended.py',
    ('GET',  '/api/events/<event_id>/runners'):    'test_api_smoke_extended.py',
    ('POST', '/api/events/<event_id>/automatch'):  'test_api_smoke_extended.py',
    ('GET',  '/api/stats'):                        'test_api_smoke_extended.py',
    ('GET',  '/api/stats/years'):                  'test_api_smoke_extended.py',

    # --- runners ---
    ('GET',  '/api/runners/search'):               'test_api_smoke_extended.py',
    ('GET',  '/api/runner/<runner_id>/history'):   'test_api_smoke_extended.py',
    ('POST', '/api/runners/<runner_row_id>/match'):'test_api_smoke_extended.py',
    ('DELETE','/api/runners/<runner_row_id>/match'):'test_api_smoke_extended.py',

    # --- NYRR event load/sync ---
    ('POST', '/api/load/<event_id>'):              'test_api_smoke_extended.py',
    ('POST', '/api/load/<event_code>/cancel'):     'test_api_smoke_extended.py',
    ('GET',  '/api/load/<event_code>/status'):     'test_api_smoke_extended.py',
    ('POST', '/api/sync/membership-fees'):         'test_api_smoke_extended.py',
    ('POST', '/api/sync/members-lastupdated'):     'test_api_smoke_extended.py',

    # --- sheets sync ---
    ('POST', '/api/sync/export/members'):          'test_api_smoke.py',
    ('POST', '/api/sync/export/payments'):         'test_api_smoke.py',
    ('POST', '/api/sync/export/submissions'):      'test_api_smoke.py',
    ('POST', '/api/sync/export/transaction-meta'): 'test_api_smoke.py',
    ('POST', '/api/sync/import/members'):          'test_api_smoke_extended.py',
    ('POST', '/api/sync/import/transactions'):     'test_api_smoke_extended.py',
    ('POST', '/api/sync/full-sync'):               'test_api_response_format.py',
    ('GET',  '/api/sync/jobs'):                    'test_api_smoke_extended.py',
    ('GET',  '/api/sync/status/<job_id>'):         'test_api_smoke_extended.py',

    # --- python exec ---
    ('GET',  '/api/py-exec/health'):               'test_api_smoke_extended.py',
    ('GET',  '/api/py-exec/list'):                 'test_api_smoke_extended.py',
    ('POST', '/api/py-exec/code'):                 'test_api_smoke_extended.py',
    ('POST', '/api/py-exec/run/<fn_name>'):        'test_api_smoke_extended.py',

    # --- query ---
    ('GET',  '/api/query/config'):                 'test_api_smoke_extended.py',
    ('GET',  '/api/query/diag'):                   'test_api_smoke_extended.py',
    ('POST', '/api/query/execute'):                'test_api_smoke_extended.py',

    # --- event discovery ---
    ('POST', '/api/discover'):                     'test_api_smoke_nyrr_hof.py',
    ('POST', '/api/discover-upcoming'):            'test_api_smoke_nyrr_hof.py',
    ('POST', '/api/discover/reconcile-slugs'):     'test_api_smoke_nyrr_hof.py',

    # --- events: by-code + Tier-4 fuzzy ---
    ('GET',  '/api/events/by-code/<event_code>'):  'test_api_smoke_nyrr_hof.py',
    ('POST', '/api/events/<event_id>/fuzzy-match'): 'test_api_smoke_nyrr_hof.py',
    ('GET',  '/api/events/<event_id>/fuzzy-match/status'): 'test_api_smoke_nyrr_hof.py',

    # --- NYRR activity / match queue / reconcile ---
    ('GET',  '/api/nyrr/activity'):                'test_api_smoke_nyrr_hof.py',
    ('GET',  '/api/nyrr/match-queue'):             'test_api_smoke_nyrr_hof.py',
    ('POST', '/api/nyrr/match-queue/bulk-confirm'): 'test_api_smoke_nyrr_hof.py',
    ('GET',  '/api/nyrr/reconcile'):               'test_api_smoke_nyrr_hof.py',
    ('POST', '/api/nyrr/reconcile/<event_id>/probe'): 'test_api_smoke_nyrr_hof.py',
    ('POST', '/api/nyrr/reconcile/<event_id>/tag-mmr'): 'test_api_smoke_nyrr_hof.py',
    ('POST', '/api/nyrr/reconcile/tag-mmr-batch'): 'test_api_smoke_nyrr_hof.py',

    # --- Hall of Fame ---
    ('GET',   '/api/hof/series'):                  'test_api_smoke_nyrr_hof.py',
    ('GET',   '/api/hof/series/<slug>'):           'test_api_smoke_nyrr_hof.py',
    ('GET',   '/api/hof/event/<event_code>'):      'test_api_smoke_nyrr_hof.py',
    ('GET',   '/api/hof/events'):                  'test_api_smoke_nyrr_hof.py',
    ('GET',   '/api/hof/distances'):               'test_api_smoke_nyrr_hof.py',
    ('POST',  '/api/hof/series'):                  'test_api_smoke_nyrr_hof.py',
    ('PATCH', '/api/hof/series/<series_id>/assign-events'): 'test_api_smoke_nyrr_hof.py',
    ('PATCH', '/api/hof/events/<event_id>/series'): 'test_api_smoke_nyrr_hof.py',
    ('PATCH', '/api/hof/events/<event_id>/distance'): 'test_api_smoke_nyrr_hof.py',
    ('POST',  '/api/hof/refresh-mmr-counts'):      'test_api_smoke_nyrr_hof.py',

    # --- members duplicates (covered by domain tests) ---
    ('GET',  '/api/members/duplicates'):           'test_members_duplicates.py',
    ('POST', '/api/members/duplicates/dismiss'):   'test_members_duplicates.py',

    # --- sync last-import (covered by contract tests) ---
    ('GET',  '/api/sync/last-import'):             'test_sync_jobs_contract.py',
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_path(path: str) -> str:
    """
    Flask url_map uses <converter:name> format; normalize to just <name>
    so we can look up in COVERAGE regardless of converter type.
    e.g. /api/events/<int:event_id>/runners → /api/events/<event_id>/runners
    """
    return re.sub(r'<[^>:]+:([^>]+)>', r'<\1>', path)


def _is_excluded(path: str) -> bool:
    if path in EXCLUDED_EXACT:
        return True
    return any(path.startswith(p) for p in EXCLUDED_PREFIXES)


def _get_all_api_routes(app) -> list[tuple[str, str]]:
    """
    Return [(METHOD, normalized_path)] for every API route in the Flask app,
    excluding browser pages and auth flows.
    """
    routes = []
    for rule in app.url_map.iter_rules():
        path = str(rule)
        if _is_excluded(path):
            continue
        normalized = _normalize_path(path)
        for method in sorted(rule.methods - {'HEAD', 'OPTIONS'}):
            routes.append((method, normalized))
    return sorted(routes)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_coverage_registry_entries_are_valid(app):
    """
    Every entry in COVERAGE must correspond to an actual route.
    Catches typos in the registry (e.g. misspelled path, wrong method).
    """
    live_routes = set(_get_all_api_routes(app))
    bad = []
    for (method, path) in COVERAGE:
        if (method, path) not in live_routes:
            bad.append(f"  {method:7} {path}")
    assert not bad, (
        "COVERAGE registry contains routes that don't exist in the Flask app:\n"
        + "\n".join(sorted(bad))
        + "\n\nFix the path/method in COVERAGE, or remove the entry if the route was deleted."
    )


@pytest.mark.parametrize('method,path', _get_all_api_routes.__wrapped__ if hasattr(_get_all_api_routes, '__wrapped__') else [])
def _placeholder():
    pass  # real parametrize is done at collection time below


def pytest_generate_tests(metafunc):
    """Dynamically parametrize test_route_has_coverage at collection time."""
    if metafunc.function.__name__ == 'test_route_has_coverage':
        # We need the app here — use the fixture indirectly by importing
        import sys, os
        os.environ.setdefault('DEV_BYPASS_AUTH', 'true')
        os.environ.setdefault('TESTING', 'true')
        sys.path.insert(0, str(HERE.parent))

        from unittest.mock import MagicMock, patch
        class _FakeMySQLError(Exception):
            def __init__(self, msg='', errno=None, **kw):
                super().__init__(msg); self.errno = errno
        cm = MagicMock(); cm.Error = _FakeMySQLError; cm.pooling = MagicMock()
        for mod in ('mysql', 'mysql.connector', 'mysql.connector.pooling',
                    'mysql.connector.errors'):
            sys.modules.setdefault(mod, cm)

        try:
            with patch('db.get_conn', return_value=MagicMock()):
                import app as flask_app
            routes = _get_all_api_routes(flask_app.app)
        except Exception:
            routes = []

        ids = [f"{m} {p}" for m, p in routes]
        metafunc.parametrize('method,path', routes, ids=ids)


def test_route_has_coverage(method, path):
    """
    Every API route must appear in the COVERAGE registry.

    FAIL = a new endpoint was added without a corresponding test.
    FIX  = add a test for this route and register it in COVERAGE above.
    """
    test_file = COVERAGE.get((method, path))
    assert test_file is not None, (
        f"\n\n  Route NOT covered by any test: {method} {path}"
        f"\n\n  To fix:"
        f"\n    1. Add a smoke test in tests/test_api_smoke_extended.py"
        f"\n    2. Register it in tests/test_endpoint_coverage.py COVERAGE dict:"
        f"\n       ('{method}', '{path}'): 'test_api_smoke_extended.py',"
    )

    # Also verify the test file actually exists
    test_path = HERE / test_file
    assert test_path.exists(), (
        f"Route {method} {path} is registered to '{test_file}' but that file doesn't exist."
    )
