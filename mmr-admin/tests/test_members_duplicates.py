"""
Tests for /api/members/duplicates and /api/members/duplicates/dismiss.

Coverage
────────
GET /api/members/duplicates?type=all
  ├── 200 with ok=True, data has name/phone/wechat keys
  ├── name groups: 3 members with same name, different FamilyIDs → 1 group
  ├── name groups: members sharing same FamilyID → filtered out (same family)
  ├── phone groups: 2 members with same PhoneNumber → 1 group
  ├── wechat groups: 2 members with same WeChatID → 1 group
  ├── type=name only returns name key
  ├── type=phone only returns phone key
  ├── type=wechat only returns wechat key
  ├── dismissed group is excluded from results
  └── 401 when not logged in

POST /api/members/duplicates/dismiss
  ├── 200 happy path → creates dismissal record
  ├── correct dup_type + dup_key written to DB
  ├── admin email recorded from session
  ├── 400 on missing dup_key
  ├── 400 on invalid dup_type
  └── dismissed key no longer shows in GET results
"""

import json
import pytest
from unittest.mock import patch, MagicMock, call


# ─────────────────────────────────────────────────────────────────
# Shared fixtures / helpers
# ─────────────────────────────────────────────────────────────────

def _member_row(member_id, first, last, phone=None, wechat=None, family_id=None):
    """Build a tuple matching the _member_cols() SELECT in api_members_duplicates."""
    return (
        member_id, first, last,
        f'{first.lower()}@example.com',   # Email
        phone,                             # PhoneNumber
        wechat,                            # WeChatID
        'Individual',                      # MemberType
        'active',                          # Status
        '2027-03-31',                      # Expiration
        family_id,                         # FamilyID
        'Manhattan',                       # District
    )


@pytest.fixture()
def auth_client(client):
    """Client with a logged-in admin session."""
    with client.session_transaction() as sess:
        sess['user'] = {'email': 'admin@mmrunners.org', 'role': 'admin'}
        sess['role'] = 'admin'
    return client


# ─────────────────────────────────────────────────────────────────
# GET /api/members/duplicates — structure
# ─────────────────────────────────────────────────────────────────

class TestGetDuplicatesStructure:

    def test_200_response_shape(self, auth_client, mock_query):
        mock_query.return_value = []
        r = auth_client.get('/api/members/duplicates?type=all')
        assert r.status_code == 200
        body = r.get_json()
        assert body['ok'] is True
        assert 'data' in body
        assert 'name' in body['data']
        assert 'phone' in body['data']
        assert 'wechat' in body['data']

    def test_type_name_only_returns_name(self, auth_client, mock_query):
        mock_query.return_value = []
        r = auth_client.get('/api/members/duplicates?type=name')
        assert r.status_code == 200
        data = r.get_json()['data']
        assert 'name' in data
        assert 'phone' not in data
        assert 'wechat' not in data

    def test_type_phone_only_returns_phone(self, auth_client, mock_query):
        mock_query.return_value = []
        r = auth_client.get('/api/members/duplicates?type=phone')
        data = r.get_json()['data']
        assert 'phone' in data
        assert 'name' not in data

    def test_type_wechat_only_returns_wechat(self, auth_client, mock_query):
        mock_query.return_value = []
        r = auth_client.get('/api/members/duplicates?type=wechat')
        data = r.get_json()['data']
        assert 'wechat' in data
        assert 'name' not in data

    def test_401_when_unauthenticated(self, client):
        # conftest sets DEV_BYPASS_AUTH=true; disable it so login_required runs.
        with patch('auth.DEV_BYPASS_AUTH', False):
            r = client.get('/api/members/duplicates')
        assert r.status_code in (401, 302)


# ─────────────────────────────────────────────────────────────────
# GET /api/members/duplicates — name duplicates logic
# ─────────────────────────────────────────────────────────────────

class TestNameDuplicates:
    """
    The name dup query runs in two steps:
      1. SELECT fn, ln, COUNT(*) → group summary rows
      2. For each group: SELECT members with those names
      3. SELECT dismissed keys
    mock_query side_effect must return the right rows per call.
    """

    def _make_query_side_effect(self, group_rows, member_rows_per_group, dismissed_rows=None):
        """
        Build a side_effect list for mock_query covering the sequence of calls
        that _name_dupes() makes:
          call 0: _dismissed_keys → dismissed_rows (list of (dup_key,) tuples)
          call 1: group summary query → group_rows
          call N: per-group member fetch → member_rows_per_group[i]
        """
        dismissed_rows = dismissed_rows or []
        calls = [dismissed_rows, group_rows] + member_rows_per_group
        return calls

    def test_three_members_same_name_different_family(self, auth_client, mock_query):
        """3 members with same name, all different FamilyIDs → 1 group returned."""
        group_rows    = [('john', 'smith', 3)]
        member_rows   = [
            _member_row('A0001', 'John', 'Smith', family_id='F001'),
            _member_row('A0002', 'John', 'Smith', family_id='F002'),
            _member_row('A0003', 'John', 'Smith', family_id='F003'),
        ]
        mock_query.side_effect = self._make_query_side_effect(group_rows, [member_rows])

        r = auth_client.get('/api/members/duplicates?type=name')
        assert r.status_code == 200
        name_groups = r.get_json()['data']['name']
        assert len(name_groups) == 1
        assert name_groups[0]['dup_type'] == 'name'
        assert name_groups[0]['dup_key'] == 'john|smith'
        assert len(name_groups[0]['members']) == 3

    def test_members_same_family_filtered_out(self, auth_client, mock_query):
        """2 members sharing a FamilyID → group excluded (expected duplicates)."""
        group_rows  = [('jane', 'doe', 2)]
        member_rows = [
            _member_row('A0010', 'Jane', 'Doe', family_id='F010'),
            _member_row('A0011', 'Jane', 'Doe', family_id='F010'),
        ]
        mock_query.side_effect = self._make_query_side_effect(group_rows, [member_rows])

        r = auth_client.get('/api/members/duplicates?type=name')
        name_groups = r.get_json()['data']['name']
        assert name_groups == []

    def test_dismissed_group_excluded(self, auth_client, mock_query):
        """A dismissed dup_key is not included in results."""
        dismissed_rows = [('john|smith',)]
        group_rows     = [('john', 'smith', 2)]
        mock_query.side_effect = [dismissed_rows, group_rows]  # group skipped → no member fetch

        r = auth_client.get('/api/members/duplicates?type=name')
        name_groups = r.get_json()['data']['name']
        assert name_groups == []


# ─────────────────────────────────────────────────────────────────
# GET /api/members/duplicates — phone duplicates
# ─────────────────────────────────────────────────────────────────

class TestPhoneDuplicates:

    def test_two_members_same_phone(self, auth_client, mock_query):
        phone = '5551234567'
        dismissed_rows = []
        group_rows     = [(phone, 2)]
        member_rows    = [
            _member_row('A0020', 'Alice', 'Wu', phone=phone),
            _member_row('A0021', 'Alice', 'Wu', phone=phone),
        ]
        mock_query.side_effect = [dismissed_rows, group_rows, member_rows]

        r = auth_client.get('/api/members/duplicates?type=phone')
        phone_groups = r.get_json()['data']['phone']
        assert len(phone_groups) == 1
        assert phone_groups[0]['dup_type'] == 'phone'
        assert phone_groups[0]['dup_key'] == phone
        assert len(phone_groups[0]['members']) == 2

    def test_dismissed_phone_excluded(self, auth_client, mock_query):
        phone = '5551234567'
        dismissed_rows = [(phone,)]
        group_rows     = [(phone, 2)]
        mock_query.side_effect = [dismissed_rows, group_rows]

        r = auth_client.get('/api/members/duplicates?type=phone')
        assert r.get_json()['data']['phone'] == []


# ─────────────────────────────────────────────────────────────────
# GET /api/members/duplicates — wechat duplicates
# ─────────────────────────────────────────────────────────────────

class TestWechatDuplicates:

    def test_two_members_same_wechat(self, auth_client, mock_query):
        wechat = 'wxid_abc123'
        dismissed_rows = []
        group_rows     = [(wechat, 2)]
        member_rows    = [
            _member_row('A0030', 'Bob', 'Chen', wechat=wechat),
            _member_row('A0031', 'Bob', 'Chen', wechat=wechat),
        ]
        mock_query.side_effect = [dismissed_rows, group_rows, member_rows]

        r = auth_client.get('/api/members/duplicates?type=wechat')
        wechat_groups = r.get_json()['data']['wechat']
        assert len(wechat_groups) == 1
        assert wechat_groups[0]['dup_type'] == 'wechat'
        assert wechat_groups[0]['dup_key'] == wechat


# ─────────────────────────────────────────────────────────────────
# POST /api/members/duplicates/dismiss
# ─────────────────────────────────────────────────────────────────

class TestDismissDuplicate:

    def _post(self, auth_client, body):
        return auth_client.post(
            '/api/members/duplicates/dismiss',
            data=json.dumps(body),
            content_type='application/json',
        )

    def test_200_happy_path_name(self, auth_client, mock_query):
        mock_query.return_value = []
        r = self._post(auth_client, {'dup_type': 'name', 'dup_key': 'john|smith'})
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_dismiss_calls_db_with_correct_args(self, auth_client, mock_query):
        mock_query.return_value = []
        self._post(auth_client, {'dup_type': 'phone', 'dup_key': '5551234567'})
        # The INSERT call should have been made
        assert mock_query.called
        call_args = mock_query.call_args
        assert 'INSERT INTO member_duplicate_dismissals' in call_args[0][0]
        params = call_args[0][1]
        assert params[0] == 'phone'
        assert params[1] == '5551234567'
        assert params[2] == 'admin@mmrunners.org'  # from session fixture

    def test_400_missing_dup_key(self, auth_client, mock_query):
        mock_query.return_value = []
        r = self._post(auth_client, {'dup_type': 'name'})
        assert r.status_code == 400
        assert r.get_json()['ok'] is False

    def test_400_invalid_dup_type(self, auth_client, mock_query):
        mock_query.return_value = []
        r = self._post(auth_client, {'dup_type': 'email', 'dup_key': 'foo'})
        assert r.status_code == 400
        assert r.get_json()['ok'] is False

    def test_401_when_unauthenticated(self, client, mock_query):
        # conftest sets DEV_BYPASS_AUTH=true; disable it so login_required runs.
        with patch('auth.DEV_BYPASS_AUTH', False):
            r = client.post(
                '/api/members/duplicates/dismiss',
                data=json.dumps({'dup_type': 'name', 'dup_key': 'x'}),
                content_type='application/json',
            )
        assert r.status_code in (401, 302)
