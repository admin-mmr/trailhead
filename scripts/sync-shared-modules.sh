#!/bin/bash
# Sync shared Python modules from basecamp/ to mmr-admin/
# Run this locally after editing basecamp/python/sync_engine.py or basecamp/python/nyrr_api.py
# This mirrors what GitHub Actions does at build time.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "🔄 Syncing shared Python modules..."

# Copy sync_engine
if [ -f basecamp/python/sync_engine.py ]; then
    cp basecamp/python/sync_engine.py mmr-admin/sync_engine.py
    echo "✅ Copied: basecamp/python/sync_engine.py → mmr-admin/sync_engine.py"
else
    echo "❌ Error: basecamp/python/sync_engine.py not found"
    exit 1
fi

# Copy sync_config
if [ -f basecamp/python/sync_config.py ]; then
    cp basecamp/python/sync_config.py mmr-admin/sync_config.py
    echo "✅ Copied: basecamp/python/sync_config.py → mmr-admin/sync_config.py"
else
    echo "❌ Error: basecamp/python/sync_config.py not found"
    exit 1
fi

# Copy nyrr_api
if [ -f basecamp/python/nyrr_api.py ]; then
    cp basecamp/python/nyrr_api.py mmr-admin/nyrr_api.py
    echo "✅ Copied: basecamp/python/nyrr_api.py → mmr-admin/nyrr_api.py"
else
    echo "❌ Error: basecamp/python/nyrr_api.py not found"
    exit 1
fi

echo "🎯 All shared modules synced."
