# Shared Python Modules

This document explains how shared modules are managed between `basecamp/python/` and `mmr-admin/`.

## Modules

| Module | Source | Copies To | Sync | Reason |
|--------|--------|-----------|------|--------|
| `sync_engine.py` | `basecamp/python/` | `mmr-admin/` | CI + Manual | Core sync logic used by both admin portal and scheduled jobs |
| `nyrr_api.py` | `basecamp/python/` | `mmr-admin/` | CI + Manual | NYRR API client; shared between integration points |

## Local Development Workflow

1. **Edit the source file** in `basecamp/python/`:
   ```bash
   nano basecamp/python/sync_engine.py
   ```

2. **Sync copies to mmr-admin** before testing:
   ```bash
   ./scripts/sync-shared-modules.sh
   ```

3. **Run import tests** to verify both copies work:
   ```bash
   python3 mmr-admin/test_imports.py
   ```

4. **Commit both** (source and copy):
   ```bash
   git add basecamp/python/sync_engine.py mmr-admin/sync_engine.py
   git commit -m "fix: update sync_engine datetime parsing"
   ```

## CI/CD Behavior

GitHub Actions automatically syncs shared modules **before** running tests and deployments:

```yaml
# .github/workflows/deploy-mmr-admin.yml
- name: Copy shared Python modules into deploy package
  run: |
    cp basecamp/python/nyrr_api.py mmr-admin/nyrr_api.py
    cp basecamp/python/sync_engine.py mmr-admin/sync_engine.py
```

**This means:**
- CI always uses the `basecamp/` version as the source of truth
- mmr-admin copies are regenerated on every build
- If you forget to sync locally, CI will catch it (tests will use fresh copy)
- But you should still sync locally to test before pushing

## Future: Full Deduplication

This is an **interim solution**. Long-term goals:
- Move `sync_engine.py` to a shared Python package (e.g., `shared/sync_engine/`)
- Convert imports from file copies to package imports
- Delete all copies and maintain single source

For now, this approach balances:
- ✅ Zero friction in local dev (no symlinks, no new directories)
- ✅ CI as source of truth (automatic sync on every build)
- ✅ Easy to audit (both copies visible in git diff)
