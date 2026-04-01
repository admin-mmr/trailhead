"""
Payment reconciliation routes for mmr-admin.

Blueprint: payments_bp
Prefix: /api/payments

Implements the 2-step async payment workflow:
  1. View pending events & unmatched gmail transactions
  2. Match (manual or auto) → Approve → Fulfill (category-specific)
"""

from __future__ import annotations

from datetime import datetime, timedelta
from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from query_builder import add_search
from payment_actions import (
    approve_event,
    reject_event,
    manual_match,
    admin_create_payment,
    run_auto_match,
    get_member,
    get_family_member_ids,
    get_config,
    _extract_member_id,
    _name_match,
)
from sync_engine import to_mysql_datetime as _engine_to_mysql_dt

payments_bp = Blueprint('payments', __name__)


# ---------------------------------------------------------------------------
# Dashboard stats
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/dashboard')
@login_required
@require_role('admin')
@handle_api_errors
def api_payments_dashboard():
    """Return counts for the payments dashboard cards."""
    pending = query("""
        SELECT COUNT(*) as cnt FROM webapp_events
        WHERE Status = 'pending' AND EventCategory = 'payment'
    """)
    matched = query("""
        SELECT COUNT(*) as cnt FROM webapp_events
        WHERE Status = 'matched' AND EventCategory = 'payment'
    """)
    unmatched_gmail = query("""
        SELECT COUNT(*) as cnt FROM gmail_transactions
        WHERE ProcessedTime IS NULL AND IsArchived = FALSE
    """)
    recent_approved = query("""
        SELECT COUNT(*) as cnt FROM webapp_events
        WHERE Status = 'approved' AND EventCategory = 'payment'
          AND ApprovalDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    """)
    recent_rejected = query("""
        SELECT COUNT(*) as cnt FROM webapp_events
        WHERE Status = 'rejected' AND EventCategory = 'payment'
          AND ApprovalDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    """)
    error_count = query("""
        SELECT COUNT(*) as cnt FROM webapp_events
        WHERE Status = 'error' AND EventCategory = 'payment'
    """)

    return json_response({'ok': True, 'data': {
        'pending':          pending[0]['cnt'],
        'matched':          matched[0]['cnt'],
        'unmatched_gmail':  unmatched_gmail[0]['cnt'],
        'approved_30d':     recent_approved[0]['cnt'],
        'rejected_30d':     recent_rejected[0]['cnt'],
        'errors':           error_count[0]['cnt'],
    }})


# ---------------------------------------------------------------------------
# Pending events (Step 1 view)
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/pending-events')
@login_required
@require_role('admin')
@handle_api_errors
def api_pending_events():
    """
    List all pending/matched webapp_events with member info.
    Supports ?status=pending|matched and ?search= filters.
    """
    status_filter = request.args.get('status', '')
    search = request.args.get('q', '').strip()

    sql = """
        SELECT we.*,
               m.FirstName, m.LastName, m.Email as MemberEmail,
               m.Type as CurrentType, m.Expiration as CurrentExpiration,
               m.FamilyID, m.Status as MemberStatus
        FROM webapp_events we
        LEFT JOIN members m ON we.MemberID = m.MemberID
        WHERE we.EventCategory = 'payment'
          AND we.Status IN ('pending', 'matched')
    """
    params = []

    if status_filter in ('pending', 'matched'):
        sql += " AND we.Status = %s"
        params.append(status_filter)

    sql, params = add_search(sql, params, search, [
        'we.MemberID', 'we.Email', 'we.PayerName', 'we.EventID',
        'm.FirstName', 'm.LastName',
    ])
    sql += " ORDER BY we.Timestamp DESC LIMIT 200"

    rows = query(sql, params)
    return json_response({'ok': True, 'data': rows})


# ---------------------------------------------------------------------------
# Unmatched gmail transactions
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/unmatched-gmail')
@login_required
@require_role('admin')
@handle_api_errors
def api_unmatched_gmail():
    """
    List all unprocessed gmail_transactions (potential payment sources).
    Supports ?search= filter on sender, memo, amount.
    """
    search = request.args.get('q', '').strip()

    sql    = "SELECT * FROM gmail_transactions WHERE ProcessedTime IS NULL AND IsArchived = FALSE"
    params = []

    sql, params = add_search(sql, params, search, [
        'Sender', 'Memo', 'TransactionNumber', 'Subject', 'CAST(Amount AS CHAR)',
    ])
    sql += " ORDER BY TransactionDate DESC LIMIT 200"

    rows = query(sql, params)
    return json_response({'ok': True, 'data': rows})


# ---------------------------------------------------------------------------
# Manual match
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/manual-match', methods=['POST'])
@login_required
@require_role('admin')
def api_manual_match():
    """
    Manually link a pending event to a gmail transaction.
    Body: { eventId, messageId }
    """
    data = request.json or {}
    event_id = data.get('eventId', '').strip()
    message_id = data.get('messageId', '').strip()

    if not event_id or not message_id:
        return json_response({'ok': False, 'error': 'eventId and messageId required'}, 400)

    admin_email = session.get('user', {}).get('email', 'unknown')
    result = manual_match(event_id, message_id, admin_email)

    status = 200 if result.get('ok') else 400
    return json_response(result, status)


# ---------------------------------------------------------------------------
# Auto-match
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/auto-match', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_auto_match():
    """
    Run the auto-match heuristic on all pending events.
    Returns stats: { matched, skipped, errors, details }.
    """
    stats = run_auto_match()
    return json_response({'ok': True, 'data': stats})


# ---------------------------------------------------------------------------
# Approve / Reject
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/approve/<event_id>', methods=['POST'])
@login_required
@require_role('admin')
def api_approve(event_id):
    """
    Approve a pending/matched event → create payment record → fulfill actions.
    Body (optional): { notes }
    """
    data = request.json or {}
    notes = data.get('notes', '')
    admin_email = session.get('user', {}).get('email', 'unknown')

    result = approve_event(event_id, admin_email, notes)
    status = 200 if result.get('ok') else 400
    return json_response(result, status)


@payments_bp.route('/api/payments/reject/<event_id>', methods=['POST'])
@login_required
@require_role('admin')
def api_reject(event_id):
    """
    Reject a pending/matched event.
    Body: { notes } (required — reason for rejection)
    """
    data = request.json or {}
    notes = data.get('notes', '').strip()
    if not notes:
        return json_response({'ok': False, 'error': 'Rejection reason (notes) required'}, 400)

    admin_email = session.get('user', {}).get('email', 'unknown')
    result = reject_event(event_id, admin_email, notes)
    status = 200 if result.get('ok') else 400
    return json_response(result, status)


# ---------------------------------------------------------------------------
# Admin-create payment (for unmatched gmail with no webapp event)
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/admin-create', methods=['POST'])
@login_required
@require_role('admin')
def api_admin_create():
    """
    Admin creates a payment directly from an unmatched gmail transaction.
    Body: { memberId, messageId, paymentIntent, notes? }
    """
    data = request.json or {}
    member_id = data.get('memberId', '').strip()
    message_id = data.get('messageId', '').strip()
    payment_intent = data.get('paymentIntent', '').strip()
    notes = data.get('notes', '')

    if not member_id or not message_id or not payment_intent:
        return json_response({
            'ok': False,
            'error': 'memberId, messageId, and paymentIntent required',
        }, 400)

    admin_email = session.get('user', {}).get('email', 'unknown')
    result = admin_create_payment(member_id, message_id, payment_intent, admin_email, notes)
    status = 200 if result.get('ok') else 400
    return json_response(result, status)


# ---------------------------------------------------------------------------
# Payment history
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/history')
@login_required
@require_role('admin')
@handle_api_errors
def api_payment_history():
    """
    Recent payment history with optional filters.
    Supports ?days=30, ?memberId=, ?search=
    """
    days      = request.args.get('days', 90, type=int)
    member_id = request.args.get('memberId', '').strip()
    search    = request.args.get('q', '').strip()

    sql = """
        SELECT p.*,
               m.FirstName, m.LastName, m.Email as MemberEmail,
               m.Type as CurrentType, m.Expiration as CurrentExpiration
        FROM payments p
        LEFT JOIN members m ON p.MemberID = m.MemberID
        WHERE p.PaymentDate >= DATE_SUB(NOW(), INTERVAL %s DAY)
    """
    params = [days]

    if member_id:
        sql += " AND p.MemberID = %s"
        params.append(member_id)

    sql, params = add_search(sql, params, search, [
        'p.MemberID', 'p.PayerName', 'p.PaymentIntent', 'p.PaymentID',
        'm.FirstName', 'm.LastName',
    ])
    sql += " ORDER BY p.PaymentDate DESC LIMIT 200"

    rows = query(sql, params)
    return json_response({'ok': True, 'data': rows})


# ---------------------------------------------------------------------------
# Member summary (for admin review before approval)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Gmail candidates for a given event (matched + fuzzy candidates, incl. processed)
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/gmail-candidates/<event_id>')
@login_required
@require_role('admin')
@handle_api_errors
def api_gmail_candidates(event_id):
    """
    Return the already-matched gmail row (if any) plus all fuzzy-match candidates
    for a given webapp_event, including already-processed rows.
    Used by the side-by-side reconcile view when an event row is focused.

    MatchContext field on each row:
      'matched'   — this is the row linked via MatchedMessageId
      'candidate' — amount+date+identifier match, not yet linked
    """
    events = query("SELECT * FROM webapp_events WHERE EventID = %s", [event_id])
    if not events:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)
    event = events[0]

    amount        = float(event.get('Amount') or 0)
    ts            = event.get('Timestamp')
    member_id     = (event.get('MemberID') or '').strip().upper()
    payer         = (event.get('PayerName') or '').strip()
    last4         = (event.get('Last4Digits') or '').strip()
    matched_msg_id = (event.get('MatchedMessageId') or '').strip()

    # Fetch all gmail rows within ±7 days and amount match (including processed)
    rows = query("""
        SELECT *,
          CASE WHEN MessageId = %s THEN 'matched' ELSE 'candidate' END AS MatchContext
        FROM gmail_transactions
        WHERE
          MessageId = %s
          OR (
            ABS(COALESCE(Amount, -9999) - %s) < 0.01
            AND (TransactionDate IS NULL
                 OR ABS(DATEDIFF(TransactionDate, DATE(%s))) <= 7)
          )
        ORDER BY
          CASE WHEN MessageId = %s THEN 0 ELSE 1 END,
          ProcessedTime IS NOT NULL,
          TransactionDate DESC
        LIMIT 100
    """, [matched_msg_id, matched_msg_id, amount, ts, matched_msg_id])

    # Post-filter candidates: require at least one identifier signal
    result = []
    for row in rows:
        if row.get('MatchContext') == 'matched':
            result.append(row)
            continue
        gmail_tx_num = (row.get('TransactionNumber') or '').strip()
        memo         = (row.get('Memo') or '') + ' ' + (row.get('OriginalMemo') or '')
        sender       = (row.get('Sender') or '').strip()

        id_match = (
            (last4 and gmail_tx_num.endswith(last4))
            or (member_id and _extract_member_id(memo) == member_id)
            or (payer and _name_match(payer, sender))
        )
        if id_match:
            result.append(row)

    return json_response({'ok': True, 'data': result})


# ---------------------------------------------------------------------------
# Lightweight member lookup for hover tooltip
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/member-quick/<member_id>')
@login_required
@require_role('admin')
@handle_api_errors
def api_member_quick(member_id):
    """
    Lightweight member data for the hover tooltip.
    Returns name, expiration, type, gender, district only.
    """
    rows = query(
        "SELECT MemberID, FirstName, LastName, Expiration, Type, Gender, District "
        "FROM members WHERE MemberID = %s",
        [member_id]
    )
    if not rows:
        return json_response({'ok': False, 'error': 'Not found'}, 404)
    return json_response({'ok': True, 'data': rows[0]})


# ---------------------------------------------------------------------------
# Member summary (for admin review before approval)
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/member/<member_id>')
@login_required
@require_role('admin')
@handle_api_errors
def api_member_summary(member_id):
    """
    Get member details + family members + recent payment history.
    Used by admin before approving a payment.
    """
    member = get_member(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    # Family members
    family_members = []
    if member.get('FamilyID'):
        family_ids = get_family_member_ids(member['FamilyID'])
        if family_ids:
            placeholders = ','.join(['%s'] * len(family_ids))
            family_members = query(
                f"SELECT MemberID, FirstName, LastName, Email, Type, Expiration, Status "
                f"FROM members WHERE MemberID IN ({placeholders})",
                family_ids,
            )

    # Recent payments for this member
    recent_payments = query("""
        SELECT PaymentID, PaymentDate, Amount, PaymentIntent, Source, ProcessedBy
        FROM payments WHERE MemberID = %s
        ORDER BY PaymentDate DESC LIMIT 10
    """, [member_id])

    # Pending events for this member
    pending_events = query("""
        SELECT EventID, EventType, Status, Timestamp, Amount, PaymentIntent, PaymentMethod
        FROM webapp_events WHERE MemberID = %s AND Status IN ('pending', 'matched')
        ORDER BY Timestamp DESC
    """, [member_id])

    return json_response({'ok': True, 'data': {
        'member': member,
        'family_members': family_members,
        'recent_payments': recent_payments,
        'pending_events': pending_events,
    }})


# ---------------------------------------------------------------------------
# Manual event-to-transaction matching (admin approval workflow)
# ---------------------------------------------------------------------------

@payments_bp.route('/api/payments/pending-events-with-matches', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_pending_events_with_matches():
    """
    Get pending events (MatchedMessageId IS NULL) with suggested gmail_transaction matches.

    Match suggestions grouped by likelihood:
      1. Most likely: amount match + memberID in memo
      2. More likely: name match (no memberID in memo)
      3. Recently matched: payment date ±2 days, already matched, amount match
    """
    # Fetch all pending events that need matching
    pending = query("""
        SELECT EventID, MemberID, PayerName, Email, Amount, MemoField,
               Timestamp, PaymentIntent, Status
        FROM webapp_events
        WHERE MatchedMessageId IS NULL
          AND Status IN ('pending', 'matched')
          AND EventCategory = 'payment'
        ORDER BY Timestamp DESC
    """)

    result = []
    for event in pending:
        event_id = event['EventID']
        member_id = event['MemberID']
        amount = event['Amount']
        payer_name = event['PayerName'] or ''
        timestamp = event['Timestamp']

        # Find matching gmail transactions
        most_likely = []
        more_likely = []
        recently_matched = []

        # Most likely: amount match + memberID in memo
        if member_id and amount:
            most_likely = query("""
                SELECT MessageId, TransactionNumber, TimeStamp, Sender, Amount,
                       Memo, TransactionDate, Subject
                FROM gmail_transactions
                WHERE Amount = %s
                  AND (Memo LIKE %s OR OriginalMemo LIKE %s)
                  AND IsArchived = 0
                ORDER BY TimeStamp DESC
                LIMIT 5
            """, [amount, f'%{member_id}%', f'%{member_id}%'])

        # More likely: name match (no memberID requirement)
        if amount and payer_name:
            more_likely = query("""
                SELECT MessageId, TransactionNumber, TimeStamp, Sender, Amount,
                       Memo, TransactionDate, Subject
                FROM gmail_transactions
                WHERE Amount = %s
                  AND (Sender LIKE %s OR Memo LIKE %s)
                  AND MessageId NOT IN (SELECT MessageId FROM gmail_transactions
                                        WHERE Memo LIKE %s OR OriginalMemo LIKE %s)
                  AND IsArchived = 0
                ORDER BY TimeStamp DESC
                LIMIT 5
            """, [amount, f'%{payer_name}%', f'%{payer_name}%',
                   f'%{member_id}%', f'%{member_id}%'])

        # Recently matched: payment date ±2 days, already matched, amount match
        if timestamp and amount:
            date_min = timestamp - timedelta(days=2)
            date_max = timestamp + timedelta(days=2)
            recently_matched = query("""
                SELECT MessageId, TransactionNumber, TimeStamp, Sender, Amount,
                       Memo, TransactionDate, Subject
                FROM gmail_transactions
                WHERE Amount = %s
                  AND TimeStamp BETWEEN %s AND %s
                  AND ProcessedTime IS NOT NULL
                  AND IsArchived = 0
                ORDER BY TimeStamp DESC
                LIMIT 5
            """, [amount, date_min, date_max])

        result.append({
            'event': event,
            'most_likely': most_likely,
            'more_likely': more_likely,
            'recently_matched': recently_matched,
        })

    return json_response({'ok': True, 'data': result})


@payments_bp.route('/api/payments/approve-event-match', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_approve_event_match():
    """
    Admin selects a gmail_transaction to match with an event.
    Updates webapp_events with: MatchedMessageId, MatchedTransactionNumber, AdminApprover,
    ApprovalDate, PaymentDate, and sets Status='approved'.
    """
    body = request.get_json() or {}
    event_id = body.get('eventId')
    message_id = body.get('messageId')
    transaction_number = body.get('transactionNumber')
    notes = body.get('notes', '')

    if not event_id or not message_id:
        return json_response({'ok': False, 'error': 'Missing eventId or messageId'}, status=400)

    # Fetch event and gmail transaction details
    event = query("""
        SELECT * FROM webapp_events WHERE EventID = %s
    """, [event_id])
    if not event:
        return json_response({'ok': False, 'error': f'Event {event_id} not found'}, status=404)
    event = event[0]

    gmail = query("""
        SELECT * FROM gmail_transactions WHERE MessageId = %s
    """, [message_id])
    if not gmail:
        return json_response({'ok': False, 'error': f'Gmail transaction {message_id} not found'}, status=404)
    gmail = gmail[0]

    # Update webapp_events
    admin_email = session.get('user_email', 'unknown')
    approval_date = _engine_to_mysql_dt(datetime.utcnow())
    payment_date = gmail.get('TransactionDate')

    try:
        execute("""
            UPDATE webapp_events
            SET MatchedMessageId = %s,
                MatchedTransactionNumber = %s,
                AdminApprover = %s,
                ApprovalDate = %s,
                PaymentDate = %s,
                Notes = IF(%s = '', Notes, %s),
                Status = 'approved'
            WHERE EventID = %s
        """, [message_id, transaction_number, admin_email, approval_date,
              payment_date, notes, notes, event_id])

        # Sync updated event back to Sheets via GAS webhook
        try:
            _sync_member_events_to_sheets(event['MemberID'])
        except Exception as sync_err:
            logger.warning(f'Failed to sync event to Sheets: {sync_err}')
            # Don't fail the approval if sync fails; just log it

        return json_response({'ok': True, 'message': f'Event {event_id} approved and linked to {message_id}'})
    except Exception as e:
        logger.error(f'Error approving event match: {e}')
        return json_response({'ok': False, 'error': str(e)}, status=500)


# ---------------------------------------------------------------------------
# Helper: Sync member events to Sheets via GAS webhook
# ---------------------------------------------------------------------------

def _sync_member_events_to_sheets(member_id: str) -> None:
    """
    Fetch updated events for a member from MySQL and sync to Sheets via GAS webhook.
    Used after manual match approval to reflect changes in Sheets.

    Args:
        member_id: Member ID to sync

    Raises:
        Exception if sync fails
    """
    from sync_engine import filter_sync_columns
    from config_cache import get_config

    if not member_id:
        logger.debug('_sync_member_events_to_sheets: No member_id provided, skipping')
        return

    # Fetch member's updated events from MySQL
    events = query("""
        SELECT * FROM webapp_events
        WHERE MemberID = %s
          AND EventCategory = 'payment'
        ORDER BY Timestamp DESC
        LIMIT 20
    """, [member_id])

    if not events:
        logger.debug(f'_sync_member_events_to_sheets: No events found for member {member_id}')
        return

    # Filter to sync-eligible columns only (to match Sheets schema)
    # IMPORTANT: Ensure UpdatedAt is always present for conflict resolution
    from datetime_utils import to_datetime
    synced_events = []
    for event in events:
        synced_event = filter_sync_columns('webapp_events', event)

        # Ensure UpdatedAt is present and is a proper ISO datetime string
        if not synced_event.get('UpdatedAt'):
            # Fallback to Timestamp if UpdatedAt is missing
            synced_event['UpdatedAt'] = synced_event.get('Timestamp', '')
        elif isinstance(synced_event['UpdatedAt'], str):
            # Already a string, ensure it's ISO format
            dt = to_datetime(synced_event['UpdatedAt'])
            if dt:
                synced_event['UpdatedAt'] = dt.isoformat()

        synced_events.append(synced_event)

    logger.info(f'_sync_member_events_to_sheets: {member_id} has {len(synced_events)} events to sync')

    # Call GAS webhook to update Sheets
    try:
        webhook_url = get_config('SheetsWebhookUrl', '').strip()
        if not webhook_url:
            logger.warning(f'SheetsWebhookUrl not configured, skipping Sheets sync for member {member_id}')
            return

        import requests
        payload = {
            'action': 'update_events',
            'rows': synced_events,
        }
        logger.info(f'_sync_member_events_to_sheets: Sending webhook for {member_id} with {len(synced_events)} events')
        resp = requests.post(webhook_url, json=payload, timeout=30)

        if resp.status_code != 200:
            logger.error(f'GAS webhook returned {resp.status_code}: {resp.text[:200]}')
            raise Exception(f'GAS webhook error {resp.status_code}')

        body = resp.json()
        if not body.get('ok'):
            raise Exception(f"GAS returned error: {body.get('error', 'unknown')}")

        logger.info(f'✅ Synced {len(synced_events)} events for member {member_id} to Sheets')
    except Exception as e:
        logger.error(f'Failed to sync events to Sheets for member {member_id}: {e}')
        raise


@payments_bp.route('/api/payments/sync-member-to-sheets/<member_id>', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_sync_member_to_sheets(member_id: str):
    """
    Manually trigger a sync of a member's events/payments to Sheets.
    Called after manual edits to ensure Sheets stays in sync with MySQL.
    """
    try:
        _sync_member_events_to_sheets(member_id)
        return json_response({'ok': True, 'message': f'Synced member {member_id} to Sheets'})
    except Exception as e:
        logger.error(f'Error syncing member {member_id} to Sheets: {e}')
        return json_response({'ok': False, 'error': str(e)}, status=500)
