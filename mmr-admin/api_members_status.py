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


def get_member_by_id(member_id: str) -> dict | None:
    """Get a single member by ID."""
    rows = query("""
        SELECT MemberID, FirstName, LastName, Email, PhoneNumber, WeChatID,
               Type, FamilyID, District, Status, Expiration, MembershipFeePaid,
               PaymentDate, PaymentTransaction, LastUpdated
        FROM members
        WHERE MemberID = %s
    """, (member_id,))
    return rows[0] if rows else None


def get_admin_id():
    """Get the admin email from the session (serves as admin ID)."""
    return session.get('user_email', 'unknown')


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

    execute(
        "CALL sp_admin_update_member_status(%s, %s, NULL, %s, %s)",
        (member_id, new_status, note, admin_id)
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
# Get Override History endpoint
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/<member_id>/overrides')
@login_required
@require_role('admin')
@handle_api_errors
def api_get_member_overrides(member_id: str):
    """
    Return admin override history for a member (from admin_member_overrides).
    Most recent first.
    """
    rows = query("""
        SELECT OverrideID, AdminEmail, TargetMemberID, ImpactedMemberIDs,
               ActionType, OldValue, NewValue, AdminNotes, Timestamp
        FROM admin_member_overrides
        WHERE TargetMemberID = %s
           OR FIND_IN_SET(%s, ImpactedMemberIDs)
        ORDER BY Timestamp DESC
        LIMIT 20
    """, (member_id, member_id))

    # Serialize datetimes
    for r in rows:
        if isinstance(r.get('Timestamp'), datetime):
            r['Timestamp'] = r['Timestamp'].isoformat()

    return json_response({'ok': True, 'data': rows})


# ─────────────────────────────────────────────────────────────────
# Revert Status endpoint
# ─────────────────────────────────────────────────────────────────

@members_status_bp.route('/api/members/<member_id>/revert-status', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_revert_member_status(member_id: str):
    """
    Revert a member (and family) to the previous status recorded in
    admin_member_overrides. Looks up the override record and restores OldValue.

    POST body: { "override_id": 42, "note": "Reverting per request" }
    """
    data = request.get_json() or {}
    override_id = data.get('override_id')
    note = (data.get('note') or 'Status reverted by admin').strip()

    if not override_id:
        return json_response({'ok': False, 'error': 'override_id is required'}, 400)

    member = get_member_by_id(member_id)
    if not member:
        return json_response({'ok': False, 'error': f'Member {member_id} not found'}, 404)

    # Get the specific override record
    overrides = query(
        "SELECT * FROM admin_member_overrides WHERE OverrideID = %s AND TargetMemberID = %s",
        (override_id, member_id)
    )
    if not overrides:
        return json_response({'ok': False, 'error': 'Override record not found for this member'}, 404)

    override = overrides[0]
    old_status = override.get('OldValue')
    if not old_status:
        return json_response({'ok': False, 'error': 'No previous status recorded in override'}, 400)

    admin_id = get_admin_id()

    # Revert via sp_admin_update_member_status (cascades to family)
    # For lifetime revert, set Expiration back to NULL so normal expiry logic takes over
    new_expiration = None
    if old_status != 'lifetime' and member.get('Status') == 'lifetime':
        # Clear the lifetime sentinel date; restore to a sane default or NULL
        new_expiration = override.get('OldExpiration')  # may be None

    execute(
        "CALL sp_admin_update_member_status(%s, %s, %s, %s, %s)",
        (member_id, old_status, new_expiration, note, admin_id)
    )

    # Note: the SP appends a new revert entry to members.Notes.
    # The original override note is preserved in the audit log (admin_member_overrides)
    # so the history is fully traceable. Notes field shows the revert action.

    log_activity(
        action='member_status_revert',
        member_id=member_id,
        admin_email=admin_id,
        state=f'reverted_to={old_status},override_id={override_id}'
    )

    updated = get_member_by_id(member_id)
    return json_response({'ok': True, 'data': {
        'updated_member': updated,
        'reverted_to': old_status,
        'message': f'{member_id} status reverted to {old_status}'
    }})
