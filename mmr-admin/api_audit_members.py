"""
Member data-quality audit routes.

Blueprint: audit_members_bp
Prefix: /api/audit

Routes:
  POST /api/audit/reconcile        — fix payment/status/expiration drift for paid members
  GET  /api/audit/expiration-drift — find unpaid members whose expiration changed w/o override
"""

from __future__ import annotations

import logging
from flask import Blueprint, request

from auth import login_required, require_role
from db import query
from helpers import json_response, handle_api_errors
from api_audit import _serialize_for_json

logger = logging.getLogger(__name__)

audit_members_bp = Blueprint('audit_members', __name__)


# ─────────────────────────────────────────────────────────────────────────
# Reconcile
# ─────────────────────────────────────────────────────────────────────────

@audit_members_bp.route('/api/audit/reconcile', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_reconcile_payments():
    """
    Run sp_reconcile_member_payments to fix members whose expiration/status
    is out of sync with their actual payment records.

    Request body:
      { "dry_run": true }   → preview only (returns rows that would change)
      { "dry_run": false }  → execute updates (returns SUCCESS + affected rows)

    Uses config table for MembershipCollectionStart and MembershipYearEnd.
    """
    data    = request.get_json(silent=True) or {}
    dry_run = bool(data.get('dry_run', True))   # default safe: dry run

    logger.info(f"Reconcile payments: dry_run={dry_run}")

    try:
        results    = query("CALL sp_reconcile_member_payments(%s)", [dry_run])
        serialized = _serialize_for_json(results or [])
        return json_response({
            'success': True,
            'dry_run': dry_run,
            'rows':    serialized,
            'count':   len(serialized),
        })
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Reconcile error: {error_msg}")
        return json_response({'success': False, 'error': error_msg}, 500)


# ─────────────────────────────────────────────────────────────────────────
# Expiration Drift
# ─────────────────────────────────────────────────────────────────────────

@audit_members_bp.route('/api/audit/expiration-drift', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_expiration_drift():
    """
    Find members whose expiration changed from their first member_log entry
    but have no payment record (individually or across their entire family),
    and no admin override to justify the change.

    Query params:
      type:      'individual' | 'family' | 'all'  (default: 'all')
      flag_only: '1' to return only ⚠ UNEXPLAINED rows  (default: 0)

    Response fields per row:
      member_id, member_name, member_type, family_id, current_status,
      first_log_expiration, current_expiration,
      exp_drift ('ok' | 'CHANGED' | 'no log'),
      has_override ('YES' | 'NO'),
      flag ('' | '⚠ UNEXPLAINED')
    """
    member_type = request.args.get('type', 'all').lower()
    flag_only   = request.args.get('flag_only', '0') == '1'

    # ── Individual: Type='Individual', no FamilyID, no payments ──────────
    individual_sql = """
        SELECT
            m.MemberID                               AS member_id,
            CONCAT(m.FirstName, ' ', m.LastName)     AS member_name,
            m.Type                                   AS member_type,
            NULL                                     AS family_id,
            m.Status                                 AS current_status,
            first_log.Expiration                     AS first_log_expiration,
            m.Expiration                             AS current_expiration,
            CASE
                WHEN first_log.Expiration IS NULL        THEN 'no log'
                WHEN first_log.Expiration = m.Expiration THEN 'ok'
                ELSE 'CHANGED'
            END                                      AS exp_drift,
            CASE WHEN EXISTS (
                SELECT 1 FROM admin_member_overrides ao
                WHERE ao.ActionType != 'REVERT'
                  AND (ao.TargetMemberID = m.MemberID
                       OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0)
            ) THEN 'YES' ELSE 'NO' END               AS has_override,
            CASE
                WHEN first_log.Expiration IS NOT NULL
                     AND first_log.Expiration <> m.Expiration
                     AND NOT EXISTS (
                         SELECT 1 FROM admin_member_overrides ao
                         WHERE ao.ActionType != 'REVERT'
                           AND (ao.TargetMemberID = m.MemberID
                                OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0)
                     )
                THEN '⚠ UNEXPLAINED'
                ELSE ''
            END                                      AS flag
        FROM members m
        LEFT JOIN payments p ON p.MemberID = m.MemberID
        LEFT JOIN (
            SELECT ml.MemberID, ml.Expiration
            FROM member_log ml
            WHERE ml.LoggingTime = (
                SELECT MIN(ml2.LoggingTime) FROM member_log ml2
                WHERE ml2.MemberID = ml.MemberID
            )
        ) first_log ON first_log.MemberID = m.MemberID
        WHERE m.Type = 'Individual'
          AND (m.FamilyID IS NULL OR m.FamilyID = '')
          AND p.MemberID IS NULL
        ORDER BY flag DESC, exp_drift DESC, m.LastName, m.FirstName
    """

    # ── Family: entire family has zero payments ───────────────────────────
    family_sql = """
        SELECT
            m.MemberID                               AS member_id,
            CONCAT(m.FirstName, ' ', m.LastName)     AS member_name,
            m.Type                                   AS member_type,
            m.FamilyID                               AS family_id,
            m.Status                                 AS current_status,
            first_log.Expiration                     AS first_log_expiration,
            m.Expiration                             AS current_expiration,
            CASE
                WHEN first_log.Expiration IS NULL        THEN 'no log'
                WHEN first_log.Expiration = m.Expiration THEN 'ok'
                ELSE 'CHANGED'
            END                                      AS exp_drift,
            CASE WHEN EXISTS (
                SELECT 1 FROM admin_member_overrides ao
                WHERE ao.ActionType != 'REVERT'
                  AND (ao.TargetMemberID = m.MemberID
                       OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0)
            ) THEN 'YES' ELSE 'NO' END               AS has_override,
            CASE
                WHEN first_log.Expiration IS NOT NULL
                     AND first_log.Expiration <> m.Expiration
                     AND NOT EXISTS (
                         SELECT 1 FROM admin_member_overrides ao
                         WHERE ao.ActionType != 'REVERT'
                           AND (ao.TargetMemberID = m.MemberID
                                OR FIND_IN_SET(m.MemberID, ao.ImpactedMemberIDs) > 0)
                     )
                THEN '⚠ UNEXPLAINED'
                ELSE ''
            END                                      AS flag
        FROM members m
        LEFT JOIN (
            SELECT ml.MemberID, ml.Expiration
            FROM member_log ml
            WHERE ml.LoggingTime = (
                SELECT MIN(ml2.LoggingTime) FROM member_log ml2
                WHERE ml2.MemberID = ml.MemberID
            )
        ) first_log ON first_log.MemberID = m.MemberID
        WHERE m.FamilyID IS NOT NULL
          AND m.FamilyID != ''
          AND m.FamilyID NOT IN (
              SELECT DISTINCT fam.FamilyID
              FROM members fam
              INNER JOIN payments fp ON fp.MemberID = fam.MemberID
              WHERE fam.FamilyID IS NOT NULL AND fam.FamilyID != ''
          )
        ORDER BY flag DESC, m.FamilyID, m.MemberID
    """

    rows: list[dict] = []
    if member_type in ('individual', 'all'):
        rows += query(individual_sql) or []
    if member_type in ('family', 'all'):
        rows += query(family_sql) or []

    serialized = _serialize_for_json(rows)
    if flag_only:
        serialized = [r for r in serialized if r.get('flag') == '⚠ UNEXPLAINED']

    unexplained = sum(1 for r in serialized if r.get('flag') == '⚠ UNEXPLAINED')
    changed     = sum(1 for r in serialized if r.get('exp_drift') == 'CHANGED')

    logger.info(f"Expiration drift: {len(serialized)} rows, {unexplained} unexplained, type={member_type}")

    return json_response({
        'success':     True,
        'count':       len(serialized),
        'unexplained': unexplained,
        'changed':     changed,
        'type_filter': member_type,
        'flag_only':   flag_only,
        'rows':        serialized,
    })
