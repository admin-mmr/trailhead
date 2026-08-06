#!/usr/bin/env python3
"""
Audit member↔runner links in nyrr_event_runners for age inconsistency (P1m).

Why age: a runner's age must move at most one year per calendar year, so the
implied birth year (event_year - age) should be stable across all of one member's
races. A row whose implied birth year sits far from the rest is evidence that the
row belongs to a different person.

There is no stored birth year to check against for almost anyone — only 33 of
~400 members have members.YearBorn and none of them are linked — so the reference
point is the member's own MODAL implied birth year across their linked rows.
That assumes the majority of a member's rows are correct, which is why this tool
reports by default and only writes when told to.

Usage (run after `mmr` so the venv + env are loaded):

    python3 mmr-admin/audit_nyrr_links.py                      # report only
    python3 mmr-admin/audit_nyrr_links.py --member A0022       # one member
    python3 mmr-admin/audit_nyrr_links.py --method auto_lastname
    python3 mmr-admin/audit_nyrr_links.py --method auto_lastname --unlink

--unlink sets mmr_member_id = NULL and match_method = 'unmatched' for the
reported rows, which returns them to the admin match queue. Rows are never
deleted, and matched_by/matched_at are cleared so the queue does not show a
stale attribution. Always run without --unlink first and read the report.
"""
import argparse
import collections
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import query, execute  # noqa: E402

#: How far an implied birth year may sit from the member's modal value. NYRR's
#: own age data rounds inconsistently around birthdays, so 1 is noise, not a
#: mismatch. 2+ means the row is very likely a different person.
TOLERANCE = 1

ROW_SQL = """
SELECT ner.id,
       ner.mmr_member_id            AS member_id,
       ner.match_method,
       ner.runner_name,
       ner.age,
       ne.id                        AS event_id,
       ne.event_year,
       ne.event_name,
       ne.event_year - ner.age      AS implied_birth
FROM nyrr_event_runners ner
JOIN nyrr_events ne ON ne.id = ner.nyrr_event_id
WHERE ner.mmr_member_id IS NOT NULL
  AND ner.age IS NOT NULL AND ner.age > 0
  AND ne.event_year IS NOT NULL
"""


def load_rows(member=None):
    sql, params = ROW_SQL, []
    if member:
        sql += " AND ner.mmr_member_id = %s"
        params.append(member)
    return query(sql, params)


def find_outliers(rows, tolerance=TOLERANCE, min_modal_agreement=0.0):
    """
    Group by member, take the modal implied birth year, and return the rows that
    deviate by more than `tolerance`, plus per-member context for the report.

    A member with a single row has no majority to compare against, so they are
    never flagged — one row cannot contradict itself.

    `min_modal_agreement` (0..1) skips members whose modal cluster is too small to
    be a trustworthy reference. Measured on prod, A0034 had only 17 of 54 rows
    agreeing: for a member like that the modal year is nearly arbitrary, and
    selectively unlinking "the others" could remove the correct rows. Those
    members need a human to look at the whole set, so raising this threshold
    excludes them rather than guessing.
    """
    by_member = collections.defaultdict(list)
    for row in rows:
        by_member[row['member_id']].append(row)

    flagged, context = [], {}
    for member_id, member_rows in by_member.items():
        if len(member_rows) < 2:
            continue
        counts = collections.Counter(r['implied_birth'] for r in member_rows)
        modal, modal_n = counts.most_common(1)[0]
        agreement = modal_n / len(member_rows)
        bad = [r for r in member_rows if abs(r['implied_birth'] - modal) > tolerance]
        if not bad:
            continue
        context[member_id] = {
            'modal': modal,
            'modal_n': modal_n,
            'total': len(member_rows),
            'flagged': len(bad),
            'agreement': agreement,
            'skipped': agreement < min_modal_agreement,
        }
        if agreement < min_modal_agreement:
            continue
        flagged.extend(bad)
    return flagged, context, by_member


def deviation(row, context):
    """Absolute distance in years from the member's modal implied birth year."""
    return abs(row['implied_birth'] - context[row['member_id']]['modal'])


def report(flagged, context, by_member, method=None):
    print(f"members with linked rows: {len(by_member)}")
    print(f"members with age-inconsistent rows: {len(context)}")
    print(f"flagged rows: {len(flagged)}"
          + (f"  (filtered to match_method={method})" if method else ""))

    if not flagged:
        print("\nnothing to do.")
        return

    per_method = collections.Counter(r['match_method'] for r in flagged)
    totals = collections.Counter(
        r['match_method'] for rows in by_member.values() for r in rows
    )
    print("\nflagged by match_method:")
    for m, n in per_method.most_common():
        total = totals[m] or 1
        print(f"  {str(m):16} {n:4} / {total:4} rows  ({100 * n / total:.0f}%)")

    print("\nper member (worst first):")
    ranked = sorted(context.items(), key=lambda kv: -kv[1]['flagged'])
    for member_id, ctx in ranked[:15]:
        print(f"  {member_id}  modal birth {ctx['modal']} "
              f"({ctx['modal_n']}/{ctx['total']} rows agree) — {ctx['flagged']} flagged")

    print("\nsample flagged rows:")
    for r in flagged[:15]:
        ctx = context[r['member_id']]
        print(f"  id={r['id']:<8} {r['member_id']} modal={ctx['modal']} "
              f"implies={r['implied_birth']} (age {r['age']} in {r['event_year']}) "
              f"{str(r['runner_name'])[:24]:26} {r['match_method']}")


def unlink(flagged):
    """Return rows to the match queue. Never deletes."""
    ids = [r['id'] for r in flagged]
    if not ids:
        return 0
    placeholders = ','.join(['%s'] * len(ids))
    execute(
        f"""UPDATE nyrr_event_runners
            SET mmr_member_id = NULL,
                match_method  = 'unmatched',
                matched_by    = NULL,
                matched_at    = NULL
            WHERE id IN ({placeholders})
              AND mmr_member_id IS NOT NULL""",
        ids,
    )
    # Keep the per-event counters honest, the way the automatch does.
    event_ids = sorted({r['event_id'] for r in flagged})
    ev_placeholders = ','.join(['%s'] * len(event_ids))
    execute(
        f"""UPDATE nyrr_events ne
            SET ne.mmr_matched_count = (
                SELECT COUNT(*) FROM nyrr_event_runners
                WHERE nyrr_event_id = ne.id AND mmr_member_id IS NOT NULL
            )
            WHERE ne.id IN ({ev_placeholders})""",
        event_ids,
    )
    return len(ids)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--member', help='audit a single MemberID')
    parser.add_argument('--method', help="only flag rows with this match_method "
                                         "(e.g. auto_lastname)")
    parser.add_argument('--tolerance', type=int, default=TOLERANCE,
                        help=f'years of slack around the modal birth year (default {TOLERANCE})')
    parser.add_argument('--min-deviation', type=int, default=0,
                        help='only flag rows deviating by MORE than this many years. '
                             'NYRR ages round inconsistently around birthdays, so a '
                             '2-3 year gap can be noise; >5 almost never is.')
    parser.add_argument('--min-modal-agreement', type=float, default=0.0,
                        help='skip members whose modal cluster is under this fraction '
                             'of their rows (e.g. 0.6) — the modal year is not a '
                             'trustworthy reference for them')
    parser.add_argument('--unlink', action='store_true',
                        help='WRITE: return flagged rows to the match queue')
    args = parser.parse_args()

    rows = load_rows(args.member)
    flagged, context, by_member = find_outliers(rows, args.tolerance, args.min_modal_agreement)

    if args.method:
        flagged = [r for r in flagged if r['match_method'] == args.method]
    if args.min_deviation:
        flagged = [r for r in flagged if deviation(r, context) > args.min_deviation]

    skipped = [m for m, c in context.items() if c.get('skipped')]
    if skipped:
        print(f"skipped {len(skipped)} member(s) whose modal cluster is under "
              f"{args.min_modal_agreement:.0%} — they need a human review of all "
              f"their rows: {', '.join(sorted(skipped)[:10])}\n")

    report(flagged, context, by_member, args.method)

    if not args.unlink:
        if flagged:
            print(f"\nreport only — re-run with --unlink to return these "
                  f"{len(flagged)} rows to the match queue.")
        return

    n = unlink(flagged)
    print(f"\nunlinked {n} rows (match_method='unmatched'); "
          f"refreshed mmr_matched_count on affected events.")


if __name__ == '__main__':
    main()
