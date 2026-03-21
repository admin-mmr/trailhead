"""
bib_ocr.py — Race bib number detection and OCR

Strategy:
  1. Take the person bounding boxes from people.py
  2. Crop the torso region for each person (where bibs are worn)
  3. Pre-process the crop to improve OCR accuracy
  4. Run EasyOCR; keep digit-only results of length 2–6
  5. Score each detection with three signals:
       ocr_conf    — OCR engine confidence (0–1)
       size_score  — how large the person is relative to the full image (0–1)
       centrality  — how close the person's centre is to the image centre (0–1)
       prominence  — weighted composite: used to elect the primary bib
  6. The bib with the highest prominence score becomes bib_primary.
     All others become bib_related.

Install: pip install easyocr

Output fields added to the record:
    bib_primary : dict | None
        {
            "number":     "1042",
            "ocr_conf":   0.94,    # raw EasyOCR confidence
            "size_score": 0.82,    # person area / image area, normalised
            "centrality": 0.76,    # proximity to image centre, normalised
            "prominence": 0.88,    # weighted composite score
            "bbox":       [x, y, w, h]  # person bounding box in pixels
        }
    bib_related : list[dict]
        Same structure as bib_primary, sorted by prominence descending.
        Empty list if no additional bibs found.
"""

import re
import cv2
import numpy as np

# ── Weights for prominence score ─────────────────────────────────
W_OCR_CONF   = 0.45
W_SIZE       = 0.35
W_CENTRALITY = 0.20

# ── Bib number validation ─────────────────────────────────────────
BIB_MIN_DIGITS = 2
BIB_MAX_DIGITS = 6
BIB_PATTERN    = re.compile(r"^\d{2,6}$")

# ── Torso crop geometry ───────────────────────────────────────────
# Within each person bbox, crop this vertical slice for the bib.
# Bibs are typically worn between 30%–70% down the body.
TORSO_TOP_FRAC    = 0.25   # start at 25% from top of person box
TORSO_BOTTOM_FRAC = 0.70   # end   at 70% from top of person box

# ── OCR pre-processing ────────────────────────────────────────────
# Upscale small crops so the OCR engine has enough pixels to work with.
TORSO_MIN_HEIGHT_PX = 80   # if crop is shorter than this, upscale it

# Module-level reader cache so we only initialise EasyOCR once per process
_reader      = None
_reader_type = None   # "easyocr" or "tesseract"


def _get_reader():
    """
    Try EasyOCR first (better accuracy for bib numbers).
    Falls back to pytesseract if EasyOCR models can't download (offline env).
    """
    global _reader, _reader_type
    if _reader is None:
        try:
            import easyocr
            r = easyocr.Reader(["en"], gpu=False, verbose=False)
            _reader      = r
            _reader_type = "easyocr"
        except Exception:
            try:
                import pytesseract
                _reader      = pytesseract
                _reader_type = "tesseract"
                print("[bib_ocr] EasyOCR unavailable — using Tesseract fallback")
            except Exception as exc:
                raise RuntimeError(
                    "No OCR engine available. "
                    "Install easyocr (pip install easyocr) or tesseract."
                ) from exc
    return _reader, _reader_type


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────

def detect_bibs(bgr_image: np.ndarray, people_boxes: list) -> dict:
    """
    Detect bib numbers for all people found in bgr_image.

    Args:
        bgr_image:    Full image as BGR numpy array.
        people_boxes: List of {"bbox": [x,y,w,h], "conf": float}
                      as returned by people.detect_people().
                      If empty or None, returns empty results.

    Returns:
        {
            "bib_primary": dict | None,
            "bib_related": list[dict]
        }
    """
    if not people_boxes:
        return {"bib_primary": None, "bib_related": []}

    img_h, img_w = bgr_image.shape[:2]
    img_area = img_h * img_w

    detections = []

    for person in people_boxes:
        px, py, pw, ph = person["bbox"]

        # Clamp to image bounds
        px = max(0, px);  py = max(0, py)
        pw = min(pw, img_w - px)
        ph = min(ph, img_h - py)
        if pw <= 0 or ph <= 0:
            continue

        # ── Torso crop ──────────────────────────────────────────
        torso_y1 = py + int(ph * TORSO_TOP_FRAC)
        torso_y2 = py + int(ph * TORSO_BOTTOM_FRAC)
        torso_y1 = max(0, torso_y1)
        torso_y2 = min(img_h, torso_y2)

        crop = bgr_image[torso_y1:torso_y2, px:px + pw]
        if crop.size == 0:
            continue

        # ── Pre-process for OCR ─────────────────────────────────
        processed = _preprocess_crop(crop)

        # ── Run OCR ─────────────────────────────────────────────
        number, ocr_conf, text_x2, crop_w = _run_ocr(processed)
        if number is None:
            continue

        # ── Partial flag: text bbox clips the right/left edge of crop ──
        # Indicates the bib number may continue beyond what was visible.
        # Cast to plain Python bool — EasyOCR coords are numpy floats and
        # numpy.bool_ is not JSON-serialisable.
        partial = False
        if text_x2 is not None and crop_w is not None and crop_w > 0:
            partial = bool(text_x2 > crop_w * 0.88)

        # ── Score signals ────────────────────────────────────────
        size_score  = _size_score(pw, ph, img_area)
        centrality  = _centrality_score(px, py, pw, ph, img_w, img_h)
        prominence  = (
            W_OCR_CONF   * ocr_conf   +
            W_SIZE       * size_score +
            W_CENTRALITY * centrality
        )

        detections.append({
            "number":     number,
            "ocr_conf":   round(ocr_conf,   3),
            "size_score": round(size_score,  3),
            "centrality": round(centrality,  3),
            "prominence": round(prominence,  3),
            "partial":    partial,
            "bbox":       [px, py, pw, ph],
        })

    if not detections:
        return {"bib_primary": None, "bib_related": []}

    # Sort by prominence descending
    detections.sort(key=lambda d: d["prominence"], reverse=True)

    # Primary = highest prominence, but only if it is meaningfully larger
    # than the second-best (ratio >= 1.3 means clearly dominant).
    # If scores are similar, still pick the top one — caller can review.
    primary  = detections[0]
    related  = detections[1:]

    return {
        "bib_primary": primary,
        "bib_related": related,
    }


# ─────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────

def _preprocess_crop(crop: np.ndarray) -> np.ndarray:
    """
    Prepare a torso crop for OCR:
      - Convert to greyscale
      - Upscale if too small (OCR accuracy degrades below ~80 px height)
      - Apply adaptive thresholding to handle varied bib background colours
    """
    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # Upscale small crops
    h, w = grey.shape
    if h < TORSO_MIN_HEIGHT_PX:
        scale = TORSO_MIN_HEIGHT_PX / h
        grey = cv2.resize(grey, (int(w * scale), int(h * scale)),
                          interpolation=cv2.INTER_CUBIC)

    # Adaptive threshold handles dark bibs on bright shirts and vice versa
    binary = cv2.adaptiveThreshold(
        grey, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=15,
        C=8,
    )
    return binary


def _run_ocr(processed: np.ndarray):
    """
    Run OCR on a pre-processed crop.
    Returns (number_string, confidence, text_x2, crop_w) or (None, None, None, None).

    text_x2 is the right-edge x-pixel of the detected text within the processed crop.
    crop_w  is the width of the processed crop.
    Both are used by the caller to detect partially-visible bib numbers.

    Tries EasyOCR first; falls back to pytesseract.
    Collects all digit-only tokens and picks the one with the highest confidence.
    """
    reader, reader_type = _get_reader()

    best_text  = None
    best_conf  = 0.0
    best_x2    = None   # right edge of the winning text bbox

    crop_w = processed.shape[1] if processed is not None else None

    try:
        if reader_type == "easyocr":
            results = reader.readtext(processed, detail=1, paragraph=False)
            for (quad, text, conf) in results:
                digits = re.sub(r"\D", "", text)
                if not BIB_PATTERN.match(digits):
                    continue
                if conf > best_conf:
                    best_text = digits
                    best_conf = conf
                    # quad is [[x1,y1],[x2,y1],[x2,y2],[x1,y2]]
                    xs = [pt[0] for pt in quad]
                    best_x2 = max(xs)

        else:  # tesseract fallback
            import pytesseract
            # --psm 7 = single text line, digits only
            config = "--psm 7 -c tessedit_char_whitelist=0123456789"
            text = pytesseract.image_to_string(processed, config=config).strip()
            digits = re.sub(r"\D", "", text)
            if BIB_PATTERN.match(digits):
                # Tesseract doesn't give per-word confidence easily; use 0.6 as default
                data = pytesseract.image_to_data(
                    processed, config=config,
                    output_type=pytesseract.Output.DICT
                )
                confs = [int(c) for c in data["conf"] if str(c).lstrip("-").isdigit() and int(c) >= 0]
                conf = (sum(confs) / len(confs) / 100.0) if confs else 0.6
                best_text  = digits
                best_conf  = conf
                best_x2    = None   # tesseract path: no bbox, can't compute partial

    except Exception:
        return None, None, None, None

    if best_text is None:
        return None, None, None, None

    return best_text, float(best_conf), best_x2, crop_w


def _size_score(pw: int, ph: int, img_area: int) -> float:
    """
    Normalise person bounding-box area relative to image area.
    Saturates at 1.0 when the person fills 40% of the frame.
    """
    person_area = pw * ph
    ratio = person_area / img_area if img_area > 0 else 0.0
    # 40% fill = score 1.0; linear below that
    return float(min(ratio / 0.40, 1.0))


def _centrality_score(px: int, py: int, pw: int, ph: int,
                      img_w: int, img_h: int) -> float:
    """
    How close is the person's centre to the image centre?
    Score 1.0 = person centre exactly at image centre.
    Score 0.0 = person centre at a corner.
    """
    cx = px + pw / 2
    cy = py + ph / 2
    img_cx = img_w / 2
    img_cy = img_h / 2

    # Normalised distance (0 = centre, 1 = furthest possible corner)
    max_dist = ((img_w / 2) ** 2 + (img_h / 2) ** 2) ** 0.5
    dist = ((cx - img_cx) ** 2 + (cy - img_cy) ** 2) ** 0.5
    norm_dist = dist / max_dist if max_dist > 0 else 0.0

    return float(1.0 - norm_dist)
