"""
Contract test: /api/members/search SQL ↔ match-modal.html field names.

The bug (surfaced only when a user opened the Match-Queue "Match runner to
member" modal): the modal read snake_case fields (m.first_name, m.member_id,
m.gender, …) but /api/members/search returns PascalCase DB columns
(FirstName, MemberID, Gender, …). Every cell rendered blank — the row showed
just a "·" separator. No error was raised; it only looked wrong on screen.

This test pins the cross-boundary vocabulary (per CLAUDE.md self-checking):
  1. The search SELECT must expose every member column the modal renders.
  2. The modal must NOT read snake_case member fields (the stale vocabulary).

Run:
    cd mmr-admin
    python3 -m pytest tests/test_match_modal_contract.py -v
"""

import re
import pathlib

HERE       = pathlib.Path(__file__).parent
ADMIN_ROOT = HERE.parent
MEMBERS_PY = ADMIN_ROOT / 'api_members.py'
MODAL_HTML = ADMIN_ROOT / 'templates' / 'match-modal.html'

# PascalCase member columns the modal renders / sends back.
REQUIRED_COLUMNS = {
    'MemberID', 'FirstName', 'LastName', 'Email',
    'Gender', 'YearBorn', 'NYRRRunnerName', 'Status',
}

# Snake_case member fields that the search endpoint never returns — reading
# any of these off a search result is the bug we're guarding against.
FORBIDDEN_SNAKE_ACCESS = re.compile(
    r'\b(?:m|member|confirming)\.'
    r'(?:member_id|first_name|last_name|nyrr_runner_name|year_born)\b'
)


def test_search_selects_columns_modal_needs():
    sql = MEMBERS_PY.read_text()
    # Scope to the _build_member_search function body (up to the next def).
    fn = re.search(r'def _build_member_search\b.*?(?=\ndef )', sql, re.DOTALL)
    assert fn, "Could not locate _build_member_search()"
    select_block = re.search(r'SELECT(.*?)FROM members', fn.group(0), re.DOTALL | re.IGNORECASE)
    assert select_block, "Could not locate the member-search SELECT statement"
    selected = select_block.group(1)
    missing = [c for c in REQUIRED_COLUMNS if not re.search(rf'\b{c}\b', selected)]
    assert not missing, (
        f"/api/members/search SELECT is missing columns the match modal renders: {missing}. "
        "Add them to _build_member_search() in api_members.py."
    )


def test_modal_does_not_read_snake_case_member_fields():
    html = MODAL_HTML.read_text()
    offenders = sorted(set(FORBIDDEN_SNAKE_ACCESS.findall(
        # findall with no group returns full matches when pattern has no capture groups
        html
    )) if False else set(m.group(0) for m in FORBIDDEN_SNAKE_ACCESS.finditer(html)))
    assert not offenders, (
        "match-modal.html reads snake_case member fields that /api/members/search "
        f"does not return (returns PascalCase): {offenders}. Use PascalCase keys."
    )
