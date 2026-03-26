#!/usr/bin/env python3
"""
NYRR Data Viewer — interactive ops tool for reviewing NYRR events,
browsing MySQL data, and triggering result loads from the NYRR API.

Usage:
    # Set DB env vars first (or source basecamp/load-env.sh)
    pip install flask mysql-connector-python requests authlib bcrypt python-dotenv
    python app.py

    # Auth: automatically reads web-apps/mmr-webapp/.env.local so all
    # Google / Microsoft OAuth credentials are shared with zero extra config.
    # One-time setup: add http://localhost:5050/auth/callback/google
    #   and http://localhost:5050/auth/callback/microsoft as redirect URIs
    #   in the Google Console / Azure app registration — no new credentials.
    # For local dev without OAuth: export DEV_BYPASS_AUTH=true
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from functools import wraps

# ---------------------------------------------------------------------------
# Auto-load web-apps/mmr-webapp/.env.local so OAuth + DB creds are shared.
# Shell-level env vars always take precedence (override=False).
# ---------------------------------------------------------------------------
_HERE    = os.path.dirname(os.path.abspath(__file__))
_WEBAPP_ENV = os.path.join(_HERE, '..', '..', 'web-apps', 'mmr-webapp', '.env.local')

try:
    from dotenv import load_dotenv
    if os.path.exists(_WEBAPP_ENV):
        load_dotenv(_WEBAPP_ENV, override=False)
        print(f'  ✓ Loaded shared env from mmr-webapp/.env.local', flush=True)
    else:
        print(f'  ⚠  mmr-webapp/.env.local not found — OAuth vars must be set manually', flush=True)
except ImportError:
    print('  ⚠  python-dotenv not installed — run: pip install python-dotenv', flush=True)

import bcrypt
from authlib.integrations.requests_client import OAuth2Session
from flask import Flask, send_file, request, session, redirect, url_for

import mysql.connector
from mysql.connector import Error as MySQLError

# Add nyrr_api.py to path
sys.path.insert(0, os.path.join(_HERE, '..', '..', 'basecamp', 'python'))
from nyrr_api import NyrrApiClient, NyrrFinisher

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__)

# ── Auth config — all vars already present in load-env.sh / .env.local ──────
SECRET_KEY           = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-prod')
DEV_BYPASS_AUTH      = os.environ.get('DEV_BYPASS_AUTH', 'false').lower() == 'true'
GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
MS_CLIENT_ID         = os.environ.get('MICROSOFT_CLIENT_ID', '')
MS_CLIENT_SECRET     = os.environ.get('MICROSOFT_CLIENT_SECRET', '')
# Base URL of this app — used to build callback URIs.
# Override with VIEWER_BASE_URL=https://your-viewer.azurewebsites.net in prod.
VIEWER_BASE_URL      = os.environ.get('VIEWER_BASE_URL', 'http://localhost:5050').rstrip('/')

app.secret_key = SECRET_KEY


# ── OAuth helpers ────────────────────────────────────────────────────────────

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

TEAM_CODE = 'MMR'

# In-flight jobs (event_code -> status dict)
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()

# Runner history cache: {runner_id: (timestamp, data)}
_runner_history_cache: Dict[str, tuple] = {}
_runner_history_lock = threading.Lock()
RUNNER_HISTORY_CACHE_TTL = 3600  # 1 hour

# ---------------------------------------------------------------------------
# Parse DATABASE_URL from env (set by `source basecamp/load-env.sh`, which
# reads the password from macOS Keychain — no local files needed).
#
# Format: mysql://user:password@host:port/database?ssl=true
# ---------------------------------------------------------------------------

def _parse_database_url() -> Dict[str, Any]:
    """Extract host/user/password/database from DATABASE_URL env var."""
    db_url = os.environ.get('DATABASE_URL', '')
    if not db_url:
        return {}
    try:
        from urllib.parse import urlparse
        parsed = urlparse(db_url)
        return {
            'host': parsed.hostname or 'localhost',
            'user': parsed.username or 'root',
            'password': parsed.password or '',
            'database': (parsed.path or '/mmrdb').lstrip('/').split('?')[0],
            'ssl_disabled': 'ssl=true' not in db_url.lower(),
        }
    except Exception:
        return {}


_env_db = _parse_database_url()

# Current DB connection config — auto-configured from DATABASE_URL if
# available (populated by `source basecamp/load-env.sh` → Keychain).
_db_config: Dict[str, Any] = _env_db if _env_db else {
    'host': os.environ.get('MYSQL_HOST', 'localhost'),
    'user': os.environ.get('MYSQL_USER', 'root'),
    'password': os.environ.get('MYSQL_PASSWORD', ''),
    'database': os.environ.get('MYSQL_DATABASE', 'mmrdb'),
    'ssl_disabled': os.environ.get('MYSQL_SSL_DISABLED', 'false').lower() == 'true',
}
_db_config_lock = threading.Lock()

if _env_db:
    print(f'  DB: {_env_db["user"]}@{_env_db["host"]}/{_env_db["database"]} (from DATABASE_URL)')

# Pre-configured connection profiles
PRESETS = {
    'azure': {
        'host': 'mmr-mysql-v4.mysql.database.azure.com',
        'user': 'mmradmin',
        'password': _env_db.get('password', ''),  # from DATABASE_URL / Keychain
        'database': 'mmrdb',
        'ssl_disabled': False,
    },
    'local': {
        'host': 'localhost',
        'user': 'root',
        'password': '',
        'database': 'mmrdb',
        'ssl_disabled': True,
    },
}

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_conn():
    with _db_config_lock:
        cfg = _db_config.copy()
    return mysql.connector.connect(
        host=cfg['host'],
        user=cfg['user'],
        password=cfg['password'],
        database=cfg['database'],
        ssl_disabled=cfg['ssl_disabled'],
        charset='utf8mb4',
        collation='utf8mb4_unicode_ci',
    )


def query(sql: str, params=None, dictionary=True) -> List[Dict]:
    conn = get_conn()
    cur = conn.cursor(dictionary=dictionary)
    cur.execute(sql, params or [])
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows


def execute(sql: str, params=None) -> int:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(sql, params or [])
    affected = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return affected


# ---------------------------------------------------------------------------
# Initialize viewer_admins table and seed super_admin
# ---------------------------------------------------------------------------

def _init_viewer_admins_table():
    """Create viewer_admins table if it doesn't exist and seed a super_admin."""
    try:
        execute("""
            CREATE TABLE IF NOT EXISTS viewer_admins (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                role ENUM('admin','super_admin') NOT NULL DEFAULT 'admin',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
    except Exception as e:
        print(f'Warning: Could not create viewer_admins table: {e}')
        return

    try:
        # Check if table is empty
        rows = query("SELECT COUNT(*) as cnt FROM viewer_admins")
        if rows and rows[0]['cnt'] == 0:
            execute("""
                INSERT IGNORE INTO viewer_admins (email, role)
                VALUES (%s, %s)
            """, ('admin@mmrunners.org', 'super_admin'))
    except Exception as e:
        print(f'Warning: Could not seed viewer_admins: {e}')


# Call on startup
_init_viewer_admins_table()


# ---------------------------------------------------------------------------
# JSON serializer for dates etc.
# ---------------------------------------------------------------------------

class DateEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        if isinstance(obj, bytes):
            return obj.decode('utf-8', errors='replace')
        return super().default(obj)


app.json.sort_keys = False


@app.errorhandler(MySQLError)
def handle_db_error(e):
    """Return a clean JSON error instead of a 500 HTML page."""
    msg = str(e)
    if 'Can\'t connect' in msg or '2003' in msg:
        return json_response({
            'ok': False,
            'error': 'Not connected to database',
            'detail': 'Go to Settings to configure your database connection.',
            'db_error': True,
        }, 503)
    return json_response({'ok': False, 'error': msg[:300], 'db_error': True}, 500)


@app.errorhandler(Exception)
def handle_generic_error(e):
    """Catch-all so the API never returns HTML error pages."""
    return json_response({'ok': False, 'error': str(e)[:300]}, 500)


@app.after_request
def add_cors(resp):
    resp.headers['Content-Type'] = resp.headers.get('Content-Type', 'application/json')
    return resp


def json_response(data, status=200):
    return app.response_class(
        json.dumps(data, cls=DateEncoder, default=str),
        status=status,
        mimetype='application/json',
    )


# ---------------------------------------------------------------------------
# Authentication & Authorization helpers
# ---------------------------------------------------------------------------

def get_user_role(email: str) -> Optional[str]:
    """Query viewer_admins table for user role. Returns 'super_admin', 'admin', or None."""
    try:
        rows = query(
            "SELECT role FROM viewer_admins WHERE email = %s",
            [email]
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
            # Skip auth in dev mode
            return f(*args, **kwargs)
        if not session.get('user'):
            return redirect(url_for('login'))
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
            if DEV_BYPASS_AUTH:
                return f(*args, **kwargs)

            user_role = session.get('user', {}).get('role')
            if not user_role:
                return json_response({'ok': False, 'error': 'Unauthorized'}, 403)

            # Role hierarchy: super_admin > admin > none
            role_order = {'super_admin': 2, 'admin': 1, 'none': 0}
            user_level = role_order.get(user_role, 0)
            min_level = role_order.get(min_role, 0)

            if user_level < min_level:
                return json_response({'ok': False, 'error': 'Insufficient permissions'}, 403)

            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ===================================================================
# Pages
# ===================================================================

@app.route('/')
@login_required
def index():
    template_path = os.path.join(os.path.dirname(__file__), 'templates', 'index.html')
    return send_file(template_path, mimetype='text/html')


# ===================================================================
# Authentication routes
# ===================================================================

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


@app.route('/login')
def login():
    if DEV_BYPASS_AUTH:
        return redirect(url_for('index'))
    if session.get('user'):
        return redirect(url_for('index'))
    error = request.args.get('error', '')
    return _render_login(error), 200, {'Content-Type': 'text/html'}


# ── OAuth — Google ────────────────────────────────────────────────────────────

@app.route('/auth/start/google')
def auth_start_google():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return redirect('/login?error=Google+OAuth+not+configured')
    oauth = _google_oauth()
    uri, state = oauth.create_authorization_url('https://accounts.google.com/o/oauth2/v2/auth',
                                                 access_type='online')
    session['oauth_state'] = state
    return redirect(uri)


@app.route('/auth/callback/google')
def auth_callback_google():
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
        app.logger.error('Google OAuth error: %s', exc)
        return redirect('/login?error=Google+sign-in+failed')
    return _finish_oauth(email)


# ── OAuth — Microsoft ─────────────────────────────────────────────────────────

_MS_AUTH_URL  = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
_MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

@app.route('/auth/start/microsoft')
def auth_start_microsoft():
    if not MS_CLIENT_ID or not MS_CLIENT_SECRET:
        return redirect('/login?error=Microsoft+OAuth+not+configured')
    oauth = _microsoft_oauth()
    uri, state = oauth.create_authorization_url(_MS_AUTH_URL)
    session['oauth_state'] = state
    return redirect(uri)


@app.route('/auth/callback/microsoft')
def auth_callback_microsoft():
    try:
        oauth = _microsoft_oauth()
        oauth.fetch_token(_MS_TOKEN_URL,
                          authorization_response=request.url,
                          state=session.pop('oauth_state', None))
        resp = oauth.get('https://graph.microsoft.com/v1.0/me')
        data  = resp.json()
        email = (data.get('mail') or data.get('userPrincipalName') or '').lower()
        if not email:
            return redirect('/login?error=Microsoft+did+not+return+an+email+address')
    except Exception as exc:
        app.logger.error('Microsoft OAuth error: %s', exc)
        return redirect('/login?error=Microsoft+sign-in+failed')
    return _finish_oauth(email)


def _finish_oauth(email: str):
    """Common post-OAuth session setup."""
    role = get_user_role(email) or 'none'
    session['user'] = {'email': email, 'role': role}
    session.permanent = True
    return redirect(url_for('index'))


# ── Password sign-in ──────────────────────────────────────────────────────────

@app.route('/auth/password', methods=['POST'])
def auth_password():
    """Verify email + password against the members table (same bcrypt hash as webapp)."""
    data     = request.json or {}
    email    = (data.get('email')    or '').strip().lower()
    password = (data.get('password') or '').strip()
    if not email or not password:
        return json_response({'ok': False, 'error': 'Email and password are required.'}, 400)

    try:
        rows = query(
            "SELECT password_hash FROM members WHERE LOWER(Email) = %s LIMIT 1",
            [email],
        )
    except Exception as e:
        app.logger.error('Password auth DB error: %s', e)
        return json_response({'ok': False, 'error': 'Database error.'}, 500)

    if not rows or not rows[0].get('password_hash'):
        return json_response({'ok': False, 'error': 'Incorrect email or password.'}, 401)

    pw_hash = rows[0]['password_hash']
    try:
        # bcrypt.checkpw accepts both str and bytes; hash must be bytes
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


# ── Logout ────────────────────────────────────────────────────────────────────

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# ===================================================================
# API: User info
# ===================================================================

@app.route('/api/me')
@login_required
def api_me():
    """Return current user info from session."""
    user = session.get('user')
    if not user:
        return json_response({'ok': False, 'error': 'Not logged in'}, 401)
    return json_response({'ok': True, **user})


# ===================================================================
# API: Admin list management
# ===================================================================

@app.route('/api/admins', methods=['GET'])
@login_required
@require_role('admin')
def api_get_admins():
    """Get all admins. Requires admin or super_admin role."""
    try:
        rows = query("SELECT id, email, role, created_at FROM viewer_admins ORDER BY created_at DESC")
        return json_response({'ok': True, 'data': rows})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


@app.route('/api/admins', methods=['POST'])
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


@app.route('/api/admins/<email>', methods=['DELETE'])
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


# ===================================================================
# API: Member search (for manual runner matching)
# ===================================================================

@app.route('/api/members/search')
@login_required
def api_members_search():
    """
    Fuzzy-search the members table by name for manual NYRR runner matching.
    Returns up to 20 candidates ordered by exact-name match first, then active.
    """
    q = (request.args.get('q') or '').strip()
    if not q:
        return json_response({'ok': True, 'data': [], 'count': 0})

    like = f'%{q}%'
    try:
        rows = query("""
            SELECT
                MemberID            AS member_id,
                FirstName           AS first_name,
                LastName            AS last_name,
                CONCAT(FirstName, ' ', LastName) AS full_name,
                Email               AS email,
                Gender              AS gender,
                NYRRRunnerName      AS nyrr_runner_name,
                Status              AS status,
                YearBorn            AS year_born
            FROM members
            WHERE CONCAT(FirstName, ' ', LastName) LIKE %s
               OR NYRRRunnerName LIKE %s
               OR LastName LIKE %s
            ORDER BY
                (LOWER(CONCAT(FirstName, ' ', LastName)) = LOWER(%s)) DESC,
                (Status = 'active') DESC,
                LastName, FirstName
            LIMIT 20
        """, [like, like, like, q])
        return json_response({'ok': True, 'data': rows, 'count': len(rows)})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


# ===================================================================
# API: Manual runner match / unmatch
# ===================================================================

@app.route('/api/runners/<int:runner_row_id>/match', methods=['POST'])
@login_required
@require_role('admin')
def api_match_runner(runner_row_id):
    """
    Manually match a nyrr_event_runners row to an MMR member.
    Body: { "member_id": "M001" }
    """
    data = request.json or {}
    member_id = (data.get('member_id') or '').strip()
    if not member_id:
        return json_response({'ok': False, 'error': 'member_id required'}, 400)

    rows = query("SELECT * FROM nyrr_event_runners WHERE id = %s", [runner_row_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Runner not found'}, 404)

    member_rows = query("SELECT MemberID FROM members WHERE MemberID = %s", [member_id])
    if not member_rows:
        return json_response({'ok': False, 'error': 'Member not found'}, 404)

    event_id = rows[0]['nyrr_event_id']
    user_email = session.get('user', {}).get('email', 'Viewer')

    try:
        execute("""
            UPDATE nyrr_event_runners
            SET mmr_member_id = %s,
                match_method  = 'manual',
                matched_by    = %s,
                matched_at    = NOW()
            WHERE id = %s
        """, [member_id, user_email, runner_row_id])

        # Recalculate matched count on the parent event
        execute("""
            UPDATE nyrr_events
            SET mmr_matched_count = (
                SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
            )
            WHERE id = %s
        """, [event_id, event_id])

        updated = query("SELECT * FROM nyrr_event_runners WHERE id = %s", [runner_row_id])
        return json_response({'ok': True, 'data': updated[0] if updated else {}})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


@app.route('/api/runners/<int:runner_row_id>/match', methods=['DELETE'])
@login_required
@require_role('admin')
def api_unmatch_runner(runner_row_id):
    """
    Remove a match from a nyrr_event_runners row.
    Sets match_method = 'unmatched' to distinguish from never-matched.
    """
    rows = query("SELECT nyrr_event_id FROM nyrr_event_runners WHERE id = %s", [runner_row_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Runner not found'}, 404)

    event_id = rows[0]['nyrr_event_id']

    try:
        execute("""
            UPDATE nyrr_event_runners
            SET mmr_member_id = NULL,
                match_method  = 'unmatched',
                matched_by    = NULL,
                matched_at    = NULL
            WHERE id = %s
        """, [runner_row_id])

        execute("""
            UPDATE nyrr_events
            SET mmr_matched_count = (
                SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
            )
            WHERE id = %s
        """, [event_id, event_id])

        return json_response({'ok': True, 'message': 'Match removed'})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


# ===================================================================
# API: Database connection settings
# ===================================================================

@app.route('/api/connection/config')
@login_required
def api_connection_config():
    """Get current database connection config (redacted password)."""
    with _db_config_lock:
        cfg = _db_config.copy()
    # Redact password in response
    cfg['password'] = '••••' if cfg['password'] else ''
    return json_response({'ok': True, 'config': cfg})


@app.route('/api/connection/presets')
@login_required
def api_connection_presets():
    """Get available connection presets."""
    presets_info = {}
    for name, cfg in PRESETS.items():
        presets_info[name] = {
            'host': cfg['host'],
            'user': cfg['user'],
            'database': cfg['database'],
            'password': '••••' if cfg['password'] else '(from env)',
        }
    return json_response({'ok': True, 'presets': presets_info})


@app.route('/api/connection/set', methods=['POST'])
@login_required
def api_connection_set():
    """Update database connection config."""
    data = request.json or {}

    # Allow preset name or custom config
    if 'preset' in data:
        preset_name = data['preset']
        if preset_name not in PRESETS:
            return json_response({'ok': False, 'error': f'Unknown preset: {preset_name}'}, 400)
        new_config = PRESETS[preset_name].copy()
    else:
        new_config = {
            'host': data.get('host', 'localhost'),
            'user': data.get('user', 'root'),
            'password': data.get('password', ''),
            'database': data.get('database', 'mmrdb'),
            'ssl_disabled': data.get('ssl_disabled', False),
        }

    # Test the connection
    try:
        test_conn = mysql.connector.connect(
            host=new_config['host'],
            user=new_config['user'],
            password=new_config['password'],
            database=new_config['database'],
            ssl_disabled=new_config['ssl_disabled'],
            charset='utf8mb4',
            collation='utf8mb4_unicode_ci',
        )
        test_conn.close()
    except Exception as e:
        return json_response({
            'ok': False,
            'error': f'Connection failed: {str(e)[:200]}'
        }, 400)

    # Update global config
    with _db_config_lock:
        _db_config.update(new_config)

    return json_response({
        'ok': True,
        'message': f'Connected to {new_config["host"]}/{new_config["database"]}'
    })


# ===================================================================
# API: NYRR Events
# ===================================================================

@app.route('/api/events')
@login_required
def api_events():
    """List all NYRR events with optional filters."""
    status = request.args.get('status')
    year = request.args.get('year', type=int)
    search = request.args.get('q', '')

    sql = "SELECT * FROM nyrr_events WHERE 1=1"
    params = []

    if status:
        sql += " AND processing_status = %s"
        params.append(status)
    if year:
        sql += " AND event_year = %s"
        params.append(year)
    if search:
        sql += " AND (event_name LIKE %s OR event_code LIKE %s)"
        params.extend([f'%{search}%', f'%{search}%'])

    sql += " ORDER BY event_date DESC"
    rows = query(sql, params)

    # Add match percentage
    for r in rows:
        mmr = r.get('mmr_runner_count') or 0
        matched = r.get('mmr_matched_count') or 0
        r['match_pct'] = round(matched / mmr * 100, 1) if mmr > 0 else 0

    return json_response({'ok': True, 'data': rows})


@app.route('/api/events/<int:event_id>')
@login_required
def api_event_detail(event_id):
    """Single event detail."""
    rows = query("SELECT * FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Not found'}, 404)
    return json_response({'ok': True, 'data': rows[0]})


@app.route('/api/events/<int:event_id>/runners')
@login_required
def api_event_runners(event_id):
    """Runners for an event with optional filters."""
    team = request.args.get('team')
    matched_only = request.args.get('matched') == '1'
    unmatched_only = request.args.get('unmatched') == '1'
    search = request.args.get('q', '')

    sql = """
        SELECT er.*, e.event_code, e.event_name, e.event_date
        FROM nyrr_event_runners er
        JOIN nyrr_events e ON e.id = er.nyrr_event_id
        WHERE er.nyrr_event_id = %s
    """
    params: list = [event_id]

    if team:
        sql += " AND er.team_code = %s"
        params.append(team)
    if matched_only:
        sql += " AND er.mmr_member_id IS NOT NULL"
    if unmatched_only:
        sql += " AND er.mmr_member_id IS NULL AND er.team_code = %s"
        params.append(TEAM_CODE)
    if search:
        sql += " AND (er.runner_name LIKE %s OR er.last_name LIKE %s)"
        params.extend([f'%{search}%', f'%{search}%'])

    sql += " ORDER BY er.overall_place ASC, er.runner_name ASC"
    rows = query(sql, params)
    return json_response({'ok': True, 'data': rows, 'count': len(rows)})


# ===================================================================
# API: Summary stats
# ===================================================================

@app.route('/api/stats')
@login_required
def api_stats():
    """Dashboard summary stats."""
    rows = query("""
        SELECT
            COUNT(*) AS total_events,
            SUM(is_upcoming) AS upcoming_events,
            SUM(CASE WHEN processing_status = 'Pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN processing_status = 'InProgress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN processing_status = 'Completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN processing_status = 'Error' THEN 1 ELSE 0 END) AS errors,
            SUM(IFNULL(result_count, 0)) AS total_runners,
            SUM(IFNULL(mmr_runner_count, 0)) AS total_mmr_runners,
            SUM(IFNULL(mmr_matched_count, 0)) AS total_matched
        FROM nyrr_events
    """)
    return json_response({'ok': True, 'data': rows[0] if rows else {}})


@app.route('/api/stats/years')
@login_required
def api_stats_years():
    """Available event years."""
    rows = query("""
        SELECT DISTINCT event_year FROM nyrr_events
        WHERE event_year IS NOT NULL
        ORDER BY event_year DESC
    """)
    return json_response({'ok': True, 'data': [r['event_year'] for r in rows]})


# ===================================================================
# API: Processing log
# ===================================================================

@app.route('/api/log')
@login_required
def api_log():
    """Recent processing log entries."""
    limit = request.args.get('limit', 50, type=int)
    rows = query("""
        SELECT pl.*, e.event_code, e.event_name
        FROM nyrr_processing_log pl
        LEFT JOIN nyrr_events e ON e.id = pl.nyrr_event_id
        ORDER BY pl.run_timestamp DESC
        LIMIT %s
    """, [limit])
    return json_response({'ok': True, 'data': rows})


# ===================================================================
# API: Generic table browser
# ===================================================================

@app.route('/api/tables')
@login_required
def api_tables():
    """List all tables in the database."""
    rows = query("""
        SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, CREATE_TIME, UPDATE_TIME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
    """)
    return json_response({'ok': True, 'data': rows})


@app.route('/api/tables/<table_name>')
@login_required
def api_table_data(table_name):
    """Browse any table with pagination."""
    # Whitelist table names to prevent SQL injection
    allowed = query("""
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
    """)
    allowed_names = {r['TABLE_NAME'] for r in allowed}
    if table_name not in allowed_names:
        return json_response({'ok': False, 'error': 'Invalid table'}, 400)

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    per_page = min(per_page, 200)
    offset = (page - 1) * per_page
    sort = request.args.get('sort', '')
    order = 'DESC' if request.args.get('order', 'asc').lower() == 'desc' else 'ASC'

    # Get columns for this table
    cols = query("""
        SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
        ORDER BY ORDINAL_POSITION
    """, [table_name])
    col_names = [c['COLUMN_NAME'] for c in cols]

    # Validate sort column
    order_clause = ""
    if sort and sort in col_names:
        order_clause = f" ORDER BY `{sort}` {order}"
    elif 'id' in col_names:
        order_clause = f" ORDER BY `id` DESC"

    # Count
    count_rows = query(f"SELECT COUNT(*) AS cnt FROM `{table_name}`")
    total = count_rows[0]['cnt'] if count_rows else 0

    # Fetch page
    rows = query(
        f"SELECT * FROM `{table_name}`{order_clause} LIMIT %s OFFSET %s",
        [per_page, offset],
    )

    return json_response({
        'ok': True,
        'table': table_name,
        'columns': cols,
        'data': rows,
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'pages': (total + per_page - 1) // per_page,
        },
    })


# ===================================================================
# API: Trigger NYRR data load
# ===================================================================

@app.route('/api/load/<int:event_id>', methods=['POST'])
@login_required
def api_load_event(event_id):
    """
    Trigger loading runner results from the NYRR API for a specific event.
    Accepts scope ('team' or 'all') and force_reload flags.
    Runs in a background thread so the UI isn't blocked.
    """
    rows = query("SELECT * FROM nyrr_events WHERE id = %s", [event_id])
    if not rows:
        return json_response({'ok': False, 'error': 'Event not found'}, 404)

    event = rows[0]
    event_code = event['event_code']

    data = request.json or {}
    scope = data.get('scope', 'team')  # 'team' or 'all'
    force_reload = data.get('force_reload', False)

    if scope not in ('team', 'all'):
        return json_response({'ok': False, 'error': 'Invalid scope'}, 400)

    with _jobs_lock:
        if event_code in _jobs and _jobs[event_code].get('status') == 'running':
            return json_response({
                'ok': False,
                'error': f'Already loading {event_code}',
            }, 409)
        _jobs[event_code] = {
            'status': 'running',
            'started_at': datetime.utcnow().isoformat(),
            'rows_written': 0,
            'scope': scope,
            'message': 'Starting...',
        }

    thread = threading.Thread(
        target=_load_event_background,
        args=(event_id, event_code, scope, force_reload),
        daemon=True,
    )
    thread.start()

    return json_response({
        'ok': True,
        'message': f'Loading started for {event_code} (scope: {scope})',
        'event_code': event_code,
    })


@app.route('/api/load/<event_code>/status')
@login_required
def api_load_status(event_code):
    """Check status of a background load job."""
    with _jobs_lock:
        job = _jobs.get(event_code)
    if not job:
        return json_response({'ok': True, 'status': 'idle'})
    return json_response({'ok': True, **job})


def _load_event_background(event_id: int, event_code: str, scope: str = 'team', force_reload: bool = False):
    """
    Background worker: fetch runners from NYRR API (team or all) and upsert.
    If force_reload, delete existing runners first.
    """
    conn = None
    try:
        client = NyrrApiClient()
        conn = get_conn()
        conn.autocommit = False
        cursor = conn.cursor()

        # Mark InProgress
        cursor.execute("""
            UPDATE nyrr_events
            SET processing_status = 'InProgress', processed_by = 'Viewer', processed_at = NOW()
            WHERE id = %s
        """, (event_id,))
        conn.commit()

        # Handle force_reload: delete existing runners
        deleted_count = 0
        if force_reload:
            cursor.execute("""
                DELETE FROM nyrr_event_runners WHERE nyrr_event_id = %s
            """, (event_id,))
            deleted_count = cursor.rowcount
            conn.commit()

            with _jobs_lock:
                _jobs[event_code]['message'] = f'Re-syncing: deleted {deleted_count} existing rows, loading fresh...'
        else:
            with _jobs_lock:
                _jobs[event_code]['message'] = f'Fetching runners from NYRR API (scope: {scope})...'

        # Fetch runners
        if scope == 'all':
            runners = client.get_event_finishers(event_code)
        else:
            runners = client.get_team_runners(event_code, TEAM_CODE)

        with _jobs_lock:
            _jobs[event_code]['message'] = f'Got {len(runners)} runners. Upserting...'

        rows_written = 0
        for runner in runners:
            # Skip any entries where the NYRR API returned a blank runner_id (id=0);
            # these can't be uniquely keyed and would collide on the duplicate-key constraint.
            if not runner.runner_id:
                continue
            full_name = f"{runner.first_name} {runner.last_name}".strip()
            cursor.execute("""
                INSERT INTO nyrr_event_runners
                    (nyrr_event_id, nyrr_runner_id, runner_name, first_name, last_name,
                     age, gender, state_province, bib_number, finish_time, pace,
                     overall_place, gender_place, team_code, is_registered_only, scan_timestamp)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, NOW())
                ON DUPLICATE KEY UPDATE
                    runner_name = VALUES(runner_name),
                    first_name = VALUES(first_name),
                    last_name = VALUES(last_name),
                    age = VALUES(age),
                    gender = VALUES(gender),
                    state_province = VALUES(state_province),
                    bib_number = VALUES(bib_number),
                    finish_time = VALUES(finish_time),
                    pace = VALUES(pace),
                    overall_place = VALUES(overall_place),
                    gender_place = VALUES(gender_place),
                    team_code = VALUES(team_code),
                    scan_timestamp = NOW()
            """, (
                event_id,
                str(runner.runner_id),
                full_name,
                runner.first_name,
                runner.last_name,
                runner.age,
                runner.gender,
                runner.state_province,
                runner.bib,
                runner.overall_time,
                runner.pace,
                runner.overall_place,
                runner.gender_place,
                runner.team_code or '',
            ))
            rows_written += 1

        with _jobs_lock:
            _jobs[event_code]['rows_written'] = rows_written

        # Run Tier-1 auto-match (known NYRRRunnerName)
        with _jobs_lock:
            _jobs[event_code]['message'] = 'Running auto-matcher (Tier 1)...'

        cursor.execute("""
            UPDATE nyrr_event_runners er
            INNER JOIN members m
                ON LOWER(TRIM(er.runner_name)) = LOWER(TRIM(m.NYRRRunnerName))
            SET er.mmr_member_id = m.MemberID,
                er.match_method = 'auto_name',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND m.NYRRRunnerName IS NOT NULL
              AND m.NYRRRunnerName != ''
              AND er.nyrr_event_id = %s
        """, (event_id,))
        t1_matched = cursor.rowcount

        # Update event status + counters
        cursor.execute("""
            UPDATE nyrr_events
            SET processing_status = 'Completed',
                result_count = (
                    SELECT COUNT(*) FROM nyrr_event_runners WHERE nyrr_event_id = %s
                ),
                mmr_runner_count = (
                    SELECT COUNT(*) FROM nyrr_event_runners
                    WHERE nyrr_event_id = %s AND team_code = %s
                ),
                mmr_matched_count = (
                    SELECT COUNT(*) FROM nyrr_event_runners
                    WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
                ),
                processed_at = NOW()
            WHERE id = %s
        """, (event_id, event_id, TEAM_CODE, event_id, event_id))

        # Log
        cursor.execute("""
            INSERT INTO nyrr_processing_log
                (nyrr_event_id, triggered_by, run_status, rows_written)
            VALUES (%s, 'Viewer', 'Success', %s)
        """, (event_id, rows_written))

        conn.commit()
        cursor.close()

        msg = f'Done! {rows_written} runners loaded, {t1_matched} auto-matched.'
        if force_reload:
            msg = f'Re-synced: deleted {deleted_count} rows, loaded {rows_written} runners, {t1_matched} auto-matched.'

        with _jobs_lock:
            _jobs[event_code] = {
                'status': 'done',
                'rows_written': rows_written,
                'scope': scope,
                'auto_matched': t1_matched,
                'message': msg,
                'finished_at': datetime.utcnow().isoformat(),
            }

    except Exception as e:
        if conn:
            conn.rollback()
            try:
                cur2 = conn.cursor()
                cur2.execute("""
                    UPDATE nyrr_events
                    SET processing_status = 'Error', notes = %s
                    WHERE id = %s
                """, (str(e)[:500], event_id))
                cur2.execute("""
                    INSERT INTO nyrr_processing_log
                        (nyrr_event_id, triggered_by, run_status, rows_written, error_details)
                    VALUES (%s, 'Viewer', 'Failed', 0, %s)
                """, (event_id, str(e)[:2000]))
                conn.commit()
                cur2.close()
            except Exception:
                pass

        with _jobs_lock:
            _jobs[event_code] = {
                'status': 'error',
                'scope': scope,
                'message': str(e),
                'finished_at': datetime.utcnow().isoformat(),
            }
    finally:
        if conn:
            conn.close()


# ===================================================================
# API: Runner history
# ===================================================================

@app.route('/api/runner/<runner_id>/history')
@login_required
def api_runner_history(runner_id):
    """Get runner's race history from NYRR API (cached 1 hour)."""
    try:
        with _runner_history_lock:
            cached = _runner_history_cache.get(runner_id)
            if cached:
                timestamp, data = cached
                if time.time() - timestamp < RUNNER_HISTORY_CACHE_TTL:
                    return json_response({'ok': True, 'data': data, 'cached': True})

        client = NyrrApiClient()
        races = client.get_runner_races(runner_id)

        with _runner_history_lock:
            _runner_history_cache[runner_id] = (time.time(), races)

        return json_response({'ok': True, 'data': races, 'cached': False})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)[:300]}, 500)


# ===================================================================
# API: Discover new events from NYRR API
# ===================================================================

@app.route('/api/discover', methods=['POST'])
@login_required
def api_discover_events():
    """
    Fetch events from NYRR API for a given year and insert any new ones.
    """
    year = request.json.get('year', date.today().year) if request.is_json else date.today().year

    try:
        client = NyrrApiClient()
        api_events = client.search_events(year=year)
    except Exception as e:
        return json_response({'ok': False, 'error': f'NYRR API error: {e}'}, 502)

    conn = get_conn()
    cursor = conn.cursor()

    # Existing codes
    cursor.execute("SELECT event_code FROM nyrr_events")
    existing = {r[0] for r in cursor.fetchall()}

    new_count = 0
    for ev in api_events:
        if ev.event_code in existing:
            continue

        event_date_str = ev.start_date_time.split('T')[0] if ev.start_date_time else None
        try:
            event_date_obj = date.fromisoformat(event_date_str) if event_date_str else None
        except ValueError:
            event_date_obj = None
        upcoming = (event_date_obj > date.today()) if event_date_obj else False
        event_year = event_date_obj.year if event_date_obj else year

        cursor.execute("""
            INSERT INTO nyrr_events
                (event_code, event_name, event_url, location, distance,
                 event_date, event_year, is_upcoming, is_virtual, processing_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'Pending')
            ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
        """, (
            ev.event_code,
            ev.event_name,
            f"https://results.nyrr.org/events/{ev.event_code}",
            ev.venue,
            ev.distance_unit_code,
            event_date_str,
            event_year,
            int(upcoming),
            int(ev.is_virtual),
        ))
        existing.add(ev.event_code)
        new_count += 1

    conn.commit()
    cursor.close()
    conn.close()

    return json_response({
        'ok': True,
        'year': year,
        'api_total': len(api_events),
        'new_inserted': new_count,
    })


# ===================================================================
# Main
# ===================================================================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    print(f'\n  NYRR Data Viewer starting on http://localhost:{port}\n')
    app.run(host='0.0.0.0', port=port, debug=True)
