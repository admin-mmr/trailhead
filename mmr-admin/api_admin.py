"""
Admin CRUD routes for mmr-admin.

Blueprint: admin_bp
Routes: /api/admins (GET, POST, DELETE)
"""

from __future__ import annotations

from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute
from helpers import json_response

admin_bp = Blueprint('admin', __name__)


@admin_bp.route('/api/admins', methods=['GET'])
@login_required
@require_role('admin')
def api_get_admins():
    """Get all admins. Requires admin or super_admin role."""
    try:
        rows = query("SELECT id, email, role, created_at FROM viewer_admins ORDER BY created_at DESC")
        return json_response({'ok': True, 'data': rows})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


@admin_bp.route('/api/admins', methods=['POST'])
@login_required
@require_role('super_admin')
def api_create_admin():
    """Create or update admin. Requires super_admin role."""
    data = request.json or {}
    email = data.get('email', '').strip()
    role = data.get('role', 'admin')

    if not email or not email.count('@'):
        return json_response({'ok': False, 'error': 'Invalid email'}, 400)

    if role not in ('admin', 'super_admin'):
        return json_response({'ok': False, 'error': 'Invalid role'}, 400)

    try:
        execute("""
            INSERT INTO viewer_admins (email, role)
            VALUES (%s, %s)
            ON DUPLICATE KEY UPDATE role = %s
        """, (email, role, role))
        return json_response({'ok': True, 'message': f'Admin {email} saved'})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


@admin_bp.route('/api/admins/<email>', methods=['DELETE'])
@login_required
@require_role('super_admin')
def api_delete_admin(email):
    """Delete admin. Cannot delete yourself. Requires super_admin."""
    current_email = session.get('user', {}).get('email')
    if email == current_email:
        return json_response({'ok': False, 'error': 'Cannot delete yourself'}, 400)

    try:
        execute("DELETE FROM viewer_admins WHERE email = %s", [email])
        return json_response({'ok': True, 'message': f'Admin {email} deleted'})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)
