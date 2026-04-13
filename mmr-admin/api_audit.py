"""
Membership renewal audit routes for mmr-admin.

Blueprint: audit_bp
Prefix: /api/audit

Routes:
  POST /api/audit/unmatch   — unlink a gmail transaction from a payment
  GET  /api/config/get      — read config table key/value pairs
  POST /api/audit/renewal   — run sp_renewal_audit (renewal trace report)

Member data-quality routes (reconcile, expiration-drift) live in api_audit_members.py.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, date
from flask import Blueprint, request

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from config_cache import get_config

logger = logging.getLogger(__name__)

audit_bp = Blueprint('audit', __name__)


# ─────────────────────────────────────────────────────────────────────────
# Helper: Convert date objects to ISO strings for JSON serialization
# ─────────────────────────────────────────────────────────────────────────

def _serialize_for_json(obj):
    """Convert date objects in dict/list to ISO format strings."""
    if isinstance(obj, dict):
        return {k: _serialize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_serialize_for_json(item) for item in obj]
    elif isinstance(obj, date) and not isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, datetime):
        return obj.isoformat()
    return obj


# ---------------------------------------------------------------------------
# Unmatch Transaction Endpoint
# ---------------------------------------------------------------------------

@audit_bp.route('/api/audit/unmatch', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_unmatch_transaction():
    """
    Reset a gmail_transaction to unprocessed state.

    Request body:
      {
        "message_id": "19cb3da76e6b20b4"
      }

    Updates:
      - ProcessedTime = NULL
      - PaymentID = NULL
    """
    data = request.get_json(silent=True)
    if isinstance(data, str):
        data = json.loads(data)

    if not isinstance(data, dict):
        return json_response({'error': 'Invalid JSON payload'}, 400)

    message_id = data.get('message_id', '').strip()
    if not message_id:
        return json_response({'error': 'Missing message_id'}, 400)

    try:
        sql = """
            UPDATE gmail_transactions
            SET PaymentID = NULL
            WHERE MessageId = %s
        """
        execute(sql, [message_id])
        logger.info(f"Unmatched transaction: {message_id}")

        return json_response({
            'success': True,
            'message': f'Transaction {message_id} unmatched',
            'message_id': message_id
        })
    except Exception as e:
        logger.error(f"Error unmatching transaction {message_id}: {e}")
        raise


# ---------------------------------------------------------------------------
# Config Endpoint
# ---------------------------------------------------------------------------

@audit_bp.route('/api/config/get')
@handle_api_errors
def api_get_config():
    """Get a config value by key."""
    key = request.args.get('key', '')
    if not key:
        return json_response({'error': 'Missing key parameter'}, 400)

    value = get_config(key, None)
    return json_response({
        'success': True,
        'key': key,
        'value': value
    })


# ---------------------------------------------------------------------------
# Renewal Audit Endpoint
# ---------------------------------------------------------------------------

@audit_bp.route('/api/audit/renewal', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_renewal_audit():
    """
    Run membership renewal audit.

    Request body:
      {
        "start_date": "2026-03-01",      # Transaction search start
        "end_date": "2026-03-31",        # Transaction search end
        "target_expiration": "2027-03-31" # Expected member expiration
      }

    Returns:
      {
        "success": true,
        "audit_results": [...],
        "summary": {...}
      }
    """
    logger.info("=== Audit: Start renewal audit ===")

    try:
        # Try multiple ways to get the JSON data
        data = request.get_json(silent=True)
        logger.info(f"Step 1 - get_json() returned type: {type(data)}")

        # If get_json() returned a string, parse it
        if isinstance(data, str):
            logger.warning(f"get_json() returned string, parsing manually")
            data = json.loads(data)
            logger.info(f"Step 2 - manual parse returned type: {type(data)}")

        # If still not a dict, try parsing request body
        if not isinstance(data, dict):
            logger.warning(f"Still not dict after parsing, trying request.data")
            try:
                body = request.get_data(as_text=True)
                logger.info(f"Request body: {body}")
                if body:
                    data = json.loads(body)
                    logger.info(f"Step 3 - parsed request.data returned type: {type(data)}")
            except Exception as e:
                logger.error(f"Failed to parse request.data: {e}")

        # Final validation
        if not isinstance(data, dict):
            logger.error(f"Expected dict, got {type(data)}: {data}")
            return json_response({'error': f'Invalid JSON payload (expected object, got {type(data).__name__}). Raw: {data}'}, 400)

        start_date = data.get('start_date')
        end_date = data.get('end_date')
        target_expiration = data.get('target_expiration')

        # Validate inputs
        if not all([start_date, end_date, target_expiration]):
            msg = f"Missing required fields: start_date={start_date}, end_date={end_date}, target_expiration={target_expiration}"
            logger.warning(msg)
            return json_response({'error': msg}, 400)

        logger.info(f"Audit parameters: start={start_date}, end={end_date}, target_exp={target_expiration}")

        # Parse dates
        try:
            start_date = datetime.strptime(start_date, '%Y-%m-%d').date()
            end_date = datetime.strptime(end_date, '%Y-%m-%d').date()
            target_expiration = datetime.strptime(target_expiration, '%Y-%m-%d').date()
            logger.info(f"Parsed dates: start={start_date}, end={end_date}, target_exp={target_expiration}")
        except ValueError as e:
            msg = f"Invalid date format (use YYYY-MM-DD): {e}"
            logger.error(msg)
            return json_response({'error': msg}, 400)

        # Get membership type (individual|family|both)
        membership_type = data.get('membership_type', 'both').lower()
        if membership_type not in ['individual', 'family', 'both']:
            return json_response({'error': f"Invalid membership_type: {membership_type}. Use: individual, family, or both"}, 400)

        # Only mismatches flag (5th param added to match SP signature)
        only_mismatches = bool(data.get('only_mismatches', False))

        logger.info(f"Membership type: {membership_type}, only_mismatches: {only_mismatches}")

        # Call stored procedure (5 params: start, end, target_exp, type, only_mismatches)
        logger.info("Calling sp_renewal_audit stored procedure...")
        try:
            results = query("CALL sp_renewal_audit(%s, %s, %s, %s, %s)", [
                str(start_date),
                str(end_date),
                str(target_expiration),
                membership_type,
                only_mismatches,
            ])

            if not results:
                logger.info("Audit complete: 0 transactions found")
                return json_response({
                    'success': True,
                    'audit_results': [],
                    'summary': {
                        'total_transactions': 0,
                        'matched': 0,
                        'mismatched': 0,
                        'not_traced': 0,
                        'message': 'No matching transactions found in date range'
                    }
                })

            # Calculate summary statistics
            matched = sum(1 for r in results if r.get('status_match') == 'MATCH')
            mismatched = sum(1 for r in results if r.get('status_match') == 'MISMATCH')
            not_traced = sum(1 for r in results if r.get('status_match') == 'NOT TRACED')

            logger.info(f"Audit complete: {len(results)} transactions (matched={matched}, mismatched={mismatched}, not_traced={not_traced})")

            # Normalize SP field names → frontend field names:
            #   message_id         → transaction_id
            #   status_match       → match_status
            #   current_expiration → expiration_date
            def _normalize(r):
                return {
                    **r,
                    'transaction_id':  r.get('message_id') or r.get('transaction_id') or '',
                    'match_status':    r.get('status_match') or r.get('match_status') or '',
                    'expiration_date': r.get('current_expiration') or r.get('expiration_date'),
                    'red_flags':       r.get('red_flags') or [],
                    'family_check':    r.get('family_check'),
                }
            results = [_normalize(r) for r in results]

            # Serialize dates to ISO format for JSON response
            serialized = _serialize_for_json({
                'success': True,
                'audit_results': results,
                'summary': {
                    'total_transactions': len(results),
                    'matched': matched,
                    'mismatched': mismatched,
                    'not_traced': not_traced,
                    'message': f'Audited {len(results)} transactions in date range'
                }
            })

            logger.info("=== Audit: Success ===")
            return json_response(serialized)

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Stored procedure error: {error_msg}")

            # Provide helpful error messages
            if 'sp_renewal_audit' in error_msg:
                return json_response({
                    'success': False,
                    'error': 'Renewal audit procedure not found. Please run database migrations (MIGRATION_V009).'
                }, 500)
            elif '1054' in error_msg:  # Column not found error
                return json_response({
                    'success': False,
                    'error': f'Database schema mismatch: {error_msg}. Please verify database migrations are applied.'
                }, 500)
            else:
                return json_response({
                    'success': False,
                    'error': f'Audit failed: {error_msg}'
                }, 500)

    except json.JSONDecodeError as e:
        msg = f"Invalid JSON: {e}"
        logger.error(msg)
        return json_response({'error': msg}, 400)
    except Exception as e:
        msg = f"Audit error: {type(e).__name__}: {e}"
        logger.error(msg, exc_info=True)
        return json_response({'error': msg}, 500)


# ---------------------------------------------------------------------------
# Reconcile Member Payments Endpoint
# ---------------------------------------------------------------------------

@audit_bp.route('/api/audit/reconcile', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_reconcile_payments():
    """
    Run sp_reconcile_member_payments to fix members whose expiration/status
    is out of sync with their actual payment records.

    Request body:
      { "dry_run": true }   → preview only (returns rows that would change)
      { "dry_run": false }  → execute updates (returns SUCCESS + affected rows)

    Uses config table for MembershipCollectionStart and MembershipYearEnd.
    """
    data = request.get_json(silent=True) or {}
    dry_run = bool(data.get('dry_run', True))  # default safe: dry run

    logger.info(f"Reconcile payments: dry_run={dry_run}")

    try:
        results = query("CALL sp_reconcile_member_payments(%s)", [dry_run])
        serialized = _serialize_for_json(results or [])

        return json_response({
            'success': True,
            'dry_run': dry_run,
            'rows': serialized,
            'count': len(serialized),
        })
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Reconcile error: {error_msg}")
        return json_response({'success': False, 'error': error_msg}, 500)
