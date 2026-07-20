"""
Auth configuration constants for mmr-admin.

Read once at import time from the environment. Kept in a dedicated module so
both ``auth`` and its sibling helpers (``auth_oauth``, ``auth_login_page``) can
share the same values without circular imports.

NOTE: ``auth`` re-imports every name here, so ``auth.DEV_BYPASS_AUTH`` (etc.)
remain importable and patchable exactly as before.
"""

from __future__ import annotations

import os

DEV_BYPASS_AUTH = os.environ.get('DEV_BYPASS_AUTH', 'false').lower() == 'true'
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
MS_CLIENT_ID = os.environ.get('MICROSOFT_CLIENT_ID', '')
MS_CLIENT_SECRET = os.environ.get('MICROSOFT_CLIENT_SECRET', '')
VIEWER_BASE_URL = os.environ.get('VIEWER_BASE_URL', 'http://localhost:5050').rstrip('/')
