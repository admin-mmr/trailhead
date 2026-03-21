#!/usr/bin/env python3
"""
process_photos.py — MMR Photo Manager entry point

Usage:
    python process_photos.py --input-dir /path/to/photos --output results.json

Full usage:
    python process_photos.py \\
        --input-dir  /path/to/photos    \\
        --output     output.json        \\
        [--skip      quality,posture]   \\  skip specific modules
        [--resume]                      \\  skip already-processed files
        [--workers   4]                 \\  parallel threads
        [--min-quality 0.3]             \\  filter below this score from output
        [--limit 50]                       process only first N images (for testing)

Available modules (use with --skip):
    quality   photo quality scorer
    people    person detection + count
    bib       bib number OCR
    posture   running posture + bib facing direction
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, str(Path(__file__).parent))

from modules.walker  import find_images
from modules.quality import score_image, _load_as_bgr

try:
    from tqdm import tqdm
    _TQDM = True
except ImportError:
    _TQDM = False

VERSION     = "1.2.0-phase2"
ALL_MODULES = {"quality", "people", "bib", "posture"}

# ── Lazy module loaders ───────────────────────────────────────────
_cache = {}

def _mod(name):
    if name not in _cache:
        if name == "people":
            from modules import people;  _cache[name] = people
        elif name == "bib":
            from modules import bib_ocr; _cache[name] = bib_ocr
        elif name == "posture":
            from modules import posture;  _cache[name] = posture
    return _cache.get(name)


# ──────────────────────────────────────────────────────────────────
# Result builder
# ──────────────────────────────────────────────────────────────────

def make_empty_record(image_info: dict) -> dict:
    return {
        "file_path":    image_info["file_path"],
        "file_name":    image_info["file_name"],
        "size_bytes":   image_info["size_bytes"],
        "processed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        # quality
        "quality_score":  None,
        "quality_detail": None,
        # people
        "people_count":         None,
        "people_facing_camera": None,
        "people_boxes":         None,
        # bib
        "bib_primary":  None,
        "bib_related":  [],
        # posture
        "bib_facing":       None,
        "bib_facing_conf":  None,
        # face recognition — Phase 3 placeholder
        "face_count":   None,
        "face_matches": None,
        # errors
        "error": None,
    }


# ──────────────────────────────────────────────────────────────────
# Per-image processor
# ──────────────────────────────────────────────────────────────────

def process_one(image_info: dict, skip: set) -> dict:
    record = make_empty_record(image_info)

    try:
        # ── Quality ───────────────────────────────────────────────
        if "quality" not in skip:
            q = score_image(image_info["file_path"])
            record["quality_score"]  = q.get("quality_score")
            record["quality_detail"] = q.get("quality_detail")
            if q.get("error"):
                record["error"] = q["error"]

        # Skip remaining modules if all three downstream are skipped
        if {"people", "bib", "posture"}.issubset(skip):
            return record

        # Load image once — shared by all downstream modules.
        # Use 1280px for detection (people/bib need more detail than quality scoring).
        try:
            from modules.people import DETECTION_MAX_PX
            bgr = _load_as_bgr(image_info["file_path"], max_px=DETECTION_MAX_PX)
        except Exception as exc:
            record["error"] = f"image load error: {exc}"
            return record

        # ── People detection ──────────────────────────────────────
        people_boxes = []
        if "people" not in skip:
            p_result = _mod("people").detect_people(bgr)
            record["people_count"] = p_result.get("people_count")
            record["people_boxes"] = p_result.get("people_boxes")
            people_boxes = p_result.get("people_boxes") or []
            if p_result.get("error") and not record["error"]:
                record["error"] = p_result["error"]

        # ── Posture (needs people boxes) ──────────────────────────
        if "posture" not in skip and people_boxes:
            enriched = _mod("posture").estimate_posture(bgr, people_boxes)
            record["people_boxes"] = enriched   # replace with posture-annotated version
            people_boxes = enriched
            # Count how many people are facing the camera
            facing_camera = sum(
                1 for p in enriched
                if p.get("facing") in ("camera", "left", "right")
            )
            record["people_facing_camera"] = facing_camera

        # ── Bib OCR ───────────────────────────────────────────────
        if "bib" not in skip:
            b_result = _mod("bib").detect_bibs(bgr, people_boxes)
            record["bib_primary"] = b_result.get("bib_primary")
            record["bib_related"] = b_result.get("bib_related", [])

            # ── Bib facing direction (needs bib_primary) ──────────
            if "posture" not in skip and record["bib_primary"] is not None:
                f_result = _mod("posture").estimate_bib_facing(
                    bgr, people_boxes, record["bib_primary"]
                )
                record["bib_facing"]      = f_result.get("bib_facing")
                record["bib_facing_conf"] = f_result.get("bib_facing_conf")

        # ── Face recognition — Phase 3 placeholder ────────────────
        # if "faces" not in skip:
        #     record.update(detect_faces(bgr))

    except Exception as exc:
        record["error"] = f"Unhandled error: {exc}"

    return record


# ──────────────────────────────────────────────────────────────────
# JSON I/O
# ──────────────────────────────────────────────────────────────────

def load_existing_results(output_path: str) -> dict:
    p = Path(output_path)
    if not p.exists():
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return {r["file_path"]: r for r in data if "file_path" in r}
    except (json.JSONDecodeError, KeyError):
        pass
    return {}


class _NumpySafeEncoder(json.JSONEncoder):
    """Coerce numpy scalars to plain Python types before JSON serialisation.
    Prevents 'Object of type numpy.bool_ is not JSON serializable' errors."""
    def default(self, obj):
        import numpy as np
        if isinstance(obj, np.bool_):
            return bool(obj)
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


def save_results(records: list, output_path: str):
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False, cls=_NumpySafeEncoder)


# ──────────────────────────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────────────────────────

def run(args):
    skip = set(s.strip().lower() for s in (args.skip or "").split(",") if s.strip())
    unknown = skip - ALL_MODULES
    if unknown:
        print(f"[error] Unknown module(s) in --skip: {unknown}. "
              f"Valid: {', '.join(sorted(ALL_MODULES))}", file=sys.stderr)
        sys.exit(1)

    active = sorted(ALL_MODULES - skip)

    print(f"\n{'='*60}")
    print(f"  MMR Photo Manager v{VERSION}")
    print(f"{'='*60}")
    print(f"  Input dir : {args.input_dir}")
    print(f"  Output    : {args.output}")
    print(f"  Active    : {', '.join(active)}")
    if skip:
        print(f"  Skipped   : {', '.join(sorted(skip))}")
    print(f"  Resume    : {args.resume}")
    print(f"  Workers   : {args.workers}")
    if args.min_quality:
        print(f"  Min quality filter : {args.min_quality}")
    if args.limit:
        print(f"  Limit     : {args.limit} images (test mode)")
    print()

    images = find_images(args.input_dir)
    if args.limit:
        images = images[:args.limit]
        print(f"[main] Test mode — processing first {len(images)} images\n")

    if not images:
        print("[main] No images found. Exiting.")
        return

    existing = {}
    if args.resume:
        existing = load_existing_results(args.output)
        before = len(images)
        images = [img for img in images if img["file_path"] not in existing]
        print(f"[main] Resume: {before - len(images)} done, {len(images)} remaining\n")

    if not images:
        print("[main] All images already processed. Nothing to do.")
        save_results(list(existing.values()), args.output)
        return

    results_map = dict(existing)
    errors = 0

    def _worker(img_info):
        return process_one(img_info, skip=skip)

    if args.workers > 1:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(_worker, img): img for img in images}
            iterator = as_completed(futures)
            if _TQDM:
                iterator = tqdm(iterator, total=len(futures), desc="Processing", unit="photo")
            for future in iterator:
                record = future.result()
                results_map[record["file_path"]] = record
                if record.get("error"):
                    errors += 1
    else:
        iterator = tqdm(images, desc="Processing", unit="photo") if _TQDM else images
        for img_info in iterator:
            record = _worker(img_info)
            results_map[record["file_path"]] = record
            if record.get("error"):
                errors += 1

    all_records = list(results_map.values())

    if args.min_quality is not None:
        before_filter = len(all_records)
        all_records = [
            r for r in all_records
            if r.get("quality_score") is None
            or r["quality_score"] >= args.min_quality
        ]
        filtered = before_filter - len(all_records)
        if filtered:
            print(f"\n[main] Filtered {filtered} images below quality threshold {args.min_quality}")

    all_records.sort(key=lambda r: r["file_path"])
    save_results(all_records, args.output)

    # ── Summary ───────────────────────────────────────────────────
    processed   = len(all_records)
    scored      = sum(1 for r in all_records if r.get("quality_score") is not None)
    mean_q      = (sum(r["quality_score"] for r in all_records
                       if r.get("quality_score") is not None) / scored) if scored else 0
    with_people = sum(1 for r in all_records if r.get("people_count") is not None)
    with_bib    = sum(1 for r in all_records if r.get("bib_primary") is not None)
    with_facing = sum(1 for r in all_records if r.get("bib_facing") is not None)

    print(f"\n{'─'*60}")
    print(f"  Processed        : {processed}")
    print(f"  Errors           : {errors}")
    if "quality" not in skip:
        print(f"  Quality scored   : {scored}  (mean {mean_q:.3f})")
    if "people" not in skip:
        if with_people:
            mean_p = sum(r["people_count"] for r in all_records
                         if r.get("people_count") is not None) / with_people
            print(f"  People detected  : {with_people} photos  (mean {mean_p:.1f}/photo)")
    if "bib" not in skip:
        print(f"  Primary bib found: {with_bib} photos")
        related_total = sum(len(r.get("bib_related") or []) for r in all_records)
        print(f"  Related bibs     : {related_total} total")
    if "posture" not in skip and with_facing:
        print(f"  Bib facing tagged: {with_facing} photos")
    print(f"  Output           : {args.output}")
    print(f"{'─'*60}\n")


# ──────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="MMR Photo Manager — local photo processing pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Modules: quality, people, bib, posture\n"
            "Example: --skip quality,posture   (run only people + bib)"
        ),
    )
    p.add_argument("--input-dir",  required=True,
                   help="Directory of photos to process")
    p.add_argument("--output",     default="output.json",
                   help="Output JSON file path (default: output.json)")
    p.add_argument("--skip",       default="",
                   help="Comma-separated modules to skip: quality,people,bib,posture")
    p.add_argument("--resume",     action="store_true",
                   help="Skip images already in the output file")
    p.add_argument("--workers",    type=int, default=1,
                   help="Parallel worker threads (default: 1)")
    p.add_argument("--min-quality",type=float, default=None,
                   help="Minimum quality score to include in output (0.0–1.0)")
    p.add_argument("--limit",      type=int, default=None,
                   help="Process only first N images (for testing)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(args)
