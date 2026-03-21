#!/usr/bin/env python3
"""
test_azure.py — Azure Face API smoke test for MMR Photo Manager

Tests three things in order:
  1. CONNECTION     — can we reach the Azure Face API with the stored credentials?
  2. DETECTION      — detect faces in a sample of album photos
  3. VERIFICATION   — compare two photos to see if they show the same person
                      (useful before attempting full PersonGroup enrollment)

Usage
-----
  # Basic: detect faces in 5 random album photos
  python src/test_azure.py

  # Point to a specific album
  python src/test_azure.py --album album_mmr

  # Run on more photos
  python src/test_azure.py --limit 20

  # Also run a verification test between two specific photos
  python src/test_azure.py --verify album_mmr/IMG_2655.JPG album_newbee/20260315-DSC_7737.jpg

  # Show the PersonGroup enrollment demo (does NOT need Limited Access)
  python src/test_azure.py --demo-enroll

Setup
-----
  1. pip install azure-ai-vision-face python-dotenv
  2. Copy .env.local.example → .env.local and fill in your Azure keys
  3. Run this script from the photo-manager root directory
"""

import argparse
import json
import sys
import random
from pathlib import Path

# Allow running from the repo root or from src/
sys.path.insert(0, str(Path(__file__).parent))

from modules.walker     import find_images
from modules.azure_face import (
    detect_faces,
    verify_faces,
    create_person_group,
    add_member_photo,
    train_group,
    identify_faces,
)


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

PASS = "✅"
FAIL = "❌"
WARN = "⚠️ "


def _section(title: str):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print(f"{'─'*60}")


def _summarise_face(f: dict, idx: int) -> str:
    bbox = f["bbox"]
    lines = [f"  Face {idx+1}: bbox=[{bbox[0]},{bbox[1]},{bbox[2]}×{bbox[3]}]"]
    if f.get("head_pose"):
        p = f["head_pose"]
        lines.append(f"    Head pose  — pitch={p['pitch']:.1f}  roll={p['roll']:.1f}  yaw={p['yaw']:.1f}")
    if f.get("blur"):
        b = f["blur"]
        lines.append(f"    Blur       — {b['level']}  ({b['value']})")
    if f.get("exposure"):
        e = f["exposure"]
        lines.append(f"    Exposure   — {e['level']}  ({e['value']})")
    if f.get("noise"):
        n = f["noise"]
        lines.append(f"    Noise      — {n['level']}  ({n['value']})")
    if f.get("occlusion"):
        o = f["occlusion"]
        occluded = [k for k, v in o.items() if v]
        lines.append(f"    Occlusion  — {', '.join(occluded) if occluded else 'none'}")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────
# Step 1 — Connection test
# ─────────────────────────────────────────────────────────────────

def test_connection(album_dir: str) -> bool:
    _section("STEP 1 — Connection Test")
    images = find_images(album_dir)
    if not images:
        print(f"{FAIL}  No images found in {album_dir}")
        return False

    test_photo = images[0]["file_path"]
    print(f"  Testing with: {test_photo}")

    result = detect_faces(test_photo, return_attributes=False)
    if result.get("error"):
        print(f"{FAIL}  {result['error']}")
        print()
        print("  Checklist:")
        print("    1. Did you copy .env.local.example → .env.local ?")
        print("    2. Did you fill in AZURE_FACE_KEY and AZURE_FACE_ENDPOINT ?")
        print("    3. Is the Face resource 'Enabled' in Azure Portal ?")
        return False

    print(f"{PASS}  Connection OK  —  {result['face_count']} face(s) detected in test photo")
    return True


# ─────────────────────────────────────────────────────────────────
# Step 2 — Face detection on a sample of album photos
# ─────────────────────────────────────────────────────────────────

def test_detection(album_dir: str, limit: int) -> list:
    _section(f"STEP 2 — Face Detection  ({limit} photos from {album_dir})")

    images = find_images(album_dir)
    if not images:
        print(f"{FAIL}  No images found in {album_dir}")
        return []

    # Take a reproducible random sample — skip very small files (thumbnails)
    images = [img for img in images if img["size_bytes"] > 50_000]
    random.seed(42)
    sample = random.sample(images, min(limit, len(images)))

    print(f"  Sampling {len(sample)} of {len(images)} images  ({limit} requested)\n")

    results  = []
    detected = 0
    total_faces = 0

    for i, img in enumerate(sample, 1):
        fname = Path(img["file_path"]).name
        result = detect_faces(img["file_path"])

        if result.get("error"):
            print(f"  [{i:2d}/{len(sample)}]  {FAIL}  {fname}")
            print(f"           Error: {result['error']}")
        else:
            n = result["face_count"]
            icon = PASS if n > 0 else "  "
            print(f"  [{i:2d}/{len(sample)}]  {icon}  {fname}  —  {n} face(s)")
            for fi, face in enumerate(result["faces"]):
                print(_summarise_face(face, fi))
            if n > 0:
                detected += 1
                total_faces += n

        results.append(result)

    print(f"\n  ── Summary ──────────────────────────────")
    print(f"  Photos with ≥1 face : {detected} / {len(sample)}")
    print(f"  Total faces found   : {total_faces}")
    if detected:
        print(f"  Mean faces / photo  : {total_faces/detected:.1f}")

    return results


# ─────────────────────────────────────────────────────────────────
# Step 3 — Verification (1:1 same-person check)
# ─────────────────────────────────────────────────────────────────

def test_verification(photo_a: str, photo_b: str):
    _section("STEP 3 — Face Verification (1:1)")
    print(f"  Photo A : {photo_a}")
    print(f"  Photo B : {photo_b}\n")

    result = verify_faces(photo_a, photo_b)

    if result.get("error"):
        print(f"{FAIL}  {result['error']}")
        return

    icon = PASS if result["is_identical"] else FAIL
    match = "SAME person" if result["is_identical"] else "DIFFERENT people"
    print(f"  {icon}  Result     : {match}")
    print(f"      Confidence : {result['confidence']:.4f}  (threshold {result['threshold']})")
    print()
    print("  Interpretation guide:")
    print(f"    ≥ 0.70  Very confident same person")
    print(f"    0.50–0.70  Likely same person")
    print(f"    < 0.50  Likely different people")


# ─────────────────────────────────────────────────────────────────
# Demo — PersonGroup enrollment (no Identify call — avoids 403)
# ─────────────────────────────────────────────────────────────────

def demo_enroll(album_dir: str):
    _section("DEMO — PersonGroup Enrollment")
    print("  This demo creates a PersonGroup and enrolls one test member.")
    print("  It does NOT call Identify (which requires Limited Access approval).")
    print("  Use this to verify your setup before applying for approval.\n")

    # 1. Create group
    print("  → Creating PersonGroup 'mmr-members' ...")
    g = create_person_group()
    if g.get("error"):
        print(f"{FAIL}  {g['error']}")
        return
    print(f"{PASS}  Group ready")

    # 2. Pick a photo with a face from the album
    images = find_images(album_dir)
    images = [img for img in images if img["size_bytes"] > 50_000]
    for img in images:
        det = detect_faces(img["file_path"], return_attributes=False)
        if det["face_count"] > 0:
            test_photo = img["file_path"]
            print(f"\n  → Using test photo: {test_photo}")
            print(f"    (has {det['face_count']} face(s) — enrolling the first face)")
            break
    else:
        print(f"{WARN}  No photo with a face found in {album_dir}. Cannot demo enrollment.")
        return

    # 3. Enroll the test member
    print("\n  → Enrolling test member A0001 / Test Runner ...")
    m = add_member_photo(
        member_id="A0001",
        name="Test Runner",
        photo_path=test_photo,
    )
    if m.get("error"):
        print(f"{FAIL}  {m['error']}")
        return
    print(f"{PASS}  Enrolled  person_id={m['person_id']}  face_id={m['face_id']}")

    # 4. Train the group
    print("\n  → Training PersonGroup (takes ~10–30 seconds for small groups) ...")
    t = train_group(wait=True)
    if t.get("error"):
        print(f"{FAIL}  {t['error']}")
        return
    print(f"{PASS}  Training complete  status={t['status']}")

    print()
    print("  PersonGroup is ready for Identify calls.")
    print("  To use Identify, apply for Limited Access: https://aka.ms/facerecognition")
    print("  Once approved, call identify_faces(event_photo_path) from azure_face.py")


# ─────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Azure Face API smoke test for MMR Photo Manager",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python src/test_azure.py\n"
            "  python src/test_azure.py --album album_mmr --limit 10\n"
            "  python src/test_azure.py --verify photo_a.jpg photo_b.jpg\n"
            "  python src/test_azure.py --demo-enroll\n"
        ),
    )
    p.add_argument("--album",  default="album_newbee",
                   help="Album directory to sample from (default: album_newbee)")
    p.add_argument("--limit",  type=int, default=5,
                   help="Number of photos to sample for detection test (default: 5)")
    p.add_argument("--verify", nargs=2, metavar=("PHOTO_A", "PHOTO_B"),
                   help="Run verification test between two photos")
    p.add_argument("--demo-enroll", action="store_true",
                   help="Run the PersonGroup enrollment demo")
    p.add_argument("--save",   default=None,
                   help="Save detection results to a JSON file")
    return p.parse_args()


def main():
    args = parse_args()

    print(f"\n{'='*60}")
    print(f"  MMR Photo Manager — Azure Face API Test")
    print(f"{'='*60}")
    print(f"  Album : {args.album}")
    print(f"  Limit : {args.limit}")

    # Step 1 — Connection
    if not test_connection(args.album):
        sys.exit(1)

    # Step 2 — Detection
    detection_results = test_detection(args.album, args.limit)

    if args.save and detection_results:
        import json as _json
        out = args.save
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w") as f:
            _json.dump(detection_results, f, indent=2, default=str)
        print(f"\n  Results saved → {out}")

    # Step 3 — Verification (optional)
    if args.verify:
        test_verification(args.verify[0], args.verify[1])

    # Demo — Enrollment (optional)
    if args.demo_enroll:
        demo_enroll(args.album)

    _section("Done")
    print("  Next steps:")
    print("  1. If detection works, review the face attributes above.")
    print("     Good photo signals: blur=low, exposure=goodExposure, occlusion=none")
    print("  2. Run --demo-enroll to test PersonGroup creation and member enrollment.")
    print("  3. Apply for Limited Access if you need 1:N face identification:")
    print("     https://aka.ms/facerecognition")
    print("  4. Once approved, call identify_faces() in azure_face.py directly.")
    print()


if __name__ == "__main__":
    main()
