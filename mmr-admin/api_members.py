"""
Member management routes for mmr-admin.

Blueprint: members_bp
Prefix: /api/members

Routes:
  GET /api/members/search        — partial search by name/ID/WeChatID (≥2 chars)
  GET /api/members/<id>/card     — lightweight member data for tooltip cards

Shared helpers (imported by sibling modules):
  get_admin_id, get_member_by_id, get_member_card, get_family_members

Note: Status management             → api_members_status.py
      Family add/remove             → api_members_family.py
      District + mark-unused        → api_members_district.py
"""
from __future__ import annotations
from typing import Optional


import logging
from datetime import datetime
from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query
from helpers import json_response, handle_api_errors
from payment_helpers import get_member_by_id  # noqa: F401 — canonical impl, re-exported here

logger = logging.getLogger(__name__)

members_bp = Blueprint('members', __name__)


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def get_admin_id():
    """Get the admin email from the session (serves as admin ID)."""
    user = session.get('user') or {}
    return user.get('email') or ''



def get_member_card(member_id: str) -> Optional[dict]:
    """
    Return the minimal member record used for tooltip/card display.

    Fields chosen to be lightweight — enough to identify the member and show
    membership status at a glance without leaking sensitive data (no payment
    transaction IDs, no full payment history).
    """
    rows = query("""
        SELECT MemberID, FirstName, LastName, WeChatID, PhoneNumber, Email,
               Type, FamilyID, District, Status, Expiration, MembershipFeePaid
        FROM members
        WHERE MemberID = %s
    """, (member_id,))
    return rows[0] if rows else None


def get_family_members(family_id: str) -> list[dict]:
    """Get all members in a family."""
    return query("""
        SELECT MemberID, FirstName, LastName, Email, Type, FamilyID,
               District, Status, Expiration, MembershipFeePaid,
               PaymentDate, PaymentTransaction, UpdatedAt
        FROM members
        WHERE FamilyID = %s
        ORDER BY Type DESC, MemberID ASC
    """, (family_id,))


# ─────────────────────────────────────────────────────────────────
# Search endpoint
# ─────────────────────────────────────────────────────────────────

def _build_member_search(tokens: list[str]) -> tuple[str, list]:
    """
    Build a parameterized SQL + params for multi-token member search.

    Logic:
      - Each token must substring-match (case-insensitive) at least one of
        FirstName, LastName, WeChatID, or MemberID.
      - ALL tokens must match  (AND across tokens, OR across fields per token).
      - Results: exact MemberID match on single-token queries floats to top,
        then alphabetical by LastName / FirstName.

    Example: tokens=["Min", "Li"]
      WHERE (FirstName LIKE '%Min%' OR LastName LIKE '%Min%' OR ...)
        AND (FirstName LIKE '%Li%'  OR LastName LIKE '%Li%'  OR ...)
      → matches FirstName=MING, LastName=LIN  ✓

    Upgrade path: replace the LIKE clauses with a FULLTEXT MATCH…AGAINST
    expression once a FULLTEXT index on (FirstName, LastName, WeChatID) exists.
    """
    clauses = []
    params: list = []
    for token in tokens:
        like = f'%{token}%'
        clauses.append(
            "(UPPER(FirstName) LIKE UPPER(%s)"
            " OR UPPER(LastName)  LIKE UPPER(%s)"
            " OR UPPER(WeChatID)  LIKE UPPER(%s)"
            " OR UPPER(MemberID)  LIKE UPPER(%s))"
        )
        params.extend([like, like, like, like])

    where = '\n        AND '.join(clauses)
    # Exact MemberID match ordering only meaningful for single-token queries.
    exact = tokens[0] if len(tokens) == 1 else ''

    sql = f"""
        SELECT MemberID, FirstName, LastName, WeChatID, Email,
               Type, FamilyID, District, Status, Expiration, MembershipFeePaid
        FROM members
        WHERE {where}
        ORDER BY
            (MemberID = %s) DESC,
            LastName, FirstName
        LIMIT 50
    """
    params.append(exact)
    return sql, params


@members_bp.route('/api/members/search')
@login_required
@require_role('admin')
@handle_api_errors
def api_members_search():
    """
    Partial-search members by FirstName, LastName, WeChatID, or MemberID.
    Query params: ?q=<search_term>

    Tokenises the query on whitespace. Each token (≥2 chars) must match
    at least one field; all tokens must match (AND logic).
    Single-char tokens are silently dropped. Returns [] when no valid tokens.

    Example: "Min Li" → ["Min","Li"]
      matches FirstName=MING, LastName=LIN  (each token hits one field)
    """
    raw = request.args.get('q', '').strip()

    # Split and drop single-char noise tokens
    tokens = [t for t in raw.split() if len(t) >= 2]
    if not tokens:
        return json_response({'ok': True, 'data': []})

    logger.info(f'Member search: tokens={tokens}')

    try:
        sql, params = _build_member_search(tokens)
        members = query(sql, params)
        logger.info(f'Member search: {len(members)} results for tokens={tokens}')
        return json_response({'ok': True, 'data': members})
    except Exception as e:
        logger.error(f'Member search error: {str(e)}')
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


# ─────────────────────────────────────────────────────────────────
# Member card (tooltip data)
# ─────────────────────────────────────────────────────────────────

@members_bp.route('/api/members/<member_id>/card')
@login_required
@require_role('admin')
@handle_api_errors
def api_member_card(member_id: str):
    """
    Return lightweight member data for tooltip/hover cards.
    Uses get_member_card() — intentionally omits payment transaction details.
    """
    member = get_member_card(member_id)
    if not member:
        return json_response({'ok': False, 'error': 'Member not found'}, 404)
    return json_response({'ok': True, 'data': member})


