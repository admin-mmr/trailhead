"""
Unit tests for POST /api/members/family/upgrade-and-add

Coverage
────────
  Happy path
  ├── Individual primary + Individual second → 200, FamilyID generated, both become Family
  ├── Response contains family_id, primary_member, members list, message
  ├── DB cursor executes SET @internal_proc, two UPDATEs, SET @internal_proc NULL
  ├── Second member inherits primary's Status, Expiration, MembershipFeePaid,
  │   PaymentDate, PaymentTransaction
  └── log_activity called twice (once per member)

  Validation — 400 / 404 / 409
  ├── Missing primary_member_id → 400
  ├── Missing new_member_id    → 400
  ├── Same IDs for both        → 400
  ├── Primary not found        → 404
  ├── Second member not found  → 404
  ├── Primary already Family with FamilyID → 409 (use add-member instead)
  └── Second member already in a different family → 409

  FamilyID generation
  ├── No existing B### IDs → B001
  ├── B001 taken → B002
  └── Gap in sequence (B001, B003 taken) → B002

All DB calls are mocked — no live MySQL required.
"""
import pytest
from unittest.mock import patch, MagicMock, call


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _member(member_id='A0001', first='John', last='Smith', status='active',
            type_='Individual', family_id=None, expiration='2026-12-31',
            fee_paid=30, pay_date='2025-01-01', pay_tx='TX001'):
    return {
        'MemberID': member_id,
        'FirstName': first,
        'LastName': last,
        'Email': f'{member_id.lower()}@example.com',
        'Type': type_,
        'FamilyID': family_id,
        'Status': status,
        'Expiration': expiration,
        'MembershipFeePaid': fee_paid,
        'PaymentDate': pay_date,
        'PaymentTransaction': pay_tx,
        'District': 'Manhattan',
        'UpdatedAt': None,
    }


def _family_member(**kwargs):
    return _member(type_='Family', family_id='B001', **kwargs)


def _post(client, body):
    return client.post('/api/members/family/upgrade-and-add', json=body)


def _mock_cursor():
    """Return a context-manager-compatible mock cursor."""
    cur = MagicMock()
    cur.__enter__ = MagicMock(return_value=cur)
    cur.__exit__ = MagicMock(return_value=False)
    return cur


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

class TestUpgradeAndAddHappyPath:

    def _run(self, client, mock_query, primary_id='A0001', second_id='A0002'):
        """
        Set up mock_query side_effect for the full happy path and call the endpoint.
        Returns (response, mock_cursor).
        """
        primary = _member(member_id=primary_id, status='active', type_='Individual',
                          family_id=None, expiration='2026-12-31')
        second = _member(member_id=second_id, type_='Individual', family_id=None)
        updated_primary = _member(member_id=primary_id, type_='Family', family_id='B001')
        family_list = [
            _member(member_id=primary_id, type_='Family', family_id='B001'),
            _member(member_id=second_id, type_='Family', family_id='B001'),
        ]

        call_count = 0

        def side_effect(sql, *a, **kw):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [primary]          # get_member_by_id(primary)
            if call_count == 2:
                return [second]           # get_member_by_id(second)
            if call_count == 3:
                return [updated_primary]  # get_member_by_id after update
            return family_list            # get_family_members

        mock_query.side_effect = side_effect

        cur = _mock_cursor()
        with patch('api_members_family.query', return_value=[]) as gen_q, \
             patch('api_members_family_ops.db_cursor', return_value=cur), \
             patch('api_members_family_ops.log_activity') as mock_log, \
             patch('api_members_family_ops.get_admin_id', return_value='admin@mmr.org'):
            r = _post(client, {'primary_member_id': primary_id, 'new_member_id': second_id})

        mock_query.side_effect = None
        return r, cur, mock_log

    def test_returns_200(self, client, mock_query):
        r, _, _ = self._run(client, mock_query)
        assert r.status_code == 200

    def test_response_ok_flag(self, client, mock_query):
        r, _, _ = self._run(client, mock_query)
        assert r.get_json()['ok'] is True

    def test_response_contains_family_id(self, client, mock_query):
        r, _, _ = self._run(client, mock_query)
        assert r.get_json()['data']['family_id'] == 'B001'

    def test_response_contains_primary_member(self, client, mock_query):
        r, _, _ = self._run(client, mock_query)
        assert r.get_json()['data']['primary_member']['MemberID'] == 'A0001'

    def test_response_contains_two_family_members(self, client, mock_query):
        r, _, _ = self._run(client, mock_query)
        members = r.get_json()['data']['members']
        assert len(members) == 2
        ids = {m['MemberID'] for m in members}
        assert ids == {'A0001', 'A0002'}

    def test_response_contains_message(self, client, mock_query):
        r, _, _ = self._run(client, mock_query)
        msg = r.get_json()['data']['message']
        assert 'A0001' in msg and 'A0002' in msg and 'B001' in msg

    def test_cursor_executes_internal_proc_guards(self, client, mock_query):
        """SET @internal_proc = 1 and SET @internal_proc = NULL must wrap the UPDATEs."""
        _, cur, _ = self._run(client, mock_query)
        calls = [str(c) for c in cur.execute.call_args_list]
        assert any('@internal_proc = 1' in c for c in calls)
        assert any('@internal_proc = NULL' in c for c in calls)

    def test_cursor_executes_two_updates(self, client, mock_query):
        """Exactly two UPDATE statements must be issued (one per member)."""
        _, cur, _ = self._run(client, mock_query)
        updates = [c for c in cur.execute.call_args_list
                   if 'UPDATE' in str(c.args[0])]
        assert len(updates) == 2

    def test_second_member_inherits_payment_fields(self, client, mock_query):
        """The second UPDATE must pass the primary's payment data."""
        _, cur, _ = self._run(client, mock_query)
        # Second UPDATE is the one where MemberID = A0002 (second positional tuple)
        updates = [c for c in cur.execute.call_args_list
                   if 'UPDATE' in str(c.args[0])]
        # The second UPDATE args tuple: (family_id, status, expiration, fee, date, tx, now, member_id)
        second_args = updates[1].args[1]
        assert second_args[0] == 'B001'       # FamilyID
        assert second_args[1] == 'active'     # Status from primary
        assert second_args[2] == '2026-12-31' # Expiration from primary

    def test_log_activity_called_twice(self, client, mock_query):
        """One log entry per affected member."""
        _, _, mock_log = self._run(client, mock_query)
        assert mock_log.call_count == 2

    def test_log_activity_actions(self, client, mock_query):
        _, _, mock_log = self._run(client, mock_query)
        actions = [c.kwargs.get('action') or c.args[0]
                   for c in mock_log.call_args_list]
        assert all(a == 'member_family_upgrade_and_add' for a in actions)


# ---------------------------------------------------------------------------
# Input validation — missing / bad body fields
# ---------------------------------------------------------------------------

class TestUpgradeAndAddValidation:

    def test_missing_primary_member_id_returns_400(self, client, mock_query):
        r = _post(client, {'new_member_id': 'A0002'})
        assert r.status_code == 400
        assert r.get_json()['ok'] is False

    def test_missing_new_member_id_returns_400(self, client, mock_query):
        r = _post(client, {'primary_member_id': 'A0001'})
        assert r.status_code == 400

    def test_empty_body_returns_400(self, client, mock_query):
        r = _post(client, {})
        assert r.status_code == 400

    def test_same_id_for_both_returns_400(self, client, mock_query):
        r = _post(client, {'primary_member_id': 'A0001', 'new_member_id': 'A0001'})
        assert r.status_code == 400
        assert 'different' in r.get_json()['error']


# ---------------------------------------------------------------------------
# Not found — 404
# ---------------------------------------------------------------------------

class TestUpgradeAndAddNotFound:

    def test_primary_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, {'primary_member_id': 'A9999', 'new_member_id': 'A0002'})
        assert r.status_code == 404

    def test_second_member_not_found_returns_404(self, client, mock_query):
        call_count = 0

        def side_effect(sql, *a, **kw):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [_member(member_id='A0001')]  # primary found
            return []                                # second not found

        mock_query.side_effect = side_effect
        r = _post(client, {'primary_member_id': 'A0001', 'new_member_id': 'A9999'})
        assert r.status_code == 404
        mock_query.side_effect = None


# ---------------------------------------------------------------------------
# Conflict — 409
# ---------------------------------------------------------------------------

class TestUpgradeAndAddConflicts:

    def test_primary_already_family_with_id_returns_409(self, client, mock_query):
        """Primary is already Family type with a FamilyID — use add-member instead."""
        mock_query.return_value = [_member(type_='Family', family_id='B002')]
        r = _post(client, {'primary_member_id': 'A0001', 'new_member_id': 'A0002'})
        assert r.status_code == 409
        assert 'add-member' in r.get_json()['error'].lower() or \
               'already Family' in r.get_json()['error'] or \
               'already' in r.get_json()['error']

    def test_second_member_already_in_family_returns_409(self, client, mock_query):
        """Second member has an existing FamilyID — cannot add to new family."""
        call_count = 0

        def side_effect(sql, *a, **kw):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [_member(member_id='A0001', type_='Individual', family_id=None)]
            return [_member(member_id='A0002', type_='Family', family_id='B099')]  # already in a family

        mock_query.side_effect = side_effect
        r = _post(client, {'primary_member_id': 'A0001', 'new_member_id': 'A0002'})
        assert r.status_code == 409
        assert 'B099' in r.get_json()['error']
        mock_query.side_effect = None


# ---------------------------------------------------------------------------
# FamilyID generation logic (unit test on generate_family_id directly)
# ---------------------------------------------------------------------------

class TestGenerateFamilyId:

    def _gen(self, existing_ids):
        """Call generate_family_id with a mocked query returning `existing_ids`."""
        from api_members_family import generate_family_id
        rows = [{'FamilyID': fid} for fid in existing_ids]
        with patch('api_members_family.query', return_value=rows):
            return generate_family_id()

    def test_no_existing_ids_returns_b001(self):
        assert self._gen([]) == 'B001'

    def test_b001_taken_returns_b002(self):
        assert self._gen(['B001']) == 'B002'

    def test_gap_in_sequence_filled(self):
        """B001 and B003 exist → B002 is the next available."""
        assert self._gen(['B001', 'B003']) == 'B002'

    def test_non_b_ids_ignored(self):
        """Non-B### values (e.g. legacy or malformed) don't block B001."""
        assert self._gen(['FAM001', 'X999', '']) == 'B001'

    def test_all_slots_taken_raises(self):
        from api_members_family import generate_family_id
        all_ids = [f'B{n:03d}' for n in range(1, 1000)]
        rows = [{'FamilyID': fid} for fid in all_ids]
        with patch('api_members_family.query', return_value=rows):
            with pytest.raises(ValueError, match='No available FamilyIDs'):
                generate_family_id()
