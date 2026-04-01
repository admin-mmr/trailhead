"""
Thread-safe, session-level config cache for mmr-admin.

Replaces the 5 independent get_config() implementations scattered across:
  payment_handlers.py, payment_actions.py, api_sheets_sync.py,
  sheets_sync.py, webhook_client.py, api_sheets_diags.py

Usage:
    from config_cache import get_config, refresh_config

    # Get all keys as dict
    cfg = get_config()

    # Get single key with default
    year_end = get_config('MembershipYearEnd', '')
    price    = int(get_config('IndividualPrice', '30'))

    # Force refresh (e.g. after admin config update)
    refresh_config()
"""

from __future__ import annotations

import threading
from typing import Dict, Optional, Union

from db import query

_cache: Dict[str, str] = {}
_lock  = threading.Lock()


def get_config(
    key: Optional[str] = None,
    default: str = '',
) -> Union[str, Dict[str, str]]:
    """
    Return config value(s) from the database config table.

    - get_config()         → dict of all key/value pairs
    - get_config('Key')    → str value, or '' if missing
    - get_config('Key', x) → str value, or x if missing
    """
    with _lock:
        if not _cache:
            rows = query("SELECT ConfigKey, ConfigValue FROM config")
            _cache.update({r['ConfigKey']: (r['ConfigValue'] or '') for r in rows})

    if key is None:
        return dict(_cache)
    return _cache.get(key, default)


def refresh_config() -> None:
    """Clear the cache so the next get_config() call re-fetches from the DB."""
    with _lock:
        _cache.clear()
