"""
sync_coerce.py — Type coercion utilities for Sheets ↔ MySQL sync.

Handles mapping and validation of data types between Google Sheets and MySQL,
particularly for ENUM fields where values differ (e.g., 'inactive' → 'not active').

Used by: test_sync_status.py, sync operations
"""

from __future__ import annotations
from typing import Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Member Status Coercion (Bug #1: ENUM truncation)
# ─────────────────────────────────────────────────────────────────────────────

# MySQL members.Status ENUM values
_MEMBER_STATUS_ENUM = {'active', 'not active', 'pending'}

# Mapping from Sheets/GAS values → MySQL ENUM values
# Handles case normalization and semantic mapping (e.g., 'inactive' → 'not active')
_MEMBER_STATUS_MAP = {
    'active': 'active',
    'Active': 'active',
    'ACTIVE': 'active',
    'not active': 'not active',
    'Not Active': 'not active',
    'NOT ACTIVE': 'not active',
    'inactive': 'not active',  # GAS uses 'inactive'; MySQL has 'not active'
    'Inactive': 'not active',
    'INACTIVE': 'not active',
    'expired': 'not active',    # Logical mapping: expired → not active
    'Expired': 'not active',
    'EXPIRED': 'not active',
    'pending': 'pending',
    'Pending': 'pending',
    'PENDING': 'pending',
    'pending_upgrade': 'pending',  # GAS uses 'pending_upgrade'; maps to 'pending'
    'Pending_Upgrade': 'pending',
    'PENDING_UPGRADE': 'pending',
}


def _coerce_member_status(value: any) -> Tuple[Optional[str], Optional[str]]:
    """
    Coerce a member status value from Sheets/GAS to MySQL ENUM.

    Args:
        value: Raw status value from Sheets or user input

    Returns:
        (mysql_value, warning_message)
        - mysql_value: Valid MySQL ENUM value, or None if invalid
        - warning_message: Warning if value was unknown, otherwise None
    """
    # Handle None and empty strings
    if value is None or value == '':
        return None, None

    # Convert to string and strip whitespace
    val_str = str(value).strip()

    # Empty after strip
    if not val_str:
        return None, None

    # Direct lookup (exact match with case)
    if val_str in _MEMBER_STATUS_MAP:
        return _MEMBER_STATUS_MAP[val_str], None

    # Fallback: try case-insensitive lookup by lowercasing
    val_lower = val_str.lower()
    for key, mapped in _MEMBER_STATUS_MAP.items():
        if key.lower() == val_lower:
            return mapped, None

    # Unknown value: return None with warning
    warning = f"Unknown member status '{val_str}' — expected one of {_MEMBER_STATUS_ENUM}"
    return None, warning
