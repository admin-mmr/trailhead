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

import os, sys

# ---------------------------------------------------------------------------
# Auto-load web-apps/mmr-webapp/.env.local so OAuth + DB creds are shared.
# Shell-level env vars always take precedence (override=False).
# Skip on Azure (WEBSITE_SITE_NAME is set) — env comes from App Settings.
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
_ON_AZURE = bool(os.environ.get('WEBSITE_SITE_NAME'))

if not _ON_AZURE:
    # Add basecamp/python to path for local development
    basecamp_path = os.path.abspath(os.path.join(_HERE, '..', 'basecamp', 'python'))  
    sys.path.insert(0, basecamp_path)
    
    _WEBAPP_ENV = os.path.join(_HERE, '..', 'web-apps', 'mmr-webapp', '.env.local')
    try:
        from dotenv import load_dotenv
        if os.path.exists(_WEBAPP_ENV):
            load_dotenv(_WEBAPP_ENV, override=False)
            print('  ✓ Loaded shared env from mmr-webapp/.env.local', flush=True)
        else:
            print('  ⚠  mmr-webapp/.env.local not found — OAuth vars must be set manually', flush=True)
    except ImportError:
        print('  ⚠  python-dotenv not installed — run: pip install python-dotenv', flush=True)

    # Load secrets from Keychain (macOS only) that aren't in .env.local
    import subprocess, shutil
    # Do not run keychain I/O during import tests, as it can hang waiting
    # for user input that will never come.
    if 'test_imports.py' not in sys.argv[0]:
        if shutil.which('security'):
            keychain_vars = ['MMR_DATABASE_URL']
            for kchn_name in keychain_vars:
                env_name = kchn_name.replace('MMR_', '')
                if not os.environ.get(env_name, '').strip():
                    result = subprocess.run(
                        ['security', 'find-generic-password', '-s', kchn_name, '-w'],
                        capture_output=True, text=True
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        os.environ[env_name] = result.stdout.strip()
                        print(f'  ✓ {env_name} loaded from Keychain ({kchn_name})', flush=True)
        else:
            print('  ⚠  security command not found — Keychain secrets unavailable', flush=True)

from flask import Flask, send_file

# ---------------------------------------------------------------------------
# Create Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-prod')
app.json.sort_keys = False

# ---------------------------------------------------------------------------
# Logging — ensure DEBUG lines reach Azure App Service log stream.
# Set LOG_LEVEL=DEBUG in App Service Application Settings to enable verbose
# payment debug logs (auto-match details, per-row rejection reasons, etc.).
# Defaults to INFO so prod isn't flooded unless you need it.
# ---------------------------------------------------------------------------
import logging as _logging
_log_level = getattr(_logging, os.environ.get('LOG_LEVEL', 'INFO').upper(), _logging.INFO)
_logging.basicConfig(
    level=_log_level,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
)
# Always show INFO+ for payment modules regardless of global level
for _mod in ('payment_actions', 'api_payments', 'payment_handlers'):
    _logging.getLogger(_mod).setLevel(min(_log_level, _logging.INFO))

# ---------------------------------------------------------------------------
# Initialize database tables
# ---------------------------------------------------------------------------

from db import init_tables

# ---------------------------------------------------------------------------
# Register error handlers & middleware
# ---------------------------------------------------------------------------

from helpers import register_error_handlers
register_error_handlers(app)

# ---------------------------------------------------------------------------
# Index page (the only non-blueprint route)
# ---------------------------------------------------------------------------

from auth import auth_bp, login_required


@app.route('/')
@login_required
def index():
    template_path = os.path.join(os.path.dirname(__file__), 'templates', 'index.html')
    return send_file(template_path, mimetype='text/html')


@app.route('/templates/<path:filename>')
def serve_template(filename):
    """Serve React component templates (html files loaded via Babel)."""
    template_path = os.path.join(os.path.dirname(__file__), 'templates', filename)
    return send_file(template_path, mimetype='text/html')


@app.route('/favicon.ico')
def favicon():
    return '', 204


# ---------------------------------------------------------------------------
# Register blueprints
# ---------------------------------------------------------------------------

app.register_blueprint(auth_bp)

from api_admin import admin_bp
app.register_blueprint(admin_bp)

from api_events import events_bp
app.register_blueprint(events_bp)

from api_events_discovery import events_discovery_bp
app.register_blueprint(events_discovery_bp)

from api_events_fuzzy import events_fuzzy_bp
app.register_blueprint(events_fuzzy_bp)

from api_runners import runners_bp
app.register_blueprint(runners_bp)

from api_nyrr_match import nyrr_match_bp
app.register_blueprint(nyrr_match_bp)

from api_nyrr_reconcile import nyrr_reconcile_bp
app.register_blueprint(nyrr_reconcile_bp)

from api_data import data_bp
app.register_blueprint(data_bp)

from api_sync import sync_bp
app.register_blueprint(sync_bp)

from api_payments import payments_bp
app.register_blueprint(payments_bp)

from api_members import members_bp
from api_members_status import members_status_bp
from api_members_family import members_family_bp
from api_members_district import members_district_bp
from api_members_duplicates import members_duplicates_bp
app.register_blueprint(members_bp)
app.register_blueprint(members_status_bp)
app.register_blueprint(members_family_bp)
app.register_blueprint(members_district_bp)
app.register_blueprint(members_duplicates_bp)

from api_district_members import district_members_bp
from api_district_export import district_export_bp
app.register_blueprint(district_members_bp)
app.register_blueprint(district_export_bp)

from api_query import query_bp
app.register_blueprint(query_bp)

from api_sheets_sync_routes import sheets_sync_bp
app.register_blueprint(sheets_sync_bp)

from api_python_exec import py_exec_bp
app.register_blueprint(py_exec_bp)

from api_schema import schema_bp
app.register_blueprint(schema_bp)

from api_audit import audit_bp
app.register_blueprint(audit_bp)
from api_audit_members import audit_members_bp
app.register_blueprint(audit_members_bp)
from api_hof import hof_bp
app.register_blueprint(hof_bp)


# ---------------------------------------------------------------------------
# NYRR automation scheduler (runs in-process on App Service; replaces the
# GitHub Actions NYRR sync). No-op unless ENABLE_NYRR_SCHEDULER=1.
# ---------------------------------------------------------------------------
if 'test_imports.py' not in sys.argv[0]:
    try:
        from nyrr_scheduler import init_scheduler
        init_scheduler()
    except Exception:
        _logging.getLogger(__name__).exception('Failed to start NYRR scheduler')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    init_tables()
    port = int(os.environ.get('PORT', 5050))
    print(f'\n  NYRR Data Viewer starting on http://localhost:{port}\n')
    app.run(host='0.0.0.0', port=port, debug=True)
