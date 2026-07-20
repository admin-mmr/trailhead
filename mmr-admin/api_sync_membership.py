"""
Membership-data sync routes for mmr-admin (split from api_sync.py).

Two admin-triggered maintenance jobs that reconcile the members table against
other MySQL tables:
  * /api/sync/membership-fees      — copy latest membership payment into members
  * /api/sync/members-lastupdated  — bump members.UpdatedAt from member_log

Routes are registered onto the shared ``sync_bp`` blueprint via
``register_membership_sync_routes(sync_bp)`` (called from api_sync.py).
Pure move — behavior/SQL unchanged.
"""

from __future__ import annotations

import logging
import traceback

import mysql.connector.errors

from flask import request

from auth import login_required
from db import query, get_conn
from helpers import json_response

logger = logging.getLogger(__name__)


def register_membership_sync_routes(sync_bp):
    """Attach the membership-data sync routes to the shared blueprint."""

    @sync_bp.route('/api/sync/membership-fees', methods=['POST'])
    @login_required
    def api_sync_membership_fees():
        """
        Sync membership fee payment data from payments table to members table.
        For each member with a membership payment (Individual or Family),
        update MembershipFeePaid, PaymentDate, and PaymentTransaction if the
        new payment date is more recent than what's currently in members.

        Request JSON (optional):
          {
            "memberID": "M001"  // optional: sync only specific member
          }

        Response:
          {
            "ok": true,
            "message": "Synced N member(s)",
            "stats": {
              "checked": N,
              "updated": N,
              "errors": N
            }
          }
        """
        logger.info("🔄 api_sync_membership_fees called")

        try:
            request_data = request.get_json() or {}
            member_id_filter = request_data.get('memberID')

            # Build query for payments with membership type
            payments_sql = """
                SELECT
                  p.MemberID,
                  p.Amount,
                  p.PaymentDate,
                  p.TransactionNumber,
                  ROW_NUMBER() OVER (PARTITION BY p.MemberID ORDER BY p.PaymentDate DESC) as rn
                FROM payments p
                WHERE p.PaymentType IN ('Individual Membership', 'Family Membership')
                  AND p.MemberID IS NOT NULL
                  AND p.PaymentDate IS NOT NULL
            """
            params = []

            if member_id_filter:
                payments_sql += " AND p.MemberID = %s"
                params.append(member_id_filter)

            # Get only the most recent payment per member
            payments_sql = f"SELECT * FROM ({payments_sql}) ranked WHERE rn = 1"

            logger.debug(f"Executing query: {payments_sql}")
            payments = query(payments_sql, params)
            logger.info(f"Found {len(payments)} members with recent membership payments")

            if not payments:
                return json_response({
                    'ok': True,
                    'message': 'No membership payments to sync',
                    'stats': {
                        'checked': 0,
                        'updated': 0,
                        'errors': 0
                    }
                })

            # Get current members data to check if update is needed
            member_ids = [p['MemberID'] for p in payments]
            member_ids_str = ','.join(['%s'] * len(member_ids))
            members_sql = f"""
                SELECT MemberID, PaymentDate
                FROM members
                WHERE MemberID IN ({member_ids_str})
            """
            members = query(members_sql, member_ids)
            members_dict = {m['MemberID']: m['PaymentDate'] for m in members}

            # Update members table for payments newer than current data
            checked = 0
            updated = 0
            errors = 0
            conn = None

            try:
                conn = get_conn()
                cursor = conn.cursor()

                for payment in payments:
                    member_id = payment['MemberID']
                    current_date = members_dict.get(member_id)
                    new_date = payment['PaymentDate']

                    # Only update if: no current date OR new date is more recent
                    should_update = current_date is None or new_date > current_date

                    checked += 1

                    if should_update:
                        update_sql = """
                            UPDATE members
                            SET
                              MembershipFeePaid = %s,
                              PaymentDate = %s,
                              PaymentTransaction = %s,
                              UpdatedAt = NOW()
                            WHERE MemberID = %s
                        """
                        try:
                            cursor.execute(update_sql, [
                                payment['Amount'],
                                payment['PaymentDate'],
                                payment['TransactionReference'],
                                member_id
                            ])
                            updated += cursor.rowcount
                            logger.debug(f"  ✓ Updated {member_id}: fee={payment['Amount']}, date={payment['PaymentDate']}")
                        except mysql.connector.errors.Error as e:
                            errors += 1
                            logger.error(f"  ✗ Error updating {member_id}: {e}")
                    else:
                        logger.debug(f"  ⊘ Skipped {member_id}: existing date {current_date} >= {new_date}")

                conn.commit()
                logger.info(f"✅ Membership fee sync complete: {updated}/{checked} updated, {errors} errors")

            except Exception as e:
                if conn:
                    conn.rollback()
                errors += len(payments) - updated
                logger.error(f"❌ Database error during sync: {e}")
                raise

            finally:
                if conn:
                    try:
                        cursor.close()
                    except:
                        pass
                    try:
                        conn.close()
                    except:
                        pass

            return json_response({
                'ok': True,
                'message': f'Synced {updated} member(s)',
                'stats': {
                    'checked': checked,
                    'updated': updated,
                    'errors': errors
                }
            })

        except Exception as e:
            logger.error(f"❌ Membership fee sync failed: {type(e).__name__}: {e}")
            logger.error(traceback.format_exc())
            return json_response({
                'ok': False,
                'error': str(e),
                'message': 'Sync failed'
            }, 500)

    @sync_bp.route('/api/sync/members-lastupdated', methods=['POST'])
    @login_required
    def api_sync_members_lastupdated():
        """
        Sync LastUpdated column in members table from member_log audit trail.
        For each member, if the most recent LoggingTime in member_log is newer than
        the current LastUpdated in members, updates LastUpdated to that LoggingTime.

        Request JSON (optional):
          {
            "memberID": "M001"  // optional: sync only specific member
          }

        Response:
          {
            "ok": true,
            "message": "Synced N member(s)",
            "stats": {
              "checked": N,
              "updated": N,
              "errors": N
            }
          }
        """
        logger.info("🔄 api_sync_members_lastupdated called")

        try:
            request_data = request.get_json() or {}
            member_id_filter = request_data.get('memberID')

            # Build query for most recent log entry per member
            logs_sql = """
                SELECT
                  ml.MemberID,
                  MAX(ml.LoggingTime) as LatestLogTime,
                  ROW_NUMBER() OVER (PARTITION BY ml.MemberID ORDER BY ml.LoggingTime DESC) as rn
                FROM member_log ml
                WHERE ml.MemberID IS NOT NULL
                  AND ml.LoggingTime IS NOT NULL
            """
            params = []

            if member_id_filter:
                logs_sql += " AND ml.MemberID = %s"
                params.append(member_id_filter)

            logs_sql += " GROUP BY ml.MemberID"

            logger.debug(f"Executing query: {logs_sql}")
            logs = query(logs_sql, params)
            logger.info(f"Found {len(logs)} members with log entries")

            if not logs:
                return json_response({
                    'ok': True,
                    'message': 'No member log entries to sync',
                    'stats': {
                        'checked': 0,
                        'updated': 0,
                        'errors': 0
                    }
                })

            # Get current members data to check if update is needed
            member_ids = [m['MemberID'] for m in logs]
            member_ids_str = ','.join(['%s'] * len(member_ids))
            members_sql = f"""
                SELECT MemberID, UpdatedAt
                FROM members
                WHERE MemberID IN ({member_ids_str})
            """
            members = query(members_sql, member_ids)
            members_dict = {m['MemberID']: m['UpdatedAt'] for m in members}

            # Update members table for log entries newer than current LastUpdated
            checked = 0
            updated = 0
            errors = 0
            conn = None

            try:
                conn = get_conn()
                cursor = conn.cursor()

                for log in logs:
                    member_id = log['MemberID']
                    current_lastupdated = members_dict.get(member_id)
                    new_lastupdated = log['LatestLogTime']

                    # Only update if: no current LastUpdated OR new LogTime is more recent
                    should_update = current_lastupdated is None or new_lastupdated > current_lastupdated

                    checked += 1

                    if should_update:
                        update_sql = """
                            UPDATE members
                            SET UpdatedAt = %s
                            WHERE MemberID = %s
                        """
                        try:
                            cursor.execute(update_sql, [new_lastupdated, member_id])
                            updated += cursor.rowcount
                            logger.debug(f"  ✓ Updated {member_id}: LastUpdated={new_lastupdated}")
                        except mysql.connector.errors.Error as e:
                            errors += 1
                            logger.error(f"  ✗ Error updating {member_id}: {e}")
                    else:
                        logger.debug(f"  ⊘ Skipped {member_id}: existing {current_lastupdated} >= {new_lastupdated}")

                conn.commit()
                logger.info(f"✅ LastUpdated sync complete: {updated}/{checked} updated, {errors} errors")

            except Exception as e:
                if conn:
                    conn.rollback()
                errors += len(logs) - updated
                logger.error(f"❌ Database error during sync: {e}")
                raise

            finally:
                if conn:
                    try:
                        cursor.close()
                    except:
                        pass
                    try:
                        conn.close()
                    except:
                        pass

            return json_response({
                'ok': True,
                'message': f'Synced {updated} member(s)',
                'stats': {
                    'checked': checked,
                    'updated': updated,
                    'errors': errors
                }
            })

        except Exception as e:
            logger.error(f"❌ LastUpdated sync failed: {type(e).__name__}: {e}")
            logger.error(traceback.format_exc())
            return json_response({
                'ok': False,
                'error': str(e),
                'message': 'Sync failed'
            }, 500)
