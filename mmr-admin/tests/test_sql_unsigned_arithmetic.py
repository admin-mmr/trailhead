"""
Static linter guarding against MySQL BIGINT UNSIGNED underflow in age math.

The bug (seen in the Match Queue UI, surfaced only when a user clicked):
    ABS(YEAR(CURDATE()) - COALESCE(m.YearBorn, m.YearBornGuess) - 53) <= 2
  → ERROR 1690 (22003): BIGINT UNSIGNED value is out of range

Root cause: MySQL's YEAR() returns an UNSIGNED integer, so the whole
expression is evaluated in unsigned arithmetic. When the running difference
goes negative (e.g. 2026 - 1990 - 53 = -17) it underflows and MySQL aborts
the query at runtime — there is no static SQL error, so it only blows up when
someone actually triggers the endpoint.

Fix: cast YEAR(CURDATE()) to SIGNED before subtracting:
    ABS(CAST(YEAR(CURDATE()) AS SIGNED) - ... - er.age)

This test scans every api_*.py SQL string and fails if a bare
`YEAR(CURDATE()) -` subtraction appears without a SIGNED cast, so the class
of bug is caught in CI rather than by a user click.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_sql_unsigned_arithmetic.py -v
"""

import ast
import re
import pathlib
import pytest

HERE       = pathlib.Path(__file__).parent
ADMIN_ROOT = HERE.parent

# A subtraction that starts from YEAR(CURDATE()) without a surrounding
# CAST(... AS SIGNED). The negative lookahead allows the safe cast form.
_UNSAFE_YEAR_SUBTRACT = re.compile(
    r'YEAR\s*\(\s*CURDATE\s*\(\s*\)\s*\)\s*-',
    re.IGNORECASE,
)
_SAFE_CAST = re.compile(
    r'CAST\s*\(\s*YEAR\s*\(\s*CURDATE\s*\(\s*\)\s*\)\s*AS\s+SIGNED\s*\)',
    re.IGNORECASE,
)


def _strings_in(path: pathlib.Path) -> list[tuple[int, str]]:
    """Return (lineno, text) for every string / f-string literal in the file."""
    try:
        tree = ast.parse(path.read_text(), filename=str(path))
    except SyntaxError:
        return []

    out: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            out.append((node.lineno, node.value))
        elif isinstance(node, ast.JoinedStr):
            parts = []
            for v in node.values:
                parts.append(str(v.value) if isinstance(v, ast.Constant) else '{...}')
            out.append((node.lineno, ''.join(parts)))
    return out


def _api_files() -> list[pathlib.Path]:
    return sorted(ADMIN_ROOT.glob('api_*.py'))


@pytest.mark.parametrize('path', _api_files(), ids=lambda p: p.name)
def test_no_unsigned_year_subtraction(path):
    """
    Every `YEAR(CURDATE()) - ...` subtraction must wrap YEAR(CURDATE()) in
    CAST(... AS SIGNED) to avoid BIGINT UNSIGNED underflow at runtime.
    """
    offenders: list[str] = []
    for lineno, text in _strings_in(path):
        # Strip out the known-safe cast form, then look for any remaining
        # bare `YEAR(CURDATE()) -` subtraction.
        residual = _SAFE_CAST.sub('SAFE', text)
        if _UNSAFE_YEAR_SUBTRACT.search(residual):
            snippet = re.sub(r'\s+', ' ', text).strip()[:120]
            offenders.append(f'  {path.name}:{lineno}: {snippet}')

    assert not offenders, (
        "Unsigned-arithmetic underflow risk: YEAR(CURDATE()) is UNSIGNED, so "
        "subtracting from it can underflow BIGINT UNSIGNED at runtime.\n"
        "Wrap it as CAST(YEAR(CURDATE()) AS SIGNED).\nOffending lines:\n"
        + "\n".join(offenders)
    )
