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

auth_bp = Blueprint('auth', __name__)

# ---------------------------------------------------------------------------
# Config (read once at import time from env)
# ---------------------------------------------------------------------------

DEV_BYPASS_AUTH = os.environ.get('DEV_BYPASS_AUTH', 'false').lower() == 'true'
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
MS_CLIENT_ID = os.environ.get('MICROSOFT_CLIENT_ID', '')
MS_CLIENT_SECRET = os.environ.get('MICROSOFT_CLIENT_SECRET', '')
VIEWER_BASE_URL = os.environ.get('VIEWER_BASE_URL', 'http://localhost:5050').rstrip('/')


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
            return redirect(url_for('auth.login'))
        return f(*args, **kwargs)
    return decorated_function


def require_role(min_role: str):
    """
    Decorator to require a minimum role.
    min_role: 'admin' or 'super_admin'
    Returns 403 JSON if insufficient.
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

            # Always re-query DB so stale session roles don't block legitimate admins
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
        return decorated_function
    return decorator


# ---------------------------------------------------------------------------
# Login page HTML
# ---------------------------------------------------------------------------

_LOGIN_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>NYRR Data Viewer — Sign in</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);
         min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
    .card{background:#fff;border-radius:24px;box-shadow:0 25px 60px rgba(0,0,0,.4);
          padding:40px 36px;width:100%;max-width:400px}
    .logo{text-align:center;margin-bottom:28px}
    .logo h1{font-size:22px;font-weight:700;color:#0f172a;margin-bottom:2px}
    .logo p{font-size:13px;color:#64748b}
    .social-btn{display:flex;align-items:center;justify-content:center;gap:10px;
                width:100%;padding:11px 16px;border-radius:12px;font-size:14px;font-weight:500;
                cursor:pointer;transition:background .15s;border:1px solid #e2e8f0;
                background:#fff;color:#374151;margin-bottom:10px;text-decoration:none}
    .social-btn:hover{background:#f8fafc}
    .social-btn:disabled{opacity:.55;cursor:not-allowed}
    .divider{display:flex;align-items:center;gap:12px;margin:20px 0;color:#94a3b8;font-size:12px}
    .divider::before,.divider::after{content:'';flex:1;border-top:1px solid #e2e8f0}
    label{display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:5px}
    .field{position:relative;margin-bottom:14px}
    input[type=email],input[type=password]{width:100%;padding:10px 12px 10px 38px;
           border:1px solid #e2e8f0;border-radius:10px;font-size:14px;outline:none;
           color:#0f172a;background:#fff}
    input[type=password]{padding-right:42px}
    input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
    .ico{position:absolute;left:11px;top:50%;transform:translateY(-50%);
         color:#94a3b8;pointer-events:none;display:flex;align-items:center}
    .eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);
         background:none;border:none;cursor:pointer;color:#94a3b8;padding:4px;
         display:flex;align-items:center;line-height:1}
    .eye:hover{color:#6366f1}
    .btn-primary{width:100%;padding:12px;background:#6366f1;color:#fff;border:none;
                 border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;
                 transition:filter .15s;margin-top:4px}
    .btn-primary:hover{filter:brightness(1.08)}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed}
    .err{color:#ef4444;font-size:13px;margin-top:10px;padding:8px 12px;
         background:#fef2f2;border-radius:8px;display:none}
    .err.show{display:block}
    .links{text-align:center;margin-top:16px;font-size:12px;color:#94a3b8}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">
    <h1>Misty Mountain Runners</h1>
    <p>NYRR Data Viewer — Admin</p>
  </div>

  <!-- Google -->
  <button class="social-btn" id="gBtn" onclick="oauthSignIn('google')" __google_disabled__>
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
    Continue with Google
  </button>

  <!-- Microsoft -->
  <button class="social-btn" id="msBtn" onclick="oauthSignIn('microsoft')" __microsoft_disabled__>
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#f25022" d="M1 1h10v10H1z"/>
      <path fill="#00a4ef" d="M13 1h10v10H13z"/>
      <path fill="#7fba00" d="M1 13h10v10H1z"/>
      <path fill="#ffb900" d="M13 13h10v10H13z"/>
    </svg>
    Continue with Microsoft
  </button>

  <div class="divider">or sign in with email</div>

  <!-- Password form -->
  <form onsubmit="passwordSignIn(event)">
    <div class="field">
      <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      <input type="email" id="em" placeholder="you@mmrunners.org" autocomplete="email" required/>
    </div>
    <div class="field">
      <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <input type="password" id="pw" placeholder="••••••••" autocomplete="current-password" required/>
      <button type="button" class="eye" onclick="togglePw()" id="eyeBtn" aria-label="Show password">
        <svg id="eyeShow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <svg id="eyeHide" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      </button>
    </div>
    <div class="err" id="err"></div>
    <button type="submit" class="btn-primary" id="submitBtn">Sign in</button>
  </form>

  <p class="links">Use your MMR member portal password</p>
</div>
<script>
function oauthSignIn(provider) {
  const btn = provider === 'google' ? document.getElementById('gBtn') : document.getElementById('msBtn');
  btn.disabled = true;
  btn.style.opacity = '0.6';
  window.location = '/auth/start/' + provider;
}
function togglePw() {
  const pw = document.getElementById('pw');
  const showing = pw.type === 'password';
  pw.type = showing ? 'text' : 'password';
  document.getElementById('eyeShow').style.display = showing ? 'none'  : '';
  document.getElementById('eyeHide').style.display = showing ? ''      : 'none';
}
function showErr(msg) {
  const el = document.getElementById('err');
  el.textContent = msg; el.classList.add('show');
}
async function passwordSignIn(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  document.getElementById('err').classList.remove('show');
  btn.disabled = true; btn.textContent = 'Signing in…';
  const r = await fetch('/auth/password', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email: document.getElementById('em').value.trim(),
                           password: document.getElementById('pw').value })
  }).then(r => r.json()).catch(() => ({ ok: false, error: 'Network error' }));
  btn.disabled = false; btn.textContent = 'Sign in';
  if (r.ok) window.location = '/';
  else showErr(r.error || 'Incorrect email or password.');
}
</script>
</body>
</html>"""


def _render_login(error: str = '') -> str:
    """Inject disabled state for unconfigured providers."""
    html = _LOGIN_HTML
    html = html.replace('__google_disabled__',    '' if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET    else 'disabled title="Google not configured"')
    html = html.replace('__microsoft_disabled__', '' if MS_CLIENT_ID     and MS_CLIENT_SECRET        else 'disabled title="Microsoft not configured"')
    if error:
        html = html.replace('<div class="err" id="err"></div>',
                            f'<div class="err show" id="err">{error}</div>')
    return html


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
    return _render_login(error), 200, {'Content-Type': 'text/html'}


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
