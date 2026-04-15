"""
Integration tests for sp_delink_member_payment.

Scenario: a member's PaymentTransaction, MembershipFeePaid, and PaymentDate were
stamped with a transaction that legitimately belongs to a *different* member.
The proc should restore the member's pre-stamp state from member_log without
touching payments, submissions, or gmail_transactions.

Run:
    pytest mmr-admin/tests/test_sp_delink_member_payment.py --run-integration -v
"""

import uuid
import pytest
import mysql.connector
from tests.integration.conftest_integration import query, execute

pytestmark = pytest.mark.integration

VALID_STATUSES = ('active', 'expired', 'inactive', 'pending', 'pending_upgrade', 'lifetime')

# ---------------------------------------------------------------------------
# Helpers (mirror pattern from test_integration_stored_procs.py)
# ---------------------------------------------------------------------------

def _mid():
    return "A" + str(uuid.uuid4().int)[:4].zfill(4)

def _tid():
    return "TX-" + uuid.uuid4().hex[:8].upper()

def _insert_member(db, member_id, status="pending", payment_tx=None, fee=None,
                   pay_date=None, expiration=None, family_id=None, type_="Individual"):
    execute(db, """
        INSERT INTO members
            (MemberID, Status, Email, FirstName, LastName, Type, FamilyID,
             PaymentTransaction, MembershipFeePaid, PaymentDate, Expiration)
        VALUES (%s, %s, %s, 'Test', %s, %s, %s, %s, %s, %s, %s)
    """, [member_id, status, f"{member_id.lower()}@test.com", member_id,
          type_, family_id, payment_tx, fee, pay_date, expiration])


def _log_member(db, member_id, status, expiration=None, payment_tx=None,
                fee=None, pay_date=None, logging_time=None):
    """Insert a member_log snapshot (simulates what the trigger would write)."""
    execute(db, """
        INSERT INTO member_log
            (LogID, MemberID, ChangeType, Status, Expiration,
             MembershipFeePaid, PaymentDate, PaymentTransaction, LoggingTime)
        VALUES (UUID(), %s, 'UPDATE', %s, %s, %s, %s, %s,
                IFNULL(%s, NOW()))
    """, [member_id, status, expiration, fee, pay_date, payment_tx, logging_time])


def _call(db, member_id, dry_run):
    return query(db, "CALL sp_delink_member_payment(%s, %s)", [member_id, dry_run])


def _get_member(db, member_id):
    rows = query(db, "SELECT * FROM members WHERE MemberID = %s", [member_id])
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSpDelinkMemberPayment:

    def test_dry_run_returns_preview_row(self, db):
        """Dry run returns one row describing what would change."""
        mid = _mid()
        tx = _tid()
        _insert_member(db, mid, status="active", payment_tx=tx,
                       fee=30.00, pay_date="2026-03-24", expiration="2027-03-31")
        # Log the pre-stamp state
        _log_member(db, mid, status="pending", logging_time="2026-01-01 00:00:00")
        # Log the stamp itself
        _log_member(db, mid, status="active", expiration="2027-03-31",
                    payment_tx=tx, fee=30.00, pay_date="2026-03-24",
                    logging_time="2026-03-26 04:47:00")

        rows = _call(db, mid, dry_run=1)
        assert len(rows) == 1
        row = rows[0]
        assert row["MemberID"] == mid
        assert row["current_PaymentTransaction"] == tx
        assert row["restore_Status"] == "pending"
        assert row["restore_FeePaid"] is None
        assert row["restore_PaymentTransaction"] is None

    def test_execute_clears_payment_fields(self, db):
        """Execute restores Status/Expiration and clears 3 payment columns."""
        mid = _mid()
        tx = _tid()
        _insert_member(db, mid, status="active", payment_tx=tx,
                       fee=30.00, pay_date="2026-03-24", expiration="2027-03-31")
        _log_member(db, mid, status="pending", logging_time="2026-01-01 00:00:00")
        _log_member(db, mid, status="active", expiration="2027-03-31",
                    payment_tx=tx, fee=30.00, pay_date="2026-03-24",
                    logging_time="2026-03-26 04:47:00")

        _call(db, mid, dry_run=0)

        m = _get_member(db, mid)
        assert m["Status"] == "pending"
        assert m["Expiration"] is None
        assert m["MembershipFeePaid"] is None
        assert m["PaymentDate"] is None
        assert m["PaymentTransaction"] is None

    def test_status_enum_not_truncated(self, db):
        """Restored status must be a valid ENUM value (no 1265 warning)."""
        mid = _mid()
        tx = _tid()
        _insert_member(db, mid, status="active", payment_tx=tx,
                       fee=30.00, pay_date="2026-03-24", expiration="2027-03-31")
        # member_log has an out-of-enum value (e.g. empty string from old data)
        _log_member(db, mid, status="", logging_time="2026-01-01 00:00:00")
        _log_member(db, mid, status="active", expiration="2027-03-31",
                    payment_tx=tx, fee=30.00, pay_date="2026-03-24",
                    logging_time="2026-03-26 04:47:00")

        _call(db, mid, dry_run=0)

        m = _get_member(db, mid)
        assert m["Status"] in VALID_STATUSES, f"Invalid status after delink: {m['Status']}"
        assert m["Status"] == "inactive"   # fallback for invalid/empty

    def test_no_prior_log_entry_clears_to_null(self, db):
        """If member has no log entry before the stamp, payment fields go to NULL,
        status falls back to 'inactive'."""
        mid = _mid()
        tx = _tid()
        _insert_member(db, mid, status="active", payment_tx=tx,
                       fee=30.00, pay_date="2026-03-24", expiration="2027-03-31")
        # Only the stamp log entry exists — nothing before it
        _log_member(db, mid, status="active", expiration="2027-03-31",
                    payment_tx=tx, fee=30.00, pay_date="2026-03-24",
                    logging_time="2026-03-26 04:47:00")

        _call(db, mid, dry_run=0)

        m = _get_member(db, mid)
        assert m["Status"] == "inactive"
        assert m["MembershipFeePaid"] is None
        assert m["PaymentTransaction"] is None

    def test_payments_table_untouched(self, db):
        """The payment row belonging to another member must not be modified."""
        owner_mid = _mid()
        wrong_mid = _mid()
        tx = _tid()

        _insert_member(db, owner_mid, status="active")
        _insert_member(db, wrong_mid, status="active", payment_tx=tx,
                       fee=30.00, pay_date="2026-03-24", expiration="2027-03-31")

        execute(db, """
            INSERT INTO gmail_transactions
                (TransactionNumber, Amount, TransactionDate, PaymentMethod, Sender, Memo, MessageId)
            VALUES (%s, 30.00, '2026-03-24', 'Zelle', 'Owner Name', 'Membership', %s)
        """, [tx, "msg_" + tx])
        pay_id = "PY-" + uuid.uuid4().hex[:12]
        execute(db, """
            INSERT INTO payments
                (PaymentID, MemberID, PaymentDate, Amount, PaymentMethod,
                 TransactionNumber, PaymentType, Source)
            VALUES (%s, %s, '2026-03-24', 30.00, 'Zelle', %s,
                    'Individual Membership', 'WebApp')
        """, [pay_id, owner_mid, tx])

        _log_member(db, wrong_mid, status="pending", logging_time="2026-01-01 00:00:00")
        _log_member(db, wrong_mid, status="active", expiration="2027-03-31",
                    payment_tx=tx, fee=30.00, pay_date="2026-03-24",
                    logging_time="2026-03-26 04:47:00")

        _call(db, wrong_mid, dry_run=0)

        # Payment still points to original owner
        rows = query(db, "SELECT MemberID FROM payments WHERE PaymentID = %s", [pay_id])
        assert rows[0]["MemberID"] == owner_mid

    def test_error_no_payment_transaction(self, db):
        """Proc raises error if member has no PaymentTransaction."""
        mid = _mid()
        _insert_member(db, mid, status="pending")

        with pytest.raises(mysql.connector.Error) as exc_info:
            _call(db, mid, dry_run=0)
        assert "no PaymentTransaction" in str(exc_info.value)

    def test_error_no_log_entry_for_tx(self, db):
        """Proc raises error if PaymentTransaction value never appears in member_log.

        trg_members_after_insert auto-logs the INSERT row (including PaymentTransaction),
        so we delete that entry afterward to simulate a member whose PaymentTransaction
        was set outside the normal trigger flow (e.g. direct DB edit) with no log history.
        """
        mid = _mid()
        tx = _tid()
        _insert_member(db, mid, status="active", payment_tx=tx,
                       fee=30.00, pay_date="2026-03-24", expiration="2027-03-31")
        # Delete the trigger-generated INSERT log so no entry matches the current tx
        execute(db, "DELETE FROM member_log WHERE MemberID=%s", [mid])

        with pytest.raises(mysql.connector.Error) as exc_info:
            _call(db, mid, dry_run=0)
        assert "No member_log entry" in str(exc_info.value)

    def test_audit_log_written(self, db):
        """PAYMENT_DELINKED action must appear in activity_log after execute."""
        mid = _mid()
        tx = _tid()
        _insert_member(db, mid, status="active", payment_tx=tx,
                       fee=30.00, pay_date="2026-03-24", expiration="2027-03-31")
        _log_member(db, mid, status="pending", logging_time="2026-01-01 00:00:00")
        _log_member(db, mid, status="active", expiration="2027-03-31",
                    payment_tx=tx, fee=30.00, pay_date="2026-03-24",
                    logging_time="2026-03-26 04:47:00")

        _call(db, mid, dry_run=0)

        rows = query(db, """
            SELECT * FROM activity_log
            WHERE MemberID = %s AND Action = 'PAYMENT_DELINKED'
            ORDER BY Timestamp DESC LIMIT 1
        """, [mid])
        assert len(rows) == 1
        assert tx in rows[0]["State"]

    def test_reconciliation_query_catches_mismatch(self, db):
        """The cross-member reconciliation SELECT returns rows for known bad cases."""
        owner_mid = _mid()
        wrong_mid = _mid()
        tx = _tid()

        _insert_member(db, owner_mid, status="active")
        _insert_member(db, wrong_mid, status="active", payment_tx=tx,
                       fee=30.00, pay_date="2026-03-24", expiration="2027-03-31")

        execute(db, """
            INSERT INTO gmail_transactions
                (TransactionNumber, Amount, TransactionDate, PaymentMethod, Sender, Memo, MessageId)
            VALUES (%s, 30.00, '2026-03-24', 'Zelle', 'Owner Name', 'Membership', %s)
        """, [tx, "msg_" + tx])
        pay_id = "PY-" + uuid.uuid4().hex[:12]
        execute(db, """
            INSERT INTO payments
                (PaymentID, MemberID, PaymentDate, Amount, PaymentMethod,
                 TransactionNumber, PaymentType, Source)
            VALUES (%s, %s, '2026-03-24', 30.00, 'Zelle', %s,
                    'Individual Membership', 'WebApp')
        """, [pay_id, owner_mid, tx])

        rows = query(db, """
            SELECT m.MemberID, p.MemberID AS payment_linked_to
            FROM members m
            JOIN payments p ON p.TransactionNumber = m.PaymentTransaction
            WHERE p.MemberID != m.MemberID
              AND m.PaymentTransaction IS NOT NULL AND m.PaymentTransaction != ''
              AND (
                m.Type = 'Individual'
                OR (m.Type = 'Family' AND m.FamilyID IS NOT NULL AND m.FamilyID != ''
                    AND m.FamilyID != (
                        SELECT m2.FamilyID FROM members m2
                        WHERE m2.MemberID = p.MemberID LIMIT 1
                    ))
              )
        """)
        member_ids = [r["MemberID"] for r in rows]
        assert wrong_mid in member_ids
        assert owner_mid not in member_ids
