"""
snapshot_codebase.py

Traverse a project directory and combine all text files into a single markdown
file, with each section clearly labeled by relative path so AI models can
easily reference and suggest code changes.
"""

import os
from pathlib import Path

# Map extensions to code block languages for better highlighting
EXT_TO_LANG = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".json": "json",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".md": "markdown",
    ".html": "html",
    ".css": "css",
    ".sh": "bash",
    ".bash": "bash",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".sql": "sql",
}

# Binary / large file extensions to skip
BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".pdf", ".ico", ".mp4", ".mov", ".zip",
    ".gz", ".tar", ".tgz", ".jar", ".exe",
}

# Directories to ignore when walking
IGNORE_DIRS = {
    ".git", ".svn", ".hg",
    "node_modules",
    "dist", "build", "out",
    "__pycache__",
    ".venv", "venv", ".mypy_cache", ".pytest_cache",
}

IGNORE_FILES = {
    "PRD.md",
}
TEMPLATE = """# Codebase Snapshot

Root: `{root}`

{body}
"""

SECTION_HEADER = """
---
## File: `{rel_path}`
---

```{language}
{content}
```

"""

def detect_language(path: Path) -> str:
    # Return a language hint for markdown fences based on file extension.
    return EXT_TO_LANG.get(path.suffix.lower(), "")

def should_skip(path: Path) -> bool:
    # Decide whether to skip a file.
    # Hidden files (except some useful dotfiles)
    if path.name.startswith(".") and path.name not in {".env", ".gitignore"}:
        return True
    # Binary / large-ish types
    if path.suffix.lower() in BINARY_EXTS:
        return True
    return False

def gather_files(root: Path):
    # Yield all non-ignored files under root.
    for dirpath, dirnames, filenames in os.walk(root):
        # Filter out ignored directories in-place so os.walk doesn't descend
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]

        for name in filenames:
            p = Path(dirpath) / name
            if should_skip(p):
                continue
            yield p

def build_markdown(root_dir: str, output_file: str = "codebase_snapshot.md") -> None:
    """
    Traverse root_dir, concatenate all text files into a single markdown file.

        The output is structured so each section starts with a markdown heading that
        shows the relative path, which makes it easy for AI tools to see where code
        lives and suggest edits.
    """
    root = Path(root_dir).resolve()
    sections = []
    
    for path in sorted(gather_files(root)):
        rel_path = path.relative_to(root)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            text = f"<unable to read file: {e}>"
    
        lang = detect_language(path)
        sections.append(
            SECTION_HEADER.format(
                rel_path=rel_path.as_posix(),
                language=lang,
                content=text,
            )
        )
    
    body = "".join(sections)
    markdown = TEMPLATE.format(root=root.as_posix(), body=body)
    
    out_path = Path(output_file).resolve()
    out_path.write_text(markdown, encoding="utf-8")
    print(f"Wrote snapshot to {out_path}")

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Combine a codebase into a single markdown file for AI context."
    )
    parser.add_argument(
        "root_dir",
        nargs="?",
        default=".",
        help="Root directory of the project (default: current directory).",
    )
    parser.add_argument(
        "-o", "--output",
        default="codebase_snapshot.md",
        help="Output markdown file name (default: codebase_snapshot.md).",
    )

    args = parser.parse_args()
    
    build_markdown(args.root_dir, args.output)
