"""
Integration tests — payment creation flow against real MySQL 5.7.

These tests hit sp_link_transaction and the full trigger chain:
  trg_payments_auto_fill         → copies TransactionDate/PaymentMethod/Sender/Memo
  trg_payments_sync_membership   → sets member status='active', updates Expiration
  trg_payments_approve_submission → marks submission 'approved'
  trg_payments_sync_to_gmail     → updates gmail_transactions.Notes

Run:
    pytest mmr-admin/tests/test_integration_payments.py --run-integration -v
"""

import uuid
import pytest
from conftest_integration import query, execute

pytestmark = pytest.mark.integration

# ---------------------------------------------------------------------------
# Fixtures: minimal seed data inserted per-test (rolled back after)
# ---------------------------------------------------------------------------

def _insert_member(db, member_id: str, status="pending", type_="Individual", family_id=None) -> str:
    execute(db, """
        INSERT INTO members (MemberID, Status, Email, FirstName, LastName, Type, FamilyID)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, [
        member_id, status,
        f"{member_id.lower()}@test.com",
        "Test", member_id,
        type_, family_id,
    ])
    return member_id


def _insert_gmail_tx(db, tx_num: str, amount: float = 30.00, sender: str = "Test Sender") -> str:
    execute(db, """
        INSERT INTO gmail_transactions
            (TransactionNumber, Amount, TransactionDate, PaymentMethod, Sender, Memo, MessageId)
        VALUES (%s, %s, '2026-11-01', 'Zelle', %s, 'Membership A0001', %s)
    """, [tx_num, amount, sender, f"msg_{tx_num}"])
    return tx_num


def _insert_submission(db, sub_id: str, member_id: str, amount: float = 30.00) -> str:
    execute(db, """
        INSERT INTO submissions (SubmissionID, MemberID, SubmissionType, Amount, Status)
        VALUES (%s, %s, 'Membership Renewal', %s, 'pending')
    """, [sub_id, member_id, amount])
    return sub_id


# ---------------------------------------------------------------------------
# Tests: trigger correctness
# ---------------------------------------------------------------------------

class TestPaymentsAutoFill:
    """trg_payments_auto_fill pulls TransactionDate/PaymentMethod/Sender/Memo
    from gmail_transactions on payment INSERT."""

    def test_payment_date_copied_from_transaction_date(self, db):
        _insert_member(db, "A0001")
        _insert_gmail_tx(db, "TX001", amount=30.00)
        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0001', 'TX001', 'Individual Membership', 30.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        row = query(db, "SELECT PaymentDate, PaymentMethod, PayerName, MemoField FROM payments WHERE TransactionNumber='TX001'")
        assert row, "Payment not found"
        p = row[0]
        assert str(p["PaymentDate"]) == "2026-11-01", "PaymentDate should come from TransactionDate"
        assert p["PaymentMethod"] == "Zelle"
        assert p["PayerName"] == "Test Sender"
        assert p["MemoField"] == "Membership A0001"

    def test_payment_date_not_paymentdate_column(self, db):
        """Regression: trigger must use TransactionDate (not PaymentDate) from gmail_transactions."""
        _insert_member(db, "A0002")
        _insert_gmail_tx(db, "TX002", amount=30.00)
        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0002', 'TX002', 'Individual Membership', 30.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        p = query(db, "SELECT PaymentDate FROM payments WHERE TransactionNumber='TX002'")[0]
        assert p["PaymentDate"] is not None, "PaymentDate should be filled by trigger"


class TestMemberStatusAfterPayment:
    """trg_payments_sync_membership_only activates member on membership payment."""

    def test_member_becomes_active(self, db):
        _insert_member(db, "A0003", status="pending")
        _insert_gmail_tx(db, "TX003", amount=30.00)
        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0003', 'TX003', 'Individual Membership', 30.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        m = query(db, "SELECT Status, Expiration FROM members WHERE MemberID='A0003'")[0]
        assert m["Status"] == "active"
        assert m["Expiration"] is not None, "Expiration should be set after membership payment"

    def test_expiration_uses_config_membership_year_end(self, db):
        _insert_member(db, "A0004", status="expired")
        _insert_gmail_tx(db, "TX004", amount=30.00)
        config = query(db, "SELECT ConfigValue FROM config WHERE ConfigKey='MembershipYearEnd'")
        expected_exp = config[0]["ConfigValue"] if config else None

        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0004', 'TX004', 'Individual Membership', 30.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        m = query(db, "SELECT Expiration FROM members WHERE MemberID='A0004'")[0]
        if expected_exp:
            assert str(m["Expiration"]) == str(expected_exp), \
                f"Expected Expiration={expected_exp} from config, got {m['Expiration']}"

    def test_non_membership_payment_does_not_change_status(self, db):
        _insert_member(db, "A0005", status="pending")
        _insert_gmail_tx(db, "TX005", amount=25.00)
        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0005', 'TX005', 'Donation', 25.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        m = query(db, "SELECT Status FROM members WHERE MemberID='A0005'")[0]
        assert m["Status"] == "pending", "Donation should not activate member"

    def test_family_members_all_activated(self, db):
        """All members sharing a FamilyID should become active on one payment."""
        _insert_member(db, "A0010", status="pending", type_="Family", family_id="F001")
        _insert_member(db, "A0011", status="pending", type_="Family", family_id="F001")
        _insert_gmail_tx(db, "TX010", amount=50.00)

        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0010', 'TX010', 'Family Membership', 50.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        statuses = query(db, "SELECT Status FROM members WHERE FamilyID='F001'")
        assert all(r["Status"] == "active" for r in statuses), \
            f"All family members should be active, got: {[r['Status'] for r in statuses]}"


class TestSubmissionApproval:
    """trg_payments_approve_submission links payment → submission."""

    def test_submission_approved_on_payment_insert(self, db):
        _insert_member(db, "A0006", status="pending")
        _insert_gmail_tx(db, "TX006", amount=30.00)
        sub_id = _insert_submission(db, "SUB001", "A0006", 30.00)

        pay_id = str(uuid.uuid4()).replace("-", "")
        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount, SubmissionID)
            VALUES (%s, 'A0006', 'TX006', 'Individual Membership', 30.00, %s)
        """, [pay_id, sub_id])

        sub = query(db, "SELECT Status, PaymentID FROM submissions WHERE SubmissionID=%s", [sub_id])
        assert sub[0]["Status"] == "approved"
        assert sub[0]["PaymentID"] == pay_id

    def test_null_submission_id_does_not_error(self, db):
        """Payment without submission (standalone) should succeed."""
        _insert_member(db, "A0007", status="pending")
        _insert_gmail_tx(db, "TX007", amount=30.00)
        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount, SubmissionID)
            VALUES (%s, 'A0007', 'TX007', 'Individual Membership', 30.00, NULL)
        """, [str(uuid.uuid4()).replace("-", "")])

        count = query(db, "SELECT COUNT(*) AS n FROM payments WHERE TransactionNumber='TX007'")[0]["n"]
        assert count == 1


class TestGmailNotesSync:
    """trg_payments_sync_to_gmail_on_change_after_payment_insert updates Notes."""

    def test_gmail_notes_updated_after_payment(self, db):
        _insert_member(db, "A0008")
        _insert_gmail_tx(db, "TX008", amount=30.00)
        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0008', 'TX008', 'Individual Membership', 30.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        gt = query(db, "SELECT Notes FROM gmail_transactions WHERE TransactionNumber='TX008'")[0]
        assert gt["Notes"] is not None, "Notes should be updated after payment insert"
        assert "A0008" in gt["Notes"]


class TestSplitPaymentLimit:
    """trg_payments_limit_check_insert prevents over-allocation."""

    def test_split_within_limit_succeeds(self, db):
        _insert_member(db, "A0020")
        _insert_member(db, "A0021")
        _insert_gmail_tx(db, "TX020", amount=60.00)

        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0020', 'TX020', 'Individual Membership', 30.00)
        """, [str(uuid.uuid4()).replace("-", "")])
        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0021', 'TX020', 'Individual Membership', 30.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        count = query(db, "SELECT COUNT(*) AS n FROM payments WHERE TransactionNumber='TX020'")[0]["n"]
        assert count == 2

    def test_split_exceeding_limit_raises(self, db):
        _insert_member(db, "A0022")
        _insert_member(db, "A0023")
        _insert_gmail_tx(db, "TX021", amount=30.00)

        execute(db, """
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
            VALUES (%s, 'A0022', 'TX021', 'Individual Membership', 30.00)
        """, [str(uuid.uuid4()).replace("-", "")])

        import mysql.connector
        with pytest.raises(mysql.connector.Error, match="Split Error"):
            execute(db, """
                INSERT INTO payments (PaymentID, MemberID, TransactionNumber, PaymentType, Amount)
                VALUES (%s, 'A0023', 'TX021', 'Individual Membership', 5.00)
            """, [str(uuid.uuid4()).replace("-", "")])


class TestSpLinkTransaction:
    """sp_link_transaction end-to-end — exactly 5 params."""

    def test_basic_link_creates_payment(self, db):
        _insert_member(db, "A0030", status="pending")
        _insert_gmail_tx(db, "TX030", amount=30.00)

        cursor = db.cursor()
        cursor.callproc("sp_link_transaction", [
            "TX030", "A0030", "Individual Membership", 30.00, None
        ])
        cursor.close()

        row = query(db, "SELECT * FROM payments WHERE TransactionNumber='TX030'")
        assert row, "sp_link_transaction should create a payment row"
        assert row[0]["MemberID"] == "A0030"

        m = query(db, "SELECT Status FROM members WHERE MemberID='A0030'")[0]
        assert m["Status"] == "active"

    def test_link_with_submission_approves_it(self, db):
        _insert_member(db, "A0031", status="pending")
        _insert_gmail_tx(db, "TX031", amount=30.00)
        _insert_submission(db, "SUB031", "A0031", 30.00)

        cursor = db.cursor()
        cursor.callproc("sp_link_transaction", [
            "TX031", "A0031", "Individual Membership", 30.00, "SUB031"
        ])
        cursor.close()

        sub = query(db, "SELECT Status FROM submissions WHERE SubmissionID='SUB031'")[0]
        assert sub["Status"] == "approved"

    def test_invalid_tx_raises(self, db):
        _insert_member(db, "A0032", status="pending")
        import mysql.connector
        cursor = db.cursor()
        with pytest.raises(mysql.connector.Error):
            cursor.callproc("sp_link_transaction", [
                "TX_DOES_NOT_EXIST", "A0032", "Individual Membership", 30.00, None
            ])
        cursor.close()

    def test_invalid_member_raises(self, db):
        _insert_gmail_tx(db, "TX033", amount=30.00)
        import mysql.connector
        cursor = db.cursor()
        with pytest.raises(mysql.connector.Error):
            cursor.callproc("sp_link_transaction", [
                "TX033", "XXXX", "Individual Membership", 30.00, None
            ])
        cursor.close()


class TestMemberTriggers:
    """members table trigger behaviour."""

    def test_invalid_email_rejected(self, db):
        import mysql.connector
        with pytest.raises(mysql.connector.Error, match="Invalid email"):
            execute(db, """
                INSERT INTO members (MemberID, Status, Email, FirstName, LastName)
                VALUES ('A0040', 'pending', 'not-an-email', 'Bad', 'Email')
            """)

    def test_invalid_status_rejected(self, db):
        import mysql.connector
        with pytest.raises(mysql.connector.Error):
            execute(db, """
                INSERT INTO members (MemberID, Status, Email, FirstName, LastName)
                VALUES ('A0041', 'bogus_status', 'ok@test.com', 'Bad', 'Status')
            """)

    def test_insert_logged_to_member_log(self, db):
        _insert_member(db, "A0042")
        log = query(db, "SELECT * FROM member_log WHERE MemberID='A0042'")
        assert log, "trg_members_after_insert should write to member_log"
        assert log[0]["ChangeType"] == "INSERT"

    def test_update_logged_to_member_log(self, db):
        _insert_member(db, "A0043")
        execute(db, "UPDATE members SET Notes='updated' WHERE MemberID='A0043'")
        log = query(db, "SELECT ChangeType FROM member_log WHERE MemberID='A0043' ORDER BY LoggingTime DESC")
        change_types = [r["ChangeType"] for r in log]
        assert "UPDATE" in change_types

    def test_direct_expiration_update_blocked(self, db):
        """members_before_update prevents direct Expiration changes."""
        import mysql.connector
        _insert_member(db, "A0044")
        with pytest.raises(mysql.connector.Error, match="Direct update to Expiration"):
            execute(db, "UPDATE members SET Expiration='2099-01-01' WHERE MemberID='A0044'")

    def test_lifetime_status_sets_expiration(self, db):
        """trg_members_before_update_lifetime auto-sets expiration to 2126."""
        _insert_member(db, "A0045", status="active")
        # Use sp_admin_update_member_status (it sets @internal_proc=1 to bypass lock)
        cursor = db.cursor()
        cursor.callproc("sp_admin_update_member_status", [
            "A0045", "admin@test.com", "lifetime", None, "Testing lifetime"
        ])
        cursor.close()
        m = query(db, "SELECT Status, Expiration FROM members WHERE MemberID='A0045'")[0]
        assert m["Status"] == "lifetime"
        assert str(m["Expiration"]) == "2126-03-31"


class TestGenerateMemberId:
    """generate_member_id procedure returns sequential A-prefixed IDs."""

    def test_returns_a_prefixed_id(self, db):
        cursor = db.cursor()
        args = cursor.callproc("generate_member_id", [""])
        new_id = args[0]
        cursor.close()
        assert new_id.startswith("A"), f"Expected A-prefix, got: {new_id}"

    def test_id_increments(self, db):
        _insert_member(db, "A0050")
        cursor = db.cursor()
        args = cursor.callproc("generate_member_id", [""])
        new_id = args[0]
        cursor.close()
        assert int(new_id[1:]) > 50, f"Expected id > A0050, got {new_id}"
