"""
Smoke tests for NYRR discovery/reconcile/match-queue and Hall of Fame routes.

Same contract as test_api_smoke_extended.py (kept separate so neither file
blows past the size limit): every endpoint must be reachable, return JSON,
and never 5xx on an empty/missing request. External NYRR calls are patched.

No live DB required — db.query / db.execute mocked via conftest.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_smoke_nyrr_hof.py -v
"""

import pytest
from unittest.mock import patch, MagicMock


def _no500(r):
    """Route exists, returns JSON, never 5xx."""
    assert r.status_code not in (404, 405), \
        f"Route missing/wrong method: {r.status_code} — {r.data[:200]}"
    assert r.status_code < 500, \
        f"Unexpected 5xx: {r.status_code} — {r.data[:300]}"
    j = r.get_json()
    assert j is not None, f"Response is not JSON: {r.data[:200]}"
    return j


def _json_404(r):
    """Missing resource: 404 with a JSON body (route itself exists)."""
    assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.data[:200]}"
    j = r.get_json()
    assert j is not None and j.get('ok') is False
    return j


# ---------------------------------------------------------------------------
# Event discovery
# ---------------------------------------------------------------------------

class TestDiscoveryEndpoints:
    def test_discover_ok_with_no_events(self, client, mock_query):
        fake_client = MagicMock()
        fake_client.search_events.return_value = []
        with patch('nyrr_api.NyrrApiClient', return_value=fake_client):
            r = client.post('/api/discover')
        j = _no500(r)
        assert j.get('ok') is True

    def test_discover_upcoming_delegates_to_scraper(self, client, mock_query):
        with patch('api_events_discovery.discover_upcoming_events',
                   return_value={'ok': True, 'inserted': 0, 'skipped': 0}):
            r = client.post('/api/discover-upcoming', json={})
        j = _no500(r)
        assert j.get('ok') is True

    def test_reconcile_slugs_delegates_to_worker(self, client, mock_query):
        with patch('sync_worker_reconcile.reconcile_slug_event_codes',
                   return_value={'scanned': 0, 'updated': 0}):
            r = client.post('/api/discover/reconcile-slugs')
        j = _no500(r)
        assert j.get('ok') is True


# ---------------------------------------------------------------------------
# Events: by-code lookup + Tier-4 fuzzy match
# ---------------------------------------------------------------------------

class TestEventLookupAndFuzzy:
    def test_event_by_code_404_when_missing(self, client, mock_query):
        mock_query.return_value = []
        _json_404(client.get('/api/events/by-code/NOPE'))

    def test_fuzzy_match_404_when_event_missing(self, client, mock_query):
        mock_query.return_value = []
        _json_404(client.post('/api/events/999/fuzzy-match'))

    def test_fuzzy_match_starts_job(self, client, mock_query):
        mock_query.return_value = [{'id': 1}]
        with patch('api_events_fuzzy.start_fuzzy_job', return_value='job-1'):
            r = client.post('/api/events/1/fuzzy-match')
        j = _no500(r)
        assert j.get('ok') is True
        assert j.get('job_key') == 'job-1'

    def test_fuzzy_status_404_when_no_job(self, client, mock_query):
        with patch('api_events_fuzzy.get_fuzzy_status', return_value=None):
            _json_404(client.get('/api/events/999/fuzzy-match/status'))


# ---------------------------------------------------------------------------
# NYRR activity / match queue / reconcile
# ---------------------------------------------------------------------------

class TestNyrrActivityAndQueue:
    def test_activity_feed_200(self, client, mock_query):
        j = _no500(client.get('/api/nyrr/activity'))
        assert j.get('ok') is True
        assert 'jobs' in j and 'throttle' in j

    def test_match_queue_200_when_empty(self, client, mock_query):
        mock_query.return_value = []
        j = _no500(client.get('/api/nyrr/match-queue'))
        assert j.get('ok') is True

    def test_bulk_confirm_zero_scanned(self, client, mock_query):
        mock_query.return_value = []
        j = _no500(client.post('/api/nyrr/match-queue/bulk-confirm', json={}))
        assert j.get('ok') is True
        assert j.get('matched') == 0


class TestNyrrReconcile:
    def test_reconcile_list_200(self, client, mock_query):
        mock_query.return_value = []
        j = _no500(client.get('/api/nyrr/reconcile'))
        assert j.get('ok') is True

    def test_probe_404_when_event_missing(self, client, mock_query):
        mock_query.return_value = []
        _json_404(client.post('/api/nyrr/reconcile/999/probe'))

    def test_tag_mmr_404_when_event_missing(self, client, mock_query):
        mock_query.return_value = []
        _json_404(client.post('/api/nyrr/reconcile/999/tag-mmr'))

    def test_tag_mmr_batch_no_candidates(self, client, mock_query):
        mock_query.return_value = []
        with patch('api_nyrr_reconcile.NyrrApiClient'):
            r = client.post('/api/nyrr/reconcile/tag-mmr-batch', json={})
        j = _no500(r)
        assert j.get('ok') is True
        assert j.get('processed') == 0


# ---------------------------------------------------------------------------
# Hall of Fame
# ---------------------------------------------------------------------------

class TestHofReadEndpoints:
    def test_series_list_200_when_empty(self, client, mock_query):
        mock_query.return_value = []
        j = _no500(client.get('/api/hof/series'))
        assert j.get('ok') is True
        assert j.get('series') == []

    def test_series_detail_missing_slug(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/hof/series/no-such-series')
        assert r.status_code in (200, 404)
        assert r.get_json() is not None

    def test_event_hof_missing_code(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/hof/event/NOPE')
        assert r.status_code in (200, 404)
        assert r.get_json() is not None

    def test_events_list_200(self, client, mock_query):
        mock_query.return_value = []
        j = _no500(client.get('/api/hof/events'))
        assert j.get('ok') is True

    def test_distances_200(self, client, mock_query):
        mock_query.return_value = []
        j = _no500(client.get('/api/hof/distances'))
        assert j.get('ok') is True
        assert j.get('distances') == []


class TestHofWriteEndpoints:
    def test_create_series_requires_name_and_slug(self, client, mock_query):
        r = client.post('/api/hof/series', json={})
        assert r.status_code == 400
        assert r.get_json()['ok'] is False

    def test_create_series_201(self, client, mock_query):
        # No existing slug, then the freshly inserted row on re-select
        rows = iter([[], [{'id': 1, 'name': 'Brooklyn Half', 'slug': 'brooklyn-half'}]])
        mock_query.side_effect = lambda *a, **kw: next(rows)
        r = client.post('/api/hof/series',
                        json={'name': 'Brooklyn Half', 'slug': 'brooklyn-half'})
        assert r.status_code == 201
        assert r.get_json()['ok'] is True

    def test_assign_events_empty_body_no_500(self, client, mock_query):
        mock_query.return_value = []
        r = client.patch('/api/hof/series/1/assign-events', json={})
        assert r.status_code < 500
        assert r.get_json() is not None

    def test_set_event_series_404_when_series_missing(self, client, mock_query):
        mock_query.return_value = []
        _json_404(client.patch('/api/hof/events/1/series', json={'series_id': 42}))

    def test_set_event_series_clear_ok(self, client, mock_query):
        j = _no500(client.patch('/api/hof/events/1/series', json={'series_id': None}))
        assert j.get('ok') is True

    def test_set_event_distance_ok(self, client, mock_query):
        j = _no500(client.patch('/api/hof/events/1/distance',
                                json={'distance': 'Half Marathon'}))
        assert j.get('ok') is True

    def test_refresh_mmr_counts_ok(self, client, mock_query):
        mock_query.return_value = []
        j = _no500(client.post('/api/hof/refresh-mmr-counts', json={}))
        assert j.get('ok') is True
