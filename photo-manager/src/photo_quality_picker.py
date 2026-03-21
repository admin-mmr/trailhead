#!/usr/bin/env python3
"""
photo_quality_picker.py — Filter photos from output.json by quality score.

Usage:
    python photo_quality_picker.py --input output.json --cutoff 0.7 --type best --max 20
    python photo_quality_picker.py --input output.json --cutoff 0.5 --type worst --max 10
    python photo_quality_picker.py --input output.json --cutoff 0.6 --type best
      (omit --max to return all that qualify)

Arguments:
    --input   Path to output.json produced by process_photos.py
    --cutoff  Quality score threshold (0.0 – 1.0)
    --type    'best'  → photos AT OR ABOVE the cutoff, sorted highest first
              'worst' → photos BELOW the cutoff, sorted lowest first
    --max     Maximum number of results to return (optional)
    --output  Optional: save filtered results to a new JSON file
"""

import argparse
import json
import sys
from pathlib import Path


def load_results(input_path: str) -> list:
    p = Path(input_path)
    if not p.exists():
        print(f"[error] File not found: {input_path}", file=sys.stderr)
        sys.exit(1)
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        print("[error] Expected a JSON array in input file.", file=sys.stderr)
        sys.exit(1)
    return data


def pick(records: list, cutoff: float, filter_type: str, max_count) -> list:
    # Only work with records that have a score (skip errored files)
    scoreable = [r for r in records if r.get("quality_score") is not None]

    if filter_type == "best":
        pool = [r for r in scoreable if r["quality_score"] >= cutoff]
        pool.sort(key=lambda r: r["quality_score"], reverse=True)
    else:  # worst
        pool = [r for r in scoreable if r["quality_score"] < cutoff]
        pool.sort(key=lambda r: r["quality_score"])  # lowest first

    if max_count is not None and len(pool) > max_count:
        return pool[:max_count]
    return pool


def print_results(results: list, filter_type: str, cutoff: float, total_input: int):
    label = "above" if filter_type == "best" else "below"
    print(f"\n{'='*62}")
    print(f"  Filter : {filter_type.upper()}  |  cutoff {cutoff}  |  ({label} threshold)")
    print(f"  Input  : {total_input} photos total")
    print(f"  Output : {len(results)} photos")
    print(f"{'='*62}")

    if not results:
        print("  (no photos matched)")
        return

    for r in results:
        score = r["quality_score"]
        d = r.get("quality_detail") or {}
        flag = "🟢" if score >= 0.75 else ("🟡" if score >= 0.5 else "🔴")
        name = r.get("file_name", Path(r["file_path"]).name)
        detail = (
            f"sharp={d.get('sharpness', '?'):.2f}  "
            f"exp={d.get('exposure', '?'):.2f}  "
            f"noise={d.get('noise', '?'):.2f}  "
            f"comp={d.get('composition', '?'):.2f}"
            if d else ""
        )
        print(f"  {flag} {score:.3f}  {name:<42}  {detail}")

    scores = [r["quality_score"] for r in results]
    print(f"{'─'*62}")
    print(f"  Score range: {min(scores):.3f} – {max(scores):.3f}  |  mean: {sum(scores)/len(scores):.3f}")
    print()


def main():
    p = argparse.ArgumentParser(
        description="Filter photos from output.json by quality score.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--input",  required=True, help="Path to output.json")
    p.add_argument("--cutoff", required=True, type=float,
                   help="Quality score threshold (0.0 – 1.0)")
    p.add_argument("--type",   required=True, choices=["best", "worst"],
                   help="'best' = at/above cutoff, 'worst' = below cutoff")
    p.add_argument("--max",    type=int, default=None,
                   help="Maximum number of results (default: all that qualify)")
    p.add_argument("--output", default=None,
                   help="Optional: save filtered results to this JSON file")
    args = p.parse_args()

    if not 0.0 <= args.cutoff <= 1.0:
        print("[error] --cutoff must be between 0.0 and 1.0", file=sys.stderr)
        sys.exit(1)

    records = load_results(args.input)
    results = pick(records, args.cutoff, args.type, args.max)
    print_results(results, args.type, args.cutoff, len(records))

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"  Saved → {args.output}\n")


if __name__ == "__main__":
    main()
