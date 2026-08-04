"""
Tier-2 age validation must compare against the EVENT year, not the current year.

`nyrr_event_runners.age` is the runner's age on race day. The original Tier-2 SQL
validated it with `YEAR(CURDATE()) - m.YearBorn`, which for a 2018 event
evaluated in 2026 is off by ~8 years — it both rejected correct matches and waved
through wrong ones. See P1m in CLAUDE.md.

The UPDATE is scoped to a single event, so the year is a constant passed as a
parameter rather than a join. These tests assert the SQL no longer derives the
year from the clock, and that the parameter carries the event's own year.
"""
import re
from unittest.mock import MagicMock, patch

from api_events_match import run_event_automatch


def _conn(rowcount=0):
    cur = MagicMock()
    cur.rowcount = rowcount
    cur.fetchall.return_value = []
    conn = MagicMock()
    conn.cursor.return_value = cur
    return conn, cur


def _tier2_call(cursor):
    """The Tier-2 UPDATE is the second execute() — Tier 1 runs first."""
    return cursor.execute.call_args_list[1]


def _executable(sql):
    """
    Strip `--` comments so assertions read the SQL the server actually runs.
    The comments in this query deliberately quote the old buggy expression, so a
    naive substring check on the raw text matches the explanation, not the code.
    """
    return '\n'.join(re.sub(r'--.*$', '', line) for line in sql.splitlines())


def _run(event_row):
    conn, cur = _conn()
    with patch('api_events_match.query', return_value=[event_row]), \
         patch('api_events_match.get_conn', return_value=conn):
        result = run_event_automatch(42)
    return result, cur


# ---------------------------------------------------------------------------
# the fix itself
# ---------------------------------------------------------------------------

def test_tier2_does_not_derive_the_year_from_the_clock():
    _, cur = _run({'id': 42, 'event_year': 2018})
    sql = _executable(_tier2_call(cur)[0][0])

    assert 'YEAR(CURDATE())' not in sql, \
        'Tier-2 age validation must not compare against the current year'
    assert 'CURDATE()' not in sql
    assert 'NOW()' in sql, 'matched_at = NOW() should still be there'


def test_tier2_passes_the_event_year_as_a_parameter():
    _, cur = _run({'id': 42, 'event_year': 2018})
    raw, params = _tier2_call(cur)[0]

    # (event_id, event_id, event_year, event_year)
    assert params == (42, 42, 2018, 2018)
    assert _executable(raw).count('%s') == len(params), 'placeholder/param count must match'


def test_both_birth_year_branches_use_the_event_year():
    """YearBorn and the YearBornGuess fallback both need the corrected year."""
    _, cur = _run({'id': 42, 'event_year': 2019})
    raw, params = _tier2_call(cur)[0]
    sql = _executable(raw)

    assert 'm.YearBorn - er.age' in sql
    assert 'm.YearBornGuess - er.age' in sql
    # Two age comparisons, each parameterised.
    assert len(re.findall(r'ABS\(CAST\(%s AS SIGNED\)', sql)) == 2
    assert params[2] == 2019 and params[3] == 2019


def test_event_year_none_is_passed_through_conservatively():
    """
    An event with neither event_year nor event_date yields NULL, the comparison
    is NULL, and a member with a birth year simply isn't auto-matched — the row
    goes to the human queue rather than being guessed at.
    """
    _, cur = _run({'id': 42, 'event_year': None})
    params = _tier2_call(cur)[0][1]
    assert params == (42, 42, None, None)


def test_event_lookup_falls_back_to_the_date_year():
    """The row query coalesces event_year with YEAR(event_date)."""
    conn, _ = _conn()
    with patch('api_events_match.query', return_value=[{'id': 42, 'event_year': 2020}]) as q, \
         patch('api_events_match.get_conn', return_value=conn):
        run_event_automatch(42)

    sql = q.call_args[0][0]
    assert 'COALESCE(event_year, YEAR(event_date))' in sql


# ---------------------------------------------------------------------------
# regressions the fix must not introduce
# ---------------------------------------------------------------------------

def test_missing_event_year_key_does_not_raise():
    """
    Older callers/tests mock the event row as {'id': N} with no year key. That
    must not become a KeyError — the lookup uses .get().
    """
    result, _ = _run({'id': 42})
    assert result['ok'] is True


def test_unknown_event_still_short_circuits():
    conn, cur = _conn()
    with patch('api_events_match.query', return_value=[]), \
         patch('api_events_match.get_conn', return_value=conn) as get:
        result = run_event_automatch(999999)

    assert result['ok'] is False
    assert result['matched'] == 0
    get.assert_not_called()
    cur.execute.assert_not_called()


def test_tier2_still_only_touches_unmatched_rows():
    _, cur = _run({'id': 42, 'event_year': 2018})
    sql = _tier2_call(cur)[0][0]
    assert 'er.mmr_member_id IS NULL' in sql


def test_gender_normalisation_is_preserved():
    _, cur = _run({'id': 42, 'event_year': 2018})
    sql = _tier2_call(cur)[0][0]
    assert "WHEN 'M' THEN 'Male'" in sql
    assert "WHEN 'W' THEN 'Female'" in sql
    assert "WHEN 'X' THEN 'Other'" in sql


def test_tier1_is_untouched_by_this_change():
    """Tier 1 matches on NYRRRunnerName and has no age validation at all."""
    _, cur = _run({'id': 42, 'event_year': 2018})
    raw, params = cur.execute.call_args_list[0][0]
    sql = _executable(raw)
    assert "'auto_name'" in sql
    assert 'er.age' not in sql
    assert params == (42, 42)
