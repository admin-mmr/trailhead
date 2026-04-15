"""
Integration tests for stored procedures:
  - sp_cancel_payment   — cancel a single payment, revert member + submission
  - sp_clear_transaction — wipe all payments for a transaction number

Run:
    pytest mmr-admin/tests/test_integration_stored_procs.py --run-integration -v

Each test runs inside a transaction that is rolled back on teardown,
so seed data never persists between tests.
"""

import uuid
import pytest
import mysql.connector
from tests.integration.conftest_integration import query, execute

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Shared seed helpers
# ---------------------------------------------------------------------------

def _mid() -> str:
    """Generate a unique member ID like A8001."""
    return "A" + str(uuid.uuid4().int)[:4].zfill(4)


def _tid() -> str:
    """Generate a unique transaction number."""
    return "TX-" + uuid.uuid4().hex[:8].upper()


def _sid() -> str:
    """Generate a unique submission ID."""
    return "SUB-" + uuid.uuid4().hex[:8].upper()


def _pid() -> str:
    """Generate a unique payment ID."""
    return uuid.uuid4().hex[:20].upper()


def _insert_member(db, member_id, status="pending", family_id=None, type_="Individual"):
    execute(db, """
        INSERT INTO members (MemberID, Status, Email, FirstName, LastName, Type, FamilyID)
        VALUES (%s, %s, %s, 'Test', %s, %s, %s)
    """, [member_id, status, f"{member_id.lower()}@test.com", member_id, type_, family_id])


def _insert_gmail_tx(db, tx_num, amount=30.00):
    execute(db, """
        INSERT INTO gmail_transactions
            (TransactionNumber, Amount, TransactionDate, PaymentMethod, Sender, Memo, MessageId)
        VALUES (%s, %s, '2025-11-01', 'Zelle', 'Test Sender', 'Membership renewal', %s)
    """, [tx_num, amount, "msg_" + tx_num])


def _insert_submission(db, sub_id, member_id, amount=30.00):
    execute(db, """
        INSERT INTO submissions (SubmissionID, MemberID, SubmissionType, Amount, Status)
        VALUES (%s, %s, 'Membership Renewal', %s, 'pending')
    """, [sub_id, member_id, amount])


def _insert_payment(db, pay_id, member_id, tx_num, pay_type="Individual Membership",
                    amount=30.00, sub_id=None):
    execute(db, """
        INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount, SubmissionID)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, [pay_id, member_id, tx_num, pay_type, amount, sub_id])


def _call_cancel_payment(db, pay_id, cancelled_by="admin@test.com"):
    cursor = db.cursor()
    cursor.callproc("sp_cancel_payment", [pay_id, cancelled_by])
    try:
        while cursor.nextset():
            pass
    except Exception:
        pass
    cursor.close()
    # Transaction owned by the `db` fixture — no commit here.


def _call_clear_transaction(db, tx_num, dry_run=0, cleared_by="admin@test.com"):
    cursor = db.cursor()
    results = []
    cursor.callproc("sp_clear_transaction", [tx_num, dry_run, cleared_by])
    # stored_results() works with use_pure=True; with the C extension the wire
    # buffer still holds unread result sets. Drain via nextset() on the same
    # cursor to avoid "Commands out of sync" on the next statement.
    for rs in cursor.stored_results():
        results.append(rs.fetchall())
    try:
        while cursor.nextset():
            pass
    except Exception:
        pass
    cursor.close()
    # Do NOT commit here — the `db` fixture owns the transaction boundary.
    # Committing inside the helper breaks rollback-based test isolation.
    return results


# ============================================================================
# sp_cancel_payment
# ============================================================================

class TestSpCancelPaymentBasic:
    """Core deletion and cleanup behaviour."""

    def test_payment_row_deleted(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid)
        _call_cancel_payment(db, pid)

        rows = query(db, "SELECT PaymentID FROM payments WHERE PaymentID=%s", [pid])
        assert rows == [], "Payment row should be deleted after cancel"

    def test_nonexistent_payment_raises(self, db):
        with pytest.raises(mysql.connector.Error):
            _call_cancel_payment(db, "PAY_DOES_NOT_EXIST")

    def test_activity_log_written(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid)
        _call_cancel_payment(db, pid)

        log = query(db, """
            SELECT * FROM activity_log
            WHERE Action='PAYMENT_CANCELLED' AND State=%s
        """, [pid])
        assert log, "PAYMENT_CANCELLED should be logged to activity_log"


class TestSpCancelPaymentMemberRevert:
    """Member fields are reverted to pre-payment state via member_log."""

    def test_membership_payment_reverts_member_status(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="pending")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, pay_type="Individual Membership")
        # After insert, trigger sets member active
        m = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "active"

        _call_cancel_payment(db, pid)

        m = query(db, "SELECT Status, Expiration, MembershipFeePaid, PaymentDate, PaymentTransaction FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "pending", "Status should revert to pre-payment value"
        assert m["Expiration"] is None, "Expiration should be cleared"
        assert m["MembershipFeePaid"] is None
        assert m["PaymentDate"] is None
        assert m["PaymentTransaction"] is None

    def test_donation_payment_does_not_touch_member(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="active")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, pay_type="Donation", amount=25.00)

        _call_cancel_payment(db, pid)

        m = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "active", "Non-membership payment cancel should not touch member status"

    def test_family_membership_reverts_all_family_members(self, db):
        fid = "F" + uuid.uuid4().hex[:4].upper()
        mid1, mid2 = _mid(), _mid()
        tid, pid = _tid(), _pid()
        _insert_member(db, mid1, status="pending", family_id=fid, type_="Family")
        _insert_member(db, mid2, status="pending", family_id=fid, type_="Family")
        _insert_gmail_tx(db, tid, amount=50.00)
        _insert_payment(db, pid, mid1, tid, pay_type="Family Membership", amount=50.00)

        # Trigger should have activated both
        statuses = query(db, "SELECT Status FROM members WHERE FamilyID=%s", [fid])
        assert all(r["Status"] == "active" for r in statuses)

        _call_cancel_payment(db, pid)

        statuses = query(db, "SELECT Status FROM members WHERE FamilyID=%s", [fid])
        assert all(r["Status"] == "pending" for r in statuses), \
            f"All family members should revert, got: {[r['Status'] for r in statuses]}"

    def test_member_reverts_to_correct_prior_status_not_inactive(self, db):
        """If member was 'expired' before payment, should revert to 'expired', not 'inactive'."""
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="expired")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, pay_type="Individual Membership")

        _call_cancel_payment(db, pid)

        m = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "expired", "Should restore 'expired', not default to 'inactive'"


class TestSpCancelPaymentSubmission:
    """Linked submission is reverted to pending."""

    def test_submission_reverted_to_pending(self, db):
        mid, tid, pid, sid = _mid(), _tid(), _pid(), _sid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_submission(db, sid, mid)
        _insert_payment(db, pid, mid, tid, sub_id=sid)

        sub = query(db, "SELECT Status FROM submissions WHERE SubmissionID=%s", [sid])[0]
        assert sub["Status"] == "approved", "Trigger should have approved the submission"

        _call_cancel_payment(db, pid)

        sub = query(db, "SELECT Status, PaymentID FROM submissions WHERE SubmissionID=%s", [sid])[0]
        assert sub["Status"] == "pending"
        assert sub["PaymentID"] is None

    def test_payment_without_submission_cancels_cleanly(self, db):
        """Cancel should succeed even if no submission was linked."""
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, sub_id=None)

        _call_cancel_payment(db, pid)  # should not raise

        rows = query(db, "SELECT PaymentID FROM payments WHERE PaymentID=%s", [pid])
        assert rows == []


class TestSpCancelPaymentGmail:
    """gmail_transactions payment-link columns cleared."""

    def test_gmail_notes_cleared(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid)

        gt = query(db, "SELECT Notes FROM gmail_transactions WHERE TransactionNumber=%s", [tid])[0]
        assert gt["Notes"] is not None, "Notes should be populated before cancel"

        _call_cancel_payment(db, pid)

        gt = query(db, "SELECT Notes, UpdatedAt FROM gmail_transactions WHERE TransactionNumber=%s", [tid])[0]
        assert gt["Notes"] is None
        assert gt["UpdatedAt"] is None


# ============================================================================
# sp_clear_transaction
# ============================================================================

class TestSpClearTransactionValidation:
    """Input validation."""

    def test_nonexistent_transaction_raises(self, db):
        with pytest.raises(mysql.connector.Error, match="TransactionNumber not found"):
            _call_clear_transaction(db, "TX_DOES_NOT_EXIST")

    def test_valid_transaction_no_payments_succeeds(self, db):
        """Transaction with zero payments should not error — member revert is still attempted."""
        tid = _tid()
        _insert_gmail_tx(db, tid)
        _call_clear_transaction(db, tid)  # should not raise


class TestSpClearTransactionDryRun:
    """Dry run returns result sets without writing anything."""

    def test_dry_run_returns_four_result_sets(self, db):
        mid, tid, pid, sid = _mid(), _tid(), _pid(), _sid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_submission(db, sid, mid)
        _insert_payment(db, pid, mid, tid, sub_id=sid)

        results = _call_clear_transaction(db, tid, dry_run=1)
        assert len(results) == 4, f"Expected 4 result sets from dry run, got {len(results)}"

    def test_dry_run_does_not_delete_payments(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid)

        _call_clear_transaction(db, tid, dry_run=1)

        rows = query(db, "SELECT PaymentID FROM payments WHERE PaymentID=%s", [pid])
        assert rows, "Dry run must not delete payments"

    def test_dry_run_does_not_modify_member(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="pending")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid)

        m_before = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        _call_clear_transaction(db, tid, dry_run=1)
        m_after = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]

        assert m_before["Status"] == m_after["Status"], "Dry run must not change member"

    def test_dry_run_shows_member_restore_values(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="expired")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, pay_type="Individual Membership")

        results = _call_clear_transaction(db, tid, dry_run=1)
        # 4th result set = members
        member_rows = results[3]
        assert member_rows, "Dry run should show member revert preview"
        row = member_rows[0]
        # result set columns: target_table, MemberID, current_status, restore_status, ...
        assert row[2] == "active", "current_status should be active (set by payment trigger)"
        assert row[3] == "expired", "restore_status should be the prior value from member_log"


class TestSpClearTransactionExecute:
    """Full execute: all payments deleted, submissions/members/gmail reverted."""

    def test_all_payments_deleted(self, db):
        mid1, mid2 = _mid(), _mid()
        tid = _tid()
        pid1, pid2 = _pid(), _pid()
        _insert_member(db, mid1)
        _insert_member(db, mid2)
        _insert_gmail_tx(db, tid, amount=60.00)
        _insert_payment(db, pid1, mid1, tid, amount=30.00)
        _insert_payment(db, pid2, mid2, tid, amount=30.00)

        _call_clear_transaction(db, tid)

        rows = query(db, "SELECT PaymentID FROM payments WHERE TransactionNumber=%s", [tid])
        assert rows == [], "All payments for the transaction should be deleted"

    def test_submission_reverted_to_pending(self, db):
        mid, tid, pid, sid = _mid(), _tid(), _pid(), _sid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_submission(db, sid, mid)
        _insert_payment(db, pid, mid, tid, sub_id=sid)

        _call_clear_transaction(db, tid)

        sub = query(db, "SELECT Status, PaymentID FROM submissions WHERE SubmissionID=%s", [sid])[0]
        assert sub["Status"] == "pending"
        assert sub["PaymentID"] is None

    def test_gmail_notes_and_updated_at_cleared(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid)
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid)

        _call_clear_transaction(db, tid)

        gt = query(db, "SELECT Notes, UpdatedAt FROM gmail_transactions WHERE TransactionNumber=%s", [tid])[0]
        assert gt["Notes"] is None
        assert gt["UpdatedAt"] is None

    def test_activity_log_written(self, db):
        tid = _tid()
        _insert_gmail_tx(db, tid)
        _call_clear_transaction(db, tid)

        log = query(db, """
            SELECT * FROM activity_log
            WHERE Action='TRANSACTION_CLEARED' AND State=%s
        """, [tid])
        assert log, "TRANSACTION_CLEARED should be logged to activity_log"


class TestSpClearTransactionMemberRevert:
    """Member revert is independent of payments/submissions state."""

    def test_member_status_reverted(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="pending")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, pay_type="Individual Membership")

        m = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "active"

        _call_clear_transaction(db, tid)

        m = query(db, "SELECT Status, Expiration, MembershipFeePaid, PaymentDate, PaymentTransaction FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "pending"
        assert m["Expiration"] is None
        assert m["MembershipFeePaid"] is None
        assert m["PaymentDate"] is None
        assert m["PaymentTransaction"] is None

    def test_member_reverted_even_when_no_submissions_linked(self, db):
        """Key regression: member revert must run even if no submission was attached."""
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="expired")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, pay_type="Individual Membership", sub_id=None)

        _call_clear_transaction(db, tid)

        m = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "expired", "Member should revert even with no submission"

    def test_family_members_all_reverted(self, db):
        fid = "F" + uuid.uuid4().hex[:4].upper()
        mid1, mid2 = _mid(), _mid()
        tid, pid = _tid(), _pid()
        _insert_member(db, mid1, status="pending", family_id=fid, type_="Family")
        _insert_member(db, mid2, status="pending", family_id=fid, type_="Family")
        _insert_gmail_tx(db, tid, amount=50.00)
        _insert_payment(db, pid, mid1, tid, pay_type="Family Membership", amount=50.00)

        statuses = query(db, "SELECT Status FROM members WHERE FamilyID=%s", [fid])
        assert all(r["Status"] == "active" for r in statuses)

        _call_clear_transaction(db, tid)

        statuses = query(db, "SELECT Status FROM members WHERE FamilyID=%s", [fid])
        assert all(r["Status"] == "pending" for r in statuses), \
            f"All family members should revert after clear, got: {[r['Status'] for r in statuses]}"

    def test_non_membership_payments_do_not_revert_member(self, db):
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="active")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, pay_type="Donation", amount=25.00)

        _call_clear_transaction(db, tid)

        m = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "active", "Donation clear should not touch member"

    def test_multiple_membership_payments_same_transaction(self, db):
        """Split membership transaction — both members reverted."""
        mid1, mid2 = _mid(), _mid()
        tid = _tid()
        pid1, pid2 = _pid(), _pid()
        _insert_member(db, mid1, status="pending")
        _insert_member(db, mid2, status="expired")
        _insert_gmail_tx(db, tid, amount=60.00)
        _insert_payment(db, pid1, mid1, tid, pay_type="Individual Membership", amount=30.00)
        _insert_payment(db, pid2, mid2, tid, pay_type="Individual Membership", amount=30.00)

        _call_clear_transaction(db, tid)

        m1 = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid1])[0]
        m2 = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid2])[0]
        assert m1["Status"] == "pending"
        assert m2["Status"] == "expired"

    def test_member_reverts_to_prior_status_from_log(self, db):
        """Verify the member_log lookup restores the exact pre-payment status."""
        mid, tid, pid = _mid(), _tid(), _pid()
        _insert_member(db, mid, status="expired")
        _insert_gmail_tx(db, tid)
        _insert_payment(db, pid, mid, tid, pay_type="Individual Membership")

        # Confirm trigger activated the member
        m = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "active"

        _call_clear_transaction(db, tid)

        m = query(db, "SELECT Status FROM members WHERE MemberID=%s", [mid])[0]
        assert m["Status"] == "expired", "Should restore 'expired' from member_log, not default to 'inactive'"
