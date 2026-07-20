"""
Dedicated tests for api_payments_actions.py (P1j — money-path coverage).

Extends (does NOT duplicate) test_business_logic.py / test_payments_filter_and_matching.py:
  - Autoguess criteria MATRIX: every dimension on/off (memberID in memo,
    member exists, amount right/wrong per type, date inside/outside/boundary
    of renewal period, pending submission present/absent) with assertions on
    the EXACT execute() params — INSERT into payments + gmail UPDATE.
  - Criteria precedence ordering (first failing check wins the reason).
  - Memo regex variants routed through autoguess (\\bA\\d{4}\\b word-boundary).
  - POST /api/payments/autoguess-all: invalid renewal config format,
    circuit breaker at 5 errors, mixed created/skipped counts,
    activity_log audit write + resilience, pending_subs_map dedup contract.
  - POST /api/payments/manual-approve: exact 5-param sp_link_transaction
    contract, submissionId hint override, family payment type, orphan-patch
    UPDATE params, error paths.

All DB calls mocked — no live MySQL required.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_payments_actions.py -v
"""
import uuid as uuid_mod
from datetime import date
from decimal import Decimal

import pytest
from unittest.mock import patch, MagicMock


# ── shared row builders ───────────────────────────────────────────────────────

def _member(member_id='A0001', type_='Individual', first='Jane', last='Lin'):
    return {
        'MemberID': member_id, 'FirstName': first, 'LastName': last,
        'Email': 'jane@example.com', 'PhoneNumber': '', 'WeChatID': '',
        'Type': type_, 'FamilyID': None, 'District': 'Queens',
        'Status': 'active', 'Expiration': None, 'MembershipFeePaid': 0,
        'PaymentDate': None, 'PaymentTransaction': '', 'UpdatedAt': None,
        'NYRRRunnerName': '',
    }


def _gmail(tx_num='TX001', memo='A0001 renewal', amount=30.0,
           tx_date=date(2025, 11, 15), sender='Jane Lin'):
    return {
        'TransactionNumber': tx_num, 'Timestamp': None, 'Sender': sender,
        'Amount': amount, 'Memo': memo, 'TransactionDate': tx_date,
        'Notes': None, 'UpdatedAt': None, 'MessageId': 'MSG001',
    }


RENEWAL_START = date(2025, 10, 1)
RENEWAL_END = date(2026, 3, 31)
ADMIN = 'admin@mmrunners.org'


def _run_autoguess(tx, member=None, pending_sub=None):
    """Run autoguess_single_transaction with pre-loaded maps and a mocked execute."""
    from payment_matching import autoguess_single_transaction
    member = member if member is not None else _member()
    members = {member['MemberID']: member}
    subs = {member['MemberID']: pending_sub} if pending_sub else {}
    with patch('payment_matching.execute') as mock_exec:
        result = autoguess_single_transaction(
            tx=tx, admin_email=ADMIN,
            all_members=members, pending_subs_map=subs,
            renewal_start=RENEWAL_START, renewal_end=RENEWAL_END,
        )
    return result, mock_exec


# ── autoguess criteria matrix ─────────────────────────────────────────────────

class TestAutoguessCriteriaMatrix:
    """
    Full criteria matrix for autoguess_single_transaction.

    Each case toggles exactly one dimension around the happy path:
      memo-id | member-exists | amount-vs-type | renewal-period | pending-sub
    and asserts match/no-match, the reason, and (on match) the exact
    execute() params written to payments + gmail_transactions.
    """

    # (case_id, memo, member_type, amount, tx_date, pending_sub,
    #  expect_created, reason_substr)
    MATRIX = [
        # -- all criteria met --------------------------------------------------
        ('indiv_30_in_period_with_sub',
         'A0001 renewal', 'Individual', 30.0, date(2025, 11, 15), 'SUB-1', True, None),
        ('indiv_30_in_period_no_sub',
         'A0001 renewal', 'Individual', 30.0, date(2025, 11, 15), None, True, None),
        ('family_50_in_period_with_sub',
         'A0001 renewal', 'Family', 50.0, date(2025, 11, 15), 'SUB-1', True, None),
        ('family_50_in_period_no_sub',
         'A0001 renewal', 'Family', 50.0, date(2025, 11, 15), None, True, None),
        # -- renewal boundaries are inclusive ---------------------------------
        ('start_boundary_matches',
         'A0001 renewal', 'Individual', 30.0, RENEWAL_START, 'SUB-1', True, None),
        ('end_boundary_matches',
         'A0001 renewal', 'Individual', 30.0, RENEWAL_END, 'SUB-1', True, None),
        # -- memo dimension off ------------------------------------------------
        ('name_only_memo_never_matches',
         'renewal Jane Lin', 'Individual', 30.0, date(2025, 11, 15), 'SUB-1',
         False, 'No memberID in memo'),
        ('empty_memo_never_matches',
         '', 'Individual', 30.0, date(2025, 11, 15), 'SUB-1',
         False, 'No memberID in memo'),
        # -- member dimension off ----------------------------------------------
        ('unknown_member_skipped',
         'A9999 renewal', 'Individual', 30.0, date(2025, 11, 15), 'SUB-1',
         False, 'A9999 not found'),
        # -- amount dimension off ----------------------------------------------
        ('indiv_wrong_amount_50',
         'A0001 renewal', 'Individual', 50.0, date(2025, 11, 15), 'SUB-1',
         False, '!= 30.00'),
        ('family_wrong_amount_30',
         'A0001 renewal', 'Family', 30.0, date(2025, 11, 15), 'SUB-1',
         False, '!= 50.00'),
        ('indiv_off_by_cents',
         'A0001 renewal', 'Individual', 30.01, date(2025, 11, 15), 'SUB-1',
         False, '!='),
        # -- period dimension off ----------------------------------------------
        ('day_before_period',
         'A0001 renewal', 'Individual', 30.0, date(2025, 9, 30), 'SUB-1',
         False, 'renewal period'),
        ('day_after_period',
         'A0001 renewal', 'Individual', 30.0, date(2026, 4, 1), 'SUB-1',
         False, 'renewal period'),
        # -- amount missing entirely -------------------------------------------
        ('no_amount_skipped',
         'A0001 renewal', 'Individual', None, date(2025, 11, 15), 'SUB-1',
         False, 'Invalid amount'),
    ]

    @pytest.mark.parametrize(
        'case_id,memo,member_type,amount,tx_date,pending_sub,expect_created,reason_substr',
        MATRIX, ids=[c[0] for c in MATRIX])
    def test_matrix(self, case_id, memo, member_type, amount, tx_date,
                    pending_sub, expect_created, reason_substr):
        tx = _gmail(memo=memo, amount=amount, tx_date=tx_date)
        member = _member(type_=member_type)
        result, mock_exec = _run_autoguess(tx, member=member, pending_sub=pending_sub)

        assert result['created'] is expect_created, result

        if expect_created:
            # Exactly two writes: INSERT payments + UPDATE gmail_transactions
            assert mock_exec.call_count == 2
            insert_sql, insert_params = mock_exec.call_args_list[0][0]
            assert 'INSERT INTO payments' in insert_sql
            expected_type = ('Family Membership' if member_type == 'Family'
                             else 'Individual Membership')
            # (PaymentID, MemberID, TransactionNumber, Amount, SubmissionID,
            #  PaymentType, ProcessedBy)
            uuid_mod.UUID(insert_params[0])  # PaymentID is a valid uuid
            assert insert_params[1] == 'A0001'
            assert insert_params[2] == tx['TransactionNumber']
            assert insert_params[3] == Decimal(str(amount))
            assert insert_params[4] == pending_sub  # SUB-1 or None
            assert insert_params[5] == expected_type
            assert insert_params[6] == ADMIN

            update_sql, update_params = mock_exec.call_args_list[1][0]
            assert 'UPDATE gmail_transactions' in update_sql
            assert update_params == ('A0001', Decimal(str(amount)),
                                     tx['TransactionNumber'])
        else:
            # No-match must never write anything
            assert mock_exec.call_count == 0
            assert reason_substr in result['reason']

    def test_precedence_amount_checked_before_memo(self):
        """None amount + no memberID in memo → 'Invalid amount' wins (checked first)."""
        tx = _gmail(memo='random note', amount=None)
        result, _ = _run_autoguess(tx)
        assert result['created'] is False
        assert result['reason'] == 'Invalid amount'

    def test_precedence_memo_checked_before_member_and_amount(self):
        """No memberID + wrong amount → memo reason wins over amount mismatch."""
        tx = _gmail(memo='random note', amount=99.0)
        result, _ = _run_autoguess(tx)
        assert result['created'] is False
        assert result['reason'] == 'No memberID in memo'

    def test_precedence_member_checked_before_amount(self):
        """Unknown member + wrong amount → 'not found' wins over amount mismatch."""
        tx = _gmail(memo='A9999 dues', amount=99.0)
        result, _ = _run_autoguess(tx)
        assert result['created'] is False
        assert 'not found' in result['reason']


class TestAutoguessMemoRegex:
    """\\bA\\d{4}\\b extraction routed through autoguess — word-boundary contract."""

    @pytest.mark.parametrize('memo', [
        'A0001 renewal',        # plain
        'a0001 dues',           # lowercase normalized to upper
        'Member: A0001!',       # punctuation delimiters ok
        '(A0001)',              # parens ok
        'renewal/A0001/2026',   # slashes ok
    ])
    def test_memo_variants_match(self, memo):
        result, _ = _run_autoguess(_gmail(memo=memo))
        assert result['created'] is True, (memo, result)

    @pytest.mark.parametrize('memo', [
        'XA0001 renewal',   # letter prefix breaks the boundary
        'A00012 renewal',   # 5 digits — trailing digit breaks the boundary
        'A0001Z renewal',   # trailing letter breaks the boundary
        'A001 renewal',     # only 3 digits
        'B0001 renewal',    # wrong prefix letter
    ])
    def test_memo_variants_no_match(self, memo):
        result, mock_exec = _run_autoguess(_gmail(memo=memo))
        assert result['created'] is False, (memo, result)
        assert result['reason'] == 'No memberID in memo'
        assert mock_exec.call_count == 0


# ── POST /api/payments/autoguess-all (route-level) ────────────────────────────

class TestAutoguessAllRouteExtended:
    """Route behaviors NOT covered by test_payments_filter_and_matching.py:
    invalid config format, circuit breaker, mixed counts, audit log, preload
    contract passed into autoguess_single_transaction."""

    def _post(self, client):
        return client.post('/api/payments/autoguess-all')

    def _qside(self, unmatched=None, members=None, pending=None):
        unmatched = unmatched if unmatched is not None else []
        members = members if members is not None else []
        pending = pending if pending is not None else []

        def side(sql, *a, **kw):
            s = sql.lower()
            if 'from gmail_transactions' in s:
                return unmatched
            if 'from members' in s:
                return members
            if 'from submissions' in s:
                return pending
            return []
        return side

    def test_invalid_renewal_date_format_returns_400(self, client, mock_query):
        mock_query.side_effect = self._qside()
        with patch('api_payments_actions.get_renewal_period',
                   return_value=('not-a-date', '2026-03-31')):
            r = self._post(client)
        mock_query.side_effect = None
        assert r.status_code == 400
        assert 'Invalid renewal period' in r.get_json()['error']

    def test_circuit_breaker_stops_after_5_errors(self, client, mock_query):
        txs = [_gmail(tx_num=f'TX{i:03d}') for i in range(8)]
        mock_query.side_effect = self._qside(unmatched=txs)
        guess = MagicMock(side_effect=Exception('boom'))
        with patch('api_payments_actions.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments_actions.autoguess_single_transaction', guess), \
             patch('api_payments_actions.execute'):
            r = self._post(client)
        mock_query.side_effect = None

        assert r.status_code == 200
        j = r.get_json()
        assert len(j['details']['errors']) == 5          # capped at max_errors
        assert guess.call_count == 5                      # 6th tx never attempted
        assert 'stopped due to errors' in j['message']
        assert j['details']['created'] == 0

    def test_mixed_created_and_skipped_counts(self, client, mock_query):
        txs = [_gmail(tx_num=f'TX{i:03d}') for i in range(4)]
        mock_query.side_effect = self._qside(unmatched=txs)
        guess = MagicMock(side_effect=[
            {'created': True, 'reason': 'ok'},
            {'created': False, 'reason': 'skip'},
            {'created': True, 'reason': 'ok'},
            {'created': False, 'reason': 'skip'},
        ])
        with patch('api_payments_actions.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments_actions.autoguess_single_transaction', guess), \
             patch('api_payments_actions.execute'):
            r = self._post(client)
        mock_query.side_effect = None

        j = r.get_json()
        assert j['ok'] is True
        assert j['details'] == {'created': 2, 'skipped': 2, 'errors': []}
        assert 'Autoguess: 2 created, 2 skipped' in j['message']

    def test_activity_log_written_with_admin_email(self, client, mock_query):
        mock_query.side_effect = self._qside(unmatched=[_gmail()])
        with patch('api_payments_actions.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments_actions.autoguess_single_transaction',
                   return_value={'created': True, 'reason': 'ok'}), \
             patch('api_payments_actions.execute') as mock_exec:
            with client.session_transaction() as sess:
                sess['user'] = {'email': ADMIN, 'role': 'admin'}
            r = self._post(client)
        mock_query.side_effect = None

        assert r.status_code == 200
        log_sql, log_params = mock_exec.call_args_list[-1][0]
        assert 'INSERT INTO activity_log' in log_sql
        # (LogID, Email, Action, State, ErrorMessage, ErrorSeverity)
        assert log_params[1] == ADMIN
        assert log_params[2] == 'AUTOGUESS_RUN'
        assert log_params[3] == 'created=1,skipped=0,errors=0'
        assert log_params[4] is None
        assert log_params[5] == 'INFO'

    def test_activity_log_failure_does_not_break_response(self, client, mock_query):
        mock_query.side_effect = self._qside(unmatched=[_gmail()])
        with patch('api_payments_actions.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments_actions.autoguess_single_transaction',
                   return_value={'created': True, 'reason': 'ok'}), \
             patch('api_payments_actions.execute', side_effect=Exception('log db down')):
            r = self._post(client)
        mock_query.side_effect = None

        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_preload_contract_members_subs_and_period(self, client, mock_query):
        """Route pre-loads members + pending subs once and passes them into
        autoguess_single_transaction. Latest pending sub per member wins
        (setdefault on CreatedAt DESC ordering)."""
        mock_query.side_effect = self._qside(
            unmatched=[_gmail()],
            members=[_member(), _member(member_id='A0002', type_='Family')],
            pending=[
                {'SubmissionID': 'SUB-NEW', 'MemberID': 'A0001'},   # latest first
                {'SubmissionID': 'SUB-OLD', 'MemberID': 'A0001'},   # ignored
                {'SubmissionID': 'SUB-B', 'MemberID': 'A0002'},
            ])
        guess = MagicMock(return_value={'created': False, 'reason': 'skip'})
        with patch('api_payments_actions.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments_actions.autoguess_single_transaction', guess), \
             patch('api_payments_actions.execute'):
            r = self._post(client)
        mock_query.side_effect = None

        assert r.status_code == 200
        kwargs = guess.call_args[1]
        assert set(kwargs['all_members'].keys()) == {'A0001', 'A0002'}
        assert kwargs['pending_subs_map'] == {'A0001': 'SUB-NEW', 'A0002': 'SUB-B'}
        assert kwargs['renewal_start'] == RENEWAL_START
        assert kwargs['renewal_end'] == RENEWAL_END


# ── POST /api/payments/manual-approve (contract details) ──────────────────────

class TestManualApproveContract:
    """Extends TestManualApproveOrphan (test_business_logic.py) with the exact
    sp_link_transaction 5-param contract, hint override, payment type by member
    type, orphan UPDATE params, and error paths."""

    def _post(self, client, body):
        return client.post('/api/payments/manual-approve', json=body)

    def _qside(self, tx=True, orphan=None, pending='SUB-001'):
        def side(sql, *a, **kw):
            if 'gmail_transactions' in sql:
                return [{'TransactionNumber': 'TX001', 'Amount': 30,
                         'Sender': 'Jane Lin', 'Memo': 'A0001',
                         'Timestamp': None, 'TransactionDate': None}] if tx else []
            if 'SubmissionID IS NULL' in sql:
                return [{'PaymentID': orphan}] if orphan else []
            if 'FROM submissions' in sql:
                return [{'SubmissionID': pending}] if pending else []
            return []
        return side

    # -- validation / lookup failures ----------------------------------------

    def test_missing_transaction_number_returns_400(self, client, mock_query):
        r = self._post(client, {'memberID': 'A0001'})
        assert r.status_code == 400

    def test_missing_member_id_returns_400(self, client, mock_query):
        r = self._post(client, {'transactionNumber': 'TX001'})
        assert r.status_code == 400

    def test_whitespace_only_fields_return_400(self, client, mock_query):
        r = self._post(client, {'transactionNumber': '  ', 'memberID': '  '})
        assert r.status_code == 400

    def test_tx_not_found_returns_404(self, client, mock_query):
        mock_query.side_effect = self._qside(tx=False)
        r = self._post(client, {'transactionNumber': 'TXNOPE', 'memberID': 'A0001'})
        mock_query.side_effect = None
        assert r.status_code == 404
        assert 'Gmail transaction not found' in r.get_json()['error']

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.side_effect = self._qside()
        with patch('api_payments_actions.get_member_by_id', return_value=None):
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A9999'})
        mock_query.side_effect = None
        assert r.status_code == 404
        assert 'Member not found' in r.get_json()['error']

    # -- sp_link_transaction contract -----------------------------------------

    def test_sp_link_transaction_exact_5_params_individual(self, client, mock_query):
        """The proc takes exactly (tx, memberID, type, amount, submissionID) —
        no admin param (regression guard for the 5-vs-6 param bug)."""
        mock_query.side_effect = self._qside()
        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id', return_value=_member()):
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})
        mock_query.side_effect = None

        assert r.status_code == 200
        sql, params = mock_exec.call_args_list[0][0]
        assert sql.count('%s') == 5
        assert 'sp_link_transaction' in sql
        assert params == ('TX001', 'A0001', 'Individual Membership', 30, 'SUB-001')

    def test_family_member_gets_family_membership_type(self, client, mock_query):
        mock_query.side_effect = self._qside()
        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id',
                   return_value=_member(type_='Family')):
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})
        mock_query.side_effect = None

        assert r.status_code == 200
        _, params = mock_exec.call_args_list[0][0]
        assert params[2] == 'Family Membership'

    def test_submission_id_hint_overrides_pending_lookup(self, client, mock_query):
        """Client-supplied submissionId wins even when a different pending
        submission exists in the DB."""
        mock_query.side_effect = self._qside(pending='SUB-FROM-DB')
        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id', return_value=_member()):
            r = self._post(client, {'transactionNumber': 'TX001',
                                    'memberID': 'A0001',
                                    'submissionId': 'SUB-HINT'})
        mock_query.side_effect = None

        assert r.status_code == 200
        _, params = mock_exec.call_args_list[0][0]
        assert params[4] == 'SUB-HINT'
        assert r.get_json()['submissionID'] == 'SUB-HINT'

    def test_no_pending_and_no_hint_passes_null_submission(self, client, mock_query):
        mock_query.side_effect = self._qside(pending=None)
        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id', return_value=_member()):
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})
        mock_query.side_effect = None

        assert r.status_code == 200
        _, params = mock_exec.call_args_list[0][0]
        assert params[4] is None
        assert r.get_json()['action'] == 'created'

    # -- orphan patching (exact params) ----------------------------------------

    def test_orphan_patch_update_params(self, client, mock_query):
        """Orphan payment + pending sub → 2 UPDATEs with exact param tuples,
        stamping the acting admin on both rows."""
        mock_query.side_effect = self._qside(orphan='PAY-ORPHAN')
        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id', return_value=_member()):
            with client.session_transaction() as sess:
                sess['user'] = {'email': ADMIN, 'role': 'admin'}
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})
        mock_query.side_effect = None

        assert r.status_code == 200
        assert r.get_json()['action'] == 'linked'
        assert mock_exec.call_count == 2

        pay_sql, pay_params = mock_exec.call_args_list[0][0]
        assert 'UPDATE payments' in pay_sql
        assert pay_params == ('SUB-001', ADMIN, 'PAY-ORPHAN')

        sub_sql, sub_params = mock_exec.call_args_list[1][0]
        assert 'UPDATE submissions' in sub_sql
        assert "Status = 'approved'" in sub_sql
        assert sub_params == ('PAY-ORPHAN', ADMIN, 'SUB-001')

    def test_orphan_patch_with_hint_uses_hint(self, client, mock_query):
        mock_query.side_effect = self._qside(orphan='PAY-ORPHAN', pending='SUB-FROM-DB')
        with patch('api_payments_actions.execute') as mock_exec, \
             patch('api_payments_actions.get_member_by_id', return_value=_member()):
            r = self._post(client, {'transactionNumber': 'TX001',
                                    'memberID': 'A0001',
                                    'submissionId': 'SUB-HINT'})
        mock_query.side_effect = None

        assert r.status_code == 200
        _, pay_params = mock_exec.call_args_list[0][0]
        assert pay_params[0] == 'SUB-HINT'

    # -- error / response shape -------------------------------------------------

    def test_sp_error_returns_500_with_message(self, client, mock_query):
        mock_query.side_effect = self._qside()
        with patch('api_payments_actions.execute',
                   side_effect=Exception('proc exploded')), \
             patch('api_payments_actions.get_member_by_id', return_value=_member()):
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})
        mock_query.side_effect = None

        assert r.status_code == 500
        assert 'proc exploded' in r.get_json()['error']

    def test_response_shape(self, client, mock_query):
        mock_query.side_effect = self._qside()
        with patch('api_payments_actions.execute'), \
             patch('api_payments_actions.get_member_by_id', return_value=_member()):
            r = self._post(client, {'transactionNumber': 'TX001', 'memberID': 'A0001'})
        mock_query.side_effect = None

        j = r.get_json()
        assert j['ok'] is True
        assert j['transactionNumber'] == 'TX001'
        assert j['memberID'] == 'A0001'
        assert j['submissionID'] == 'SUB-001'
        assert j['action'] == 'created'
        assert 'Jane Lin' in j['message']
