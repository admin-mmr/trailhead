"""
Tests for api_audit_members.py:
  POST /api/audit/reconcile        — sp_reconcile_member_payments wrapper
  GET  /api/audit/expiration-drift — unpaid members with expiration drift

Mocked DB — no live MySQL required.
"""
import pytest
from datetime import date
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ok(r):
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.data[:300]}"
    return r.get_json()


def _post(client, path, body=None):
    return client.post(path, json=body or {})


# ---------------------------------------------------------------------------
# Shared mock rows
# ---------------------------------------------------------------------------

def _indiv_row(member_id='A0100', exp_drift='CHANGED', has_override='NO', flag='⚠ UNEXPLAINED'):
    return {
        'member_id':           member_id,
        'member_name':         'Test Member',
        'member_type':         'Individual',
        'family_id':           None,
        'current_status':      'inactive',
        'first_log_expiration': '2025-03-31',
        'current_expiration':  '2027-03-31',
        'exp_drift':           exp_drift,
        'has_override':        has_override,
        'flag':                flag,
    }


def _family_row(member_id='A0200', family_id='F001', exp_drift='CHANGED', flag='⚠ UNEXPLAINED'):
    return {
        'member_id':           member_id,
        'member_name':         'Family Member',
        'member_type':         'Family',
        'family_id':           family_id,
        'current_status':      'inactive',
        'first_log_expiration': '2025-03-31',
        'current_expiration':  '2027-03-31',
        'exp_drift':           exp_drift,
        'has_override':        'NO',
        'flag':                flag,
    }


# ===========================================================================
# Reconcile
# ===========================================================================

class TestReconcile:
    """POST /api/audit/reconcile"""

    def test_dry_run_true_200(self, client, mock_query):
        mock_query.return_value = []
        data = ok(_post(client, '/api/audit/reconcile', {'dry_run': True}))
        assert data['success'] is True
        assert data['dry_run'] is True
        assert isinstance(data['rows'], list)
        assert data['count'] == 0

    def test_dry_run_false_200(self, client, mock_query):
        mock_query.return_value = []
        data = ok(_post(client, '/api/audit/reconcile', {'dry_run': False}))
        assert data['success'] is True
        assert data['dry_run'] is False

    def test_defaults_to_dry_run(self, client, mock_query):
        """Empty body must default to dry_run=True — safe by default."""
        mock_query.return_value = []
        data = ok(_post(client, '/api/audit/reconcile', {}))
        assert data['dry_run'] is True

    def test_no_body_safe(self, client, mock_query):
        """Missing Content-Type / body must not 500."""
        mock_query.return_value = []
        r = client.post('/api/audit/reconcile')
        assert r.status_code == 200

    def test_rows_serialized(self, client, mock_query):
        """date objects in SP result must be ISO strings, not raw date objects."""
        mock_query.return_value = [
            {'MemberID': 'A0001', 'current_expiration': date(2027, 3, 31),
             'new_amount': 30.0, 'status_match': 'STATUS MISMATCH'}
        ]
        data = ok(_post(client, '/api/audit/reconcile', {'dry_run': True}))
        assert data['count'] == 1
        assert data['rows'][0]['current_expiration'] == '2027-03-31'

    def test_count_matches_rows(self, client, mock_query):
        mock_query.return_value = [_indiv_row(), _indiv_row('A0101')]
        data = ok(_post(client, '/api/audit/reconcile', {'dry_run': True}))
        assert data['count'] == len(data['rows'])


# ===========================================================================
# Expiration Drift
# ===========================================================================

class TestExpirationDrift:
    """GET /api/audit/expiration-drift"""

    # ── response shape ──────────────────────────────────────────────────

    def test_default_200_shape(self, client, mock_query):
        """Default (type=all, flag_only=0) must return 200 with all summary fields."""
        mock_query.return_value = []
        data = ok(client.get('/api/audit/expiration-drift'))
        assert data['success'] is True
        for key in ('count', 'unexplained', 'changed', 'type_filter', 'flag_only', 'rows'):
            assert key in data, f"Missing key: {key}"
        assert data['type_filter'] == 'all'
        assert data['flag_only'] is False

    def test_empty_result(self, client, mock_query):
        mock_query.return_value = []
        data = ok(client.get('/api/audit/expiration-drift'))
        assert data['count'] == 0
        assert data['unexplained'] == 0
        assert data['changed'] == 0
        assert data['rows'] == []

    # ── type filter ──────────────────────────────────────────────────────

    def test_type_individual_calls_query_once(self, client, mock_query):
        """type=individual must run exactly one DB query (individual SQL only)."""
        mock_query.return_value = [_indiv_row()]
        data = ok(client.get('/api/audit/expiration-drift?type=individual'))
        assert data['type_filter'] == 'individual'
        assert mock_query.call_count == 1

    def test_type_family_calls_query_once(self, client, mock_query):
        """type=family must run exactly one DB query (family SQL only)."""
        mock_query.return_value = [_family_row()]
        data = ok(client.get('/api/audit/expiration-drift?type=family'))
        assert data['type_filter'] == 'family'
        assert mock_query.call_count == 1

    def test_type_all_calls_query_twice(self, client, mock_query):
        """type=all (default) must run two queries and concatenate results."""
        mock_query.return_value = [_indiv_row()]
        data = ok(client.get('/api/audit/expiration-drift?type=all'))
        assert mock_query.call_count == 2
        # two calls × one row each = 2 total
        assert data['count'] == 2

    def test_type_unknown_returns_empty(self, client, mock_query):
        """Unknown type value falls through both branches → empty rows."""
        mock_query.return_value = [_indiv_row()]
        data = ok(client.get('/api/audit/expiration-drift?type=bogus'))
        assert data['count'] == 0
        assert mock_query.call_count == 0

    # ── flag_only filter ─────────────────────────────────────────────────

    def test_flag_only_filters_unexplained(self, client, mock_query):
        """flag_only=1 must return only ⚠ UNEXPLAINED rows."""
        mock_query.return_value = [
            _indiv_row('A0100', flag='⚠ UNEXPLAINED'),
            _indiv_row('A0101', exp_drift='ok', has_override='NO', flag=''),
            _indiv_row('A0102', exp_drift='CHANGED', has_override='YES', flag=''),
        ]
        data = ok(client.get('/api/audit/expiration-drift?type=individual&flag_only=1'))
        assert data['flag_only'] is True
        assert data['count'] == 1
        assert data['rows'][0]['member_id'] == 'A0100'

    def test_flag_only_zero_returns_all(self, client, mock_query):
        """flag_only=0 (default) must return all rows regardless of flag."""
        mock_query.return_value = [
            _indiv_row('A0100', flag='⚠ UNEXPLAINED'),
            _indiv_row('A0101', exp_drift='ok', has_override='NO', flag=''),
        ]
        data = ok(client.get('/api/audit/expiration-drift?type=individual&flag_only=0'))
        assert data['flag_only'] is False
        assert data['count'] == 2

    # ── summary counts ───────────────────────────────────────────────────

    def test_unexplained_count(self, client, mock_query):
        """unexplained must count only rows with flag='⚠ UNEXPLAINED'."""
        mock_query.return_value = [
            _indiv_row('A0100', flag='⚠ UNEXPLAINED'),
            _indiv_row('A0101', flag='⚠ UNEXPLAINED'),
            _indiv_row('A0102', exp_drift='ok', has_override='NO', flag=''),
        ]
        data = ok(client.get('/api/audit/expiration-drift?type=individual'))
        assert data['unexplained'] == 2
        assert data['count'] == 3

    def test_changed_count(self, client, mock_query):
        """changed must count rows with exp_drift='CHANGED' regardless of flag."""
        mock_query.return_value = [
            _indiv_row('A0100', exp_drift='CHANGED', has_override='YES', flag=''),
            _indiv_row('A0101', exp_drift='CHANGED', has_override='NO',  flag='⚠ UNEXPLAINED'),
            _indiv_row('A0102', exp_drift='ok',      has_override='NO',  flag=''),
        ]
        data = ok(client.get('/api/audit/expiration-drift?type=individual'))
        assert data['changed'] == 2
        assert data['unexplained'] == 1

    def test_counts_zero_when_all_ok(self, client, mock_query):
        mock_query.return_value = [
            _indiv_row('A0100', exp_drift='ok', has_override='NO', flag=''),
            _indiv_row('A0101', exp_drift='ok', has_override='NO', flag=''),
        ]
        data = ok(client.get('/api/audit/expiration-drift?type=individual'))
        assert data['unexplained'] == 0
        assert data['changed'] == 0

    # ── flag logic ───────────────────────────────────────────────────────

    def test_changed_with_override_not_flagged(self, client, mock_query):
        """exp_drift=CHANGED + has_override=YES must NOT be ⚠ UNEXPLAINED."""
        row = _indiv_row('A0100', exp_drift='CHANGED', has_override='YES', flag='')
        mock_query.return_value = [row]
        data = ok(client.get('/api/audit/expiration-drift?type=individual'))
        assert data['rows'][0]['flag'] == ''
        assert data['unexplained'] == 0

    def test_changed_without_override_flagged(self, client, mock_query):
        """exp_drift=CHANGED + has_override=NO must be ⚠ UNEXPLAINED."""
        row = _indiv_row('A0100', exp_drift='CHANGED', has_override='NO', flag='⚠ UNEXPLAINED')
        mock_query.return_value = [row]
        data = ok(client.get('/api/audit/expiration-drift?type=individual'))
        assert data['rows'][0]['flag'] == '⚠ UNEXPLAINED'
        assert data['unexplained'] == 1

    def test_ok_drift_never_flagged(self, client, mock_query):
        """exp_drift=ok must never produce a flag, even without an override."""
        row = _indiv_row('A0100', exp_drift='ok', has_override='NO', flag='')
        mock_query.return_value = [row]
        data = ok(client.get('/api/audit/expiration-drift?type=individual'))
        assert data['rows'][0]['flag'] == ''
        assert data['unexplained'] == 0

    # ── date serialization ───────────────────────────────────────────────

    def test_date_objects_serialized(self, client, mock_query):
        """date objects returned by MySQL must be ISO strings in the response."""
        mock_query.return_value = [{
            **_indiv_row(),
            'first_log_expiration': date(2025, 3, 31),
            'current_expiration':   date(2027, 3, 31),
        }]
        data = ok(client.get('/api/audit/expiration-drift?type=individual'))
        row = data['rows'][0]
        assert row['first_log_expiration'] == '2025-03-31'
        assert row['current_expiration']   == '2027-03-31'

    # ── family rows ──────────────────────────────────────────────────────

    def test_family_rows_have_family_id(self, client, mock_query):
        mock_query.return_value = [_family_row()]
        data = ok(client.get('/api/audit/expiration-drift?type=family'))
        assert data['rows'][0]['family_id'] == 'F001'
        assert data['rows'][0]['member_type'] == 'Family'

    def test_type_all_merges_individual_and_family(self, client, mock_query):
        """type=all must concatenate individual + family rows."""
        def _side_effect(sql, *a, **kw):
            if 'FamilyID IS NULL' in sql or "FamilyID = ''" in sql:
                return [_indiv_row('A0100')]
            return [_family_row('A0200')]
        mock_query.side_effect = _side_effect
        data = ok(client.get('/api/audit/expiration-drift?type=all'))
        ids = [r['member_id'] for r in data['rows']]
        assert 'A0100' in ids
        assert 'A0200' in ids
        mock_query.side_effect = None

    # ── flag_only + family ───────────────────────────────────────────────

    def test_flag_only_works_on_family_rows(self, client, mock_query):
        mock_query.return_value = [
            _family_row('A0200', flag='⚠ UNEXPLAINED'),
            _family_row('A0201', exp_drift='ok', flag=''),
        ]
        data = ok(client.get('/api/audit/expiration-drift?type=family&flag_only=1'))
        assert data['count'] == 1
        assert data['rows'][0]['member_id'] == 'A0200'
