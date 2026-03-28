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

import os

# ---------------------------------------------------------------------------
# Auto-load web-apps/mmr-webapp/.env.local so OAuth + DB creds are shared.
# Shell-level env vars always take precedence (override=False).
# Skip on Azure (WEBSITE_SITE_NAME is set) — env comes from App Settings.
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
_ON_AZURE = bool(os.environ.get('WEBSITE_SITE_NAME'))

if not _ON_AZURE:
    _WEBAPP_ENV = os.path.join(_HERE, '..', '..', 'web-apps', 'mmr-webapp', '.env.local')
    try:
        from dotenv import load_dotenv
        if os.path.exists(_WEBAPP_ENV):
            load_dotenv(_WEBAPP_ENV, override=False)
            print('  ✓ Loaded shared env from mmr-webapp/.env.local', flush=True)
        else:
            print('  ⚠  mmr-webapp/.env.local not found — OAuth vars must be set manually', flush=True)
    except ImportError:
        print('  ⚠  python-dotenv not installed — run: pip install python-dotenv', flush=True)

from flask import Flask, send_file

# ---------------------------------------------------------------------------
# Create Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-prod')
app.json.sort_keys = False

# ---------------------------------------------------------------------------
# Initialize database tables
# ---------------------------------------------------------------------------

from db import init_tables
init_tables()

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

from api_runners import runners_bp
app.register_blueprint(runners_bp)

from api_data import data_bp
app.register_blueprint(data_bp)

from api_sync import sync_bp
app.register_blueprint(sync_bp)

from api_payments import payments_bp
app.register_blueprint(payments_bp)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5050))
    print(f'\n  NYRR Data Viewer starting on http://localhost:{port}\n')
    app.run(host='0.0.0.0', port=port, debug=True)
