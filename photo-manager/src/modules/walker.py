"""
walker.py — Directory walker
Scans a directory recursively and returns a list of supported image paths.
Skips video files, hidden files, and anything that isn't a recognised image format.
"""

import os
from pathlib import Path

# Formats we can open and analyse
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}

# File patterns to always skip (macOS junk, temp files, etc.)
SKIP_PREFIXES = (".", "~$", "._")


def find_images(input_dir: str) -> list[dict]:
    """
    Recursively walk input_dir and return a list of image records.

    Each record is:
        {
            "file_path": "/absolute/path/to/photo.jpg",
            "file_name": "photo.jpg",
            "size_bytes": 3145728
        }

    Files are returned sorted by file_path for reproducible ordering.
    """
    input_path = Path(input_dir).resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input directory not found: {input_dir}")
    if not input_path.is_dir():
        raise NotADirectoryError(f"Not a directory: {input_dir}")

    found = []
    skipped_count = 0

    for root, dirs, files in os.walk(input_path):
        # Skip hidden subdirectories in-place (e.g. .Trash, .DS_Store siblings)
        dirs[:] = [d for d in dirs if not d.startswith(".")]

        for filename in files:
            # Skip hidden / temp files
            if any(filename.startswith(p) for p in SKIP_PREFIXES):
                skipped_count += 1
                continue

            ext = Path(filename).suffix.lower()
            if ext not in SUPPORTED_EXTENSIONS:
                skipped_count += 1
                continue

            full_path = Path(root) / filename
            try:
                size = full_path.stat().st_size
            except OSError:
                skipped_count += 1
                continue

            # Skip suspiciously tiny files (< 5 KB are almost always corrupt/placeholder)
            if size < 5_000:
                skipped_count += 1
                continue

            found.append({
                "file_path": str(full_path),
                "file_name": filename,
                "size_bytes": size,
            })

    found.sort(key=lambda r: r["file_path"])

    print(f"[walker] Found {len(found)} images  |  skipped {skipped_count} non-image files")
    return found
