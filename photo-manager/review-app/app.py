"""
MMR Photo Review App — Human-in-the-loop annotation tool

A Flask webapp for reviewing pipeline detection results, annotating
photos with human feedback, managing member↔bib mappings, and editing
NYRR runner identification info.

Usage:
    cd photo-manager/review-app
    pip install -r requirements.txt
    python app.py --output ../output.json --photos ../album_mmr

Then open http://localhost:5050 in your browser.

Features:
    /                   Dashboard with stats + filters
    /review/<idx>       Single-photo review with detection overlays
    /members            Member-bib mapping editor
    /nyrr               NYRR runner info editor
    /api/...            JSON endpoints for AJAX updates
"""

import argparse
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import (
    Flask, render_template, request, jsonify, send_file, abort, g, redirect,
    url_for,
)

app = Flask(__name__)

# ── Configuration (set via CLI args or env vars) ─────────────────
app.config["OUTPUT_JSON"] = os.environ.get("OUTPUT_JSON", "../output.json")
app.config["PHOTOS_DIR"] = os.environ.get("PHOTOS_DIR", "..")
app.config["BIB_RESULTS_DIR"] = os.environ.get("BIB_RESULTS_DIR", "../bib_results")
app.config["DB_PATH"] = os.environ.get("DB_PATH", "review.db")


# ─────────────────────────────────────────────────────────────────
# Database helpers
# ─────────────────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DB_PATH"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(app.config["DB_PATH"])
    schema_path = Path(__file__).parent / "schema.sql"
    with open(schema_path) as f:
        db.executescript(f.read())
    db.close()


# ─────────────────────────────────────────────────────────────────
# Data loading
# ─────────────────────────────────────────────────────────────────

_records_cache = None
_records_mtime = 0


def load_records():
    """Load output.json with simple mtime-based cache."""
    global _records_cache, _records_mtime
    path = Path(app.config["OUTPUT_JSON"])
    if not path.exists():
        return []
    mtime = path.stat().st_mtime
    if _records_cache is None or mtime > _records_mtime:
        with open(path, "r", encoding="utf-8") as f:
            _records_cache = json.load(f)
        _records_mtime = mtime
    return _records_cache


def resolve_photo_path(file_path: str) -> Path:
    """Resolve a photo path from output.json to an actual file."""
    p = Path(file_path)
    if p.exists():
        return p
    alt = Path(app.config["PHOTOS_DIR"]) / p
    if alt.exists():
        return alt
    alt2 = Path(app.config["PHOTOS_DIR"]) / p.name
    if alt2.exists():
        return alt2
    return p


# ─────────────────────────────────────────────────────────────────
# Routes: Dashboard
# ─────────────────────────────────────────────────────────────────

@app.route("/")
def dashboard():
    records = load_records()
    db = get_db()

    # Get annotation stats
    stats = db.execute("""
        SELECT review_status, COUNT(*) as cnt
        FROM photo_annotations
        GROUP BY review_status
    """).fetchall()
    status_counts = {row["review_status"]: row["cnt"] for row in stats}

    # Difficulty breakdown
    diff_stats = db.execute("""
        SELECT difficulty, COUNT(*) as cnt
        FROM photo_annotations
        WHERE difficulty IS NOT NULL
        GROUP BY difficulty
    """).fetchall()
    difficulty_counts = {row["difficulty"]: row["cnt"] for row in diff_stats}

    # Filter params
    status_filter = request.args.get("status", "all")
    difficulty_filter = request.args.get("difficulty", "all")
    bib_filter = request.args.get("bib", "").strip()
    page = int(request.args.get("page", 1))
    per_page = 24

    # Get reviewed file paths for annotation status
    reviewed_paths = {}
    annotations = db.execute(
        "SELECT file_path, review_status, difficulty FROM photo_annotations"
    ).fetchall()
    for a in annotations:
        reviewed_paths[a["file_path"]] = {
            "status": a["review_status"],
            "difficulty": a["difficulty"],
        }

    # Apply filters
    filtered = []
    for rec in records:
        fp = rec.get("file_path", "")
        anno = reviewed_paths.get(fp, {})
        rec_status = anno.get("status", "unreviewed")
        rec_diff = anno.get("difficulty")

        if status_filter != "all" and rec_status != status_filter:
            continue
        if difficulty_filter != "all":
            if difficulty_filter == "untagged" and rec_diff is not None:
                continue
            elif difficulty_filter != "untagged" and rec_diff != difficulty_filter:
                continue
        if bib_filter:
            bp = (rec.get("bib_primary") or {}).get("number", "")
            if bib_filter not in str(bp):
                continue

        filtered.append({
            "index": records.index(rec),
            "file_name": rec.get("file_name", Path(fp).name),
            "file_path": fp,
            "quality_score": rec.get("quality_score"),
            "bib_primary": (rec.get("bib_primary") or {}).get("number"),
            "people_count": rec.get("people_count"),
            "review_status": rec_status,
            "difficulty": rec_diff,
        })

    total = len(filtered)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    paginated = filtered[(page - 1) * per_page : page * per_page]

    return render_template(
        "dashboard.html",
        photos=paginated,
        total=total,
        total_all=len(records),
        page=page,
        total_pages=total_pages,
        status_filter=status_filter,
        difficulty_filter=difficulty_filter,
        bib_filter=bib_filter,
        status_counts=status_counts,
        difficulty_counts=difficulty_counts,
        reviewed_count=len(reviewed_paths),
    )


# ─────────────────────────────────────────────────────────────────
# Routes: Single photo review
# ─────────────────────────────────────────────────────────────────

@app.route("/review/<int:idx>")
def review_photo(idx):
    records = load_records()
    if idx < 0 or idx >= len(records):
        abort(404)

    rec = records[idx]
    fp = rec.get("file_path", "")
    db = get_db()

    # Load existing annotation
    annotation = db.execute(
        "SELECT * FROM photo_annotations WHERE file_path = ?", (fp,)
    ).fetchone()

    # Load bib results if available
    bib_results = None
    bp = (rec.get("bib_primary") or {}).get("number")
    if bp:
        bib_file = Path(app.config["BIB_RESULTS_DIR"]) / f"bib_{bp}_matches.json"
        if bib_file.exists():
            with open(bib_file) as f:
                bib_results = json.load(f)

    return render_template(
        "review.html",
        rec=rec,
        idx=idx,
        total=len(records),
        annotation=annotation,
        bib_results=bib_results,
        prev_idx=max(0, idx - 1),
        next_idx=min(len(records) - 1, idx + 1),
    )


@app.route("/photo/<int:idx>")
def serve_photo(idx):
    """Serve a photo by index from output.json."""
    records = load_records()
    if idx < 0 or idx >= len(records):
        abort(404)
    photo_path = resolve_photo_path(records[idx].get("file_path", ""))
    if not photo_path.exists():
        abort(404)
    return send_file(str(photo_path.resolve()))


@app.route("/photo_by_path")
def serve_photo_by_path():
    """Serve a photo by file path (for bib results references)."""
    fp = request.args.get("path", "")
    photo_path = resolve_photo_path(fp)
    if not photo_path.exists():
        abort(404)
    return send_file(str(photo_path.resolve()))


# ─────────────────────────────────────────────────────────────────
# Routes: Members & bib mappings
# ─────────────────────────────────────────────────────────────────

@app.route("/members")
def members():
    db = get_db()
    mappings = db.execute("""
        SELECT * FROM member_bib_mapping
        ORDER BY member_id, event_date DESC
    """).fetchall()

    # Group by member
    members_dict = {}
    for m in mappings:
        mid = m["member_id"]
        if mid not in members_dict:
            members_dict[mid] = {
                "member_id": mid,
                "member_name": m["member_name"],
                "events": [],
            }
        members_dict[mid]["events"].append(dict(m))

    return render_template(
        "members.html",
        members=list(members_dict.values()),
        total=len(members_dict),
    )


# ─────────────────────────────────────────────────────────────────
# Routes: NYRR runner info
# ─────────────────────────────────────────────────────────────────

@app.route("/nyrr")
def nyrr():
    db = get_db()
    runners = db.execute("""
        SELECT n.*, m.member_name
        FROM nyrr_runner_info n
        LEFT JOIN member_bib_mapping m ON n.member_id = m.member_id
        GROUP BY n.member_id
        ORDER BY n.member_id
    """).fetchall()
    return render_template("nyrr.html", runners=runners)


# ─────────────────────────────────────────────────────────────────
# API: Annotations
# ─────────────────────────────────────────────────────────────────

@app.route("/api/annotate", methods=["POST"])
def api_annotate():
    """Create or update a photo annotation."""
    data = request.json
    fp = data.get("file_path")
    if not fp:
        return jsonify({"error": "file_path required"}), 400

    db = get_db()
    now = datetime.utcnow().isoformat() + "Z"

    db.execute("""
        INSERT INTO photo_annotations
            (file_path, file_name, review_status, reviewed_by, reviewed_at,
             difficulty, notes, bib_correct, bib_override, face_correct,
             member_id_override, quality_score, bib_primary, people_count,
             match_tier, match_conf, face_score, outfit_score, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
            review_status = excluded.review_status,
            reviewed_by = excluded.reviewed_by,
            reviewed_at = excluded.reviewed_at,
            difficulty = COALESCE(excluded.difficulty, difficulty),
            notes = COALESCE(excluded.notes, notes),
            bib_correct = COALESCE(excluded.bib_correct, bib_correct),
            bib_override = COALESCE(excluded.bib_override, bib_override),
            face_correct = COALESCE(excluded.face_correct, face_correct),
            member_id_override = COALESCE(excluded.member_id_override, member_id_override),
            quality_score = COALESCE(excluded.quality_score, quality_score),
            bib_primary = COALESCE(excluded.bib_primary, bib_primary),
            people_count = COALESCE(excluded.people_count, people_count),
            match_tier = COALESCE(excluded.match_tier, match_tier),
            match_conf = COALESCE(excluded.match_conf, match_conf),
            face_score = COALESCE(excluded.face_score, face_score),
            outfit_score = COALESCE(excluded.outfit_score, outfit_score),
            updated_at = excluded.updated_at
    """, (
        fp,
        data.get("file_name", Path(fp).name),
        data.get("review_status", "confirmed"),
        data.get("reviewed_by", "admin"),
        now,
        data.get("difficulty"),
        data.get("notes"),
        data.get("bib_correct"),
        data.get("bib_override"),
        data.get("face_correct"),
        data.get("member_id_override"),
        data.get("quality_score"),
        data.get("bib_primary"),
        data.get("people_count"),
        data.get("match_tier"),
        data.get("match_conf"),
        data.get("face_score"),
        data.get("outfit_score"),
        now,
    ))
    db.commit()
    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────────────
# API: Member-bib mappings
# ─────────────────────────────────────────────────────────────────

@app.route("/api/member-bib", methods=["POST"])
def api_member_bib():
    """Create or update a member-bib mapping."""
    data = request.json
    required = ["member_id", "bib_number", "event_date"]
    for field in required:
        if not data.get(field):
            return jsonify({"error": f"{field} required"}), 400

    db = get_db()
    now = datetime.utcnow().isoformat() + "Z"

    db.execute("""
        INSERT INTO member_bib_mapping
            (member_id, member_name, bib_number, event_date, event_name,
             source, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(member_id, event_date) DO UPDATE SET
            member_name = excluded.member_name,
            bib_number = excluded.bib_number,
            event_name = excluded.event_name,
            source = excluded.source,
            notes = COALESCE(excluded.notes, notes),
            updated_at = excluded.updated_at
    """, (
        data["member_id"],
        data.get("member_name"),
        data["bib_number"],
        data["event_date"],
        data.get("event_name"),
        data.get("source", "manual"),
        data.get("notes"),
        now,
    ))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/member-bib/<int:row_id>", methods=["DELETE"])
def api_delete_member_bib(row_id):
    db = get_db()
    db.execute("DELETE FROM member_bib_mapping WHERE id = ?", (row_id,))
    db.commit()
    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────────────
# API: NYRR runner info
# ─────────────────────────────────────────────────────────────────

@app.route("/api/nyrr", methods=["POST"])
def api_nyrr():
    """Create or update NYRR runner info."""
    data = request.json
    if not data.get("member_id") or not data.get("nyrr_runner_name"):
        return jsonify({"error": "member_id and nyrr_runner_name required"}), 400

    db = get_db()
    now = datetime.utcnow().isoformat() + "Z"

    db.execute("""
        INSERT INTO nyrr_runner_info
            (member_id, nyrr_runner_name, year_born_1, year_born_2,
             verified, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(member_id) DO UPDATE SET
            nyrr_runner_name = excluded.nyrr_runner_name,
            year_born_1 = excluded.year_born_1,
            year_born_2 = excluded.year_born_2,
            verified = excluded.verified,
            notes = COALESCE(excluded.notes, notes),
            updated_at = excluded.updated_at
    """, (
        data["member_id"],
        data["nyrr_runner_name"],
        data.get("year_born_1"),
        data.get("year_born_2"),
        data.get("verified", 0),
        data.get("notes"),
        now,
    ))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/nyrr/<member_id>", methods=["DELETE"])
def api_delete_nyrr(member_id):
    db = get_db()
    db.execute("DELETE FROM nyrr_runner_info WHERE member_id = ?", (member_id,))
    db.commit()
    return jsonify({"ok": True})


# ─────────────────────────────────────────────────────────────────
# API: Stats
# ─────────────────────────────────────────────────────────────────

@app.route("/api/stats")
def api_stats():
    records = load_records()
    db = get_db()
    annotations = db.execute("SELECT COUNT(*) as cnt FROM photo_annotations").fetchone()
    return jsonify({
        "total_photos": len(records),
        "total_annotated": annotations["cnt"],
        "total_unannotated": len(records) - annotations["cnt"],
    })


# ─────────────────────────────────────────────────────────────────
# CLI entry point
# ─────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="MMR Photo Review App")
    p.add_argument("--output", default="../output.json",
                   help="Path to output.json from process_photos.py")
    p.add_argument("--photos", default="..",
                   help="Root directory of photo files")
    p.add_argument("--bib-results", default="../bib_results",
                   help="Directory of bib analyzer results")
    p.add_argument("--db", default="review.db",
                   help="SQLite database path (default: review.db)")
    p.add_argument("--port", type=int, default=5050,
                   help="Port to run on (default: 5050)")
    p.add_argument("--host", default="127.0.0.1",
                   help="Host to bind to (default: 127.0.0.1)")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    app.config["OUTPUT_JSON"] = args.output
    app.config["PHOTOS_DIR"] = args.photos
    app.config["BIB_RESULTS_DIR"] = args.bib_results
    app.config["DB_PATH"] = args.db

    init_db()
    print(f"\n  MMR Photo Review App")
    print(f"  Output:  {args.output}")
    print(f"  Photos:  {args.photos}")
    print(f"  DB:      {args.db}")
    print(f"  URL:     http://{args.host}:{args.port}\n")

    app.run(host=args.host, port=args.port, debug=True)
