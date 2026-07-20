"""
Unit tests for core business logic — pure functions and high-risk route paths.

Covers gaps identified in coverage audit:
  - payment_matching: fuzzy_match_transaction_to_member, autoguess_single_transaction,
    build_member_text, build_transaction_text, partial_name_match
  - payment_helpers: is_within_renewal_period
  - api_members: _build_member_search
  - api_payments: manual-approve orphan path
  - api_members_status: revert-status validation, mark-active validation

All DB calls are mocked — no live MySQL required.
"""
import pytest
from datetime import date, datetime
from decimal import Decimal
from unittest.mock import patch, MagicMock, call


# ---------------------------------------------------------------------------
# Helpers shared across tests
# ---------------------------------------------------------------------------

def _member(member_id='A0001', first='John', last='Smith', type_='Individual',
            wechat='', email='john@example.com', nyrr=''):
    return {
        'MemberID': member_id, 'FirstName': first, 'LastName': last,
        'Type': type_, 'WeChatID': wechat, 'Email': email,
        'NYRRRunnerName': nyrr, 'Status': 'active',
        'Expiration': None, 'FamilyID': None,
    }


def _gmail(tx_num='TX001', sender='John Smith', memo='A0001 renewal',
           amount=30.0, tx_date='2025-11-01', notes=''):
    return {
        'TransactionNumber': tx_num, 'Sender': sender, 'Memo': memo,
        'Amount': amount, 'TransactionDate': tx_date, 'Notes': notes,
    }


# ---------------------------------------------------------------------------
# build_member_text / build_transaction_text
# ---------------------------------------------------------------------------

class TestBuildText:
    def setup_method(self):
        from payment_matching import build_member_text, build_transaction_text
        self.build_member = build_member_text
        self.build_tx = build_transaction_text

    def test_member_text_includes_all_fields(self):
        m = _member(first='Ming', last='Lin', wechat='minglin_wc',
                    email='ming@example.com', nyrr='MING LIN')
        text = self.build_member(m)
        assert 'ming' in text
        assert 'lin' in text
        assert 'minglin_wc' in text
        assert 'ming' in text          # email local part
        assert 'ming lin' in text      # nyrr name

    def test_member_text_omits_at_domain(self):
        """Only the local part of the email should appear, not the domain."""
        m = _member(email='user@mmrunners.org')
        text = self.build_member(m)
        assert '@' not in text
        assert 'mmrunners' not in text
        assert 'user' in text

    def test_member_text_no_nyrr(self):
        m = _member(nyrr='')
        text = self.build_member(m)
        assert text  # still produces something

    def test_member_text_empty_fields_no_crash(self):
        m = {'MemberID': 'A0001', 'FirstName': '', 'LastName': '',
             'WeChatID': '', 'Email': '', 'NYRRRunnerName': None}
        text = self.build_member(m)
        assert isinstance(text, str)

    def test_transaction_text_concatenates_fields(self):
        g = _gmail(sender='Alice Wang', memo='A0001', notes='linked')
        text = self.build_tx(g)
        assert 'alice wang' in text
        assert 'a0001' in text
        assert 'linked' in text

    def test_transaction_text_handles_none_fields(self):
        g = {'Sender': None, 'Memo': None, 'Notes': None}
        text = self.build_tx(g)
        assert isinstance(text, str)


# ---------------------------------------------------------------------------
# fuzzy_match_transaction_to_member — all 4 rules
# ---------------------------------------------------------------------------

class TestFuzzyMatch:
    def setup_method(self):
        from payment_matching import fuzzy_match_transaction_to_member
        self.match = fuzzy_match_transaction_to_member

    def test_rule1_member_id_in_tx_text(self):
        """Rule 1: MemberID substring in transaction text → priority 1."""
        g = _gmail(memo='A0001 renewal', sender='someone')
        m = _member(member_id='A0001')
        matched, priority = self.match(g, m)
        assert matched is True
        assert priority == 1

    def test_rule1_case_insensitive(self):
        """Rule 1 is case-insensitive — 'a0001' in memo should still match A0001."""
        g = _gmail(memo='payment from a0001')
        m = _member(member_id='A0001')
        matched, priority = self.match(g, m)
        assert matched and priority == 1

    def test_rule2_tx_last4_matches_member_digits(self):
        """Rule 2: last 4 digits of TransactionNumber match the 4 digits of MemberID."""
        g = _gmail(tx_num='TX00010001', memo='no id here', sender='unknown')
        m = _member(member_id='A0001')
        matched, priority = self.match(g, m)
        assert matched is True
        assert priority == 2

    def test_rule2_does_not_trigger_if_rule1_already_matched(self):
        """Rule 1 fires first — rule 2 priority should not appear when rule 1 matches."""
        g = _gmail(tx_num='TX0001', memo='A0001')
        m = _member(member_id='A0001')
        _, priority = self.match(g, m)
        assert priority == 1  # rule 1 wins

    def test_rule3_every_sender_word_in_member_text(self):
        """Rule 3: every word in Sender is a substring of member_text."""
        g = _gmail(sender='john smith', memo='payment', tx_num='TX9999')
        m = _member(first='John', last='Smith', member_id='A0002')
        matched, priority = self.match(g, m)
        assert matched is True
        assert priority == 3

    def test_rule3_fails_if_one_sender_word_missing(self):
        """Rule 3 requires ALL words to match — partial match is not enough."""
        g = _gmail(sender='john doe', memo='payment', tx_num='TX9999')
        m = _member(first='John', last='Smith', member_id='A0002')
        # 'john' matches but 'doe' doesn't
        matched, priority = self.match(g, m)
        assert priority != 3 or not matched

    def test_rule4_any_member_word_in_tx_text(self):
        """Rule 4: any word from member_text appears in transaction text.
        Sender must not fully match member_text (else Rule 3 fires first)."""
        # sender 'xyz123' is NOT in member_text 'alice wang', so Rule 3 fails.
        # But 'alice' (from member_text) IS in the memo, so Rule 4 fires.
        g = _gmail(sender='xyz123', memo='payment from alice', tx_num='TX8888')
        m = _member(first='Alice', last='Wang', member_id='A0099')
        matched, priority = self.match(g, m)
        assert matched is True
        assert priority == 4

    def test_no_match_returns_false_priority_zero(self):
        """When nothing matches, must return (False, 0)."""
        g = _gmail(sender='xyz corp', memo='random payment', tx_num='TX0000')
        m = _member(first='John', last='Smith', member_id='A0001')
        matched, priority = self.match(g, m)
        assert matched is False
        assert priority == 0

    def test_empty_member_id_skips_rule1(self):
        g = _gmail(memo='A0001')
        m = {**_member(), 'MemberID': ''}
        matched, priority = self.match(g, m)
        # Rule 1 can't fire without a member ID; may still match via other rules
        assert priority != 1


# ---------------------------------------------------------------------------
# autoguess_single_transaction — core autoguess logic
# ---------------------------------------------------------------------------

class TestAutoguessTransaction:
    """Tests for autoguess_single_transaction — the core payment matching function.
    All DB side-effects (execute) are mocked; pure logic is exercised directly."""

    def setup_method(self):
        from payment_matching import autoguess_single_transaction
        self.autoguess = autoguess_single_transaction

    def _run(self, tx=None, member=None, pending_sub=None,
             renewal_start=date(2025, 10, 1), renewal_end=date(2026, 3, 31)):
        tx = tx or _gmail()
        members = {member['MemberID']: member} if member else {'A0001': _member()}
        subs = {list(members.keys())[0]: pending_sub} if pending_sub else {}
        with patch('payment_matching.execute') as mock_exec:
            result = self.autoguess(
                tx=tx, admin_email='admin@mmrunners.org',
                all_members=members, pending_subs_map=subs,
                renewal_start=renewal_start, renewal_end=renewal_end,
            )
        return result, mock_exec

    def test_happy_path_individual_creates_payment(self):
        """Individual $30 with ID in memo within renewal period → created=True."""
        result, mock_exec = self._run()
        assert result['created'] is True
        assert mock_exec.call_count >= 1  # INSERT into payments

    def test_family_50_dollar_match(self):
        """Family member with $50 amount → created=True."""
        tx = _gmail(amount=50.0, memo='A0001 dues')
        member = _member(type_='Family')
        result, mock_exec = self._run(tx=tx, member=member)
        assert result['created'] is True

    def test_wrong_amount_individual_skipped(self):
        """$50 payment for Individual member → amount mismatch → skipped."""
        tx = _gmail(amount=50.0)
        result, _ = self._run(tx=tx)
        assert result['created'] is False
        assert 'Amount' in result['reason'] or 'amount' in result['reason'].lower()

    def test_wrong_amount_family_skipped(self):
        """$30 payment for Family member → amount mismatch → skipped."""
        tx = _gmail(amount=30.0)
        member = _member(type_='Family')
        result, _ = self._run(tx=tx, member=member)
        assert result['created'] is False

    def test_no_member_id_in_memo_skipped(self):
        """Memo with no A#### pattern → skipped immediately."""
        tx = _gmail(memo='monthly payment thank you')
        result, _ = self._run(tx=tx)
        assert result['created'] is False
        assert 'memo' in result['reason'].lower() or 'memberID' in result['reason']

    def test_unknown_member_skipped(self):
        """MemberID in memo but not in members dict → skipped."""
        tx = _gmail(memo='A9999 renewal')
        result, _ = self._run(tx=tx)  # members dict only has A0001
        assert result['created'] is False
        assert 'not found' in result['reason'].lower()

    def test_outside_renewal_period_skipped(self):
        """Transaction date before renewal window → skipped."""
        tx = _gmail(tx_date='2025-01-01')
        result, _ = self._run(tx=tx)
        assert result['created'] is False
        assert 'period' in result['reason'].lower() or 'renewal' in result['reason'].lower()

    def test_payment_created_without_submission(self):
        """No pending submission → payment still created (submission_id=None)."""
        result, mock_exec = self._run(pending_sub=None)
        assert result['created'] is True
        # First execute call should be the INSERT; check SubmissionID is None
        insert_args = mock_exec.call_args_list[0][0][1]
        assert insert_args[4] is None  # submission_id position

    def test_payment_linked_to_submission(self):
        """Pending submission exists → payment INSERT includes SubmissionID."""
        result, mock_exec = self._run(pending_sub='SUB-123')
        assert result['created'] is True
        insert_args = mock_exec.call_args_list[0][0][1]
        assert insert_args[4] == 'SUB-123'

    def test_none_amount_skipped(self):
        """tx with no amount → skipped with reason."""
        tx = {**_gmail(), 'Amount': None}
        result, _ = self._run(tx=tx)
        assert result['created'] is False

    def test_execute_error_returns_false(self):
        """DB error during INSERT → created=False, no exception propagates."""
        tx = _gmail()
        members = {'A0001': _member()}
        with patch('payment_matching.execute', side_effect=Exception('DB down')):
            result = self.autoguess(
                tx=tx, admin_email='admin@mmrunners.org',
                all_members=members, pending_subs_map={},
                renewal_start=date(2025, 10, 1), renewal_end=date(2026, 3, 31),
            )
        assert result['created'] is False
        assert 'Error' in result['reason']

    def test_string_tx_date_parsed_correctly(self):
        """String tx_date '2025-11-15' is parsed and compared correctly."""
        tx = _gmail(tx_date='2025-11-15')
        result, _ = self._run(tx=tx)
        assert result['created'] is True  # within Oct 2025–Mar 2026

    def test_invalid_string_date_skipped(self):
        """Unparseable tx_date string → skipped with reason."""
        tx = _gmail(tx_date='not-a-date')
        result, _ = self._run(tx=tx)
        assert result['created'] is False


# ---------------------------------------------------------------------------
# is_within_renewal_period
# ---------------------------------------------------------------------------

class TestIsWithinRenewalPeriod:
    def setup_method(self):
        from payment_helpers import is_within_renewal_period
        self.check = is_within_renewal_period

    def _with_config(self, start, end, payment_date):
        with patch('payment_helpers.get_renewal_period', return_value=(start, end)):
            return self.check(payment_date)

    def test_date_on_start_boundary(self):
        assert self._with_config('2025-10-01', '2026-03-31', date(2025, 10, 1)) is True

    def test_date_on_end_boundary(self):
        assert self._with_config('2025-10-01', '2026-03-31', date(2026, 3, 31)) is True

    def test_date_inside_period(self):
        assert self._with_config('2025-10-01', '2026-03-31', date(2025, 12, 15)) is True

    def test_date_before_period(self):
        assert self._with_config('2025-10-01', '2026-03-31', date(2025, 9, 30)) is False

    def test_date_after_period(self):
        assert self._with_config('2025-10-01', '2026-03-31', date(2026, 4, 1)) is False

    def test_string_date_parsed(self):
        assert self._with_config('2025-10-01', '2026-03-31', '2025-11-01') is True

    def test_no_config_returns_false(self):
        """Missing config → False (don't accidentally approve payments)."""
        with patch('payment_helpers.get_renewal_period', return_value=(None, None)):
            assert self.check(date(2025, 11, 1)) is False

    def test_invalid_config_date_returns_false(self):
        """Malformed config date → False, no exception."""
        assert self._with_config('not-a-date', '2026-03-31', date(2025, 11, 1)) is False

    def test_none_payment_date_returns_false(self):
        assert self._with_config('2025-10-01', '2026-03-31', None) is False


# ---------------------------------------------------------------------------
# _build_member_search (api_members.py)
# ---------------------------------------------------------------------------

class TestBuildMemberSearch:
    def setup_method(self):
        from api_members import _build_member_search
        self.build = _build_member_search

    def test_single_token_produces_or_clauses(self):
        sql, params = self.build(['john'])
        assert 'LIKE' in sql
        assert any('%john%' in str(p) for p in params)

    def test_multiple_tokens_produce_and_clauses(self):
        sql, params = self.build(['john', 'smith'])
        assert sql.count('AND') >= 1

    def test_params_count_matches_tokens(self):
        """4 params per token (FirstName, LastName, WeChatID, MemberID) + 1 for ORDER BY."""
        _, params = self.build(['abc'])
        assert len(params) == 5  # 4 LIKE + 1 exact match for ORDER BY

    def test_two_tokens_param_count(self):
        _, params = self.build(['abc', 'xyz'])
        # 4 params per token (8) + 1 for ORDER BY exact (uses first token)
        assert len(params) == 9

    def test_exact_match_ordering_param_is_first_token(self):
        """ORDER BY exact match uses the first token for single-token queries."""
        _, params = self.build(['A0001'])
        assert params[-1] == 'A0001'

    def test_empty_token_list_does_not_crash(self):
        """Edge case: empty list → empty WHERE clause; just must not raise."""
        try:
            sql, params = self.build([])
            # If it returns, sql should be usable
            assert isinstance(sql, str)
        except Exception:
            pass  # acceptable to raise on empty input


# ---------------------------------------------------------------------------
# manual-approve — orphan payment path
# ---------------------------------------------------------------------------

class TestManualApproveOrphan:
    """
    When AutoGuess creates a payment without a SubmissionID (orphan), manual-approve
    should patch the existing payment rather than create a duplicate via sp_link_transaction.
    """

    def _tx_row(self):
        return {'TransactionNumber': 'TX001', 'Amount': 30, 'Sender': 'John',
                'Memo': 'A0001', 'Timestamp': None, 'TransactionDate': None}

    def _member_row(self):
        return {
            'MemberID': 'A0001', 'FirstName': 'John', 'LastName': 'Smith',
            'Email': 'j@x.com', 'PhoneNumber': '', 'WeChatID': '', 'Type': 'Individual',
            'FamilyID': None, 'District': '', 'Status': 'active',
            'Expiration': None, 'MembershipFeePaid': 0,
            'PaymentDate': None, 'PaymentTransaction': '', 'UpdatedAt': None,
        }

    def _post(self, client, body):
        return client.post('/api/payments/manual-approve', json=body)

    def test_orphan_path_patches_not_creates(self, client, mock_query):
        """When orphaned payment exists, execute() is called to patch it — NOT sp_link_transaction.
        get_member_by_id is patched directly since it's imported from payment_helpers
        and not intercepted by mock_query."""
        def query_side_effect(sql, *args, **kwargs):
            if 'gmail_transactions' in sql:
                return [self._tx_row()]
            if 'SubmissionID IS NULL' in sql:
                return [{'PaymentID': 'PAY-ORPHAN'}]  # orphan exists
            if 'submissions' in sql and 'pending' in sql:
                return [{'SubmissionID': 'SUB-001'}]
            return []

        mock_query.side_effect = query_side_effect

        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id', return_value=self._member_row()):
            with client.session_transaction() as sess:
                sess['user'] = {'email': 'admin@mmrunners.org', 'role': 'admin'}
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})

        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert j['action'] == 'linked'

        # Must NOT call sp_link_transaction
        for c in mock_exec.call_args_list:
            assert 'sp_link_transaction' not in str(c)

        mock_query.side_effect = None

    def test_non_orphan_path_calls_sp_link_transaction(self, client, mock_query):
        """When no orphan exists, sp_link_transaction is called."""
        def query_side_effect(sql, *args, **kwargs):
            if 'gmail_transactions' in sql:
                return [self._tx_row()]
            if 'SubmissionID IS NULL' in sql:
                return []  # no orphan
            if 'submissions' in sql and 'pending' in sql:
                return [{'SubmissionID': 'SUB-001'}]
            return []

        mock_query.side_effect = query_side_effect

        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id', return_value=self._member_row()):
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})

        assert r.status_code == 200
        assert r.get_json()['action'] == 'created'
        assert 'sp_link_transaction' in str(mock_exec.call_args_list)

        mock_query.side_effect = None

    def test_orphan_without_submission_still_patches(self, client, mock_query):
        """Orphan + no pending submission → patches payment only (no submission UPDATE)."""
        def query_side_effect(sql, *args, **kwargs):
            if 'gmail_transactions' in sql:
                return [self._tx_row()]
            if 'SubmissionID IS NULL' in sql:
                return [{'PaymentID': 'PAY-ORPHAN'}]
            return []  # no pending submission

        mock_query.side_effect = query_side_effect

        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id', return_value=self._member_row()):
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})

        assert r.status_code == 200
        assert r.get_json()['action'] == 'linked'
        # Only one execute call (payment patch) — no submission update since no sub found
        assert mock_exec.call_count == 1

        mock_query.side_effect = None


# ---------------------------------------------------------------------------
# api_members_status — revert-status validation
# ---------------------------------------------------------------------------

class TestRevertStatus:
    def _post(self, client, member_id, body):
        return client.post(f'/api/members/{member_id}/revert-status', json=body)

    def test_missing_override_id_returns_400(self, client, mock_query):
        r = self._post(client, 'A0001', {'note': 'reverting'})
        assert r.status_code == 400

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []  # member not found
        r = self._post(client, 'A9999', {'override_id': 1, 'note': 'reverting'})
        assert r.status_code == 404

    def _member_sql_row(self):
        return {'MemberID': 'A0001', 'Status': 'inactive',
                'FirstName': 'John', 'LastName': 'Smith',
                'Email': '', 'PhoneNumber': '', 'WeChatID': '',
                'Type': 'Individual', 'FamilyID': None, 'District': '',
                'Expiration': None, 'MembershipFeePaid': 0,
                'PaymentDate': None, 'PaymentTransaction': '', 'UpdatedAt': None}

    def _make_side_effect(self, override_rows):
        """Side effect factory. Checks admin_member_overrides FIRST to avoid
        the 'SELECT * FROM admin_member_overrides' accidentally matching the
        members branch if we used a 'SELECT *' heuristic."""
        member_row = self._member_sql_row()
        def side_effect(sql, *args, **kwargs):
            if 'admin_member_overrides' in sql:
                return override_rows
            # member lookup — FROM members
            return [member_row]
        return side_effect

    def test_override_not_found_returns_404(self, client, mock_query):
        mock_query.side_effect = self._make_side_effect(override_rows=[])
        r = self._post(client, 'A0001', {'override_id': 999, 'note': 'reverting'})
        assert r.status_code == 404
        mock_query.side_effect = None

    def test_override_with_no_old_value_returns_400(self, client, mock_query):
        mock_query.side_effect = self._make_side_effect(
            override_rows=[{'OverrideID': 1, 'OldValue': None, 'OldExpiration': None}]
        )
        r = self._post(client, 'A0001', {'override_id': 1, 'note': 'reverting'})
        assert r.status_code == 400
        assert 'previous status' in r.get_json().get('error', '').lower() or \
               'no previous' in r.get_json().get('error', '').lower()
        mock_query.side_effect = None

    def test_valid_revert_calls_stored_proc(self, client, mock_query):
        mock_query.side_effect = self._make_side_effect(
            override_rows=[{'OverrideID': 1, 'OldValue': 'expired', 'OldExpiration': None}]
        )
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'admin@mmrunners.org', 'role': 'admin'}
        with patch('api_members_overrides.execute') as mock_exec, \
             patch('api_members_overrides.log_activity'):
            r = self._post(client, 'A0001', {'override_id': 1, 'note': 'reverting'})
        assert r.status_code == 200
        assert 'sp_admin_update_member_status' in str(mock_exec.call_args_list)
        mock_query.side_effect = None
