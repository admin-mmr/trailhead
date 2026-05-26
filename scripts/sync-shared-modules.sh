#!/bin/bash
# Sync shared Python modules from basecamp/python/ to mmr-admin/
# Run this locally after editing any file in basecamp/python/
# This mirrors what GitHub Actions does at build time.

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SHARED=(
  nyrr_api
  nyrr_api_models
  nyrr_api_endpoints
  nyrr_finisher_splitter
  sync_audit
  sync_batch
  sync_compare
  sync_config
  sync_datetime
  sync_diff
  sync_engine
  sync_jobs
  sync_models
  sync_types
)

echo "🔄 Syncing shared Python modules..."

for mod in "${SHARED[@]}"; do
  src="basecamp/python/${mod}.py"
  dst="mmr-admin/${mod}.py"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "✅ Copied: $src → $dst"
  else
    echo "❌ Error: $src not found"
    exit 1
  fi
done

echo "🎯 All shared modules synced."
