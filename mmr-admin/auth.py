"""
Authentication & authorization for mmr-admin.

Blueprint: auth_bp
Routes: /login, /logout, /auth/start/*, /auth/callback/*, /auth/password, /api/me
"""

from __future__ import annotations

import os
from functools import wraps
from typing import Optional

import bcrypt
from authlib.integrations.requests_client import OAuth2Session
from flask import Blueprint, redirect, request, session, url_for

from db import query, get_conn
from helpers import json_response
from auth_login_page import render_login

auth_bp = Blueprint('auth', __name__)

# ---------------------------------------------------------------------------
# Config (read once at import time from env)
# ---------------------------------------------------------------------------

from auth_config import (  # extracted for LOC limit; re-exported so auth.DEV_BYPASS_AUTH etc. stay patchable
    DEV_BYPASS_AUTH, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    MS_CLIENT_ID, MS_CLIENT_SECRET, VIEWER_BASE_URL,
)


# ---------------------------------------------------------------------------
# OAuth helpers
# ---------------------------------------------------------------------------

def _google_oauth() -> OAuth2Session:
    return OAuth2Session(
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        redirect_uri=f'{VIEWER_BASE_URL}/auth/callback/google',
        scope='openid email profile',
    )


def _microsoft_oauth() -> OAuth2Session:
    return OAuth2Session(
        client_id=MS_CLIENT_ID,
        client_secret=MS_CLIENT_SECRET,
        redirect_uri=f'{VIEWER_BASE_URL}/auth/callback/microsoft',
        scope='openid email profile User.Read',
    )


_MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
_MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'


# ---------------------------------------------------------------------------
# Role helpers & decorators
# ---------------------------------------------------------------------------

def get_user_role(email: str) -> Optional[str]:
    """Query admin_users table for user role. Returns 'super_admin', 'admin', or None."""
    try:
        rows = query(
            "SELECT role FROM admin_users WHERE email = %s",
            [email],
        )
        if rows:
            return rows[0]['role']
    except Exception:
        pass
    return None


def login_required(f):
    """Decorator to require authentication. Checks session['user'] is set."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if DEV_BYPASS_AUTH:
            return f(*args, **kwargs)
        if not session.get('user'):
            from flask import request as _req
            if _req.path.startswith('/api/'):
                return json_response({'ok': False, 'error': 'Not authenticated'}, 401)
            return redirect(url_for('auth.login'))
        return f(*args, **kwargs)
    # Marker for tests/test_auth_matrix.py — propagates through @wraps stacking
    decorated_function._auth_login_required = True
    return decorated_function


def _is_hardcoded_super_admin(email: str) -> bool:
    """Check if user is in the hardcoded super_admin list (for query/data endpoints)."""
    super_admins = [
        'admin@mmrunners.org',
        'cathy.lin@mmrunners.org',
    ]
    return email in super_admins


def require_role(min_role: str):
    """
    Decorator to require a minimum role.
    min_role: 'admin' or 'super_admin'
    Returns 403 JSON if insufficient.

    IMPORTANT: Hardcoded super_admins bypass DB role check for query/admin endpoints.
    This allows quick access without needing DB entries.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            import logging
            logger = logging.getLogger(__name__)

            if DEV_BYPASS_AUTH:
                return f(*args, **kwargs)

            user = session.get('user', {})
            email = user.get('email')
            if not email:
                logger.warning(f'[REQUIRE_ROLE] No email in session for {min_role} check')
                return json_response({'ok': False, 'error': 'Unauthorized'}, 403)

            # Check hardcoded super_admin list first (no DB query needed)
            if _is_hardcoded_super_admin(email):
                logger.info(f'[REQUIRE_ROLE] ALLOWED: {email} (hardcoded super_admin)')
                session['user'] = {**user, 'role': 'super_admin'}
                return f(*args, **kwargs)

            # Fallback: query DB for user role
            user_role = get_user_role(email) or 'none'
            logger.info(f'[REQUIRE_ROLE] email={email}, user_role={user_role}, min_role={min_role}')

            session['user'] = {**user, 'role': user_role}

            role_order = {'super_admin': 2, 'admin': 1, 'none': 0}
            user_level = role_order.get(user_role, 0)
            min_level = role_order.get(min_role, 0)

            logger.info(f'[REQUIRE_ROLE] user_level={user_level}, min_level={min_level}')

            if user_level < min_level:
                logger.error(f'[REQUIRE_ROLE] DENIED: {email} needs {min_role} but only has {user_role}')
                return json_response({'ok': False, 'error': 'Insufficient permissions'}, 403)

            logger.info(f'[REQUIRE_ROLE] ALLOWED: {email} ({user_role}) accessing {min_role} endpoint')
            return f(*args, **kwargs)
        # Marker for tests/test_auth_matrix.py — propagates through @wraps stacking
        decorated_function._auth_min_role = min_role
        return decorated_function
    return decorator



# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@auth_bp.route('/login')
def login():
    if DEV_BYPASS_AUTH:
        return redirect(url_for('index'))
    if session.get('user'):
        return redirect(url_for('index'))
    error = request.args.get('error', '')
    return render_login(error), 200, {'Content-Type': 'text/html'}


@auth_bp.route('/auth/start/google')
def auth_start_google():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return redirect('/login?error=Google+OAuth+not+configured')
    oauth = _google_oauth()
    uri, state = oauth.create_authorization_url('https://accounts.google.com/o/oauth2/v2/auth',
                                                 access_type='online')
    session['oauth_state'] = state
    return redirect(uri)


@auth_bp.route('/auth/callback/google')
def auth_callback_google():
    from flask import current_app
    try:
        oauth = _google_oauth()
        token = oauth.fetch_token('https://oauth2.googleapis.com/token',
                                  authorization_response=request.url,
                                  state=session.pop('oauth_state', None))
        resp = oauth.get('https://www.googleapis.com/oauth2/v2/userinfo')
        email = (resp.json().get('email') or '').lower()
        if not email:
            return redirect('/login?error=Google+did+not+return+an+email+address')
    except Exception as exc:
        current_app.logger.error('Google OAuth error: %s', exc)
        return redirect('/login?error=Google+sign-in+failed')
    return _finish_oauth(email)


@auth_bp.route('/auth/start/microsoft')
def auth_start_microsoft():
    if not MS_CLIENT_ID or not MS_CLIENT_SECRET:
        return redirect('/login?error=Microsoft+OAuth+not+configured')
    oauth = _microsoft_oauth()
    uri, state = oauth.create_authorization_url(_MS_AUTH_URL)
    session['oauth_state'] = state
    return redirect(uri)


@auth_bp.route('/auth/callback/microsoft')
def auth_callback_microsoft():
    from flask import current_app
    try:
        oauth = _microsoft_oauth()
        oauth.fetch_token(_MS_TOKEN_URL,
                          authorization_response=request.url,
                          state=session.pop('oauth_state', None))
        resp = oauth.get('https://graph.microsoft.com/v1.0/me')
        data = resp.json()
        email = (data.get('mail') or data.get('userPrincipalName') or '').lower()
        if not email:
            return redirect('/login?error=Microsoft+did+not+return+an+email+address')
    except Exception as exc:
        current_app.logger.error('Microsoft OAuth error: %s', exc)
        return redirect('/login?error=Microsoft+sign-in+failed')
    return _finish_oauth(email)


def _finish_oauth(email: str):
    """Common post-OAuth session setup."""
    role = get_user_role(email) or 'none'
    session['user'] = {'email': email, 'role': role}
    session.permanent = True
    return redirect(url_for('index'))


@auth_bp.route('/auth/password', methods=['POST'])
def auth_password():
    """Verify email + password against the members table (same bcrypt hash as webapp)."""
    from flask import current_app
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    password = (data.get('password') or '').strip()
    if not email or not password:
        return json_response({'ok': False, 'error': 'Email and password are required.'}, 400)

    try:
        rows = query(
            "SELECT password_hash FROM members WHERE LOWER(Email) = %s LIMIT 1",
            [email],
        )
    except Exception as e:
        current_app.logger.error('Password auth DB error: %s', e)
        return json_response({'ok': False, 'error': 'Database error.'}, 500)

    if not rows or not rows[0].get('password_hash'):
        return json_response({'ok': False, 'error': 'Incorrect email or password.'}, 401)

    pw_hash = rows[0]['password_hash']
    try:
        if isinstance(pw_hash, str):
            pw_hash = pw_hash.encode()
        match = bcrypt.checkpw(password.encode(), pw_hash)
    except Exception:
        match = False

    if not match:
        return json_response({'ok': False, 'error': 'Incorrect email or password.'}, 401)

    role = get_user_role(email) or 'none'
    session['user'] = {'email': email, 'role': role}
    session.permanent = True
    return json_response({'ok': True, 'role': role})


@auth_bp.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('auth.login'))


# ---------------------------------------------------------------------------
# API: User info
# ---------------------------------------------------------------------------

@auth_bp.route('/api/me')
@login_required
def api_me():
    """Return current user info from session."""
    user = session.get('user')
    if not user:
        return json_response({'ok': False, 'error': 'Not logged in'}, 401)
    email = user.get('email', '')
    role = get_user_role(email) or 'none'
    user_data = {**user, 'role': role}
    session['user'] = user_data
    return json_response({'ok': True, 'data': user_data})
