"""
NYRR match-queue routes for mmr-admin.

Blueprint: nyrr_match_bp
Prefix: /api/nyrr

Routes:
  GET  /api/nyrr/match-queue           — paginated unmatched finishers + top-3 candidates each
  POST /api/nyrr/match-queue/bulk-confirm — match all single-candidate rows (up to BULK_LIMIT)

Match-queue logic:
  "Unmatched finisher" = nyrr_event_runners row where:
    - mmr_member_id IS NULL
    - is_registered_only = 0  (actual finisher, not just a registrant)

  Candidates per runner = active MMR members where:
    - same first_name OR same last_name (case/space-insensitive)
    - age ±2 if runner.age IS NOT NULL AND member has YearBorn or YearBornGuess
  Ordered by: exact full-name match, then NYRRRunnerName match, then active status.
  Capped at 3 per runner.

  Tier-4 auto_fuzzy rows (match_method='auto_fuzzy') are flagged in the response
  so the UI can highlight them yellow for re-confirmation.

Bulk-confirm:
  Scans up to BULK_LIMIT unmatched runners, runs candidate logic, matches rows with
  exactly 1 candidate. Returns count matched.
"""
from __future__ import annotations

import logging
from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute, get_conn
from helpers import json_response, handle_api_errors

logger = logging.getLogger(__name__)

nyrr_match_bp = Blueprint('nyrr_match', __name__)

PAGE_SIZE  = 50
BULK_LIMIT = 500   # max rows scanned per bulk-confirm call
CAND_LIMIT = 3     # candidates returned per runner row


# ── candidate lookup ──────────────────────────────────────────────────────────

def _candidates_for_runner(runner: dict) -> list[dict]:
    """
    Return up to CAND_LIMIT member candidates for a single unmatched runner row.

    Criteria:
      - LOWER(TRIM(FirstName)) = runner.first_name  OR  LOWER(TRIM(LastName)) = runner.last_name
      - age ±2 if runner has an age and member has YearBorn/YearBornGuess
    Ordered by: exact full-name match DESC, NYRRRunnerName match DESC, active status DESC.
    """
    fn = (runner.get('first_name') or '').strip().lower()
    ln = (runner.get('last_name')  or '').strip().lower()
    age = runner.get('age')          # may be None

    if not fn and not ln:
        return []

    age_clause = ""
    age_params: list = []
    if age is not None:
        age_clause = """
            AND (
                (m.YearBorn IS NULL AND m.YearBornGuess IS NULL)
                OR ABS(YEAR(CURDATE()) - COALESCE(m.YearBorn, m.YearBornGuess) - %s) <= 2
            )
        """
        age_params = [age]

    rows = query(
        f"""
        SELECT
            m.MemberID     AS member_id,
            m.FirstName    AS first_name,
            m.LastName     AS last_name,
            m.Gender       AS gender,
            m.NYRRRunnerName AS nyrr_runner_name,
            m.Status       AS status,
            m.YearBorn,
            m.YearBornGuess,
            -- score for ordering (evaluated in SQL so ORDER BY can use it)
            (LOWER(TRIM(CONCAT(COALESCE(m.FirstName,''), ' ', COALESCE(m.LastName,'')))) =
             LOWER(TRIM(CONCAT(%s, ' ', %s)))) AS exact_name_match,
            (m.NYRRRunnerName IS NOT NULL
             AND LOWER(TRIM(m.NYRRRunnerName)) = LOWER(TRIM(%s))) AS nyrr_name_match
        FROM members m
        WHERE (
            (%s != '' AND LOWER(TRIM(m.FirstName)) = %s)
            OR (%s != '' AND LOWER(TRIM(m.LastName)) = %s)
        )
        {age_clause}
        ORDER BY exact_name_match DESC, nyrr_name_match DESC,
                 (m.Status = 'active') DESC, m.MemberID
        LIMIT %s
        """,
        [fn, ln, runner.get('runner_name', ''),
         fn, fn,
         ln, ln] + age_params + [CAND_LIMIT]
    ) or []

    return [dict(r) for r in rows]


# ── routes ────────────────────────────────────────────────────────────────────

@nyrr_match_bp.route('/api/nyrr/match-queue', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def get_match_queue():
    """
    GET /api/nyrr/match-queue?page=1&mmr_only=0&event_id=<id>

    Returns paginated unmatched finishers with top-3 candidates each.

    Query params:
      page      — 1-based page number (default 1)
      mmr_only  — if "1", restrict to team_code='MMR' (default 0 = all teams)
      event_id  — filter to a single event (optional)

    Response shape:
      {
        ok: true,
        data: {
          runners: [{
            id, runner_name, first_name, last_name, age, gender,
            bib_number, team_code, event_id, event_name, event_date,
            match_method,            # null for plain unmatched, 'auto_fuzzy' for tier-4 pre-suggestions
            confidence_score,        # set for auto_fuzzy rows, null otherwise
            candidates: [{ member_id, first_name, last_name, gender, nyrr_runner_name, status, ... }]
          }],
          total: <int>,
          page: <int>,
          pages: <int>,
          per_page: <int>
        }
      }
    """
    page     = max(1, int(request.args.get('page', 1)))
    mmr_only = request.args.get('mmr_only', '0') == '1'
    event_id = request.args.get('event_id')

    where_clauses = [
        # Include fully-unmatched rows AND Tier-4 fuzzy pre-matches awaiting confirmation
        "(er.mmr_member_id IS NULL OR er.match_method = 'auto_fuzzy')",
        "er.is_registered_only = 0",
    ]
    params: list = []

    if mmr_only:
        where_clauses.append("er.team_code = 'MMR'")
    if event_id:
        where_clauses.append("er.nyrr_event_id = %s")
        params.append(int(event_id))

    where_sql = " AND ".join(where_clauses)

    count_rows = query(
        f"SELECT COUNT(*) AS cnt FROM nyrr_event_runners er WHERE {where_sql}",
        params
    ) or [{'cnt': 0}]
    total = count_rows[0]['cnt'] if isinstance(count_rows[0], dict) else count_rows[0][0]

    offset = (page - 1) * PAGE_SIZE
    runner_rows = query(
        f"""
        SELECT
            er.id, er.runner_name, er.first_name, er.last_name,
            er.age, er.gender, er.bib_number, er.team_code,
            er.nyrr_event_id AS event_id,
            er.match_method,
            er.confidence_score,
            er.mmr_member_id AS pre_matched_member_id,
            ev.event_name, ev.event_date
        FROM nyrr_event_runners er
        LEFT JOIN nyrr_events ev ON ev.id = er.nyrr_event_id
        WHERE {where_sql}
        ORDER BY er.match_method DESC, ev.event_date DESC, er.last_name, er.first_name
        LIMIT %s OFFSET %s
        """,
        params + [PAGE_SIZE, offset]
    ) or []

    runners = []
    for row in runner_rows:
        r = dict(row)
        if r.get('match_method') == 'auto_fuzzy' and r.get('pre_matched_member_id'):
            # For fuzzy pre-matches: show the already-matched member as the sole candidate
            member_rows = query(
                """SELECT MemberID AS member_id, FirstName AS first_name, LastName AS last_name,
                          Gender AS gender, NYRRRunnerName AS nyrr_runner_name, Status AS status,
                          YearBorn, YearBornGuess
                   FROM members WHERE MemberID = %s""",
                (r['pre_matched_member_id'],)
            ) or []
            r['candidates'] = [dict(m) for m in member_rows]
        else:
            r['candidates'] = _candidates_for_runner(r)
        runners.append(r)

    import math
    pages = math.ceil(total / PAGE_SIZE) if total > 0 else 1

    logger.info("Match queue page=%d mmr_only=%s → %d/%d runners", page, mmr_only, len(runners), total)
    return json_response({
        'ok': True,
        'data': {
            'runners': runners,
            'total': total,
            'page': page,
            'pages': pages,
            'per_page': PAGE_SIZE,
        }
    })


@nyrr_match_bp.route('/api/nyrr/match-queue/bulk-confirm', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def bulk_confirm_single_candidates():
    """
    POST /api/nyrr/match-queue/bulk-confirm
    Body: { mmr_only: bool, event_id: int|null }

    Scans up to BULK_LIMIT unmatched finishers, runs candidate logic per row.
    Any row with exactly ONE candidate gets automatically matched (match_method='manual',
    matched_by=admin_email).

    Returns: { ok: true, matched: N, scanned: M }
    """
    body     = request.get_json(force=True) or {}
    mmr_only = bool(body.get('mmr_only', False))
    event_id = body.get('event_id')

    where_clauses = [
        # Bulk-confirm only operates on truly unmatched rows (not auto_fuzzy pre-matches)
        "er.mmr_member_id IS NULL",
        "er.is_registered_only = 0",
    ]
    params: list = []

    if mmr_only:
        where_clauses.append("er.team_code = 'MMR'")
    if event_id:
        where_clauses.append("er.nyrr_event_id = %s")
        params.append(int(event_id))

    where_sql = " AND ".join(where_clauses)

    runner_rows = query(
        f"""
        SELECT er.id, er.runner_name, er.first_name, er.last_name,
               er.age, er.gender, er.nyrr_event_id AS event_id
        FROM nyrr_event_runners er
        WHERE {where_sql}
        ORDER BY er.nyrr_event_id, er.id
        LIMIT %s
        """,
        params + [BULK_LIMIT]
    ) or []

    admin_email = session.get('user', {}).get('email', 'Viewer')
    matched = 0
    scanned = len(runner_rows)

    conn = get_conn()
    cursor = conn.cursor()
    try:
        event_ids_touched: set[int] = set()
        for row in runner_rows:
            r = dict(row)
            candidates = _candidates_for_runner(r)
            if len(candidates) != 1:
                continue  # skip: 0 candidates (no match) or 2–3 (ambiguous)

            member_id = candidates[0]['member_id']
            cursor.execute("""
                UPDATE nyrr_event_runners
                SET mmr_member_id = %s,
                    match_method  = 'manual',
                    matched_by    = %s,
                    matched_at    = NOW()
                WHERE id = %s AND mmr_member_id IS NULL
            """, (member_id, admin_email, r['id']))

            if cursor.rowcount > 0:
                matched += 1
                event_ids_touched.add(r['event_id'])

        # Refresh matched_count on every touched event
        for eid in event_ids_touched:
            cursor.execute("""
                UPDATE nyrr_events
                SET mmr_matched_count = (
                    SELECT COUNT(*) FROM nyrr_event_runners
                    WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
                )
                WHERE id = %s
            """, (eid, eid))

        conn.commit()
    finally:
        cursor.close()
        conn.close()

    logger.info("Bulk-confirm: scanned=%d matched=%d by=%s", scanned, matched, admin_email)
    return json_response({'ok': True, 'matched': matched, 'scanned': scanned})
