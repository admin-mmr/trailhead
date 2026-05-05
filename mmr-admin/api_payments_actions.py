"""
Payments — write-mutation actions.

Endpoints:
  POST /api/payments/autoguess-all   — scan unmatched gmail and auto-link
  POST /api/payments/manual-approve  — admin approves single tx → memberID
  POST /api/payments/admin-create    — admin creates payment from gmail tx

Routes register on the shared `payments_bp` defined in `api_payments`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from flask import request, session

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from payment_helpers import get_member_by_id, get_renewal_period
from payment_matching import autoguess_single_transaction

from api_payments import payments_bp

logger = logging.getLogger(__name__)


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
    admin_email = session.get('user', {}).get('email') or None

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
    admin_email = session.get('user', {}).get('email') or None

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
# ADMIN-INITIATED PAYMENT CREATE
# ============================================================================

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
    admin_email = session.get('user', {}).get('email') or None

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
