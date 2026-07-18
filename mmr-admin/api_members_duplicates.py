"""
Member duplicate detection routes for mmr-admin.

Blueprint: members_duplicates_bp
Prefix: /api/members

Routes:
  GET  /api/members/duplicates          — list duplicate groups (name/phone/wechat/all)
  POST /api/members/duplicates/dismiss  — dismiss a duplicate group

Duplicate detection logic:
  name   — members sharing LOWER(TRIM(FirstName)) + LOWER(TRIM(LastName)),
            excluding members in the same FamilyID (same family is expected)
  phone  — members sharing PhoneNumber (non-null, non-empty)
  wechat — members sharing WeChatID (non-null, non-empty)

Dismissed groups (in member_duplicate_dismissals) are filtered out of results.
"""
from __future__ import annotations

import logging
from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query
from helpers import json_response, handle_api_errors

logger = logging.getLogger(__name__)

members_duplicates_bp = Blueprint('members_duplicates', __name__)


# ── helpers ──────────────────────────────────────────────────────────────────

def _dismissed_keys(dup_type: str) -> set:
    """Return the set of dup_keys already dismissed for this type."""
    rows = query(
        "SELECT dup_key FROM member_duplicate_dismissals WHERE dup_type = %s",
        (dup_type,)
    )
    return {r[0] for r in rows} if rows else set()


def _member_cols() -> str:
    return (
        "MemberID, FirstName, LastName, Email, PhoneNumber, WeChatID, "
        "MemberType, Status, Expiration, FamilyID, District"
    )


def _rows_to_dicts(rows) -> list:
    cols = [
        'MemberID', 'FirstName', 'LastName', 'Email', 'PhoneNumber',
        'WeChatID', 'MemberType', 'Status', 'Expiration', 'FamilyID', 'District'
    ]
    return [dict(zip(cols, r)) for r in rows]


# ── name duplicates ───────────────────────────────────────────────────────────

def _name_dupes() -> list[dict]:
    dismissed = _dismissed_keys('name')

    # Find name groups with 2+ distinct members from different families
    groups_sql = """
        SELECT
            LOWER(TRIM(FirstName)) AS fn,
            LOWER(TRIM(LastName))  AS ln,
            COUNT(DISTINCT MemberID) AS cnt
        FROM members
        WHERE FirstName IS NOT NULL AND FirstName != ''
          AND LastName  IS NOT NULL AND LastName  != ''
        GROUP BY fn, ln
        HAVING COUNT(DISTINCT MemberID) > 1
        ORDER BY ln, fn
    """
    group_rows = query(groups_sql) or []

    results = []
    for fn, ln, _cnt in group_rows:
        dup_key = f"{fn}|{ln}"
        if dup_key in dismissed:
            continue

        members_sql = f"""
            SELECT {_member_cols()}
            FROM members
            WHERE LOWER(TRIM(FirstName)) = %s
              AND LOWER(TRIM(LastName))  = %s
            ORDER BY MemberID
        """
        member_rows = query(members_sql, (fn, ln)) or []
        members = _rows_to_dicts(member_rows)

        # Filter out groups where ALL members share the same non-null FamilyID
        family_ids = {m['FamilyID'] for m in members if m['FamilyID']}
        if len(family_ids) == 1 and all(m['FamilyID'] for m in members):
            continue  # same family — expected

        results.append({
            'dup_type': 'name',
            'dup_key': dup_key,
            'display': f"{members[0]['FirstName']} {members[0]['LastName']}",
            'members': members,
        })

    return results


# ── phone duplicates ──────────────────────────────────────────────────────────

def _phone_dupes() -> list[dict]:
    dismissed = _dismissed_keys('phone')

    groups_sql = """
        SELECT PhoneNumber, COUNT(DISTINCT MemberID) AS cnt
        FROM members
        WHERE PhoneNumber IS NOT NULL AND TRIM(PhoneNumber) != ''
        GROUP BY PhoneNumber
        HAVING COUNT(DISTINCT MemberID) > 1
        ORDER BY PhoneNumber
    """
    group_rows = query(groups_sql) or []

    results = []
    for phone, _cnt in group_rows:
        dup_key = phone
        if dup_key in dismissed:
            continue

        members_sql = f"""
            SELECT {_member_cols()}
            FROM members
            WHERE PhoneNumber = %s
            ORDER BY MemberID
        """
        member_rows = query(members_sql, (phone,)) or []
        members = _rows_to_dicts(member_rows)

        results.append({
            'dup_type': 'phone',
            'dup_key': dup_key,
            'display': phone,
            'members': members,
        })

    return results


# ── wechat duplicates ─────────────────────────────────────────────────────────

def _wechat_dupes() -> list[dict]:
    dismissed = _dismissed_keys('wechat')

    groups_sql = """
        SELECT WeChatID, COUNT(DISTINCT MemberID) AS cnt
        FROM members
        WHERE WeChatID IS NOT NULL AND TRIM(WeChatID) != ''
        GROUP BY WeChatID
        HAVING COUNT(DISTINCT MemberID) > 1
        ORDER BY WeChatID
    """
    group_rows = query(groups_sql) or []

    results = []
    for wechat_id, _cnt in group_rows:
        dup_key = wechat_id
        if dup_key in dismissed:
            continue

        members_sql = f"""
            SELECT {_member_cols()}
            FROM members
            WHERE WeChatID = %s
            ORDER BY MemberID
        """
        member_rows = query(members_sql, (wechat_id,)) or []
        members = _rows_to_dicts(member_rows)

        results.append({
            'dup_type': 'wechat',
            'dup_key': dup_key,
            'display': wechat_id,
            'members': members,
        })

    return results


# ── routes ────────────────────────────────────────────────────────────────────

@members_duplicates_bp.route('/api/members/duplicates', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def get_duplicates():
    """
    GET /api/members/duplicates?type=name|phone|wechat|all

    Returns:
      { ok: true, data: { name: [...], phone: [...], wechat: [...] } }

    Each group:
      { dup_type, dup_key, display, members: [{ MemberID, FirstName, ... }] }
    """
    dup_type = request.args.get('type', 'all').lower()

    data = {}
    if dup_type in ('name', 'all'):
        data['name'] = _name_dupes()
    if dup_type in ('phone', 'all'):
        data['phone'] = _phone_dupes()
    if dup_type in ('wechat', 'all'):
        data['wechat'] = _wechat_dupes()

    total = sum(len(v) for v in data.values())
    logger.info("Duplicate scan type=%s → %d groups", dup_type, total)
    return json_response({'ok': True, 'data': data})


@members_duplicates_bp.route('/api/members/duplicates/dismiss', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def dismiss_duplicate():
    """
    POST /api/members/duplicates/dismiss
    Body: { dup_type: 'name'|'phone'|'wechat', dup_key: '...' }

    Inserts a dismissal record so the group no longer appears in results.
    Returns: { ok: true, message: '...' }
    """
    body = request.get_json(force=True) or {}
    dup_type = body.get('dup_type', '').strip()
    dup_key  = body.get('dup_key',  '').strip()

    if dup_type not in ('name', 'phone', 'wechat'):
        return json_response({'ok': False, 'error': "dup_type must be 'name', 'phone', or 'wechat'"}, 400)
    if not dup_key:
        return json_response({'ok': False, 'error': 'dup_key is required'}, 400)

    # dismissed_by is NOT NULL; the sentinel is email-shaped so the value stays
    # valid if it ever flows into an Email-constrained column (chk_actlog_email_valid).
    admin_email = session.get('user', {}).get('email') or 'dev-bypass@localhost'

    query(
        """
        INSERT INTO member_duplicate_dismissals (dup_type, dup_key, dismissed_by)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE dismissed_by = %s, dismissed_at = NOW()
        """,
        (dup_type, dup_key, admin_email, admin_email)
    )

    logger.info("Duplicate dismissed: type=%s key=%s by=%s", dup_type, dup_key, admin_email)
    return json_response({'ok': True, 'message': f'Dismissed {dup_type} duplicate: {dup_key}'})
