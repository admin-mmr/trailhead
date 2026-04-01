# Git Troubleshooting Guide

## Committing Code + Context Updates (Cowork Sessions)

**The safest pattern: commit code and `_context.md` in ONE commit**

```bash
# Edit _context.md using Edit tool BEFORE committing
git add <code-files> _context.md && git commit -m "feat: description of changes"
```

This eliminates race conditions entirely. Only use a separate `_context.md` commit if the code commit was already made without it.

## If a Separate Context Commit IS Needed

```bash
# Wait 5 seconds for lock files to clear, then commit
sleep 5 && git add _context.md && git commit -m "docs: update context log..."
```

## If Lock Files Persist (`.git/HEAD.lock` or `.git/index.lock`)

1. Request file deletion permission via `allow_cowork_file_delete` tool
2. Remove the lock files:
   ```bash
   rm .git/HEAD.lock .git/index.lock 2>/dev/null
   ```
3. Retry the commit

**Why:** Git creates temporary lock files during commit. In the Cowork sandbox, these sometimes persist after a commit completes. The `allow_cowork_file_delete` tool grants permission to remove them.
