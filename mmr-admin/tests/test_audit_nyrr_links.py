"""
Tests for the age-consistency logic in audit_nyrr_links.py (P1m).

This tool proposes unlinking member↔runner rows, so a false positive costs a
correct race result. The rules that keep it honest:
  - a member with one row is never flagged (nothing to contradict),
  - the reference is the member's MODAL implied birth year,
  - members whose modal cluster is weak can be excluded rather than guessed at.
"""
from audit_nyrr_links import deviation, find_outliers


def row(member_id, implied_birth, row_id=1, method='auto_firstlast', event_id=10):
    """A row shaped like the audit query's output. age/event_year are cosmetic here."""
    return {
        'id': row_id,
        'member_id': member_id,
        'match_method': method,
        'runner_name': 'Someone',
        'age': 40,
        'event_id': event_id,
        'event_year': implied_birth + 40,
        'event_name': 'Some Race',
        'implied_birth': implied_birth,
    }


def test_consistent_member_is_not_flagged():
    rows = [row('A1', 1980, 1), row('A1', 1980, 2), row('A1', 1980, 3)]
    flagged, context, _ = find_outliers(rows)
    assert flagged == []
    assert context == {}


def test_one_year_wobble_is_treated_as_noise():
    """NYRR ages round inconsistently around birthdays."""
    rows = [row('A1', 1980, 1), row('A1', 1980, 2), row('A1', 1981, 3)]
    flagged, _, _ = find_outliers(rows)
    assert flagged == []


def test_clear_outlier_is_flagged():
    rows = [row('A1', 1980, 1), row('A1', 1980, 2), row('A1', 2005, 3)]
    flagged, context, _ = find_outliers(rows)
    assert [r['id'] for r in flagged] == [3]
    assert context['A1']['modal'] == 1980
    assert context['A1']['flagged'] == 1
    assert context['A1']['total'] == 3


def test_single_row_member_is_never_flagged():
    """One row cannot contradict itself — there is no majority to compare to."""
    flagged, context, by_member = find_outliers([row('A1', 1980)])
    assert flagged == []
    assert 'A1' not in context
    assert 'A1' in by_member


def test_members_are_evaluated_independently():
    rows = [
        row('A1', 1980, 1), row('A1', 1980, 2), row('A1', 2005, 3),
        row('A2', 1990, 4), row('A2', 1990, 5),
    ]
    flagged, context, _ = find_outliers(rows)
    assert [r['id'] for r in flagged] == [3]
    assert 'A2' not in context


def test_tolerance_is_configurable():
    rows = [row('A1', 1980, 1), row('A1', 1980, 2), row('A1', 1985, 3)]
    assert len(find_outliers(rows, tolerance=1)[0]) == 1
    assert find_outliers(rows, tolerance=5)[0] == []


def test_agreement_is_reported():
    rows = [row('A1', 1980, i) for i in range(1, 8)] + [row('A1', 2005, 8)]
    _, context, _ = find_outliers(rows)
    assert context['A1']['modal_n'] == 7
    assert context['A1']['agreement'] == 7 / 8


def test_weak_modal_cluster_can_be_excluded():
    """
    A0034 on prod had 17 of 54 rows agreeing. Selectively unlinking "the others"
    there could remove the CORRECT rows, so such members are skipped for human
    review instead of being acted on.
    """
    rows = [row('A1', 1980, 1), row('A1', 1980, 2), row('A1', 1995, 3), row('A1', 2005, 4)]
    flagged, context, _ = find_outliers(rows, min_modal_agreement=0.6)
    assert flagged == []
    assert context['A1']['skipped'] is True

    flagged_loose, context_loose, _ = find_outliers(rows, min_modal_agreement=0.0)
    assert len(flagged_loose) == 2
    assert context_loose['A1']['skipped'] is False


def test_strong_modal_cluster_passes_the_agreement_gate():
    rows = [row('A1', 1980, i) for i in range(1, 9)] + [row('A1', 2005, 9)]
    flagged, context, _ = find_outliers(rows, min_modal_agreement=0.6)
    assert [r['id'] for r in flagged] == [9]
    assert context['A1']['skipped'] is False


def test_deviation_measures_distance_from_the_modal_year():
    rows = [row('A1', 1980, 1), row('A1', 1980, 2), row('A1', 2005, 3)]
    flagged, context, _ = find_outliers(rows)
    assert deviation(flagged[0], context) == 25


def test_ties_pick_a_modal_year_without_crashing():
    """Two equally common implied years: still deterministic, still no crash."""
    rows = [row('A1', 1980, 1), row('A1', 2005, 2)]
    flagged, context, _ = find_outliers(rows)
    # Whichever year wins, exactly one row is the outlier.
    assert len(flagged) == 1
    assert context['A1']['modal'] in (1980, 2005)
