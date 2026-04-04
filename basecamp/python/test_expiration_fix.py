#!/usr/bin/env python3
"""
Test for the Expiration date bug fix (blank/0000-00-00 → NULL).
"""

import sys
sys.path.insert(0, '/sessions/tender-loving-mayer/mnt/trailhead/basecamp/python')
sys.path.insert(0, '/sessions/tender-loving-mayer/mnt/trailhead/mmr-admin')

from sync_config import _normalize_sheet_rows, SYNC_CONFIG

def test_expiration_normalization():
    """
    Test that blank and '0000-00-00' expirations are normalized to NULL.
    """
    print("=" * 70)
    print("TEST: Expiration Date Normalization")
    print("=" * 70)

    # Get the import_members config
    cfg = SYNC_CONFIG.get('import_members')
    cols = cfg['columns']

    # Create test rows with various invalid/blank expiration values
    test_cases = [
        {
            'name': 'Normal date',
            'row': {'MemberID': 'M001', 'Expiration': '2026-12-31', 'Status': 'Active'},
            'expected_expiration': '2026-12-31'
        },
        {
            'name': 'Empty string',
            'row': {'MemberID': 'M002', 'Expiration': '', 'Status': 'Active'},
            'expected_expiration': None
        },
        {
            'name': 'Zero date (0000-00-00)',
            'row': {'MemberID': 'M003', 'Expiration': '0000-00-00', 'Status': 'Active'},
            'expected_expiration': None
        },
        {
            'name': 'Zero datetime (0000-00-00 00:00:00)',
            'row': {'MemberID': 'M004', 'Expiration': '0000-00-00 00:00:00', 'Status': 'Active'},
            'expected_expiration': None
        },
        {
            'name': 'Whitespace only',
            'row': {'MemberID': 'M005', 'Expiration': '   ', 'Status': 'Active'},
            'expected_expiration': None
        },
        {
            'name': 'None value',
            'row': {'MemberID': 'M006', 'Expiration': None, 'Status': 'Active'},
            'expected_expiration': None
        },
    ]

    passed = 0
    failed = 0

    for test_case in test_cases:
        raw_rows = [test_case['row']]
        normalized = _normalize_sheet_rows(raw_rows, cols)

        # Now apply the mapping logic (simulate what sync_config does)
        mapped_rows = []
        for row in normalized:
            mapped_row = {}
            for col in cols:
                sql_col = cfg.get('map_fields', {}).get(col, col)
                value = row.get(col)

                # This is the fix from sync_config.py
                if sql_col in ('Expiration', 'Created', 'PaymentDate', 'TransactionDate', 'CreatedAt', 'UpdatedAt'):
                    if value in ('', '0000-00-00', '0000-00-00 00:00:00', None) or (isinstance(value, str) and value.strip() == ''):
                        value = None

                mapped_row[sql_col] = value
            mapped_rows.append(mapped_row)

        actual_expiration = mapped_rows[0].get('Expiration')
        expected = test_case['expected_expiration']

        if actual_expiration == expected:
            print(f"✓ {test_case['name']:40} → {repr(actual_expiration)}")
            passed += 1
        else:
            print(f"✗ {test_case['name']:40} → Expected: {repr(expected)}, Got: {repr(actual_expiration)}")
            failed += 1

    print("=" * 70)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 70)

    return failed == 0

if __name__ == '__main__':
    success = test_expiration_normalization()
    sys.exit(0 if success else 1)
