"""NYRR finisher ↔ MMR member auto-matching (extracted from api_events.py).

Tier 1 = exact stored NYRRRunnerName; Tier 2 = first/last + age/gender. Tier 3
(partial) and Tier 4 (fuzzy) are intentionally not auto-committed here.

`run_event_automatch(event_id)` is the request-context-free core — called by the
weekly scheduler (nyrr_scheduler._automatch_one) and by the HTTP route.
`register_match_routes(events_bp)` attaches POST /api/events/<id>/automatch to
the shared blueprint owned by api_events.py.
"""
from __future__ import annotations

from auth import login_required, require_role
from db import query, get_conn
from helpers import json_response


def _backfill_member_name_and_year(cursor, event_id: int, match_method: str) -> None:
    """After a Tier match, push runner_name → NYRRRunnerName and infer YearBornGuess.

    Called identically after Tier 1, 2, and 3 — extracts the repeated UPDATE block.
    Only fills fields that are currently NULL/empty so we never overwrite known data.
    """
    cursor.execute("""
        UPDATE members m
        INNER JOIN nyrr_event_runners er ON m.MemberID = er.mmr_member_id
        SET m.NYRRRunnerName = er.runner_name,
            m.YearBornGuess = CASE WHEN m.YearBornGuess IS NULL THEN CAST(YEAR(CURDATE()) AS SIGNED) - er.age ELSE m.YearBornGuess END,
            m.UpdatedAt = NOW()
        WHERE er.match_method = %s
          AND er.nyrr_event_id = %s
          AND (m.NYRRRunnerName IS NULL OR m.NYRRRunnerName = '')
    """, (match_method, event_id))


# ---------------------------------------------------------------------------
# Auto-match
# ---------------------------------------------------------------------------

def run_event_automatch(event_id):
    """
    Core Tier-1 + Tier-2 auto-match for one already-loaded event. Returns a
    summary dict {ok, matched, t1, t2, t3}. Safe to call OUTSIDE a request
    context (used by nyrr_scheduler's weekly finisher pipeline as well as by the
    HTTP route below). Only updates currently unmatched rows. Raises on DB error
    (caller handles); returns ok=False only for "event not found".
    """
    rows = query(
        "SELECT id, COALESCE(event_year, YEAR(event_date)) AS event_year "
        "FROM nyrr_events WHERE id = %s",
        [event_id]
    )
    if not rows:
        return {'ok': False, 'error': 'Event not found', 'matched': 0}

    # Age validation below compares against the year the race was RUN, not the
    # current year: nyrr_event_runners.age is the runner's age at race time. The
    # UPDATE is scoped to this one event, so the year is a constant and can be
    # passed as a parameter rather than joining nyrr_events into the UPDATE.
    #
    # If the event has neither event_year nor event_date this stays None; the
    # comparison then yields NULL, the age branch is false, and a member with a
    # birth year simply isn't auto-matched. That is the conservative outcome —
    # the row is left for the human match queue.
    event_year = rows[0].get('event_year')

    conn = None
    try:
        conn = get_conn()
        cursor = conn.cursor()

        # NOTE on backfill: we deliberately do NOT call
        # _backfill_member_name_and_year() after auto tiers. Auto matches are not
        # human-confirmed, and writing the runner's name into members.NYRRRunnerName
        # caused a corruption cascade (a wrong match poisons NYRRRunnerName, which
        # then makes Tier-1 auto_name "confidently" re-create the bad match).
        # Backfill now happens ONLY on the manual confirm path (api_runners match).

        # Per-event collision guard: a runner name that maps to MORE THAN ONE
        # distinct nyrr_runner_id within this event is ambiguous — we cannot know
        # which finisher is the member, so we skip it and leave it for the queue.

        # Tier 1: Match by NYRRRunnerName (skip runner-name collisions)
        cursor.execute("""
            UPDATE nyrr_event_runners er
            INNER JOIN members m
                ON LOWER(TRIM(er.runner_name)) = LOWER(TRIM(m.NYRRRunnerName))
            LEFT JOIN (
                SELECT LOWER(TRIM(runner_name)) AS nm
                FROM nyrr_event_runners
                WHERE nyrr_event_id = %s
                GROUP BY LOWER(TRIM(runner_name))
                HAVING COUNT(DISTINCT nyrr_runner_id) > 1
            ) collide ON collide.nm = LOWER(TRIM(er.runner_name))
            SET er.mmr_member_id = m.MemberID,
                er.match_method = 'auto_name',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND m.NYRRRunnerName IS NOT NULL
              AND m.NYRRRunnerName != ''
              AND er.nyrr_event_id = %s
              AND collide.nm IS NULL
        """, (event_id, event_id))
        t1_matched = cursor.rowcount

        # Tier 2: Match by first + last name when exactly one MEMBER matches AND
        # the name is not shared by multiple distinct runners in this event.
        # With age/gender validation (if member has YearBorn or YearBornGuess)
        cursor.execute("""
            UPDATE nyrr_event_runners er
            INNER JOIN (
                SELECT LOWER(TRIM(FirstName)) AS fn, LOWER(TRIM(LastName)) AS ln,
                       MAX(MemberID) AS MemberID
                FROM members
                WHERE FirstName IS NOT NULL AND FirstName != ''
                  AND LastName IS NOT NULL AND LastName != ''
                GROUP BY LOWER(TRIM(FirstName)), LOWER(TRIM(LastName))
                HAVING COUNT(*) = 1
            ) uniq ON LOWER(TRIM(er.first_name)) = uniq.fn
                  AND LOWER(TRIM(er.last_name)) = uniq.ln
            INNER JOIN members m ON uniq.MemberID = m.MemberID
            LEFT JOIN (
                SELECT LOWER(TRIM(first_name)) AS fn, LOWER(TRIM(last_name)) AS ln
                FROM nyrr_event_runners
                WHERE nyrr_event_id = %s
                GROUP BY LOWER(TRIM(first_name)), LOWER(TRIM(last_name))
                HAVING COUNT(DISTINCT nyrr_runner_id) > 1
            ) collide ON collide.fn = LOWER(TRIM(er.first_name))
                     AND collide.ln = LOWER(TRIM(er.last_name))
            SET er.mmr_member_id = uniq.MemberID,
                er.match_method = 'auto_firstlast',
                er.matched_by = 'Viewer',
                er.matched_at = NOW()
            WHERE er.mmr_member_id IS NULL
              AND er.first_name IS NOT NULL AND er.first_name != ''
              AND er.last_name IS NOT NULL AND er.last_name != ''
              AND er.nyrr_event_id = %s
              AND collide.fn IS NULL
              -- Age/gender validation: only if member has YearBorn or YearBornGuess.
              -- The year here is the EVENT year, passed in as a parameter — er.age
              -- is the runner's age on race day, so comparing it against
              -- YEAR(CURDATE()) was off by however long ago the race was (~8 years
              -- for a 2018 event), which both rejected correct matches and waved
              -- through wrong ones. See P1m in CLAUDE.md.
              --
              -- NOTE: when er.age IS NULL (registered-only rows) the comparison is
              -- NULL and the branch is false, so a member with a birth year is not
              -- auto-matched. That is deliberate: no corroborating evidence means
              -- the row goes to the human queue rather than being guessed at.
              AND (
                -- If member has YearBorn set, validate runner age matches
                (m.YearBorn IS NOT NULL AND ABS(CAST(%s AS SIGNED) - m.YearBorn - er.age) <= 1)
                -- OR if member has YearBornGuess, validate runner age matches
                OR (m.YearBorn IS NULL AND m.YearBornGuess IS NOT NULL AND ABS(CAST(%s AS SIGNED) - m.YearBornGuess - er.age) <= 1)
                -- OR if member has no birth year, skip validation
                OR (m.YearBorn IS NULL AND m.YearBornGuess IS NULL)
              )
              -- Optional: also check gender if both have gender data
              -- NYRR uses M/W/X; DB stores Male/Female/Other — normalize before compare
              AND (
                er.gender IS NULL
                OR m.Gender IS NULL
                OR CASE er.gender
                   WHEN 'M' THEN 'Male'
                   WHEN 'W' THEN 'Female'
                   WHEN 'X' THEN 'Other'
                   ELSE er.gender
                END = m.Gender
              )
        """, (event_id, event_id, event_year, event_year))
        t2_matched = cursor.rowcount

        # Tier 3 (partial / single-name match) is intentionally NOT auto-committed.
        # Matching on first-name OR last-name alone produced wrong matches (e.g.
        # "Jinyuan Qiao" → member "Bin Qiao") for a membership with many shared
        # surnames. Single-name candidates now surface in the Match Queue
        # (GET /api/nyrr/match-queue) for a human to confirm.
        t3_matched = 0

        # Tier 4 (fuzzy) is NOT run here — it's a background job to avoid OOM on
        # large events (25k runners × 1.5k members ≈ 37M comparisons).
        # Use POST /api/events/<id>/fuzzy-match to start it asynchronously.

        matched = t1_matched + t2_matched

        # Refresh matched count on the event
        cursor.execute("""
            UPDATE nyrr_events
            SET mmr_matched_count = (
                SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = %s AND mmr_member_id IS NOT NULL
            )
            WHERE id = %s
        """, (event_id, event_id))

        conn.commit()
        cursor.close()
        return {'ok': True, 'matched': matched, 't1': t1_matched,
                't2': t2_matched, 't3': t3_matched}
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


def register_match_routes(events_bp):
    """Attach the auto-match route to the shared events blueprint."""
    @events_bp.route('/api/events/<int:event_id>/automatch', methods=['POST'])
    @login_required
    @require_role('admin')
    def api_run_automatch(event_id):
        """
        Re-run Tier-1 + Tier-2 auto-match on an already-loaded event (thin HTTP
        wrapper around run_event_automatch). Only updates currently unmatched rows.
        """
        try:
            result = run_event_automatch(event_id)
        except Exception as e:
            return json_response({'ok': False, 'error': str(e)[:300]}, 500)
        if not result.get('ok'):
            return json_response(result, 404)

        t1_matched, t2_matched, t3_matched = result['t1'], result['t2'], result['t3']
        matched = result['matched']
        parts = []
        if t1_matched: parts.append(f'{t1_matched} by NYRR name')
        if t2_matched: parts.append(f'{t2_matched} by first/last name')
        if t3_matched: parts.append(f'{t3_matched} by partial name')
        detail = f' ({", ".join(parts)})' if parts else ''
        return json_response({'ok': True, 'matched': matched,
                               'message': f'Auto-matched {matched} runner(s){detail}. '
                                          f'Run POST /api/events/{event_id}/fuzzy-match for Tier-4 fuzzy match.'})
