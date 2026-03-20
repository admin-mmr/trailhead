# MMR Photo Manager

Automated pipeline for managing race event photos — quality scoring, person detection, bib OCR, face recognition, and member notification.

---

## How it works

The system runs in three phases. Each phase builds on the previous one's output.

**Phase 1 & 2 — `process_photos.py`**
Walk a photo directory and produce `output.json`. For every photo it records: quality score, person count, person size, facing direction, posture, bib numbers with confidence scores, and a partial-bib flag.

**Filter — `photo_quality_picker.py`**
Filter `output.json` by quality score to find the best or worst photos in the set.

**Debug — `debug_photo.py`**
Run all modules on a single photo and save an annotated image showing exactly what was detected and why. Use this to tune thresholds and iterate.

**Phase 3 — `bib_analyzer.py`**
Given a bib number, find the person in Phase 1/2 results, extract their best face crops, and scan the whole directory for additional photos of that person — including photos where the bib was not readable.

---

## Setup

**Requirements:** Python 3.9+, macOS or Linux

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install core dependencies (Phase 1 + 2)
pip install -r requirements.txt

# macOS: Tesseract binary for fallback OCR
brew install tesseract

# Phase 3 only — face recognition (requires cmake + dlib)
brew install cmake
pip install dlib
pip install face_recognition
```

Model weights download automatically on first run:
- YOLOv8n person detection — ~6 MB (from Ultralytics, cached in `~/.cache/ultralytics/`)
- EasyOCR bib OCR — ~100 MB (cached in `~/.EasyOCR/`)

Both require internet on first run. Subsequent runs are fully offline.

---

## Commands

### 1. `process_photos.py` — Main pipeline

Scans a photo directory and writes detection results to JSON.

```bash
python src/process_photos.py --input-dir ./album_mmr --output output.json
```

**All options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--input-dir` | *(required)* | Directory of photos to process |
| `--output` | `output.json` | Output JSON file path |
| `--skip` | *(none)* | Comma-separated modules to skip: `quality`, `people`, `bib`, `posture` |
| `--resume` | off | Skip photos already in the output file |
| `--workers` | `1` | Parallel threads (keep at 1 for large JPEGs) |
| `--min-quality` | *(none)* | Exclude photos below this score (0.0–1.0) |
| `--limit` | *(none)* | Process only first N photos (for testing) |

**Examples:**

```bash
# First run — full pipeline
python src/process_photos.py --input-dir ./album_mmr --output output.json

# Resume after interruption
python src/process_photos.py --input-dir ./album_mmr --output output.json --resume

# Quick test on 10 photos, skip quality scoring
python src/process_photos.py --input-dir ./album_mmr --output test.json --limit 10 --skip quality

# People and bib only (skip quality + posture for speed)
python src/process_photos.py --input-dir ./album_mmr --output output.json --skip quality,posture
```

**Output JSON schema** (one record per photo):

```json
{
  "file_path":            "album_mmr/IMG_0001.jpg",
  "file_name":            "IMG_0001.jpg",
  "size_bytes":           3812044,
  "processed_at":         "2026-03-16T10:00:00Z",

  "quality_score":        0.84,
  "quality_detail": {
    "sharpness":          1.0,
    "exposure":           1.0,
    "noise":              0.61,
    "composition":        0.47
  },

  "people_count":         4,
  "people_facing_camera": 2,
  "people_boxes": [
    {
      "bbox":         [130, 382, 264, 719],
      "conf":         0.695,
      "size_frac":    0.261,
      "posture":      "running",
      "posture_conf": 0.80,
      "facing":       "camera",
      "facing_conf":  0.80
    }
  ],

  "bib_primary": {
    "number":     "1330",
    "ocr_conf":   0.702,
    "size_score": 0.514,
    "centrality": 0.807,
    "prominence": 0.658,
    "partial":    true,
    "bbox":       [130, 382, 264, 719]
  },
  "bib_related": [],

  "bib_facing":      "side",
  "bib_facing_conf": 0.4,

  "face_count":   null,
  "face_matches": null,
  "error":        null
}
```

**Key fields:**

- `people_facing_camera` — count of people whose face is visible (camera/left/right). Use this instead of `people_count` to find photos where participants are identifiable.
- `size_frac` — person bounding box area as a fraction of the image (0.0–1.0). Larger = more prominent.
- `bib_primary.partial` — `true` if the bib number text was clipped at the edge of the crop; the number may be incomplete.

---

### 2. `photo_quality_picker.py` — Quality filter

Filter `output.json` by quality score.

```bash
python src/photo_quality_picker.py output.json --cutoff 0.7 --type best --max 20
```

**All options:**

| Argument | Description |
|----------|-------------|
| `input` | Path to `output.json` |
| `--cutoff` | Quality score threshold (0.0–1.0) |
| `--type` | `best` (score ≥ cutoff) or `worst` (score < cutoff) |
| `--max` | Maximum number of results to return |
| `--output` | Save filtered results to a new JSON file |

**Examples:**

```bash
# Find the 20 sharpest, best-exposed photos
python src/photo_quality_picker.py output.json --cutoff 0.7 --type best --max 20

# Find the 10 worst photos (for review/deletion)
python src/photo_quality_picker.py output.json --cutoff 0.5 --type worst --max 10

# Save results to a new file
python src/photo_quality_picker.py output.json --cutoff 0.7 --type best --output best_photos.json
```

Score legend printed to stdout: 🟢 ≥ 0.75 · 🟡 0.50–0.75 · 🔴 < 0.50

---

### 3. `debug_photo.py` — Single photo debugger

Runs all modules on one photo and saves an annotated image showing bounding boxes, labels, and scores. Use this to verify detection results and iterate on thresholds.

```bash
python src/debug_photo.py "album_mmr/IMG_0001.jpg"
python src/debug_photo.py "album_mmr/IMG_0001.jpg" --out debug_out/ --skip posture
```

**All options:**

| Argument | Default | Description |
|----------|---------|-------------|
| `photo` | *(required)* | Path to the photo to debug |
| `--out` | `debug_out/` | Directory for the annotated output image |
| `--skip` | *(none)* | Comma-separated modules to skip |

**Annotated image legend:**

| Colour | Meaning |
|--------|---------|
| Green box | Person detected |
| Orange box | Person carrying the primary (highest prominence) bib |
| Blue box | Person carrying a related bib |
| Yellow dashed box | Torso crop zone (where OCR searches for the bib number) |

Each box label shows: detection confidence · size as % of frame · posture · facing direction. The primary bib box also shows bib number, OCR confidence, and a `PARTIAL` flag if the number was clipped.

**Iteration workflow:** Run on your Mac, then paste the terminal output and drag the annotated image into this chat to iterate on detection parameters.

```bash
# Capture output for sharing
python src/debug_photo.py "album_mmr/IMG_0001.jpg" --out debug_out/ 2>&1 | tee debug_out/debug_log.txt

# Debug multiple photos and review logs
for f in album_mmr/*.jpg; do
  python src/debug_photo.py "$f" --out debug_out/ >> debug_out/batch_log.txt 2>&1
done
```

---

### 4. `bib_analyzer.py` — Per-bib face recognition (Phase 3)

Given a bib number, finds all matching photos from Phase 1/2, extracts the best face headshots, and scans the entire album for the same person — including photos where the bib was not detected.

```bash
python src/bib_analyzer.py 1330
```

**All options:**

| Argument | Default | Description |
|----------|---------|-------------|
| `bib` | *(required)* | Bib number to search for |
| `--input` | `output.json` | Path to Phase 1/2 results |
| `--photos-dir` | `.` | Root directory of photo files |
| `--out` | `bib_results/` | Output directory for headshots and JSON |
| `--tolerance` | `0.55` | Face match strictness: 0.45 = strict, 0.55 = recommended, 0.65 = lenient |
| `--max-faces` | `5` | Max headshots to extract (from different source photos) |

**Examples:**

```bash
# Standard run
python src/bib_analyzer.py 1330

# Stricter matching to reduce false positives
python src/bib_analyzer.py 1330 --tolerance 0.45

# Extract more headshots for a better chance of matching
python src/bib_analyzer.py 1330 --max-faces 5 --tolerance 0.55

# Explicit paths
python src/bib_analyzer.py 1330 \
    --input output.json \
    --photos-dir album_mmr/ \
    --out bib_results/
```

**Four phases:**

1. **FIND** — search `output.json` for photos where the bib appears (primary or related)
2. **EXTRACT** — detect face within each person's bounding box, score by sharpness × size, save top 3–5 headshots from different source photos to `bib_results/faces/bib_1330/`
3. **SCAN** — compare saved face encodings against every photo in the album
4. **SAVE** — write `bib_results/bib_1330_matches.json`

**Output JSON structure:**

```json
{
  "bib_number": "1330",
  "run_at": "2026-03-16T10:00:00Z",
  "source_photos_count": 3,
  "source_photos": ["album_mmr/IMG_0042.jpg", "..."],
  "face_crops_saved": [
    "bib_results/faces/bib_1330/face_01.jpg",
    "bib_results/faces/bib_1330/face_02.jpg"
  ],
  "summary": {
    "total_matches":    12,
    "known_bib_photos":  3,
    "new_face_matches":  9
  },
  "matches": {
    "with_bib": [
      {
        "file_path":    "album_mmr/IMG_0042.jpg",
        "file_name":    "IMG_0042.jpg",
        "match_conf":   0.92,
        "face_bbox":    [210, 80, 95, 110],
        "quality_score": 0.84,
        "bib_detected": "1330"
      }
    ],
    "without_bib": [
      {
        "file_path":    "album_mmr/IMG_0187.jpg",
        "file_name":    "IMG_0187.jpg",
        "match_conf":   0.78,
        "face_bbox":    [340, 120, 88, 104],
        "quality_score": 0.91,
        "bib_detected": null
      }
    ]
  }
}
```

`matches.without_bib` is the key result — photos of the member where the bib was not readable. These are the photos to send them after the event.

**Tolerance guide:**

| Value | Behaviour |
|-------|-----------|
| 0.45 | Very strict — near-identical faces only, fewest false positives |
| 0.55 | Recommended — good balance of recall and precision |
| 0.65 | Lenient — catches more angles and partial faces, more false positives |

---

## Module reference

All detection work is in `src/modules/`:

| Module | What it does | Key fallback |
|--------|-------------|--------------|
| `walker.py` | Finds images in a directory | — |
| `quality.py` | Scores sharpness, exposure, noise, composition | No fallback needed |
| `people.py` | Detects people, returns bboxes + `size_frac` | HOG if YOLO offline |
| `posture.py` | Posture label + per-person facing direction | Bbox heuristic if no MediaPipe |
| `bib_ocr.py` | Bib number OCR with partial-number flag | Tesseract if EasyOCR offline |

---

## Project files

```
photo-manager/
├── src/
│   ├── process_photos.py       Phase 1+2 pipeline
│   ├── photo_quality_picker.py Quality filter utility
│   ├── debug_photo.py          Single-photo visual debugger
│   ├── bib_analyzer.py         Phase 3 per-bib face recognition
│   └── modules/
│       ├── walker.py           Directory scanner
│       ├── quality.py          Quality scorer
│       ├── people.py           Person detection (YOLO / HOG)
│       ├── posture.py          Posture + facing direction
│       └── bib_ocr.py          Bib OCR (EasyOCR / Tesseract)
├── requirements.txt            Annotated dependencies with install notes
├── requirements-lock.txt       Pinned exact versions
├── member-photo-instructions.md   Bilingual guide for members (EN + 中文)
├── member-data-collection-spec.md Admin/dev spec for data collection
└── README.md                   This file
```

---

## Related docs

- [`member-photo-instructions.md`](member-photo-instructions.md) — bilingual (EN/中文) guide for members on how to submit profile photos for face recognition
- [`member-data-collection-spec.md`](member-data-collection-spec.md) — Google Form field spec, web app spec, and privacy consent touchpoints for member registration
