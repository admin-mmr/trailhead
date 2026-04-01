"""
pytest configuration and shared fixtures for mmr-admin tests.

No live DB required for unit tests — all DB calls are mocked via unittest.mock.
Integration tests (tests/integration/) require a real test DB and are skipped by default.
Run integration tests with: pytest tests/integration/ --run-integration
"""
import sys
import os
import pytest

# Add mmr-admin root to path so imports work the same as runtime
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def pytest_addoption(parser):
    parser.addoption(
        '--run-integration',
        action='store_true',
        default=False,
        help='Run integration tests that require a live MySQL database',
    )


def pytest_configure(config):
    config.addinivalue_line(
        'markers',
        'integration: marks test as requiring a live database (skipped by default)',
    )


def pytest_collection_modifyitems(config, items):
    if not config.getoption('--run-integration'):
        skip_integration = pytest.mark.skip(reason='Pass --run-integration to run DB tests')
        for item in items:
            if 'integration' in item.keywords:
                item.add_marker(skip_integration)
