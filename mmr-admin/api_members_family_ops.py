"""
Family composite operations for mmr-admin.

Routes register on the shared `members_family_bp` defined in
`api_members_family` (URL paths and blueprint are unchanged by the split):

  POST /api/members/family/upgrade-and-add  — upgrade Individual→Family,
                                               generate FamilyID, add 2nd member
"""
from __future__ import annotations

import logging
from datetime import datetime
from flask import request

from auth import login_required, require_role
from db import db_cursor
from helpers import json_response, handle_api_errors
from activity_logger import log_activity
from api_members import get_admin_id, get_member_by_id, get_family_members

from api_members_family import members_family_bp, generate_family_id

logger = logging.getLogger(__name__)


@members_family_bp.route('/api/members/family/upgrade-and-add', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_upgrade_and_add():
    """
    Upgrade an Individual member to Family type, generate a new FamilyID,
    then add a second member to that family in one atomic operation.

    POST body:
    {
      "primary_member_id": "A0100",   // Must be Individual (or already Family with no FamilyID)
      "new_member_id":     "A0200"    // Member to join the family
    }

    What happens:
      1. Validate primary exists and is Individual (or Family without a FamilyID)
      2. Validate new_member exists and is not already in a different family
      3. Generate next available B### FamilyID
      4. Update primary: Type→Family, FamilyID set, Status/Expiration unchanged
      5. Update new_member: Type→Family, FamilyID set, inherits primary's Status/Expiration/payment fields
      6. Log both actions
    """
    data = request.get_json() or {}
    primary_id = data.get('primary_member_id', '').strip()
    new_member_id = data.get('new_member_id', '').strip()

    if not primary_id or not new_member_id:
        return json_response({'ok': False, 'error': 'Missing primary_member_id or new_member_id'}, 400)

    if primary_id == new_member_id:
        return json_response({'ok': False, 'error': 'primary_member_id and new_member_id must be different'}, 400)

    primary = get_member_by_id(primary_id)
    if not primary:
        return json_response({'ok': False, 'error': f'Member {primary_id} not found'}, 404)

    # Allow Individual or a Family member who somehow has no FamilyID yet
    if primary['Type'] == 'Family' and primary['FamilyID']:
        return json_response({
            'ok': False,
            'error': (
                f'Member {primary_id} is already Family type with FamilyID={primary["FamilyID"]}. '
                'Use "Add Member to Family" instead.'
            )
        }, 409)

    new_member = get_member_by_id(new_member_id)
    if not new_member:
        return json_response({'ok': False, 'error': f'Member {new_member_id} not found'}, 404)

    if new_member.get('FamilyID'):
        return json_response({
            'ok': False,
            'error': (
                f'Member {new_member_id} is already in family {new_member["FamilyID"]}. '
                'Remove them from that family first.'
            )
        }, 409)

    try:
        family_id = generate_family_id()
    except ValueError as exc:
        return json_response({'ok': False, 'error': str(exc)}, 500)

    admin_id = get_admin_id()
    now = datetime.utcnow()

    with db_cursor() as cur:
        cur.execute("SET @internal_proc = 1")

        # Upgrade primary → Family, assign new FamilyID
        cur.execute("""
            UPDATE members
            SET Type = 'Family',
                FamilyID = %s,
                UpdatedAt = %s
            WHERE MemberID = %s
        """, (family_id, now, primary_id))

        # Add new member → Family, inherit primary's payment/status fields
        cur.execute("""
            UPDATE members
            SET Type = 'Family',
                FamilyID = %s,
                Status = %s,
                Expiration = %s,
                MembershipFeePaid = %s,
                PaymentDate = %s,
                PaymentTransaction = %s,
                UpdatedAt = %s
            WHERE MemberID = %s
        """, (
            family_id,
            primary['Status'],
            primary['Expiration'],
            primary['MembershipFeePaid'],
            primary['PaymentDate'],
            primary['PaymentTransaction'],
            now,
            new_member_id,
        ))

        cur.execute("SET @internal_proc = NULL")

    log_activity(
        action='member_family_upgrade_and_add',
        member_id=primary_id,
        admin_email=admin_id,
        state=f'upgraded_to_family,family_id={family_id},added={new_member_id}'
    )
    log_activity(
        action='member_family_upgrade_and_add',
        member_id=new_member_id,
        admin_email=admin_id,
        state=f'added_to_new_family,family_id={family_id},primary={primary_id}'
    )

    updated_primary = get_member_by_id(primary_id)
    family_members = get_family_members(family_id)

    return json_response({'ok': True, 'data': {
        'family_id': family_id,
        'primary_member': updated_primary,
        'members': family_members,
        'message': (
            f'{primary_id} upgraded to Family and assigned FamilyID {family_id}; '
            f'{new_member_id} added to family.'
        )
    }})
