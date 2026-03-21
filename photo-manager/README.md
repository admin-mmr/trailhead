# photo-manager 📸

MMR's automated photo processing pipeline — detect, analyze, and organize race photos at scale.

## Overview

`photo-manager` is a Python CV (Computer Vision) tool that processes race photos to:
- Extract runner bibs (race numbers) via OCR
- Detect and crop human faces using Azure Face API
- Analyze photo quality (focus, brightness, face size)
- Organize and tag photos by runner

The pipeline integrates with:
- **Azure Computer Vision** — bib OCR, face detection
- **Google Drive** — cloud storage for photos
- **MySQL** (via `basecamp/`) — runner metadata lookup

---

## Quick Start

### Prerequisites
- Python 3.9+
- Azure Computer Vision credentials
- Google Cloud service account (for Drive access)
- Access to `basecamp/` for shared Google Workspace module

### Setup

```bash
# Clone trailhead (if not already done)
git clone https://github.com/admin-mmr/trailhead.git
cd trailhead/photo-manager

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env.local   # Add Azure + Google Cloud credentials
```

### Run

```bash
# Process photos from Google Drive
python src/process_photos.py

# Analyze photo quality
python src/photo_quality_picker.py

# Extract bibs (race numbers)
python src/bib_analyzer.py

# Debug: Test Azure Face API
python src/test_azure.py
```

---

## Directory Structure

```
photo-manager/
├── src/
│   ├── process_photos.py         # Main pipeline
│   ├── photo_quality_picker.py   # Quality scoring
│   ├── bib_analyzer.py           # Bib OCR + detection
│   ├── debug_photo.py            # Debugging utilities
│   ├── test_azure.py             # Azure Face API test
│   └── modules/
│       ├── azure_face.py         # Face detection wrapper
│       ├── bib_ocr.py            # Bib extraction via OCR
│       ├── quality.py            # Photo quality metrics
│       ├── posture.py            # Runner posture analysis
│       ├── people.py             # Multi-person detection
│       └── walker.py             # Walking vs. running detection
├── requirements.txt              # Python dependencies
├── requirements-lock.txt         # Pinned versions
├── member-photo-instructions.md  # Instructions for members (bilingual)
├── member-data-collection-spec.md
├── mmr_photo_manager_phase1_plan.docx
└── partner/                      # Collaboration with 湘舍动
```

---

## Key Modules

### `process_photos.py`
Main orchestration script. Fetches photos from Google Drive, runs through the CV pipeline, and uploads results back.

```bash
python src/process_photos.py --event "20260315-nyc-half"
```

### `bib_analyzer.py`
Extracts runner bib numbers (race numbers) from photos using OCR.

```bash
python src/bib_analyzer.py --photo_path "s3://photos/A0001.jpg"
```

### `photo_quality_picker.py`
Scores photos by quality (focus, brightness, runner visibility) and filters low-quality ones.

```bash
python src/photo_quality_picker.py --min_score 0.7
```

### `modules/azure_face.py`
Wrapper around Azure Computer Vision for face detection and bounding boxes.

### `modules/quality.py`
Computes photo quality metrics (Laplacian blur, brightness histogram, face proportion).

---

## Environment Variables

Set in `.env.local`:

```bash
# Azure Computer Vision
AZURE_VISION_KEY=your_azure_key_here
AZURE_VISION_ENDPOINT=https://your-region.api.cognitive.microsoft.com/

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Google Drive
GOOGLE_DRIVE_PHOTO_FOLDER_ID=folder_id_for_race_photos

# Shared basecamp
BASECAMP_PATH=../basecamp
```

---

## Integration with Trailhead

`photo-manager` uses shared utilities from `basecamp/`:

```python
from basecamp.python.google_workspace import GoogleDriveClient
from basecamp.python.mysql_sync import get_member_photos
```

For cross-service integration, see [`../MONOREPO.md`](../MONOREPO.md).

---

## Troubleshooting

### "Azure Face API rate limit exceeded"
Photos are processed too quickly. Add delay between requests:
```python
time.sleep(0.5)  # 500ms between API calls
```

### "Google Drive authentication failed"
Verify `GOOGLE_APPLICATION_CREDENTIALS` points to the correct service account JSON. Service account must have access to the photo folder.

### "Bib detection is missing runners"
Adjust OCR confidence threshold in `modules/bib_ocr.py`:
```python
MIN_CONFIDENCE = 0.6  # Lower = more detections, more false positives
```

---

## Phase 1 Plan

See [`mmr_photo_manager_phase1_plan.docx`](mmr_photo_manager_phase1_plan.docx) for the full roadmap.

---

## License

MIT — see [`../LICENSE`](../LICENSE)
