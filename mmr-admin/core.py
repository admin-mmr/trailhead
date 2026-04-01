"""
Core utilities for mmr-admin.

Leaf module — no imports from other mmr-admin modules.
Provides: gen_id (collision-safe ID generation).
"""

from __future__ import annotations

import random
import time


def gen_id(prefix: str) -> str:
    """
    Generate a unique ID like EV-1711234567890-4827.

    Uses random.randint (not time-derived) for the suffix to avoid
    collisions when called multiple times within the same millisecond.
    """
    ts   = int(time.time() * 1000)
    rand = random.randint(0, 9999)
    return f'{prefix}-{ts}-{rand:04d}'
