"""
Member status management routes for mmr-admin.

Blueprint: members_status_bp
Prefix: /api/members/<id>

Handles member status changes (lifetime, inactive) and reversions:
  - Lifetime & Inactive status changes with notes (cascades to family)
  - View override history (admin_member_overrides audit log)
  - Revert to previous status (restores OldValue from override)
"""
from __future__ import annotations
from typing import Optional


import logging
from datetime import datetime
from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from activity_logger import log_activity

logger = logging.getLogger(__name__)

members_status_bp = Blueprint('members_status', __name__)

ALLOWED_ADMIN_STATUSES = {'lifetime', 'inactive'}

CONFIG_KEY_YEAR_END = 'MembershipYearEnd'


def get_member_by_id(member_id: str) -> Optional[dict]:
    """Get a single member by ID."""
    rows = query("""
        SELECT MemberID, FirstName, LastName, Email, PhoneNumber, WeChatID,
               Type, FamilyID, District, Status, Expiration, MembershipFeePaid,
               PaymentDate, PaymentTransaction, UpdatedAt
        FROM members
        WHERE MemberID = %s
    """, (member_id,))
    return rows[0] if rows else None


def get_admin_id():
    """Get the admin email from the session (serves as admin ID)."""
    user = session.get('user') or {}
    return user.get('email') or None


# ─────────────────────────────────────────────────────────────────
# Change Status endpoint
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/<member_id>/status', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_change_member_status(member_id: str):
    """
    Set a member's status to 'lifetime' or 'inactive', with an admin note.

    Uses sp_admin_update_member_status which:
      - Cascades to family members (same FamilyID)
      - Appends note to members.Notes
      - Inserts audit row into admin_member_overrides
      - For 'lifetime': DB trigger auto-sets Expiration = 2126-03-31

    POST body:
      { "new_status": "lifetime", "note": "Honorary member" }
    """
    data = request.get_json() or {}
    new_status = (data.get('new_status') or '').lower().strip()
    note = (data.get('note') or '').strip()

    if new_status not in ALLOWED_ADMIN_STATUSES:
        return json_response({'ok': False, 'error': f'status must be one of: {", ".join(ALLOWED_ADMIN_STATUSES)}'}, 400)
    if not note:
        return json_response({'ok': False, 'error': 'note is required'}, 400)

    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    admin_id = get_admin_id()
    if not admin_id:
        return json_response({'ok': False, 'error': 'Admin session missing — please log out and back in'}, 401)

    # Pass NULL for expiration — the SP keeps the existing value when NULL is supplied
    # (ELSE Expiration in the CASE). Expiration restoration is handled by the
    # dedicated revert-override endpoint, not here.
    execute(
        "CALL sp_admin_update_member_status(%s, %s, %s, NULL, %s)",
        (member_id, admin_id, new_status, note)
    )

    log_activity(
        action=f'member_status_{new_status}',
        member_id=member_id,
        admin_email=admin_id,
        state=f'old={member["Status"]},new={new_status}'
    )

    updated = get_member_by_id(member_id)
    return json_response({'ok': True, 'data': {
        'updated_member': updated,
        'message': f'{member_id} status changed to {new_status}'
    }})


# ─────────────────────────────────────────────────────────────────
# Config: membership year-end date
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/config/year-end')
@login_required
@require_role('admin')
@handle_api_errors
def api_get_year_end():
    """Return the MembershipYearEnd date from the config table."""
    rows = query(
        "SELECT ConfigValue FROM config WHERE ConfigKey = %s",
        (CONFIG_KEY_YEAR_END,)
    )
    if not rows:
        return json_response({'ok': False, 'error': 'MembershipYearEnd not set in config'}, 404)
    return json_response({'ok': True, 'data': {'year_end': rows[0]['ConfigValue']}})


# ─────────────────────────────────────────────────────────────────
# Mark Active endpoint
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/<member_id>/mark-active', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_mark_member_active(member_id: str):
    """
    Mark a member (and family) as active, setting Expiration to MembershipYearEnd.

    Reads MembershipYearEnd from config, then calls sp_admin_update_member_status
    with status='active' and the year-end date (EXPIRATION_OVERRIDE action).
    Cascades to all family members with the same FamilyID.

    POST body:
      { "note": "Renewed via admin override" }
    """
    data = request.get_json() or {}
    note = (data.get('note') or '').strip()

    if not note:
        return json_response({'ok': False, 'error': 'note is required'}, 400)

    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    # Fetch year-end date from config
    rows = query(
        "SELECT ConfigValue FROM config WHERE ConfigKey = %s",
        (CONFIG_KEY_YEAR_END,)
    )
    if not rows:
        return json_response({'ok': False, 'error': 'MembershipYearEnd not configured — set it in the config table first'}, 400)

    year_end = rows[0]['ConfigValue']
    admin_id = get_admin_id()

    execute(
        "CALL sp_admin_update_member_status(%s, %s, %s, %s, %s)",
        (member_id, admin_id, 'active', year_end, note)
    )

    log_activity(
        action='member_mark_active',
        member_id=member_id,
        admin_email=admin_id,
        state=f'old={member["Status"]},new=active,expiration={year_end}'
    )

    updated = get_member_by_id(member_id)
    return json_response({'ok': True, 'data': {
        'updated_member': updated,
        'expiration_set': year_end,
        'message': f'{member_id} marked active, expiration set to {year_end}'
    }})


# ─────────────────────────────────────────────────────────────────
# Member Log History endpoint
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/<member_id>/log-history')
@login_required
@require_role('admin')
@handle_api_errors
def api_member_log_history(member_id: str):
    """
    Return member_log rows for a member, most recent first.
    Includes every recorded change (Sheets sync, payments, admin overrides, etc.)
    so admins can pick any historical Status + Expiration to restore.

    Query params:
      limit: max rows to return (default 50, max 200)
    """
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    limit = min(int(request.args.get('limit', 50)), 200)

    rows = query("""
        SELECT LogID, LoggingTime, ChangeType,
               Status, Expiration,
               Type, FamilyID,
               MembershipFeePaid, PaymentDate, PaymentTransaction
        FROM member_log
        WHERE MemberID = %s
        ORDER BY LoggingTime DESC
        LIMIT %s
    """, (member_id, limit))

    for r in rows:
        if isinstance(r.get('LoggingTime'), datetime):
            r['LoggingTime'] = r['LoggingTime'].isoformat()
        if r.get('Expiration'):
            r['Expiration'] = str(r['Expiration'])
        if r.get('PaymentDate'):
            r['PaymentDate'] = str(r['PaymentDate'])
        if r.get('MembershipFeePaid') is not None:
            r['MembershipFeePaid'] = float(r['MembershipFeePaid'])

    return json_response({'ok': True, 'data': {
        'member': member,
        'log': rows,
        'count': len(rows),
    }})


# ─────────────────────────────────────────────────────────────────
# Restore from Log endpoint
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/<member_id>/restore-from-log', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_restore_from_log(member_id: str):
    """
    Restore a member's Status and Expiration to a specific member_log snapshot.

    Fetches the target log row, then calls sp_admin_update_member_status with
    the historical Status and Expiration. Cascades to family members.
    Requires an admin note.

    POST body:
      { "log_id": "<LogID>", "note": "Restoring to pre-sync state" }
    """
    data = request.get_json() or {}
    log_id = (data.get('log_id') or '').strip()
    note = (data.get('note') or '').strip()

    if not log_id:
        return json_response({'ok': False, 'error': 'log_id is required'}, 400)
    if not note:
        return json_response({'ok': False, 'error': 'note is required'}, 400)

    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    log_rows = query(
        "SELECT LogID, Status, Expiration, LoggingTime, ChangeType FROM member_log WHERE LogID = %s AND MemberID = %s",
        (log_id, member_id)
    )
    if not log_rows:
        return json_response({'ok': False, 'error': 'Log entry not found for this member'}, 404)

    snap = log_rows[0]
    restore_status = snap.get('Status')
    restore_expiration = str(snap['Expiration']) if snap.get('Expiration') else None
    snap_time = snap['LoggingTime'].isoformat() if isinstance(snap.get('LoggingTime'), datetime) else str(snap.get('LoggingTime', ''))

    if not restore_status:
        return json_response({'ok': False, 'error': 'Log entry has no Status value to restore'}, 400)

    admin_id = get_admin_id()
    if not admin_id:
        return json_response({'ok': False, 'error': 'Admin session missing — please log out and back in'}, 401)

    execute(
        "CALL sp_admin_update_member_status(%s, %s, %s, %s, %s)",
        (member_id, admin_id, restore_status, restore_expiration, note)
    )

    log_activity(
        action='member_restore_from_log',
        member_id=member_id,
        admin_email=admin_id,
        state=f'restored_status={restore_status},restored_expiration={restore_expiration},log_id={log_id},snap_time={snap_time}'
    )

    updated = get_member_by_id(member_id)
    return json_response({'ok': True, 'data': {
        'updated_member': updated,
        'restored_status': restore_status,
        'restored_expiration': restore_expiration,
        'snapshot_time': snap_time,
        'message': f'{member_id} restored to status={restore_status}, expiration={restore_expiration or "unchanged"} (snapshot from {snap_time[:10]})',
    }})


# ─────────────────────────────────────────────────────────────────
# Route module imports — register override history & revert routes on
# members_status_bp. Must come AFTER the blueprint and shared helpers
# (members_status_bp, get_member_by_id, get_admin_id) are defined above,
# since api_members_overrides imports them from this module. The import
# itself is the side-effect that registers the routes (noqa suppresses
# the "unused import" warning). Mirrors the api_payments split.
# ─────────────────────────────────────────────────────────────────
from api_members_overrides import *  # noqa: E402, F401, F403
