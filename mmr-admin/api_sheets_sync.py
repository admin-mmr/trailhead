"""
api_sheets_sync.py — LEGACY FILE (DEPRECATED)

This file contains legacy sync code that has been refactored into:
  - api_sheets_sync_routes.py: Flask routes for Sheets ↔ MySQL sync
  - sync_runners.py: Individual sync job runners
  - sync_config.py (in basecamp/python/): Configuration and generic runner
  - sync_coerce.py: Type coercion utilities (member status, values)

ONLY the blueprint registration and utility re-exports below are active.
All endpoint logic has been moved to api_sheets_sync_routes.py.

For new feature development, use:
  1. api_sheets_sync_routes.py for Flask routes
  2. sync_runners.py for job implementations
  3. sync_config.py for configuration
  4. sync_coerce.py for data type coercion

DO NOT add new code to this file.
"""

from flask import Blueprint
from auth import login_required
from helpers import json_response
from sync_jobs import list_jobs as list_sync_jobs, get_job

# Re-export utilities for backwards compatibility (tests, external code)
from sync_coerce import (
    _coerce_member_status,
    _MEMBER_STATUS_ENUM,
    _MEMBER_STATUS_MAP,
)

# Re-export the blueprint for backwards compatibility
# (but the actual routes are defined in api_sheets_sync_routes.py)
sheets_sync_bp = Blueprint('sheets_sync', __name__)


