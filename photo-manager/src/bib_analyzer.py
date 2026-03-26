#!/usr/bin/env python3
"""
bib_analyzer.py — Multi-signal person matching cascade (Phase 3)

Given a bib number, this tool runs a four-phase cascade that combines
three signals — bib number, face recognition, and outfit colour — to
find all photos of a runner across an event album.

Cascade tiers:
    Tier 1 (bib)         — bib clearly readable → definitive ID
    Tier 2 (bib+signals) — partial bib + face/outfit → boosted confidence
    Tier 3 (face+outfit) — no bib visible → face + outfit scan

Phases:
  A. FIND    — search output.json for every photo where that bib was detected
  B. EXTRACT — crop face + extract outfit signature from each bib photo
  C. SCAN    — multi-signal scan: face + outfit + partial bib against all photos
  D. SAVE    — write results JSON with per-signal confidence breakdown

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
from modules.outfit import extract_outfit_signature, match_outfit

# ── Defaults ──────────────────────────────────────────────────────
DEFAULT_INPUT     = "output.json"
DEFAULT_PHOTOS    = "."
DEFAULT_OUT       = "bib_results"
DEFAULT_TOLERANCE = 0.55   # 0.0=strictest, 1.0=loosest; 0.6 is face_recognition default
MAX_FACES_DEFAULT = 5      # max headshots to extract per bib (from different source photos)

FACE_LOAD_PX  = 1280       # load resolution for face detection
FACE_MIN_PX   = 40         # minimum face height in pixels to be usable

# ── Multi-signal fusion weights ──────────────────────────────────
# These control how the three signals combine into a final confidence.
# The cascade uses: final = max(bib_score, W_FACE*face + W_OUTFIT*outfit + W_BIB_PARTIAL*partial_bib)
# A match is accepted when final >= MATCH_THRESHOLD.
#
# Design rationale:
#   - Bib alone is always sufficient (Tier 1) — bypasses the formula entirely
#   - Face (0.45) + outfit (0.35) can reach threshold without any bib (Tier 3)
#   - A weak partial bib (0.20) boosts borderline face/outfit matches (Tier 2)
#   - Neither face nor outfit alone should cross the threshold to prevent
#     false positives from same-outfit different-person (club jerseys)
W_FACE        = 0.45
W_OUTFIT      = 0.35
W_BIB_PARTIAL = 0.20
MATCH_THRESHOLD = 0.45


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
    extract an outfit colour signature from the torso, score by quality,
    and save the best max_faces crops to out_dir/faces/bib_{number}/.
    Crops are chosen from DIFFERENT source photos for angular diversity.

    Returns list of dicts:
        {path, source_photo, quality_score, face_bbox_in_image,
         encoding, outfit_signature}

    'encoding' is a numpy array kept only in memory, not written to JSON.
    'outfit_signature' is the compact dict from modules/outfit.py.
    """
    fr       = _get_fr()
    face_out = out_dir / "faces" / f"bib_{bib_number}"
    face_out.mkdir(parents=True, exist_ok=True)

    # (quality, face_rgb, encoding, source_path, bbox_in_image, outfit_sig)
    candidates = []

    print(f"\n[Phase B] Extracting faces + outfit signatures "
          f"from {len(bib_photos)} bib photo(s)...")

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

        # ── Extract outfit signature from the person bbox ────────
        outfit_sig = extract_outfit_signature(bgr, person_bbox)
        outfit_tag = ""
        if outfit_sig:
            top_color = outfit_sig["dominant_colors"][0]
            outfit_tag = f"  outfit=HSV({top_color[0]},{top_color[1]},{top_color[2]})"

        # ── Crop to person bbox with extra headroom above ────────
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
            print(f"  [skip] no face in person crop: {fpath.name}{outfit_tag}")
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

        candidates.append((quality, face_rgb, encs[0], fpath, full_bbox, outfit_sig))
        print(f"  [{fpath.name}]  face {right-left}\u00d7{face_h}px  "
              f"quality={quality:.3f}{outfit_tag}")

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
    for rank, (quality, face_rgb, encoding, src_path, full_bbox, outfit_sig) in enumerate(selected, 1):
        save_path = face_out / f"face_{rank:02d}.jpg"
        face_bgr  = cv2.cvtColor(face_rgb, cv2.COLOR_RGB2BGR)
        cv2.imwrite(str(save_path), face_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])
        results.append({
            "path":             str(save_path),
            "source_photo":     str(src_path),
            "quality_score":    quality,
            "face_bbox":        full_bbox,         # [x, y, w, h] in full image pixels
            "encoding":         encoding,          # numpy array — in memory only
            "outfit_signature": outfit_sig,        # dict from outfit.py, or None
        })
        print(f"  [saved] face_{rank:02d}.jpg  \u2190 {src_path.name}  quality={quality:.3f}")

    # Build a merged reference outfit from all selected crops
    # (average the signatures for robustness across photos)
    outfit_sigs = [c["outfit_signature"] for c in results if c["outfit_signature"]]
    if outfit_sigs:
        print(f"\n  \u2192 {len(outfit_sigs)} outfit signature(s) extracted as reference")

    print(f"  \u2192 {len(results)} headshot(s) saved to {face_out}/")
    return results


# ─────────────────────────────────────────────────────────────────
# Multi-signal fusion
# ─────────────────────────────────────────────────────────────────

def _partial_bib_score(bib_number: str, rec: dict) -> float:
    """
    Check if the photo has a partial bib reading that could match.

    Returns:
        1.0  — exact full bib match (Tier 1, but handled separately)
        0.3–0.7 — partial match (some digits align)
        0.0  — no bib detected or no overlap

    Partial matching logic: if bib_number is "1330" and the detected
    bib reads "133" or "330" or "13_0", that's a partial hit.
    We score by the fraction of digits that match in sequence.
    """
    detected_bib = str((rec.get("bib_primary") or {}).get("number", ""))
    if not detected_bib:
        return 0.0

    if detected_bib == bib_number:
        return 1.0   # exact match — Tier 1

    # Check if detected is a substring of target or vice versa
    target = bib_number
    detected = detected_bib

    # Longest common substring ratio
    if len(target) == 0:
        return 0.0

    # Simple: check if one contains the other
    if detected in target or target in detected:
        overlap = min(len(detected), len(target))
        ratio = overlap / max(len(target), len(detected))
        return round(min(0.7, ratio), 2)

    # Digit-by-digit comparison (handles transpositions)
    matches = sum(1 for a, b in zip(target, detected) if a == b)
    if matches == 0:
        return 0.0

    return round(min(0.5, matches / len(target)), 2)


def _fuse_signals(face_score: float, outfit_score: float,
                  partial_bib: float) -> float:
    """
    Combine three signals into a final confidence score.

    The formula:
        final = W_FACE * face + W_OUTFIT * outfit + W_BIB_PARTIAL * partial_bib

    Design constraints:
        - face (0.45) + outfit (0.35) can reach threshold without bib
        - outfit alone (0.35 * 1.0 = 0.35) CANNOT reach threshold (0.45)
        - face alone needs ~1.0 score (0.45 * 1.0 = 0.45) — borderline
        - partial_bib boosts borderline cases over the edge
    """
    return round(
        W_FACE * face_score +
        W_OUTFIT * outfit_score +
        W_BIB_PARTIAL * partial_bib,
        4,
    )


# ─────────────────────────────────────────────────────────────────
# Phase C — Multi-signal cascade scan
# ─────────────────────────────────────────────────────────────────

def scan_for_matches(face_crops: list, records: list, photos_dir: str,
                     bib_number: str, tolerance: float) -> dict:
    """
    Multi-signal scan combining face recognition, outfit colour
    matching, and partial bib detection.

    The cascade works in three tiers per photo:

    Tier 1: If this photo's bib_primary exactly matches bib_number,
            it's already confirmed (from Phase A).  Include it with
            full confidence.

    Tier 2: If the photo has a partial/related bib that could match,
            combine the partial bib score with face and/or outfit
            signals.  Two weak signals together can cross the
            threshold.

    Tier 3: No bib at all — rely on face + outfit only.  Both need
            to show reasonable similarity to cross the threshold.

    Returns:
        {
            "with_bib":    list  — Tier 1 confirmed matches
            "without_bib": list  — Tier 2/3 new discoveries
        }

    Each match entry:
        {
            "file_path":      str,
            "file_name":      str,
            "match_conf":     float,   # final fused confidence
            "match_tier":     int,     # 1, 2, or 3
            "signals": {
                "face_score":    float,
                "outfit_score":  float,
                "bib_partial":   float,
            },
            "face_bbox":      [x,y,w,h] | None,
            "quality_score":  float | None,
            "bib_detected":   str | None
        }
    """
    fr               = _get_fr()
    known_encodings  = [c["encoding"] for c in face_crops]
    known_outfits    = [c["outfit_signature"] for c in face_crops
                        if c.get("outfit_signature")]

    # Set of file paths already known to have this exact bib
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
    outfit_only_matches = 0   # count matches where outfit was the deciding signal

    total = len(records)
    print(f"\n[Phase C] Multi-signal cascade scan of {total} photos")
    print(f"  Signals: face (w={W_FACE}) + outfit (w={W_OUTFIT}) "
          f"+ partial_bib (w={W_BIB_PARTIAL})")
    print(f"  Match threshold: {MATCH_THRESHOLD}  |  "
          f"Face tolerance: {tolerance}")
    print(f"  Reference: {len(known_encodings)} face(s), "
          f"{len(known_outfits)} outfit(s)")
    print()

    for i, rec in enumerate(records, 1):
        fpath = _resolve_path(rec["file_path"], photos_dir)
        if not fpath.exists():
            skipped += 1
            continue

        # Progress indicator every 10 photos
        if i % 10 == 0 or i == total:
            print(f"  {i}/{total}  matches: "
                  f"{len(with_bib)} confirmed, {len(without_bib)} new "
                  f"({outfit_only_matches} via outfit)", end="\r")

        try:
            bgr = _load_as_bgr(str(fpath), max_px=FACE_LOAD_PX)
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        except Exception:
            skipped += 1
            continue

        checked += 1

        # ── Signal 1: Partial bib score ──────────────────────────
        partial_bib = _partial_bib_score(bib_number, rec)

        # ── Signal 2: Face recognition ───────────────────────────
        face_score = 0.0
        best_face_bbox = None

        face_locs = fr.face_locations(rgb, model="hog")
        if face_locs:
            try:
                unknown_encs = fr.face_encodings(rgb, known_face_locations=face_locs)
            except Exception:
                unknown_encs = []

            for enc, loc in zip(unknown_encs, face_locs):
                distances = fr.face_distance(known_encodings, enc)
                best_dist = float(np.min(distances)) if len(distances) else 1.0

                # Convert distance to 0–1 score (higher = better match)
                score = max(0.0, 1.0 - best_dist)
                if score > face_score:
                    face_score = score
                    top, right, bottom, left = loc
                    best_face_bbox = [left, top, right - left, bottom - top]

        # ── Signal 3: Outfit colour matching ─────────────────────
        outfit_score = 0.0

        # Try to get outfit signature from the record (if process_photos
        # already extracted it) or compute it live from detected people
        rec_outfits = rec.get("outfit_signatures") or []

        if rec_outfits and known_outfits:
            # Compare each outfit in this photo against our references
            for rec_sig in rec_outfits:
                if rec_sig is None:
                    continue
                for ref_sig in known_outfits:
                    sim = match_outfit(ref_sig, rec_sig)
                    if sim > outfit_score:
                        outfit_score = sim

        elif known_outfits:
            # No pre-computed signatures — extract live from people boxes
            # This handles photos processed before the outfit module existed
            people_boxes = rec.get("people_boxes") or []
            for person in people_boxes:
                bbox = person.get("bbox")
                if bbox is None:
                    continue
                live_sig = extract_outfit_signature(bgr, bbox)
                if live_sig is None:
                    continue
                for ref_sig in known_outfits:
                    sim = match_outfit(ref_sig, live_sig)
                    if sim > outfit_score:
                        outfit_score = sim

        # ── Fuse signals ─────────────────────────────────────────
        fused = _fuse_signals(face_score, outfit_score, partial_bib)

        if fused < MATCH_THRESHOLD:
            continue

        # Determine match tier
        if partial_bib >= 1.0:
            tier = 1
        elif partial_bib > 0.0:
            tier = 2
        else:
            tier = 3

        # Track outfit-driven matches for reporting
        if face_score < 0.3 and outfit_score > 0.5:
            outfit_only_matches += 1

        match = {
            "file_path":     str(rec["file_path"]),
            "file_name":     rec.get("file_name", fpath.name),
            "match_conf":    fused,
            "match_tier":    tier,
            "signals": {
                "face_score":  round(face_score, 3),
                "outfit_score": round(outfit_score, 3),
                "bib_partial": round(partial_bib, 3),
            },
            "face_bbox":     best_face_bbox,
            "quality_score": rec.get("quality_score"),
            "bib_detected":  (rec.get("bib_primary") or {}).get("number"),
        }

        if str(rec["file_path"]) in bib_photo_paths:
            with_bib.append(match)
        else:
            without_bib.append(match)

    print()  # newline after progress line

    # Sort by confidence descending
    with_bib.sort(   key=lambda m: m["match_conf"], reverse=True)
    without_bib.sort(key=lambda m: m["match_conf"], reverse=True)

    print(f"  Checked {checked} photos  |  skipped {skipped} (not found)")
    print(f"  Tier breakdown of new matches:")
    tier_counts = {1: 0, 2: 0, 3: 0}
    for m in without_bib:
        tier_counts[m["match_tier"]] = tier_counts.get(m["match_tier"], 0) + 1
    print(f"    Tier 2 (partial bib + signals): {tier_counts[2]}")
    print(f"    Tier 3 (face + outfit only):    {tier_counts[3]}")
    if outfit_only_matches:
        print(f"    Outfit-driven (weak face):      {outfit_only_matches}")

    return {"with_bib": with_bib, "without_bib": without_bib}


# ─────────────────────────────────────────────────────────────────
# Phase D — Save results JSON
# ─────────────────────────────────────────────────────────────────

def save_results(bib_number: str, bib_photos: list, face_crops: list,
                 matches: dict, out_dir: Path) -> Path:
    """
    Write bib_{number}_matches.json.
    The 'encoding' numpy arrays and outfit signatures from face_crops
    are stripped before serialisation.
    """
    # Count matches by tier
    tier_counts = {1: 0, 2: 0, 3: 0}
    for m in matches.get("without_bib", []):
        t = m.get("match_tier", 3)
        tier_counts[t] = tier_counts.get(t, 0) + 1

    result = {
        "bib_number": bib_number,
        "run_at":     datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version":    "2.0-cascade",

        # Cascade configuration (for reproducibility)
        "cascade_config": {
            "weights": {"face": W_FACE, "outfit": W_OUTFIT, "bib_partial": W_BIB_PARTIAL},
            "match_threshold": MATCH_THRESHOLD,
        },

        # Source bib photos (where the bib number was originally detected)
        "source_photos_count": len(bib_photos),
        "source_photos":       [rec["file_path"] for rec, _ in bib_photos],

        # Saved headshot paths (in out_dir/faces/bib_{number}/)
        "face_crops_saved": [c["path"] for c in face_crops],

        # Summary counts — most important numbers at a glance
        "summary": {
            "total_matches":       len(matches["with_bib"]) + len(matches["without_bib"]),
            "known_bib_photos":    len(matches["with_bib"]),
            "new_matches":         len(matches["without_bib"]),
            "tier_2_partial_bib":  tier_counts[2],
            "tier_3_face_outfit":  tier_counts[3],
        },

        # Full match lists with per-signal breakdown
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
    matches = scan_for_matches(
        face_crops, records, args.photos_dir, bib_number, args.tolerance
    )

    # ── Phase D ──────────────────────────────────────────────────
    out_file = save_results(bib_number, bib_photos, face_crops, matches, out_dir)

    # ── Summary ───────────────────────────────────────────────────
    tier_2 = sum(1 for m in matches["without_bib"] if m.get("match_tier") == 2)
    tier_3 = sum(1 for m in matches["without_bib"] if m.get("match_tier") == 3)

    print(f"\n{'─'*62}")
    print(f"  BIB #{bib_number} — COMPLETE (multi-signal cascade v2)")
    print(f"{'─'*62}")
    print(f"  Bib photos found         : {len(bib_photos)}")
    print(f"  Face headshots saved     : {len(face_crops)}")
    print(f"    \u2192 {out_dir / 'faces' / ('bib_' + bib_number)}/")
    print(f"  Confirmed (bib visible)  : {len(matches['with_bib'])} photos")
    print(f"  NEW matches              : {len(matches['without_bib'])} photos  \u2190 send to member")
    print(f"    Tier 2 (partial bib)   : {tier_2}")
    print(f"    Tier 3 (face+outfit)   : {tier_3}")
    print(f"  Results JSON             : {out_file}")

    if matches["without_bib"]:
        print(f"\n  New photos to notify member about:")
        for m in matches["without_bib"][:10]:
            sig = m.get("signals", {})
            tier_label = f"T{m.get('match_tier', '?')}"
            face_tag = f"face={sig.get('face_score', 0):.2f}"
            outfit_tag = f"outfit={sig.get('outfit_score', 0):.2f}"
            print(f"       {m['file_name']:<35} conf={m['match_conf']:.2f} "
                  f"[{tier_label}] {face_tag} {outfit_tag}")
        if len(matches["without_bib"]) > 10:
            remainder = len(matches["without_bib"]) - 10
            print(f"       ... and {remainder} more \u2014 see {out_file.name}")

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
