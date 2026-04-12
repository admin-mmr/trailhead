"""
Admin CRUD routes for mmr-admin.

Blueprint: admin_bp
Routes: /api/admins (GET, POST, DELETE), /api/admin/refresh-sheets (POST)
"""

from __future__ import annotations

import os
import subprocess

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
        rows = query("SELECT id, email, role, added_at as created_at FROM admin_users ORDER BY added_at DESC")
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
            INSERT INTO admin_users (email, role)
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
        execute("DELETE FROM admin_users WHERE email = %s", [email])
        return json_response({'ok': True, 'message': f'Admin {email} deleted'})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


# ---------------------------------------------------------------------------
# Trigger Google Sheets → MySQL refresh via GitHub Actions
# ---------------------------------------------------------------------------

GITHUB_REPO = 'admin-mmr/trailhead'
WORKFLOW_FILE = 'sync-all-sheets-ordered.yml'


@admin_bp.route('/api/admin/refresh-sheets', methods=['POST'])
@login_required
@require_role('admin')
def api_refresh_sheets():
    """
    Trigger the 'Sync All Sheets (Ordered Sequential)' GitHub Action.
    Syncs: gmail_transactions → payments → webapp_events → members.
    Requires GITHUB_TOKEN env var on the server (a PAT with workflow scope).
    """
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        # 503 = service unavailable due to missing config, not an application error
        return json_response({
            'ok': False,
            'error': 'GITHUB_TOKEN not configured on server — cannot trigger workflow'
        }, 503)

    try:
        import requests as req_lib
        resp = req_lib.post(
            f'https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/{WORKFLOW_FILE}/dispatches',
            headers={
                'Authorization': f'token {token}',
                'Accept': 'application/vnd.github.v3+json',
            },
            json={'ref': 'main'},
            timeout=15,
        )
        if resp.status_code == 204:
            user_email = session.get('user', {}).get('email', 'unknown')
            print(f'[refresh-sheets] Workflow triggered by {user_email}', flush=True)
            return json_response({
                'ok': True,
                'message': 'Sync workflow triggered. Sheets will sync in order: gmail_transactions → payments → webapp_events → members. This takes ~5 minutes.'
            })
        else:
            return json_response({
                'ok': False,
                'error': f'GitHub API returned {resp.status_code}: {resp.text[:300]}'
            }, resp.status_code)
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)

