"""
Payment Reconciliation API — MySQL-backed, no Sheets sync.

Blueprint: payments_bp
Prefix: /api/payments

Dashboard, listing, autoguess, manual approval, and admin operations.

Flow:
  1. Dashboard: Counts (pending submissions, unmatched gmail_transactions, approved/rejected/errors)
  2. List endpoints:
     - /pending-submissions: pending submissions needing payment match
     - /unmatched-gmail: gmail_transactions with Notes=NULL or UpdatedAt=NULL
  3. Autoguess: Scan unmatched gmail → check membership renew logic → attempt match
  4. Manual approval: Admin selects memberID + gmail_transaction → create payment
  5. DB triggers handle: member status updates, submission approvals, gmail Notes sync
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from payment_helpers import get_member_by_id, get_renewal_period, parse_member_id_from_memo
from payment_matching import (
    fuzzy_select_transaction_to_submission,
    fuzzy_match_transaction_to_member,
    build_member_text,
    build_transaction_text,
    autoguess_single_transaction,
)

logger = logging.getLogger(__name__)

payments_bp = Blueprint('payments', __name__)


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
    skip = int(request.args.get('skip', 0))
    limit = int(request.args.get('limit', 50))
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
    skip = int(request.args.get('skip', 0))
    limit = int(request.args.get('limit', 50))
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
# AUTOGUESS LOGIC
# ============================================================================

@payments_bp.route('/api/payments/autoguess-all', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_autoguess_all():
    """
    Scan all unmatched Gmail transactions and attempt autoguess.

    Strict criteria (ALL must pass):
      1. MemberID explicit in memo (regex: \bA\d{4}\b)
      2. Amount matches membership type ($30 individual, $50 family)
      3. Transaction date within renewal period (from config)
      4. [Optional] Link to pending membership submission if exists, otherwise create payment alone
    """
    # Capture admin email BEFORE entering loop (fixes blank history issue)
    admin_email = session.get('user', {}).get('email', 'admin')

    # Get unmatched transactions
    unmatched = query("""
        SELECT TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate
        FROM gmail_transactions
        WHERE Notes IS NULL OR UpdatedAt IS NULL
        ORDER BY TransactionDate DESC
    """)

    created_count = 0
    skipped_count = 0
    errors = []
    max_errors = 5  # Circuit breaker: stop after 5 errors

    logger.info(f'[AUTOGUESS] Starting autoguess for {len(unmatched)} unmatched transactions')

    # Pre-load everything once — avoids N×2 config queries + N member lookups
    start_str, end_str = get_renewal_period()
    if not start_str or not end_str:
        logger.error(f'[AUTOGUESS] ⚠️ Renewal period NOT configured!')
        return json_response({'error': 'Renewal period not configured'}, status=400)

    try:
        renewal_start = datetime.strptime(start_str, '%Y-%m-%d').date()
        renewal_end   = datetime.strptime(end_str,   '%Y-%m-%d').date()
    except ValueError:
        return json_response({'error': 'Invalid renewal period dates in config'}, status=400)

    # All members keyed by MemberID
    all_members = {m['MemberID']: m for m in query("SELECT * FROM members")}

    # All pending membership submissions keyed by MemberID (take first/latest per member)
    pending_rows = query("""
        SELECT SubmissionID, MemberID FROM submissions
        WHERE Status = 'pending' AND SubmissionType LIKE '%Membership%'
        ORDER BY CreatedAt DESC
    """)
    pending_subs_map = {}
    for row in pending_rows:
        pending_subs_map.setdefault(row['MemberID'], row['SubmissionID'])

    logger.info(f'[AUTOGUESS] Pre-loaded {len(all_members)} members, {len(pending_subs_map)} pending subs')

    for idx, tx in enumerate(unmatched, 1):
        # Circuit breaker: stop on too many errors
        if len(errors) >= max_errors:
            logger.error(f'[AUTOGUESS] Stopping: {len(errors)} errors reached. Processed {idx-1}/{len(unmatched)}')
            break

        try:
            result = autoguess_single_transaction(
                tx, admin_email,
                all_members=all_members,
                pending_subs_map=pending_subs_map,
                renewal_start=renewal_start,
                renewal_end=renewal_end,
            )
            if result['created']:
                created_count += 1
            else:
                skipped_count += 1
        except Exception as e:
            logger.error(f'[AUTOGUESS] ERROR on tx {tx["TransactionNumber"]}: {str(e)[:100]}')
            errors.append({'transactionNumber': tx['TransactionNumber'], 'error': str(e)[:200]})

    message = f'Autoguess: {created_count} created, {skipped_count} skipped'
    if errors:
        message += f', {len(errors)} errors'
    if len(errors) >= max_errors:
        message += ' (stopped due to errors)'

    logger.info(f'[AUTOGUESS] {message}')

    # Log to activity_log for audit trail (use captured admin_email)
    try:
        log_id = str(uuid.uuid4())
        error_summary = '\n'.join([f"{e['transactionNumber']}: {e['error']}" for e in errors]) if errors else None

        execute("""
            INSERT INTO activity_log (
                LogID, Timestamp, Email, Action, State, ErrorMessage, ErrorSeverity
            ) VALUES (%s, NOW(), %s, %s, %s, %s, %s)
        """, (
            log_id,
            admin_email,
            'AUTOGUESS_RUN',
            f'created={created_count},skipped={skipped_count},errors={len(errors)}',
            error_summary,
            'ERROR' if errors else 'INFO'
        ))
    except Exception as log_err:
        logger.warning(f'[AUTOGUESS] Failed to log to activity_log: {log_err}')

    return json_response({
        'ok': True,
        'message': message,
        'details': {
            'created': created_count,
            'skipped': skipped_count,
            'errors': errors,
        }
    })


# ============================================================================
# MANUAL APPROVAL
# ============================================================================

@payments_bp.route('/api/payments/manual-approve', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_manual_approve():
    """
    Admin approves a Gmail transaction by selecting memberID.

    Request body:
    {
      "transactionNumber": "tx_abc123",
      "memberID": "A0001"
    }

    Logic:
      1. Verify member exists
      2. Check if there are any pending submissions for this member
      3. If yes, link to first pending membership submission
      4. If no, create payment with blank submissionID
      5. Call sp_link_transaction to create payment + update gmail_transactions
    """
    data = request.json or {}
    tx_num = data.get('transactionNumber', '').strip()
    member_id = data.get('memberID', '').strip()
    submission_id_hint = (data.get('submissionId') or '').strip() or None

    if not tx_num or not member_id:
        return json_response({'error': 'Missing transactionNumber or memberID'}, status=400)

    logger.info(f'[MANUAL-APPROVE] Approving tx={tx_num}, member={member_id}, hint={submission_id_hint}')

    # Fetch Gmail transaction
    tx_rows = query(
        "SELECT * FROM gmail_transactions WHERE TransactionNumber = %s",
        (tx_num,)
    )
    if not tx_rows:
        logger.warning(f'[MANUAL-APPROVE] Transaction not found: {tx_num}')
        return json_response({'error': 'Gmail transaction not found'}, status=404)

    tx = tx_rows[0]

    # Verify member exists
    member = get_member_by_id(member_id)
    if not member:
        logger.warning(f'[MANUAL-APPROVE] Member not found: {member_id}')
        return json_response({'error': 'Member not found'}, status=404)

    # Use client-supplied submissionId if provided, otherwise find the latest pending one
    if submission_id_hint:
        submission_id = submission_id_hint
    else:
        pending_subs = query("""
            SELECT SubmissionID FROM submissions
            WHERE MemberID = %s AND Status = 'pending'
            ORDER BY CreatedAt DESC
            LIMIT 1
        """, (member_id,))
        submission_id = pending_subs[0]['SubmissionID'] if pending_subs else None
    admin_email = session.get('user', {}).get('email', 'admin')

    logger.info(f'[MANUAL-APPROVE] Linking transaction: amount={tx["Amount"]}, submissionID={submission_id}, admin={admin_email}')

    payment_type = 'Family Membership' if member['Type'] == 'Family' else 'Individual Membership'

    try:
        # Check for an orphaned payment (AutoGuess created it but left SubmissionID blank)
        existing = query("""
            SELECT PaymentID FROM payments
            WHERE TransactionNumber = %s
              AND (SubmissionID IS NULL OR SubmissionID = '')
            LIMIT 1
        """, (tx_num,))

        if existing:
            # Patch the orphaned payment and approve the submission directly
            payment_id = existing[0]['PaymentID']
            logger.info(f'[MANUAL-APPROVE] Orphaned payment found {payment_id} — patching SubmissionID')
            execute(
                "UPDATE payments SET SubmissionID = %s, ProcessedBy = %s WHERE PaymentID = %s",
                (submission_id, admin_email, payment_id)
            )
            if submission_id:
                execute("""
                    UPDATE submissions
                    SET Status = 'approved', PaymentID = %s, UpdatedByID = %s
                    WHERE SubmissionID = %s
                """, (payment_id, admin_email, submission_id))
            action = 'linked'
        else:
            # sp_link_transaction takes exactly 5 params: tx, memberID, type, amount, submissionID
            # admin_email is logged separately via log_activity — do NOT pass to stored proc
            execute(
                "CALL sp_link_transaction(%s, %s, %s, %s, %s)",
                (tx_num, member_id, payment_type, tx['Amount'], submission_id)
            )
            action = 'created'

        logger.info(f'[MANUAL-APPROVE] Success ({action}): tx={tx_num}, member={member_id}, submission={submission_id}')
        return json_response({
            'ok': True,
            'message': f'Payment {action} for {member["FirstName"]} {member["LastName"]}',
            'transactionNumber': tx_num,
            'memberID': member_id,
            'submissionID': submission_id,
            'action': action,
        })
    except Exception as e:
        logger.exception(f'[MANUAL-APPROVE] Error: {e}')
        return json_response({'error': str(e)}, status=500)


# ============================================================================
# SUBMISSION SEARCH & FILTERING
# ============================================================================

@payments_bp.route('/api/payments/submissions-for-member/<member_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_submissions_for_member(member_id: str):
    """Get all pending submissions for a specific member."""
    subs = query("""
        SELECT SubmissionID, SubmissionType, Amount, Status, CreatedAt, ExpiresAt
        FROM submissions
        WHERE MemberID = %s AND Status = 'pending'
        ORDER BY CreatedAt DESC
    """, (member_id,))
    return json_response({'submissions': subs})


@payments_bp.route('/api/payments/gmail-matching-candidates/<member_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_gmail_matching_candidates(member_id: str):
    """
    Get unmatched Gmail transactions that could match this member.
    Filters by partial name/email match and amount.
    """
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'error': 'Member not found'}, status=404)

    first_name = member['FirstName']
    last_name = member['LastName']
    email = member['Email']

    candidates = query("""
        SELECT TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate,
               PaymentMethod, Notes, UpdatedAt
        FROM gmail_transactions
        WHERE (Notes IS NULL OR UpdatedAt IS NULL)
          AND (Sender LIKE %s OR Sender LIKE %s OR Memo LIKE %s OR Memo LIKE %s)
        ORDER BY TransactionDate DESC
        LIMIT 20
    """, (f"%{first_name}%", f"%{last_name}%", f"%{first_name}%", f"%{last_name}%"))

    return json_response({'transactions': candidates})


# ============================================================================
# MISSING ENDPOINTS FOR FRONTEND
# ============================================================================

@payments_bp.route('/api/payments/member-quick/all', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_member_quick_all():
    """
    Fetch all members for fuzzy search in quick-approve popover.
    Must be registered BEFORE /<member_id> to avoid Flask routing /all as a member_id.
    Returns: {ok: true, data: [{MemberID, FirstName, LastName, Email, Expiration, Type, District}]}
    """
    members = query("""
        SELECT MemberID, FirstName, LastName, Email, Expiration, Type, District
        FROM members
        ORDER BY FirstName, LastName
    """)
    logger.info(f'[MEMBER-QUICK/ALL] query returned {len(members)} rows')
    if members:
        logger.info(f'[MEMBER-QUICK/ALL] sample: {members[0]}')
    else:
        # Diagnose: check if table is accessible and has rows at all
        cnt = query("SELECT COUNT(*) as cnt FROM members")
        logger.warning(f'[MEMBER-QUICK/ALL] members table COUNT(*) = {cnt[0]["cnt"] if cnt else "ERROR"}')
    return json_response({'ok': True, 'data': members})


@payments_bp.route('/api/payments/member-quick/<member_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_member_quick(member_id: str):
    """
    Quick member lookup for tooltips and quick-approve popover.
    Returns: {ok: true, data: {FirstName, LastName, MemberID, Email, Expiration, Type, Gender, District, WeChatID}}
    """
    member = get_member_by_id(member_id.upper())
    if not member:
        return json_response({'ok': False, 'error': 'Member not found'}, status=404)

    return json_response({
        'ok': True,
        'data': {
            'MemberID': member.get('MemberID'),
            'FirstName': member.get('FirstName'),
            'LastName': member.get('LastName'),
            'Email': member.get('Email'),
            'Expiration': member.get('Expiration'),
            'Type': member.get('Type'),
            'Gender': member.get('Gender'),
            'District': member.get('District'),
            'WeChatID': member.get('WeChatID'),
        }
    })


@payments_bp.route('/api/payments/debug-candidates/<submission_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_debug_candidates(submission_id: str):
    """
    Step-by-step trace of gmail candidate matching for a submission.
    GET /api/payments/debug-candidates/<submission_id>

    Returns member_text, and for each candidate: tx_text + result of each rule.
    """
    sub = query("SELECT * FROM submissions WHERE SubmissionID = %s", (submission_id,))
    if not sub:
        return json_response({'error': 'Submission not found'}, status=404)
    sub = sub[0]

    member = get_member_by_id(sub['MemberID'])
    if not member:
        return json_response({'error': f'Member {sub["MemberID"]} not found'}, status=404)

    member_text = build_member_text(member)
    member_id   = member['MemberID'].upper()

    candidates = query("""
        SELECT MessageId, TransactionNumber, Sender, Amount, Memo, TransactionDate, Notes, UpdatedAt
        FROM gmail_transactions
        WHERE (Notes IS NULL OR UpdatedAt IS NULL) AND Amount = %s
        ORDER BY TransactionDate DESC LIMIT 100
    """, (sub['Amount'],))

    traced = []
    for g in candidates:
        tx_text = build_transaction_text(g)
        tx_number = g.get('TransactionNumber', '') or ''
        sender = (g.get('Sender') or '').lower()
        member_digits = member_id[1:] if len(member_id) >= 2 and member_id[1:].isdigit() else None
        tx_last4 = tx_number[-4:] if len(tx_number) >= 4 else tx_number

        rules = {
            'r1_memberid_in_tx': member_id.lower() in tx_text,
            'r2_tx_last4_eq_member_digits': bool(member_digits and tx_last4 == member_digits),
            'r3_all_sender_words_in_member': bool(sender and all(w in member_text for w in sender.split())),
            'r4_any_member_word_in_tx': bool(member_text and any(w in tx_text for w in member_text.split())),
        }
        matched_rule = next((k for k, v in rules.items() if v), None)
        traced.append({
            'TransactionNumber': tx_number,
            'Sender': g.get('Sender'),
            'Memo': g.get('Memo'),
            'TransactionDate': str(g.get('TransactionDate') or ''),
            'tx_text': tx_text,
            'rules': rules,
            'matched_rule': matched_rule,
            'priority': int(matched_rule[1]) if matched_rule else 0,
        })

    traced.sort(key=lambda x: x['priority'] if x['priority'] > 0 else 999)

    return json_response({
        'submission': {'SubmissionID': submission_id, 'MemberID': sub['MemberID'], 'Amount': float(sub['Amount'])},
        'member': {'MemberID': member_id, 'Name': f"{member['FirstName']} {member['LastName']}", 'member_text': member_text},
        'total_unmatched_at_amount': len(candidates),
        'candidates': traced,
    })


@payments_bp.route('/api/payments/gmail-candidates/<submission_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_gmail_candidates(submission_id: str):
    """
    Get ranked Gmail transaction candidates for a submission using fuzzy matching.

    Returns unmatched Gmail transactions matching the submission amount, scored by fuzzy rules.
    Sorted by priority (highest first) for admin to choose from in quick-approve UI.

    Response:
    {
      'submission': {SubmissionID, MemberID, Amount},
      'member': {MemberID, FirstName, LastName, Email, WeChatID, Type, Expiration},
      'candidates': [
        {TransactionNumber, Sender, Amount, Memo, TransactionDate, priority, matched},
        ...
      ],
      'count': int,
      'total_candidates': int
    }
    """
    result = fuzzy_select_transaction_to_submission(submission_id, max_candidates=20)

    if 'error' in result:
        return json_response(result, status=404)

    return json_response(result)


@payments_bp.route('/api/payments/debug/match/<submission_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_debug_match(submission_id: str):
    """
    Debug endpoint: show intermediate state for gmail-candidates matching.
    Returns submission, member record, member_text, raw candidate count,
    and full scored candidate list (up to 50) before truncation.
    """
    from db import query as db_query

    # Step 1: submission
    sub = db_query("SELECT * FROM submissions WHERE SubmissionID = %s", (submission_id,))
    if not sub:
        return json_response({'error': 'Submission not found', 'submission_id': submission_id}, 404)
    sub = sub[0]

    # Step 2: member
    member = get_member_by_id(sub['MemberID'])
    if not member:
        return json_response({'error': f"Member {sub['MemberID']} not found"}, 404)

    member_text = build_member_text(member)

    # Step 3: raw gmail candidates (before scoring)
    amount = sub['Amount']
    sub_amount = float(amount)
    member_id = sub['MemberID']
    mid_pattern = f'%{member_id}%'
    raw = db_query("""
        SELECT MessageId, TransactionNumber, Sender, Amount, Memo, Notes, TransactionDate, UpdatedAt
        FROM gmail_transactions
        WHERE (
            Amount = %s
            OR Memo  LIKE %s
            OR Notes LIKE %s
        )
        AND NOT EXISTS (
            SELECT 1 FROM payments
            WHERE payments.TransactionNumber = gmail_transactions.TransactionNumber
              AND payments.SubmissionID IS NOT NULL
              AND payments.SubmissionID != ''
        )
    """, (amount, mid_pattern, mid_pattern))

    # Step 4: score each
    scored = []
    for gmail in raw:
        matched, priority = fuzzy_match_transaction_to_member(gmail, member)
        amount_match = abs(float(gmail['Amount']) - sub_amount) < 0.01
        scored.append({
            'MessageId': gmail['MessageId'],
            'TransactionNumber': gmail['TransactionNumber'],
            'Sender': gmail['Sender'],
            'Memo': gmail['Memo'],
            'Notes': gmail['Notes'],
            'Amount': float(gmail['Amount']),
            'amount_match': amount_match,
            'TransactionDate': gmail['TransactionDate'].isoformat() if gmail['TransactionDate'] and hasattr(gmail['TransactionDate'], 'isoformat') else str(gmail['TransactionDate']),
            'tx_text': build_transaction_text(gmail),
            'priority': priority,
            'matched': matched,
        })

    scored.sort(key=lambda x: (
        x['amount_match'],
        6 if (x['matched'] and x['priority'] == 0) else ((5 - x['priority']) if x['priority'] > 0 else -1),
        x['TransactionDate'] or ''
    ), reverse=True)

    return json_response({
        'submission': {k: str(v) if v is not None else None for k, v in sub.items()},
        'member': {
            'MemberID': member.get('MemberID'),
            'FirstName': member.get('FirstName'),
            'LastName': member.get('LastName'),
            'Email': member.get('Email'),
            'WeChatID': member.get('WeChatID'),
            'member_text': member_text,
        },
        'raw_candidate_count': len(raw),
        'candidates': scored[:50],
    })


@payments_bp.route('/api/payments/admin-create', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_admin_create():
    """
    Admin creates a payment directly from Gmail transaction.
    Body: {memberId, messageId, paymentIntent, notes}
    """
    data = request.get_json()
    member_id = data.get('memberId', '').upper()
    message_id = data.get('messageId')
    payment_intent = data.get('paymentIntent', 'Individual Membership')
    notes = data.get('notes', '')

    if not member_id or not message_id:
        return json_response({'error': 'memberId and messageId required'}, status=400)

    # Get member & gmail transaction
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'error': f'Member {member_id} not found'}, status=404)

    gmail = query(
        "SELECT * FROM gmail_transactions WHERE MessageId = %s",
        (message_id,)
    )
    if not gmail or len(gmail) == 0:
        return json_response({'error': 'Gmail transaction not found'}, status=404)

    gmail = gmail[0]
    tx_num = gmail.get('TransactionNumber')
    if not tx_num:
        return json_response({'error': 'Gmail transaction has no TransactionNumber — cannot link'}, status=400)

    amount = gmail.get('Amount')
    admin_email = session.get('user', {}).get('email', 'admin')

    # Find pending membership submission to auto-close
    pending_subs = query("""
        SELECT SubmissionID FROM submissions
        WHERE MemberID = %s AND Status = 'pending' AND SubmissionType LIKE '%Membership%'
        ORDER BY CreatedAt DESC LIMIT 1
    """, (member_id,))
    submission_id = pending_subs[0]['SubmissionID'] if pending_subs else None

    try:
        # sp_link_transaction fires all 4 triggers:
        #   trg_payments_auto_fill         → pulls PaymentDate/Sender/Memo from gmail_transactions
        #   trg_payments_sync_membership_only → updates member Status/Expiration/PaymentTransaction
        #   trg_payments_approve_submission → marks submission approved
        #   trg_payments_sync_to_gmail     → writes Notes back to gmail_transactions
        execute(
            "CALL sp_link_transaction(%s, %s, %s, %s, %s)",
            (tx_num, member_id, payment_intent, amount, submission_id)
        )

        return json_response({
            'ok': True,
            'message': f'Payment created for {member_id}',
            'updated_members': [member_id]
        })
    except Exception as e:
        logger.error(f'[admin-create] Error: {e}')
        return json_response({'error': str(e)}, status=500)


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
    Query params: ?skip=0&limit=50&days=30
    Returns: approved and rejected payments from the last N days.
    """
    skip = int(request.args.get('skip', 0))
    limit = int(request.args.get('limit', 50))
    days = int(request.args.get('days', 30))

    rows = query("""
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
        FROM payments p
        JOIN members m ON p.MemberID = m.MemberID
        LEFT JOIN submissions s ON p.SubmissionID = s.SubmissionID
        WHERE p.UpdatedAt >= DATE_SUB(NOW(), INTERVAL %s DAY)
        ORDER BY p.UpdatedAt DESC
        LIMIT %s OFFSET %s
    """, (days, limit, skip))

    return json_response({'payments': rows})


# ============================================================================
# AUTOGUESS AUDIT LOG
# ============================================================================

@payments_bp.route('/api/payments/autoguess-log', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_autoguess_log():
    """Fetch historical autoguess runs from activity_log."""
    limit = int(request.args.get('limit', 100))
    skip = int(request.args.get('skip', 0))

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


# ============================================================================
# AUTOGUESS DEBUG
# ============================================================================

@payments_bp.route('/api/payments/debug-autoguess/<transaction_number>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_debug_autoguess(transaction_number: str):
    """
    Trace autoguess decision for a single transaction — step by step.
    GET /api/payments/debug-autoguess/85071026
    """
    steps = []

    def step(name, passed, detail):
        steps.append({'step': name, 'passed': passed, 'detail': detail})

    # Fetch transaction
    rows = query("SELECT * FROM gmail_transactions WHERE TransactionNumber = %s", (transaction_number,))
    if not rows:
        return json_response({'ok': False, 'error': f'Transaction {transaction_number} not found'})
    tx = rows[0]

    step('found', True, {
        'TransactionNumber': tx.get('TransactionNumber'),
        'Sender': tx.get('Sender'),
        'Amount': str(tx.get('Amount')),
        'Memo': tx.get('Memo'),
        'TransactionDate': str(tx.get('TransactionDate')),
        'Notes': tx.get('Notes'),
        'UpdatedAt': str(tx.get('UpdatedAt')),
    })

    # Check if already matched
    already_matched = tx.get('Notes') is not None and tx.get('UpdatedAt') is not None
    step('unmatched_check', not already_matched,
         'Already matched (Notes + UpdatedAt both set)' if already_matched else 'Eligible — not yet matched')

    # Step 1: member ID in memo
    memo = tx.get('Memo') or ''
    member_id = parse_member_id_from_memo(memo)
    step('memo_member_id', bool(member_id),
         f'Extracted: {member_id}' if member_id else f'No A#### pattern found in memo: "{memo}"')
    if not member_id:
        return json_response({'ok': True, 'verdict': 'SKIP', 'steps': steps})

    # Step 2: member exists
    member = get_member_by_id(member_id)
    step('member_exists', bool(member),
         f'{member_id}: {member.get("FirstName")} {member.get("LastName")}, Type={member.get("Type")}, Status={member.get("Status")}' if member
         else f'Member {member_id} not found in DB')
    if not member:
        return json_response({'ok': True, 'verdict': 'SKIP', 'steps': steps})

    # Step 3: amount vs member type
    from decimal import Decimal
    amount = Decimal(str(tx['Amount'])) if tx.get('Amount') else None
    expected = Decimal('50.00') if member['Type'] == 'Family' else Decimal('30.00')
    step('amount_match', amount == expected,
         f'Got ${amount}, expected ${expected} for {member["Type"]} member')
    if amount != expected:
        return json_response({'ok': True, 'verdict': 'SKIP', 'steps': steps})

    # Step 4: renewal period
    start_str, end_str = get_renewal_period()
    tx_date = tx.get('TransactionDate')
    in_period = is_within_renewal_period(tx_date)
    step('renewal_period', in_period,
         f'TxDate={tx_date}, renewal={start_str} → {end_str}, in_period={in_period}')
    if not in_period:
        return json_response({'ok': True, 'verdict': 'SKIP', 'steps': steps})

    # Step 5: pending submission
    pending = query("""
        SELECT SubmissionID, Status, SubmissionType FROM submissions
        WHERE MemberID = %s AND Status = 'pending' AND SubmissionType LIKE '%Membership%'
        LIMIT 1
    """, (member_id,))
    step('pending_submission', True,
         f'Found: {pending[0]["SubmissionID"]}' if pending else 'None found (payment will be created without submission link)')

    # Step 6: duplicate payment check
    existing_payment = query("""
        SELECT PaymentID FROM payments WHERE TransactionNumber = %s LIMIT 1
    """, (transaction_number,))
    step('no_duplicate', not existing_payment,
         f'Duplicate found: {existing_payment[0]["PaymentID"]}' if existing_payment else 'No existing payment — safe to create')

    verdict = 'SKIP' if existing_payment else 'WOULD_CREATE'
    return json_response({'ok': True, 'verdict': verdict, 'steps': steps})


# ============================================================================
# FUZZY MATCHING DEBUG / TEST ENDPOINTS
# ============================================================================

@payments_bp.route('/api/payments/test-fuzzy-match/<submission_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_test_fuzzy_match(submission_id: str):
    """
    Test endpoint: Score all unmatched Gmail transactions against a submission.
    Used for debugging fuzzy matching logic.

    Returns: {submission, candidates: [{gmail, member, matched, priority, scores}]}
    """
    # Get submission
    sub = query(
        "SELECT * FROM submissions WHERE SubmissionID = %s",
        (submission_id,)
    )
    if not sub or len(sub) == 0:
        return json_response({'error': 'Submission not found'}, status=404)

    sub = sub[0]
    member_id = sub['MemberID']
    amount = sub['Amount']

    # Get member
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'error': f'Member {member_id} not found'}, status=404)

    # Get unmatched Gmail transactions with matching amount
    candidates = query("""
        SELECT TransactionNumber, MessageId, Sender, Amount, Memo, TransactionDate,
               Notes, UpdatedAt
        FROM gmail_transactions
        WHERE (Notes IS NULL OR UpdatedAt IS NULL)
          AND Amount = %s
        ORDER BY TransactionDate DESC
        LIMIT 30
    """, (amount,))

    # Score each candidate
    scored = []
    for gmail in candidates:
        matched, priority = fuzzy_match_transaction_to_member(gmail, member)
        scored.append({
            'gmail': gmail,
            'matched': matched,
            'priority': priority,
            'member_text': build_member_text(member),
            'tx_text': build_transaction_text(gmail),
        })

    return json_response({
        'submission': {
            'SubmissionID': sub['SubmissionID'],
            'MemberID': sub['MemberID'],
            'Amount': float(sub['Amount']),
        },
        'member': {
            'MemberID': member['MemberID'],
            'FirstName': member['FirstName'],
            'LastName': member['LastName'],
            'Email': member['Email'],
            'WeChatID': member.get('WeChatID'),
            'NYRRRunnerName': member.get('NYRRRunnerName'),
        },
        'candidates': scored,
        'count': len(scored),
    })
