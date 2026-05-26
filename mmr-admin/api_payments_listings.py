"""
Payments — read-only listings.

Endpoints:
  GET  /api/payments/dashboard            — counts for dashboard
  GET  /api/payments/pending-submissions  — list pending submissions
  GET  /api/payments/unmatched-gmail      — list unmatched gmail txs
  GET  /api/payments/search-members       — admin member search
  GET  /api/payments/history              — payment history (paginated)
  POST /api/payments/cancel/<payment_id>  — cancel a payment (sp_cancel_payment)
  GET  /api/payments/autoguess-log        — historical autoguess runs

Routes register on the shared `payments_bp` defined in `api_payments`.
"""

from __future__ import annotations

import logging
from flask import request, session

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors, get_pagination

from api_payments import payments_bp

logger = logging.getLogger(__name__)


# ============================================================================
# DASHBOARD
# ============================================================================

@payments_bp.route('/api/payments/dashboard', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_payments_dashboard():
    """Return counts for payments dashboard."""
    logger.info('[DASHBOARD] Fetching payment dashboard stats...')

    try:
        pending = query("SELECT COUNT(*) as cnt FROM submissions WHERE Status = 'pending'")
        logger.info(f'[DASHBOARD] Pending submissions: {pending}')

        matched = query("SELECT COUNT(*) as cnt FROM payments WHERE SubmissionID IS NOT NULL")
        logger.info(f'[DASHBOARD] Matched payments: {matched}')

        unmatched_gmail = query("""
            SELECT COUNT(*) as cnt FROM gmail_transactions
            WHERE Notes IS NULL OR UpdatedAt IS NULL
        """)
        logger.info(f'[DASHBOARD] Unmatched gmail: {unmatched_gmail}')

        approved_30d = query("""
            SELECT COUNT(*) as cnt FROM submissions
            WHERE Status = 'approved' AND UpdatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        """)
        logger.info(f'[DASHBOARD] Approved (30d): {approved_30d}')

        rejected_30d = query("""
            SELECT COUNT(*) as cnt FROM submissions
            WHERE Status = 'cancelled' AND UpdatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        """)
        logger.info(f'[DASHBOARD] Rejected (30d): {rejected_30d}')

        errors = query("""
            SELECT COUNT(*) as cnt FROM error_context
            WHERE Status IN ('NEW', 'ACKNOWLEDGED') AND DetectedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        """)
        logger.info(f'[DASHBOARD] Errors (7d): {errors}')

        result = {
            'ok': True,
            'pending': pending[0]['cnt'],
            'matched': matched[0]['cnt'],
            'unmatched_gmail': unmatched_gmail[0]['cnt'],
            'approved_30d': approved_30d[0]['cnt'],
            'rejected_30d': rejected_30d[0]['cnt'],
            'errors': errors[0]['cnt'],
        }
        logger.info(f'[DASHBOARD] Returning response: {result}')
        return json_response(result)
    except Exception as e:
        logger.exception(f'[DASHBOARD] Exception in dashboard endpoint: {e}')
        raise


# ============================================================================
# LIST ENDPOINTS
# ============================================================================

@payments_bp.route('/api/payments/pending-submissions', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_pending_submissions():
    """
    List all pending submissions.
    Query params: ?skip=0&limit=50&search=
    """
    skip, limit = get_pagination()
    search = request.args.get('search', '').strip()

    sql = """
        SELECT s.SubmissionID, s.MemberID, s.SubmissionType, s.Amount, s.CreatedAt,
               s.Status, s.ExpiresAt,
               m.FirstName, m.LastName, m.Email, m.Type as MemberType
        FROM submissions s
        JOIN members m ON s.MemberID = m.MemberID
        WHERE s.Status = 'pending'
    """
    params = []

    if search:
        sql += " AND (m.FirstName LIKE %s OR m.LastName LIKE %s OR m.Email LIKE %s OR s.MemberID LIKE %s)"
        params.extend([f"%{search}%"] * 4)

    sql += " ORDER BY s.CreatedAt DESC LIMIT %s OFFSET %s"
    params.extend([limit, skip])

    rows = query(sql, tuple(params))
    return json_response({'submissions': rows})


@payments_bp.route('/api/payments/unmatched-gmail', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_unmatched_gmail():
    """
    List all unmatched Gmail transactions (Notes IS NULL or UpdatedAt IS NULL).
    Query params: ?skip=0&limit=50&search=
    """
    skip, limit = get_pagination()
    search = request.args.get('search', '').strip()

    base_where = " FROM gmail_transactions WHERE (Notes IS NULL OR UpdatedAt IS NULL)"
    search_clause = ""
    search_params = []

    if search:
        search_clause = " AND (Sender LIKE %s OR Memo LIKE %s OR TransactionNumber LIKE %s OR Amount LIKE %s)"
        search_params = [f"%{search}%"] * 4

    total_rows = query(
        f"SELECT COUNT(*) AS cnt{base_where}{search_clause}",
        tuple(search_params)
    )
    total = total_rows[0]['cnt'] if total_rows else 0

    sql = f"""SELECT MessageId, TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate,
               PaymentMethod, Notes, UpdatedAt
        {base_where}{search_clause}
        ORDER BY TransactionDate DESC LIMIT %s OFFSET %s"""
    rows = query(sql, tuple(search_params + [limit, skip]))
    return json_response({'transactions': rows, 'total': total, 'skip': skip, 'limit': limit})


# ============================================================================
# MEMBER SEARCH
# ============================================================================

@payments_bp.route('/api/payments/search-members', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_search_members():
    """
    Search members by name, email, memberID, notes, wechat, etc.
    Query params: ?q=search_term&limit=30
    Supports multiple space-separated terms (AND logic).
    """
    q = request.args.get('q', '').strip()
    limit = int(request.args.get('limit', 30))

    if len(q) < 2:
        return json_response({'error': 'Search term too short'}, status=400)

    results = query(
        "CALL sp_search_members_advanced(%s, %s)",
        (q, limit)
    )

    return json_response({'members': results})


# ============================================================================
# PAYMENT HISTORY
# ============================================================================

@payments_bp.route('/api/payments/history', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_payment_history():
    """
    Get payment history, sorted by most recent first.
    Query params: ?skip=0&limit=50&days=30&search=
      days=0  → all time (no date filter)
      search  → filter by member name, MemberID, or PaymentID
    Returns: { payments, total, skip, limit }
    """
    skip, limit = get_pagination()
    days = int(request.args.get('days', 30))
    search = request.args.get('search', '').strip()

    where_clauses = []
    params = []

    if days > 0:
        where_clauses.append('p.UpdatedAt >= DATE_SUB(NOW(), INTERVAL %s DAY)')
        params.append(days)

    if search:
        like = f'%{search}%'
        where_clauses.append(
            '(m.MemberID LIKE %s OR m.FirstName LIKE %s OR m.LastName LIKE %s'
            ' OR CONCAT(m.FirstName, " ", m.LastName) LIKE %s OR p.PaymentID LIKE %s)'
        )
        params.extend([like, like, like, like, like])

    where_sql = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''

    base_sql = f"""
        FROM payments p
        JOIN members m ON p.MemberID = m.MemberID
        LEFT JOIN submissions s ON p.SubmissionID = s.SubmissionID
        {where_sql}
    """

    total_rows = query(f'SELECT COUNT(*) as cnt {base_sql}', params)
    total = total_rows[0]['cnt'] if total_rows else 0

    rows = query(f"""
        SELECT
            p.PaymentID,
            p.MemberID,
            m.FirstName,
            m.LastName,
            p.Amount,
            p.PaymentType,
            p.PaymentDate,
            p.ProcessedBy,
            s.SubmissionID,
            s.Status as SubmissionStatus,
            p.UpdatedAt
        {base_sql}
        ORDER BY p.UpdatedAt DESC
        LIMIT %s OFFSET %s
    """, params + [limit, skip])

    return json_response({'payments': rows, 'total': total, 'skip': skip, 'limit': limit})


@payments_bp.route('/api/payments/cancel/<payment_id>', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_cancel_payment(payment_id):
    """
    Cancel a payment by calling sp_cancel_payment(p_payment_id, p_cancelled_by).
    Reverses member status, reverts submission to pending, clears gmail link, deletes payment.
    """
    if not payment_id:
        return json_response({'error': 'payment_id required'}, 400)

    admin_email = session.get('user', {}).get('email') or None
    logger.info(f'[CANCEL-PAYMENT] Admin {admin_email} cancelling payment {payment_id}')

    execute("CALL sp_cancel_payment(%s, %s)", (payment_id, admin_email))
    msg = f'Payment {payment_id} cancelled.'
    logger.info(f'[CANCEL-PAYMENT] {msg}')

    return json_response({'ok': True, 'message': msg})


# ============================================================================
# AUTOGUESS AUDIT LOG
# ============================================================================

@payments_bp.route('/api/payments/autoguess-log', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_autoguess_log():
    """Fetch historical autoguess runs from activity_log."""
    skip, limit = get_pagination(default_limit=100)

    rows = query("""
        SELECT
            LogID,
            Timestamp,
            Email,
            State,
            ErrorMessage,
            ErrorSeverity
        FROM activity_log
        WHERE Action = 'AUTOGUESS_RUN'
        ORDER BY Timestamp DESC
        LIMIT %s OFFSET %s
    """, (limit, skip))

    return json_response({'ok': True, 'data': {'logs': rows}})
