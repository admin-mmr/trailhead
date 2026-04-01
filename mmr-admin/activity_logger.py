"""
Activity logging helper for mmr-admin.

Replaces the 3 identical activity_log INSERT blocks in payment_actions.py
(and any future callers).

Leaf module — imports only from db and core.
"""

from __future__ import annotations

from db import execute
from core import gen_id


def log_activity(
    action:      str,
    member_id:   str = '',
    admin_email: str = '',
    event_id:    str = '',
    state:       str = '',
) -> None:
    """
    Insert one row into activity_log.

    Args:
        action:      e.g. 'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'MANUAL_MATCH'
        member_id:   MemberID of the affected member (may be empty)
        admin_email: Email of the admin who triggered the action
        event_id:    EventID of the related webapp_event (may be empty)
        state:       Short descriptor string, e.g. 'intent=Family Membership,amount=30'
    """
    execute(
        """
        INSERT INTO activity_log
            (LogID, Timestamp, MemberID, Email, EventID, Action, State)
        VALUES (%s, NOW(), %s, %s, %s, %s, %s)
        """,
        [
            gen_id('AL'),
            member_id  or None,
            admin_email or None,
            event_id   or None,
            action,
            state[:500] if state else None,
        ],
    )
