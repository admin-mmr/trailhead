#!/usr/bin/env python3
"""
bib_analyzer.py — Per-bib face extraction and recognition (Phase 3)

Given a bib number, this tool runs four phases:

  A. FIND    — search output.json for every photo where that bib was detected
  B. EXTRACT — crop and score face from each bib photo; save best 3-5 headshots
  C. SCAN    — compare saved face encodings against every photo in the directory
  D. SAVE    — write results JSON; clearly split "known bib" vs "new face match"

The key output is "without_bib": photos where the same person appears but the
bib was not readable — ideal for sending to members after an event.

Usage:
    python src/bib_analyzer.py 1330
    python src/bib_analyzer.py 1330 --tolerance 0.50 --max-faces 5
    python src/bib_analyzer.py 1330 \\
        --input output.json \\
        --photos-dir album_mmr/ \\
        --out bib_results/

Requirements:
    pip install face_recognition
    macOS: brew install cmake && pip install dlib face_recognition
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from modules.quality import _load_as_bgr

# ── Defaults ──────────────────────────────────────────────────────
DEFAULT_INPUT     = "output.json"
DEFAULT_PHOTOS    = "."
DEFAULT_OUT       = "bib_results"
DEFAULT_TOLERANCE = 0.55   # 0.0=strictest, 1.0=loosest; 0.6 is face_recognition default
MAX_FACES_DEFAULT = 5      # max headshots to extract per bib (from different source photos)

FACE_LOAD_PX  = 1280       # load resolution for face detection
FACE_MIN_PX   = 40         # minimum face height in pixels to be usable


# ─────────────────────────────────────────────────────────────────
# Face recognition backend (lazy-loaded)
# ─────────────────────────────────────────────────────────────────

_fr = None


def _get_fr():
    """Import face_recognition once and cache. Exit with clear instructions if missing."""
    global _fr
    if _fr is None:
        try:
            import face_recognition as fr
            _fr = fr
        except ImportError:
            print(
                "\n[error] face_recognition is not installed.\n"
                "\n"
                "  Install it:\n"
                "    pip install face_recognition\n"
                "\n"
                "  On Mac you may need cmake + dlib first:\n"
                "    brew install cmake\n"
                "    pip install dlib\n"
                "    pip install face_recognition\n",
                file=sys.stderr,
            )
            sys.exit(1)
    return _fr


# ─────────────────────────────────────────────────────────────────
# Phase A — Find bib photos in output.json
# ─────────────────────────────────────────────────────────────────

def find_bib_photos(records: list, bib_number: str) -> list:
    """
    Return list of (record, person_bbox) for every photo in records
    where bib_number appears as primary or related bib.
    """
    hits = []
    for rec in records:
        bbox = None

        # Primary bib
        bp = rec.get("bib_primary")
        if bp and str(bp.get("number", "")) == bib_number:
            bbox = bp["bbox"]

        # Related bibs (if not already matched via primary)
        if bbox is None:
            for br in (rec.get("bib_related") or []):
                if str(br.get("number", "")) == bib_number:
                    bbox = br["bbox"]
                    break

        if bbox is not None:
            hits.append((rec, bbox))

    return hits


# ─────────────────────────────────────────────────────────────────
# Phase B — Extract and score face crops
# ─────────────────────────────────────────────────────────────────

def _face_quality(face_rgb: np.ndarray) -> float:
    """
    Score a face crop by sharpness × size.
    Both components are normalised to 0–1; higher = better headshot.
    """
    h, w = face_rgb.shape[:2]
    grey  = cv2.cvtColor(face_rgb, cv2.COLOR_RGB2GRAY)
    sharp = cv2.Laplacian(grey, cv2.CV_64F).var()

    # 200×200 face at perfect sharpness ≈ 1.0 each
    size_score  = min((h * w) / (200 * 200), 1.0)
    sharp_score = min(sharp / 500.0, 1.0)
    return round(0.5 * size_score + 0.5 * sharp_score, 3)


def _resolve_path(photo_path: str, photos_dir: str) -> Path:
    """Try the path as-is first; then relative to photos_dir."""
    p = Path(photo_path)
    if p.exists():
        return p
    alt = Path(photos_dir) / p
    if alt.exists():
        return alt
    return p   # return original even if missing (caller checks .exists())


def extract_face_crops(bib_photos: list, photos_dir: str,
                       out_dir: Path, bib_number: str,
                       max_faces: int = MAX_FACES_DEFAULT) -> list:
    """
    For each bib photo, detect the face within the person bounding box,
    score by quality (sharpness × size), and save the best max_faces crops
    to out_dir/faces/bib_{number}/.  Crops are chosen from DIFFERENT source
    photos for angular diversity.

    Returns list of dicts:
        {path, source_photo, quality_score, face_bbox_in_image, encoding}
    Note: 'encoding' is a numpy array kept only in memory, not written to JSON.
    """
    fr       = _get_fr()
    face_out = out_dir / "faces" / f"bib_{bib_number}"
    face_out.mkdir(parents=True, exist_ok=True)

    candidates = []   # (quality, face_rgb, encoding, source_path, bbox_in_image)

    print(f"\n[Phase B] Extracting faces from {len(bib_photos)} bib photo(s)...")

    for rec, person_bbox in bib_photos:
        fpath = _resolve_path(rec["file_path"], photos_dir)
        if not fpath.exists():
            print(f"  [skip] file not found: {rec['file_path']}")
            continue

        try:
            bgr = _load_as_bgr(str(fpath), max_px=FACE_LOAD_PX)
        except Exception as exc:
            print(f"  [skip] load error ({fpath.name}): {exc}")
            continue

        rgb     = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        img_h, img_w = rgb.shape[:2]

        # Crop to person bbox with extra headroom above
        px, py, pw, ph = person_bbox
        headroom = int(ph * 0.12)
        y1 = max(0, py - headroom);  y2 = min(img_h, py + ph)
        x1 = max(0, px);             x2 = min(img_w, px + pw)
        person_rgb = rgb[y1:y2, x1:x2]

        if person_rgb.size == 0:
            continue

        # Detect faces inside the person crop (fast HOG model)
        face_locs = fr.face_locations(person_rgb, model="hog")
        if not face_locs:
            print(f"  [skip] no face in person crop: {fpath.name}")
            continue

        # Pick the largest face in the crop
        best_loc = max(face_locs, key=lambda l: (l[2] - l[0]) * (l[1] - l[3]))
        top, right, bottom, left = best_loc
        face_h = bottom - top

        if face_h < FACE_MIN_PX:
            print(f"  [skip] face too small ({face_h}px height): {fpath.name}")
            continue

        face_rgb = person_rgb[top:bottom, left:right]

        try:
            encs = fr.face_encodings(person_rgb, known_face_locations=[best_loc])
        except Exception:
            continue
        if not encs:
            continue

        quality = _face_quality(face_rgb)

        # Convert face bbox back to full-image pixel coordinates
        full_bbox = [x1 + left, y1 + top, right - left, bottom - top]

        candidates.append((quality, face_rgb, encs[0], fpath, full_bbox))
        print(f"  [{fpath.name}]  face {right-left}×{face_h}px  quality={quality:.3f}")

    if not candidates:
        print("  [warning] No usable faces found in any bib photo.")
        return []

    # Sort by quality descending; pick top max_faces from DIFFERENT source photos
    candidates.sort(key=lambda c: c[0], reverse=True)
    seen_sources = set()
    selected     = []
    for c in candidates:
        src = str(c[3])
        if src not in seen_sources:
            selected.append(c)
            seen_sources.add(src)
        if len(selected) >= max_faces:
            break

    # Save headshot images and build result list
    results = []
    for rank, (quality, face_rgb, encoding, src_path, full_bbox) in enumerate(selected, 1):
        save_path = face_out / f"face_{rank:02d}.jpg"
        face_bgr  = cv2.cvtColor(face_rgb, cv2.COLOR_RGB2BGR)
        cv2.imwrite(str(save_path), face_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])
        results.append({
            "path":          str(save_path),
            "source_photo":  str(src_path),
            "quality_score": quality,
            "face_bbox":     full_bbox,   # [x, y, w, h] in full image pixels
            "encoding":      encoding,    # numpy array — in memory only
        })
        print(f"  [saved] face_{rank:02d}.jpg  ← {src_path.name}  quality={quality:.3f}")

    print(f"\n  → {len(results)} headshot(s) saved to {face_out}/")
    return results


# ─────────────────────────────────────────────────────────────────
# Phase C — Scan all photos for face matches
# ─────────────────────────────────────────────────────────────────

def scan_for_face(face_crops: list, records: list, photos_dir: str,
                  bib_number: str, tolerance: float) -> dict:
    """
    Compare known face encodings against every photo in records.

    Returns:
        {
            "with_bib":    list  — photos already known to have this bib (confirmed)
            "without_bib": list  — NEW matches: same person, bib not detected → notify!
        }

    Each match entry:
        {
            "file_path":    str,
            "file_name":    str,
            "match_conf":   float,   # 1.0 - face_distance (higher = more certain)
            "face_bbox":    [x,y,w,h],
            "quality_score": float | None,
            "bib_detected": str | None   # bib_primary number if any
        }
    """
    fr               = _get_fr()
    known_encodings  = [c["encoding"] for c in face_crops]

    # Set of file paths already known to have this bib (from Phase A)
    bib_photo_paths = {
        str(rec["file_path"])
        for rec in records
        if (
            str((rec.get("bib_primary") or {}).get("number", "")) == bib_number
            or any(
                str(b.get("number", "")) == bib_number
                for b in (rec.get("bib_related") or [])
            )
        )
    }

    with_bib    = []
    without_bib = []
    skipped     = 0
    checked     = 0

    total = len(records)
    print(f"\n[Phase C] Scanning {total} photos for face matches "
          f"(tolerance={tolerance})...")
    print(f"  (This may take a few minutes for large albums)")

    for i, rec in enumerate(records, 1):
        fpath = _resolve_path(rec["file_path"], photos_dir)
        if not fpath.exists():
            skipped += 1
            continue

        # Progress indicator every 10 photos
        if i % 10 == 0 or i == total:
            print(f"  {i}/{total}  matches so far: "
                  f"{len(with_bib)} with bib, {len(without_bib)} new", end="\r")

        try:
            bgr = _load_as_bgr(str(fpath), max_px=FACE_LOAD_PX)
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        except Exception:
            skipped += 1
            continue

        face_locs = fr.face_locations(rgb, model="hog")
        if not face_locs:
            continue

        try:
            unknown_encs = fr.face_encodings(rgb, known_face_locations=face_locs)
        except Exception:
            continue

        checked += 1

        for enc, loc in zip(unknown_encs, face_locs):
            distances = fr.face_distance(known_encodings, enc)
            best_dist = float(np.min(distances)) if len(distances) else 1.0

            if best_dist > tolerance:
                continue

            conf = round(1.0 - best_dist, 3)
            top, right, bottom, left = loc

            match = {
                "file_path":     str(rec["file_path"]),
                "file_name":     rec.get("file_name", fpath.name),
                "match_conf":    conf,
                "face_bbox":     [left, top, right - left, bottom - top],
                "quality_score": rec.get("quality_score"),
                "bib_detected":  (rec.get("bib_primary") or {}).get("number"),
            }

            if str(rec["file_path"]) in bib_photo_paths:
                with_bib.append(match)
            else:
                without_bib.append(match)

            break   # one match per photo is enough

    print()  # newline after progress line

    # Sort by confidence descending
    with_bib.sort(   key=lambda m: m["match_conf"], reverse=True)
    without_bib.sort(key=lambda m: m["match_conf"], reverse=True)

    print(f"  Checked {checked} photos with faces  |  "
          f"skipped {skipped} (not found on disk)")

    return {"with_bib": with_bib, "without_bib": without_bib}


# ─────────────────────────────────────────────────────────────────
# Phase D — Save results JSON
# ─────────────────────────────────────────────────────────────────

def save_results(bib_number: str, bib_photos: list, face_crops: list,
                 matches: dict, out_dir: Path) -> Path:
    """
    Write bib_{number}_matches.json.
    The 'encoding' numpy arrays are stripped before serialisation.
    """
    result = {
        "bib_number": bib_number,
        "run_at":     datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),

        # Source bib photos (where the bib number was originally detected)
        "source_photos_count": len(bib_photos),
        "source_photos":       [rec["file_path"] for rec, _ in bib_photos],

        # Saved headshot paths (in out_dir/faces/bib_{number}/)
        "face_crops_saved": [c["path"] for c in face_crops],

        # Summary counts — most important numbers at a glance
        "summary": {
            "total_matches":    len(matches["with_bib"]) + len(matches["without_bib"]),
            "known_bib_photos": len(matches["with_bib"]),
            "new_face_matches": len(matches["without_bib"]),   # ← key result
        },

        # Full match lists
        # with_bib:    confirms the bib_number detection (expected matches)
        # without_bib: same person, bib not detected — send these to the member!
        "matches": {
            "with_bib":    matches["with_bib"],
            "without_bib": matches["without_bib"],
        },
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"bib_{bib_number}_matches.json"

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    return out_file


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def run(args):
    bib_number = str(args.bib).strip()
    out_dir    = Path(args.out)

    print(f"\n{'='*62}")
    print(f"  BIB ANALYZER — #{bib_number}")
    print(f"{'='*62}")
    print(f"  Input JSON  : {args.input}")
    print(f"  Photos dir  : {args.photos_dir}")
    print(f"  Output dir  : {out_dir}")
    print(f"  Tolerance   : {args.tolerance}  (lower = stricter match)")
    print(f"  Max faces   : {args.max_faces}")

    # Load output.json
    input_path = Path(args.input)
    if not input_path.exists():
        print(
            f"\n[error] Input file not found: {args.input}\n"
            f"  Run process_photos.py first to generate output.json.",
            file=sys.stderr,
        )
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        records = json.load(f)
    print(f"\n  Loaded {len(records)} records from {args.input}")

    # ── Phase A ──────────────────────────────────────────────────
    print(f"\n[Phase A] Searching for bib #{bib_number} in output.json...")
    bib_photos = find_bib_photos(records, bib_number)

    if not bib_photos:
        print(
            f"\n[error] Bib #{bib_number} not found in {args.input}.\n"
            f"  Check the bib number, or re-run process_photos.py if photos are new.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"  Found {len(bib_photos)} photo(s) with bib #{bib_number}:")
    for rec, bbox in bib_photos:
        is_primary = str((rec.get("bib_primary") or {}).get("number", "")) == bib_number
        role = "primary" if is_primary else "related"
        print(f"    [{role}] {rec['file_name']}  person_bbox={bbox}")

    # ── Phase B ──────────────────────────────────────────────────
    face_crops = extract_face_crops(
        bib_photos, args.photos_dir, out_dir, bib_number, args.max_faces
    )

    if not face_crops:
        print(
            "\n[error] Could not extract any face crops. Cannot proceed.\n"
            "  Possible reasons:\n"
            "  - Faces are too small or obscured in the bib photos\n"
            "  - The bib was detected on a very distant or partial person\n"
            "  - face_recognition model is not installed correctly",
            file=sys.stderr,
        )
        sys.exit(1)

    # ── Phase C ──────────────────────────────────────────────────
    matches = scan_for_face(
        face_crops, records, args.photos_dir, bib_number, args.tolerance
    )

    # ── Phase D ──────────────────────────────────────────────────
    out_file = save_results(bib_number, bib_photos, face_crops, matches, out_dir)

    # ── Summary ───────────────────────────────────────────────────
    print(f"\n{'─'*62}")
    print(f"  BIB #{bib_number} — COMPLETE")
    print(f"{'─'*62}")
    print(f"  Bib photos found        : {len(bib_photos)}")
    print(f"  Face headshots saved    : {len(face_crops)}")
    print(f"    → {out_dir / 'faces' / ('bib_' + bib_number)}/")
    print(f"  Confirmed (bib visible) : {len(matches['with_bib'])} photos")
    print(f"  NEW matches (no bib)    : {len(matches['without_bib'])} photos  ← send to member")
    print(f"  Results JSON            : {out_file}")

    if matches["without_bib"]:
        print(f"\n  📸  New photos to notify member about:")
        for m in matches["without_bib"][:10]:
            print(f"       {m['file_name']:<40} conf={m['match_conf']:.2f}")
        if len(matches["without_bib"]) > 10:
            remainder = len(matches["without_bib"]) - 10
            print(f"       ... and {remainder} more — see {out_file.name}")

    print(f"{'─'*62}\n")


# ─────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description=(
            "MMR Bib Analyzer — find all photos of a race participant by bib number,\n"
            "extract their face, and match it across the full photo library."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python src/bib_analyzer.py 1330\n"
            "  python src/bib_analyzer.py 1330 --tolerance 0.50\n"
            "  python src/bib_analyzer.py 1330 \\\n"
            "      --input output.json \\\n"
            "      --photos-dir album_mmr/ \\\n"
            "      --out bib_results/\n"
            "\n"
            "Tolerance guide:\n"
            "  0.45  very strict  — only near-identical faces match\n"
            "  0.55  recommended  — good balance (default)\n"
            "  0.65  lenient      — catches more angles, more false positives\n"
        ),
    )
    p.add_argument(
        "bib",
        help="Bib number to search for (e.g. 1330)",
    )
    p.add_argument(
        "--input", default=DEFAULT_INPUT,
        help=f"Path to output.json from process_photos.py (default: {DEFAULT_INPUT})",
    )
    p.add_argument(
        "--photos-dir", default=DEFAULT_PHOTOS,
        help="Root directory of photo files (default: current directory)",
    )
    p.add_argument(
        "--out", default=DEFAULT_OUT,
        help=f"Output directory for headshots and results JSON (default: {DEFAULT_OUT})",
    )
    p.add_argument(
        "--tolerance", type=float, default=DEFAULT_TOLERANCE,
        help=(
            f"Face match tolerance 0.0–1.0, lower = stricter "
            f"(default: {DEFAULT_TOLERANCE})"
        ),
    )
    p.add_argument(
        "--max-faces", type=int, default=MAX_FACES_DEFAULT,
        help=(
            f"Max headshots to extract per bib, from different source photos "
            f"(default: {MAX_FACES_DEFAULT})"
        ),
    )
    return p.parse_args()


if __name__ == "__main__":
    run(parse_args())
