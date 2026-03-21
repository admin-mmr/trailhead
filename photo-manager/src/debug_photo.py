#!/usr/bin/env python3
"""
debug_photo.py — Visual debugger for a single photo

Runs all detection modules on one image and writes an annotated copy
you can open to see exactly what was detected and why.

Usage:
    python src/debug_photo.py album_mmr/20260315_093524(0).jpg
    python src/debug_photo.py album_mmr/IMG_7313.JPG --out debug_out/

Output:
    <out_dir>/<filename>_debug.jpg   — annotated image with boxes + labels
    stdout                            — per-module result table
"""

import argparse
import sys
import json
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from modules.quality import score_image, _load_as_bgr
from modules.people  import detect_people, DETECTION_MAX_PX
from modules.bib_ocr import detect_bibs
from modules.posture import estimate_posture, estimate_bib_facing


# ── Colours (BGR) ─────────────────────────────────────────────────
C_PERSON  = (0, 200, 0)      # green — person box
C_PRIMARY = (0, 100, 255)    # orange — primary bib person
C_BIB     = (255, 80, 0)     # blue  — related bib person
C_LABEL   = (255, 255, 255)  # white text
C_SHADOW  = (0, 0, 0)        # black text shadow


def draw_label(img, text, x, y, colour=C_LABEL, scale=0.55, thickness=1):
    """Draw text with a dark shadow so it's readable on any background."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    # Shadow
    cv2.putText(img, text, (x + 1, y + 1), font, scale, C_SHADOW, thickness + 1, cv2.LINE_AA)
    # Text
    cv2.putText(img, text, (x, y), font, scale, colour, thickness, cv2.LINE_AA)


def draw_box(img, bbox, colour, label_lines):
    """Draw a bounding box with stacked label lines above it."""
    x, y, w, h = bbox
    cv2.rectangle(img, (x, y), (x + w, y + h), colour, 2)
    line_h = 18
    for i, line in enumerate(label_lines):
        ty = y - (len(label_lines) - i) * line_h + line_h - 2
        ty = max(ty, line_h)
        draw_label(img, line, x + 3, ty, colour)


def run_debug(photo_path: str, out_dir: str, skip_modules: set):
    path = Path(photo_path)
    if not path.exists():
        print(f"[error] File not found: {photo_path}", file=sys.stderr)
        sys.exit(1)

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    out_file = out_path / f"{path.stem}_debug.jpg"

    print(f"\n{'='*62}")
    print(f"  DEBUG: {path.name}")
    print(f"{'='*62}")

    # ── Quality ────────────────────────────────────────────────────
    q_result = {}
    if "quality" not in skip_modules:
        q_result = score_image(str(path))
        qs = q_result.get("quality_score")
        qd = q_result.get("quality_detail") or {}
        print(f"\n[quality]")
        print(f"  score      : {qs}")
        if qd:
            print(f"  sharpness  : {qd.get('sharpness')}")
            print(f"  exposure   : {qd.get('exposure')}")
            print(f"  noise      : {qd.get('noise')}")
            print(f"  composition: {qd.get('composition')}")
        if q_result.get("error"):
            print(f"  ERROR      : {q_result['error']}")

    # ── Load image for detection (1280px) ──────────────────────────
    bgr = _load_as_bgr(str(path), max_px=DETECTION_MAX_PX)
    img_h, img_w = bgr.shape[:2]
    annotated = bgr.copy()
    print(f"\n[image] loaded at {img_w}x{img_h}px for detection")

    # ── People ─────────────────────────────────────────────────────
    p_result = {"people_count": None, "people_boxes": []}
    if "people" not in skip_modules:
        p_result = detect_people(bgr)
        boxes    = p_result.get("people_boxes") or []
        print(f"\n[people]")
        print(f"  count  : {p_result.get('people_count')}")
        for i, b in enumerate(boxes):
            pct = f"{b.get('size_frac', 0) * 100:.1f}%"
            print(f"  box[{i}] : bbox={b['bbox']}  conf={b['conf']}  size={pct}")
        if p_result.get("error"):
            print(f"  ERROR  : {p_result['error']}")

    # ── Posture ────────────────────────────────────────────────────
    people_boxes = p_result.get("people_boxes") or []
    if "posture" not in skip_modules and people_boxes:
        people_boxes = estimate_posture(bgr, people_boxes)
        facing_camera = sum(1 for p in people_boxes if p.get("facing") in ("camera", "left", "right"))
        print(f"\n[posture]  ({facing_camera}/{len(people_boxes)} facing camera)")
        for i, b in enumerate(people_boxes):
            print(f"  box[{i}] : posture={b.get('posture')}({b.get('posture_conf'):.2f})"
                  f"  facing={b.get('facing')}({b.get('facing_conf', 0):.2f})")

    # ── Bib OCR ────────────────────────────────────────────────────
    b_result = {"bib_primary": None, "bib_related": []}
    if "bib" not in skip_modules:
        b_result = detect_bibs(bgr, people_boxes)
        bp = b_result.get("bib_primary")
        br = b_result.get("bib_related", [])
        print(f"\n[bib]")
        if bp:
            partial_tag = "  ⚠ PARTIAL" if bp.get("partial") else ""
            print(f"  primary  : #{bp['number']}{partial_tag}  "
                  f"prominence={bp['prominence']}  "
                  f"ocr_conf={bp['ocr_conf']}  "
                  f"size={bp['size_score']}  "
                  f"centrality={bp['centrality']}")
        else:
            print(f"  primary  : none detected")
        for i, b in enumerate(br):
            print(f"  related[{i}]: #{b['number']}  prominence={b['prominence']}  "
                  f"ocr_conf={b['ocr_conf']}")

    # ── Bib facing ─────────────────────────────────────────────────
    if "posture" not in skip_modules and b_result.get("bib_primary"):
        f_result = estimate_bib_facing(bgr, people_boxes, b_result["bib_primary"])
        print(f"\n[bib_facing]")
        print(f"  facing  : {f_result.get('bib_facing')}  "
              f"conf={f_result.get('bib_facing_conf')}")

    # ── Annotate image ─────────────────────────────────────────────
    bp_bbox = (b_result.get("bib_primary") or {}).get("bbox")
    br_bboxes = {tuple(b["bbox"]): b for b in b_result.get("bib_related", [])}

    for i, person in enumerate(people_boxes):
        bbox = person["bbox"]
        posture     = person.get("posture", "")
        posture_c   = person.get("posture_conf", 0)
        person_conf = person.get("conf", 0)

        # Colour: orange if this is the primary bib person, blue if related, green otherwise
        if bbox == bp_bbox:
            colour = C_PRIMARY
            role   = "PRIMARY"
        elif tuple(bbox) in br_bboxes:
            colour = C_BIB
            bib_n  = br_bboxes[tuple(bbox)]["number"]
            role   = f"RELATED #{bib_n}"
        else:
            colour = C_PERSON
            role   = f"person[{i}]"

        facing      = person.get("facing", "")
        facing_c    = person.get("facing_conf", 0)

        size_pct = person.get("size_frac", 0) * 100
        label_lines = [
            f"{role}  det={person_conf:.2f}  sz={size_pct:.1f}%",
        ]
        if posture:
            label_lines.append(f"posture:{posture}({posture_c:.2f})  facing:{facing}({facing_c:.2f})")
        if bbox == bp_bbox and b_result.get("bib_primary"):
            bp = b_result["bib_primary"]
            partial_tag = " PARTIAL" if bp.get("partial") else ""
            label_lines.append(f"bib #{bp['number']}{partial_tag}  ocr={bp['ocr_conf']:.2f}  prom={bp['prominence']:.2f}")

        draw_box(annotated, bbox, colour, label_lines)

        # Draw torso crop outline (where OCR looks for bibs)
        px, py, pw, ph = bbox
        ty1 = py + int(ph * 0.25)
        ty2 = py + int(ph * 0.70)
        cv2.rectangle(annotated, (px, ty1), (px + pw, ty2), (200, 200, 0), 1)

    # ── Legend overlay ─────────────────────────────────────────────
    legend = [
        "GREEN  = person detected",
        "ORANGE = primary bib subject",
        "BLUE   = related bib person",
        "YELLOW = torso crop (OCR search zone)",
    ]
    for i, line in enumerate(legend):
        draw_label(annotated, line, 8, 20 + i * 20, C_LABEL, scale=0.5)

    # ── Quality overlay (top right) ────────────────────────────────
    if q_result.get("quality_score") is not None:
        qs = q_result["quality_score"]
        qd = q_result.get("quality_detail") or {}
        q_lines = [
            f"quality: {qs:.3f}",
            f"  sharp={qd.get('sharpness', '?'):.2f}",
            f"  exp={qd.get('exposure', '?'):.2f}",
            f"  noise={qd.get('noise', '?'):.2f}",
            f"  comp={qd.get('composition', '?'):.2f}",
        ]
        for i, line in enumerate(q_lines):
            x = img_w - 180
            draw_label(annotated, line, x, 20 + i * 20, C_LABEL, scale=0.5)

    # ── Save ───────────────────────────────────────────────────────
    cv2.imwrite(str(out_file), annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(f"\n{'─'*62}")
    print(f"  Annotated image → {out_file}")
    print(f"{'─'*62}\n")


# ──────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Visual debugger for a single photo — shows detection results as an annotated image."
    )
    p.add_argument("photo", help="Path to the photo to debug")
    p.add_argument("--out",  default="debug_out",
                   help="Output directory for the annotated image (default: debug_out/)")
    p.add_argument("--skip", default="",
                   help="Comma-separated modules to skip: quality,people,bib,posture")
    return p.parse_args()


if __name__ == "__main__":
    args   = parse_args()
    skip   = set(s.strip().lower() for s in args.skip.split(",") if s.strip())
    run_debug(args.photo, args.out, skip)
