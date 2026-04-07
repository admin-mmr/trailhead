"""
sync_types.py — Dataclasses, enums, and type definitions for sync operations.

Provides:
  - STANDARD_TABLES, MEMBERS_SYNC_COLUMNS, IMMUTABLE_ON_UPDATE: Config constants
  - SyncDecision, GmailSyncAction, SyncAudit, SyncRowResult: Dataclasses
"""

from __future__ import annotations
import json, logging
from dataclasses import dataclass, field
from typing import Optional, Any

logger = logging.getLogger(__name__)

STANDARD_TABLES = {
    'members': {'primary_key': 'MemberID'},
    'submissions': {'primary_key': 'SubmissionID'},
    'gmail_transactions': {'primary_key': 'MessageId'},
}

MEMBERS_SYNC_COLUMNS = [
    'MemberID', 'FirstName', 'LastName', 'Email', 'WeChatID', 'Gender', 'District',
    'Type', 'Expiration', 'Status', 'InvitedBy', 'Notes', 'CreatedAt'
]

IMMUTABLE_ON_UPDATE = {'MemberID', 'SubmissionID', 'MessageId', 'CreatedAt'}

@dataclass
class SyncDecision:
    """Represents a resolution choice in conflict resolution."""
    reason: str
    precedence: int  # 0 = neither, 1 = db, 2 = sheet
    value: Any = None
    source: str = ''

@dataclass
class GmailSyncAction:
    """Gmail sync action metadata."""
    message_id: str
    action: str
    status: str
    timestamp: str
    note: str = ''

@dataclass
class SyncAudit:
    """Audit trail for sync operations."""
    table: str
    operation: str
    pk_value: Any
    changes: dict = field(default_factory=dict)
    status: str = 'pending'
    timestamp: str = ''
    error: str = ''

    def log(self, msg: str):
        logger.info(f"[{self.table}] {msg}")

    def to_dict(self):
        return {
            'table': self.table, 'operation': self.operation, 'pk_value': self.pk_value,
            'changes': self.changes, 'status': self.status, 'error': self.error
        }

    def __str__(self):
        return f"{self.table}.{self.operation}({self.pk_value}): {self.status}"

@dataclass
class SyncRowResult:
    """Result of syncing a single row."""
    table: str
    pk_value: Any
    action: str  # 'insert', 'update', 'skip'
    timestamp: str = ''
    message: str = ''
    error: Optional[str] = None
