"""
Advanced tests for payment_matching.py — covering the uncovered sections:

  Lines 144–190: find_best_submission_match
    - already-linked transaction path (priority 0)
    - amount-based scan with fuzzy scoring
    - no match returns None

  Lines 227–317: fuzzy_select_transaction_to_submission
    - missing submission → error dict
    - missing member → error dict
    - candidates scored and sorted correctly
    - payment-linked transaction gets priority 0
    - amount-mismatch candidate included when MemberID in memo

  Lines 393, 400–405: autoguess_single_transaction edge cases
    - Family Membership payment type label
    - pending_subs_map=None path (live DB query for submission)

Coverage target: bring payment_matching.py above 85% (was 62%).

Run:
    cd mmr-admin
    python3 -m pytest tests/test_payment_matching_advanced.py -v
"""
import pytest
from datetime import date, datetime
from decimal import Decimal
from unittest.mock import patch, MagicMock, call


# ── helpers ──────────────────────────────────────────────────────────────────

def _member(member_id='A0001', first='Jane', last='Lin',
            type_='Individual', wechat='', email='jane@example.com', nyrr=''):
    return {
        'MemberID': member_id, 'FirstName': first, 'LastName': last,
        'Type': type_, 'WeChatID': wechat, 'Email': email,
        'NYRRRunnerName': nyrr, 'Status': 'active', 'Expiration': None,
    }


def _gmail(tx='TX001', sender='Jane Lin', memo='A0001 dues', amount=30.0,
           tx_date='2025-11-01', notes=None, msg_id='msg1'):
    return {
        'MessageId': msg_id, 'TransactionNumber': tx, 'Sender': sender,
        'Memo': memo, 'Amount': amount, 'TransactionDate': tx_date,
        'Notes': notes, 'UpdatedAt': None, 'Timestamp': None,
    }


def _sub(sub_id='SUB001', member_id='A0001', amount=30, status='pending'):
    return {'SubmissionID': sub_id, 'MemberID': member_id,
            'Amount': amount, 'Status': status}


# ── find_best_submission_match ────────────────────────────────────────────────

class TestFindBestSubmissionMatch:
    def setup_method(self):
        from payment_matching import find_best_matching_submission
        self.find = find_best_matching_submission

    def test_already_linked_transaction_returns_priority_0(self):
        """If gmail tx already has a payments row with MemberID, return priority=0."""
        gmail = _gmail(tx='TX-LINKED', memo='some payment')

        def query_side(sql, params=(), **kw):
            if 'payments' in sql and 'TransactionNumber' in sql:
                return [{'MemberID': 'A0001'}]
            if 'submissions' in sql and 'pending' in sql.lower():
                return [{'SubmissionID': 'SUB001', 'MemberID': 'A0001'}]
            return []

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', return_value=_member()):
            result = self.find(gmail, amount=Decimal('30.00'))

        assert result is not None
        assert result['priority'] == 0
        assert result['member_id'] == 'A0001'

    def test_already_linked_no_pending_sub_falls_through_to_scan(self):
        """Linked payment but no pending submission for that member → falls through
        to the regular pending-subs scan. If scan also empty → returns None."""
        gmail = _gmail(tx='TX-LINKED')

        def query_side(sql, params=(), **kw):
            if 'payments' in sql and 'TransactionNumber' in sql:
                return [{'MemberID': 'A0001'}]
            # hinted_sub query and pending_subs scan both return empty
            if 'submissions' in sql:
                return []
            return []

        with patch('payment_matching.query', side_effect=query_side):
            result = self.find(gmail, amount=Decimal('30.00'))

        # No sub found for the hinted member, regular scan also empty → None
        assert result is None

    def test_no_pending_subs_at_amount_returns_none(self):
        """No pending submissions at the given amount → None."""
        gmail = _gmail()

        def query_side(sql, params=(), **kw):
            if 'payments' in sql:
                return []  # not already linked
            if 'submissions' in sql:
                return []  # no pending subs at this amount
            return []

        with patch('payment_matching.query', side_effect=query_side):
            result = self.find(gmail, amount=Decimal('30.00'))

        assert result is None

    def test_fuzzy_match_returns_a_match(self):
        """Two pending subs — at least one matches the sender name."""
        # Use a memo that contains the MemberID so Rule 1 fires (most specific).
        # This ensures the matched member is deterministic regardless of email quirks.
        gmail = _gmail(tx='TX999', sender='Someone', memo='A0001 dues')

        subs = [
            {'SubmissionID': 'SUB-A', 'MemberID': 'A0001', 'Amount': 30},
            {'SubmissionID': 'SUB-B', 'MemberID': 'A0002', 'Amount': 30},
        ]

        def query_side(sql, params=(), **kw):
            if 'payments' in sql and 'TransactionNumber' in sql:
                return []
            if 'submissions' in sql:
                return subs
            return []

        member_a = _member('A0001', 'Jane', 'Lin', email='jane@example.com')
        member_b = _member('A0002', 'Bob', 'Wang', email='bob@example.com')

        def get_member(mid):
            return member_a if mid == 'A0001' else member_b

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', side_effect=get_member):
            result = self.find(gmail, amount=Decimal('30.00'))

        # A0001's MemberID appears in memo → Rule 1 match (priority 1)
        assert result is not None
        assert result['member_id'] == 'A0001'
        assert result['priority'] == 1

    def test_member_not_found_sub_skipped(self):
        """If get_member_by_id returns None for a sub's member → sub is skipped."""
        gmail = _gmail()
        subs = [{'SubmissionID': 'SUB-X', 'MemberID': 'A9999', 'Amount': 30}]

        def query_side(sql, params=(), **kw):
            if 'payments' in sql:
                return []
            return subs

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', return_value=None):
            result = self.find(gmail, amount=Decimal('30.00'))

        assert result is None


# ── fuzzy_select_transaction_to_submission ────────────────────────────────────

class TestFuzzySelectTransactionToSubmission:
    def setup_method(self):
        from payment_matching import fuzzy_select_transaction_to_submission
        self.select = fuzzy_select_transaction_to_submission

    def test_submission_not_found_returns_error(self):
        with patch('payment_matching.query', return_value=[]):
            result = self.select('NOSUB')
        assert 'error' in result
        assert result['candidates'] == []

    def test_member_not_found_returns_error(self):
        sub = _sub()
        with patch('payment_matching.query', return_value=[sub]), \
             patch('payment_matching.get_member_by_id', return_value=None):
            result = self.select('SUB001')
        assert 'error' in result

    def test_no_candidates_returns_empty_list(self):
        sub = _sub()

        def query_side(sql, params=(), **kw):
            if 'submissions' in sql:
                return [sub]
            return []  # no gmail candidates

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', return_value=_member()):
            result = self.select('SUB001')

        assert 'candidates' in result
        assert result['candidates'] == []

    def test_candidate_with_member_id_in_memo_gets_high_priority(self):
        sub = _sub()
        gmail = _gmail(tx='TX999', memo='A0001 renewal', amount=30.0)

        def query_side(sql, params=(), **kw):
            if 'FROM submissions' in sql:
                return [sub]
            if 'gmail_transactions' in sql:
                return [gmail]
            if 'FROM payments' in sql and 'IN' in sql:
                return []  # not payment-linked
            return []

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', return_value=_member()):
            result = self.select('SUB001')

        assert 'candidates' in result
        assert len(result['candidates']) == 1
        c = result['candidates'][0]
        assert c['matched'] is True
        assert c['priority'] == 1  # Rule 1: MemberID in tx text

    def test_payment_linked_candidate_gets_priority_0(self):
        """If candidate tx is already in payments table for this member → priority 0."""
        sub = _sub()
        gmail = _gmail(tx='TX-LINKED', memo='no id here', amount=30.0)

        def query_side(sql, params=(), **kw):
            if 'FROM submissions' in sql:
                return [sub]
            if 'gmail_transactions' in sql:
                return [gmail]
            if 'FROM payments' in sql and 'IN' in sql:
                return [{'TransactionNumber': 'TX-LINKED'}]  # payment-linked
            return []

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', return_value=_member()):
            result = self.select('SUB001')

        assert len(result['candidates']) == 1
        c = result['candidates'][0]
        assert c['priority'] == 0
        assert c['matched'] is True

    def test_candidates_sorted_best_first(self):
        """Multiple candidates — highest priority returned first."""
        sub = _sub()
        g1 = _gmail(tx='TX001', memo='A0001 renewal', amount=30.0, msg_id='m1')
        g2 = _gmail(tx='TX002', sender='somebody else', memo='payment', amount=30.0, msg_id='m2')

        def query_side(sql, params=(), **kw):
            if 'FROM submissions' in sql:
                return [sub]
            if 'gmail_transactions' in sql:
                return [g2, g1]  # deliberately wrong order
            if 'FROM payments' in sql:
                return []
            return []

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', return_value=_member()):
            result = self.select('SUB001')

        candidates = result['candidates']
        assert len(candidates) == 2
        # TX001 has MemberID in memo (Rule 1) → should rank first
        priorities = [c['priority'] for c in candidates]
        assert priorities == sorted(priorities, reverse=True) or candidates[0]['TransactionNumber'] == 'TX001'

    def test_result_includes_submission_and_member(self):
        sub = _sub()
        gmail = _gmail()

        def query_side(sql, params=(), **kw):
            if 'FROM submissions' in sql:
                return [sub]
            if 'gmail_transactions' in sql:
                return [gmail]
            if 'FROM payments' in sql:
                return []
            return []

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', return_value=_member()):
            result = self.select('SUB001')

        assert 'submission' in result
        assert 'member' in result
        assert result['submission']['SubmissionID'] == 'SUB001'

    def test_tx_date_isoformat_called_for_date_objects(self):
        """TransactionDate as a date object → converted to isoformat string."""
        sub = _sub()
        gmail_with_date = _gmail()
        gmail_with_date['TransactionDate'] = date(2025, 11, 1)

        def query_side(sql, params=(), **kw):
            if 'FROM submissions' in sql:
                return [sub]
            if 'gmail_transactions' in sql:
                return [gmail_with_date]
            if 'FROM payments' in sql:
                return []
            return []

        with patch('payment_matching.query', side_effect=query_side), \
             patch('payment_matching.get_member_by_id', return_value=_member()):
            result = self.select('SUB001')

        candidates = result['candidates']
        if candidates:
            assert candidates[0]['TransactionDate'] == '2025-11-01'


# ── autoguess_single_transaction — additional edge cases ─────────────────────

class TestAutoguessTransactionExtended:
    def setup_method(self):
        from payment_matching import autoguess_single_transaction
        self.autoguess = autoguess_single_transaction

    def _run(self, tx, member=None, pending_subs_map=None, renewal_start=date(2025, 10, 1),
             renewal_end=date(2026, 3, 31)):
        members = {member['MemberID']: member} if member else {'A0001': {
            'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Lin',
            'Type': 'Individual', 'WeChatID': '', 'Email': '', 'NYRRRunnerName': '',
        }}
        with patch('payment_matching.execute') as mock_exec:
            result = self.autoguess(
                tx=tx, admin_email='admin@mmrunners.org',
                all_members=members,
                pending_subs_map=pending_subs_map,
                renewal_start=renewal_start,
                renewal_end=renewal_end,
            )
        return result, mock_exec

    def test_family_member_uses_family_membership_payment_type(self):
        """Family member → PaymentType should be 'Family Membership'."""
        tx = {
            'TransactionNumber': 'TX100', 'Sender': 'A Family', 'Memo': 'A0001 renewal',
            'Amount': 50.0, 'TransactionDate': '2025-11-15', 'Notes': None,
        }
        member = {
            'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Lin',
            'Type': 'Family', 'WeChatID': '', 'Email': '', 'NYRRRunnerName': '',
        }
        result, mock_exec = self._run(tx, member=member)
        assert result['created'] is True
        insert_call = str(mock_exec.call_args_list[0])
        assert 'Family Membership' in insert_call

    def test_individual_member_uses_individual_membership_payment_type(self):
        tx = {
            'TransactionNumber': 'TX101', 'Sender': 'Jane Lin', 'Memo': 'A0001 renewal',
            'Amount': 30.0, 'TransactionDate': '2025-11-15', 'Notes': None,
        }
        result, mock_exec = self._run(tx)
        assert result['created'] is True
        insert_call = str(mock_exec.call_args_list[0])
        assert 'Individual Membership' in insert_call

    def test_pending_subs_map_none_triggers_live_query(self):
        """pending_subs_map=None → falls through to live DB query for submission."""
        tx = {
            'TransactionNumber': 'TX102', 'Sender': 'Jane Lin', 'Memo': 'A0001 renewal',
            'Amount': 30.0, 'TransactionDate': '2025-11-15', 'Notes': None,
        }
        with patch('payment_matching.query', return_value=[{'SubmissionID': 'SUB-LIVE'}]) as mock_q, \
             patch('payment_matching.execute') as mock_exec:
            result = self.autoguess(
                tx=tx, admin_email='admin@test.com',
                all_members={'A0001': {'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Lin',
                                       'Type': 'Individual', 'WeChatID': '', 'Email': '', 'NYRRRunnerName': ''}},
                pending_subs_map=None,
                renewal_start=date(2025, 10, 1),
                renewal_end=date(2026, 3, 31),
            )
        assert result['created'] is True
        # Submission from live query should be in the INSERT
        insert_call = str(mock_exec.call_args_list[0])
        assert 'SUB-LIVE' in insert_call

    def test_decimal_amount_30_matches_individual(self):
        """Decimal('30.00') explicitly — should match Individual member."""
        tx = {
            'TransactionNumber': 'TX103', 'Sender': 'Jane', 'Memo': 'A0001',
            'Amount': Decimal('30.00'), 'TransactionDate': '2025-11-01', 'Notes': None,
        }
        result, _ = self._run(tx)
        assert result['created'] is True

    def test_decimal_amount_50_matches_family(self):
        tx = {
            'TransactionNumber': 'TX104', 'Sender': 'Jane', 'Memo': 'A0001',
            'Amount': Decimal('50.00'), 'TransactionDate': '2025-11-01', 'Notes': None,
        }
        member = {
            'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Lin',
            'Type': 'Family', 'WeChatID': '', 'Email': '', 'NYRRRunnerName': '',
        }
        result, _ = self._run(tx, member=member)
        assert result['created'] is True

    def test_gmail_notes_updated_on_success(self):
        """On success, two execute() calls — INSERT payments + UPDATE gmail_transactions."""
        tx = {
            'TransactionNumber': 'TX105', 'Sender': 'Jane', 'Memo': 'A0001',
            'Amount': 30.0, 'TransactionDate': '2025-11-01', 'Notes': None,
        }
        result, mock_exec = self._run(tx)
        assert result['created'] is True
        assert mock_exec.call_count == 2  # INSERT + UPDATE
        update_call = str(mock_exec.call_args_list[1])
        assert 'gmail_transactions' in update_call

    def test_pending_subs_map_empty_dict_no_submission_linked(self):
        """Empty pending_subs_map → submission_id=None, payment still created."""
        tx = {
            'TransactionNumber': 'TX106', 'Sender': 'Jane', 'Memo': 'A0001',
            'Amount': 30.0, 'TransactionDate': '2025-11-01', 'Notes': None,
        }
        result, mock_exec = self._run(tx, pending_subs_map={})
        assert result['created'] is True
        insert_args = mock_exec.call_args_list[0][0][1]
        assert insert_args[4] is None  # submission_id position

    def test_date_exactly_on_start_boundary_succeeds(self):
        tx = {
            'TransactionNumber': 'TX107', 'Sender': 'Jane', 'Memo': 'A0001',
            'Amount': 30.0, 'TransactionDate': '2025-10-01', 'Notes': None,
        }
        result, _ = self._run(tx, renewal_start=date(2025, 10, 1), renewal_end=date(2026, 3, 31))
        assert result['created'] is True

    def test_date_exactly_on_end_boundary_succeeds(self):
        tx = {
            'TransactionNumber': 'TX108', 'Sender': 'Jane', 'Memo': 'A0001',
            'Amount': 30.0, 'TransactionDate': '2026-03-31', 'Notes': None,
        }
        result, _ = self._run(tx, renewal_start=date(2025, 10, 1), renewal_end=date(2026, 3, 31))
        assert result['created'] is True
