# Pre-commit Hooks & Integration Testing

The repo uses shared hooks in `.githooks/` (enabled via `git config core.hooksPath .githooks`).

## Current Hooks

- `pre-commit` — runs `test_imports.py` when `mmr-admin/*.py` files are staged

## Expanding the Hook

When you add a new testable subsystem (Python package, Next.js app, etc.), update `.githooks/pre-commit` to include a check for that subsystem:

- Pattern: detect staged files by path prefix → run the relevant test → block commit on failure
- Tests to add as they become available:
  - `npm run typecheck` when `web-apps/mmr-webapp/**/*.ts(x)` files change
  - `python3 -m pytest` for any Python service with tests
  - Schema validation when `db/schemas/*.sql` files change
  - Lint checks (`npm run lint`, `ruff check`) for respective file types
- Keep hooks fast (<10 seconds). If slow, make it check only staged files, not the whole project
- Always include a bypass reminder in error output: `git commit --no-verify`

## When Writing New Code

🪝 If the new module has tests, suggest adding it to the pre-commit hook.
