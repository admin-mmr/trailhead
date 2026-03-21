"""
quality.py — Photo Quality Scorer
Analyses a single image and returns a quality score (0.0 – 1.0) plus
a breakdown of four signal dimensions.

Signals and weights:
    sharpness   35%  — Laplacian variance on greyscale image
    exposure    30%  — histogram penalty for blown highlights / crushed shadows
    noise       20%  — high-frequency noise estimate via blur-difference
    composition 15%  — rule-of-thirds face placement; fallback to centre crop score

Usage:
    from modules.quality import score_image
    result = score_image("/path/to/photo.jpg")
    # result = {
    #     "quality_score": 0.83,
    #     "quality_detail": {
    #         "sharpness": 0.91,
    #         "exposure": 0.78,
    #         "noise": 0.88,
    #         "composition": 0.75
    #     }
    # }
"""

import cv2
import numpy as np
from pathlib import Path

# Try to import pillow_heif for HEIC support; gracefully degrade if unavailable
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    _HEIC_SUPPORTED = True
except ImportError:
    _HEIC_SUPPORTED = False

from PIL import Image, UnidentifiedImageError

# ──────────────────────────────────────────────
# Weights — must sum to 1.0
# ──────────────────────────────────────────────
W_SHARPNESS   = 0.35
W_EXPOSURE    = 0.30
W_NOISE       = 0.20
W_COMPOSITION = 0.15

# ──────────────────────────────────────────────
# Calibration constants
# Tune these on your own event photo sample set.
# ──────────────────────────────────────────────

# Sharpness: Laplacian variance.
# Below SHARP_LOW  → score 0.0   (very blurry)
# Above SHARP_HIGH → score 1.0   (tack sharp)
# Interpolated linearly between the two.
# Typical values for 12MP+ event photos: blur ~20, sharp ~300
SHARP_LOW  = 20.0
SHARP_HIGH = 300.0

# Exposure: fraction of pixels that are blown (> 250) or crushed (< 5)
# Above EXPOSE_BAD_FRAC → score 0.0 per channel
# Below EXPOSE_GOOD_FRAC → score 1.0 per channel
EXPOSE_GOOD_FRAC = 0.01   # up to 1% extreme pixels is fine
EXPOSE_BAD_FRAC  = 0.15   # 15% extreme pixels is very bad

# Noise: normalised std-dev of (image − blurred image)
# Below NOISE_LOW  → score 1.0  (very clean)
# Above NOISE_HIGH → score 0.0  (very noisy)
NOISE_LOW  = 2.0
NOISE_HIGH = 25.0

# Composition: fraction of image area the subject face must cover
# to score full composition marks.
COMP_FACE_TARGET = 0.08   # face should cover ~8% of image area

# Maximum long edge we process internally.
# 800px is sufficient for all quality signals (sharpness, exposure, noise, composition).
# Keeping this low is the single biggest speed factor on large race JPEGs.
MAX_PROCESS_PX = 800


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────

def score_image(file_path: str) -> dict:
    """
    Score a single image file.

    Returns:
        {
            "quality_score": float,          # 0.0 – 1.0
            "quality_detail": {
                "sharpness":   float,
                "exposure":    float,
                "noise":       float,
                "composition": float,
            }
        }
    On failure returns quality_score=None and quality_detail=None,
    plus an "error" key with the reason.
    """
    try:
        bgr = _load_as_bgr(file_path)
    except Exception as exc:
        return {"quality_score": None, "quality_detail": None, "error": str(exc)}

    grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    s = _sharpness(grey)
    e = _exposure(bgr)
    n = _noise(grey)
    c = _composition(grey)

    composite = (
        W_SHARPNESS   * s +
        W_EXPOSURE    * e +
        W_NOISE       * n +
        W_COMPOSITION * c
    )

    return {
        "quality_score": round(float(composite), 4),
        "quality_detail": {
            "sharpness":   round(float(s), 4),
            "exposure":    round(float(e), 4),
            "noise":       round(float(n), 4),
            "composition": round(float(c), 4),
        },
    }


# ──────────────────────────────────────────────
# Image loader
# ──────────────────────────────────────────────

def _load_as_bgr(file_path: str, max_px: int = MAX_PROCESS_PX) -> np.ndarray:
    """
    Load any supported image format (including HEIC) into a BGR numpy array.
    Uses PIL's draft() for JPEG to avoid decoding at full resolution —
    this makes large 10–20MB race JPEGs 4–8x faster to load.

    Args:
        file_path: path to the image file
        max_px:    cap the long edge at this many pixels (default: MAX_PROCESS_PX=800)
                   Pass a larger value (e.g. 1280) for detection modules that benefit
                   from more pixels than quality scoring needs.
    Raises on unreadable files.
    """
    ext = Path(file_path).suffix.lower()
    target = (max_px, max_px)

    if ext in (".heic", ".heif"):
        if not _HEIC_SUPPORTED:
            raise RuntimeError(
                "HEIC file detected but pillow-heif is not installed. "
                "Run: pip install pillow-heif --break-system-packages"
            )
        pil_img = Image.open(file_path).convert("RGB")
        pil_img.thumbnail(target, Image.LANCZOS)
        return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    elif ext in (".jpg", ".jpeg"):
        # PIL draft() tells the JPEG decoder to skip every N lines during decode,
        # returning a 1/2 or 1/4 size image without fully decoding the file.
        # Much faster and uses far less memory on large originals.
        pil_img = Image.open(file_path)
        pil_img.draft("RGB", target)          # hint the decoder
        pil_img = pil_img.convert("RGB")
        pil_img.thumbnail(target, Image.LANCZOS)   # ensure final cap
        return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    else:
        # PNG, WebP etc — no draft support, fall back to cv2 then resize
        bgr = cv2.imread(file_path, cv2.IMREAD_COLOR)
        if bgr is None:
            try:
                pil_img = Image.open(file_path).convert("RGB")
                pil_img.thumbnail(target, Image.LANCZOS)
                return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            except (UnidentifiedImageError, Exception) as exc:
                raise RuntimeError(f"Cannot read image: {exc}") from exc

        h, w = bgr.shape[:2]
        if max(h, w) > max_px:
            scale = max_px / max(h, w)
            bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)),
                             interpolation=cv2.INTER_AREA)
        return bgr


# ──────────────────────────────────────────────
# Signal functions
# ──────────────────────────────────────────────

def _sharpness(grey: np.ndarray) -> float:
    """
    Laplacian variance — higher = sharper.
    Returns a score in [0, 1].
    """
    lap_var = float(cv2.Laplacian(grey, cv2.CV_64F).var())
    return _clamp_normalise(lap_var, SHARP_LOW, SHARP_HIGH)


def _exposure(bgr: np.ndarray) -> float:
    """
    Penalise blown highlights (pixel > 250) and crushed shadows (pixel < 5)
    across all three channels.
    Returns the mean per-channel exposure score in [0, 1].
    """
    scores = []
    total_px = bgr.shape[0] * bgr.shape[1]

    for ch in cv2.split(bgr):
        blown   = float(np.sum(ch > 250)) / total_px
        crushed = float(np.sum(ch <   5)) / total_px
        bad_frac = blown + crushed
        # Score 1.0 when bad_frac <= EXPOSE_GOOD_FRAC, 0.0 when >= EXPOSE_BAD_FRAC
        score = 1.0 - _clamp_normalise(bad_frac, EXPOSE_GOOD_FRAC, EXPOSE_BAD_FRAC)
        scores.append(score)

    return float(np.mean(scores))


def _noise(grey: np.ndarray) -> float:
    """
    Estimate noise as the standard deviation of (image - gaussian_blur(image)).
    High std = high noise. Returns a score in [0, 1] where 1 = clean.
    """
    blurred = cv2.GaussianBlur(grey, (5, 5), 0)
    diff = cv2.absdiff(grey, blurred).astype(np.float32)
    noise_std = float(diff.std())
    # Invert: lower noise → higher score
    return 1.0 - _clamp_normalise(noise_std, NOISE_LOW, NOISE_HIGH)


def _composition(grey: np.ndarray) -> float:
    """
    Rule-of-thirds face placement score.

    Attempts to detect faces using OpenCV's Haar cascade.
    If a face is found:
        - Score based on how close the face centre is to a rule-of-thirds
          intersection point, AND how large the face is relative to the frame.
    If no face is found:
        - Fall back to a centre-weighted sharpness score (is the centre of
          the image the sharpest region? A common proxy for subject placement).
    Returns a score in [0, 1].
    """
    h, w = grey.shape[:2]

    faces = _detect_faces_haar(grey)

    if faces:
        # Use the largest detected face
        faces_sorted = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
        fx, fy, fw, fh = faces_sorted[0]

        # Face centre as fraction of image dimensions
        cx = (fx + fw / 2) / w
        cy = (fy + fh / 2) / h

        # Rule-of-thirds intersection points: (1/3, 1/3), (2/3, 1/3), (1/3, 2/3), (2/3, 2/3)
        thirds = [(1/3, 1/3), (2/3, 1/3), (1/3, 2/3), (2/3, 2/3)]
        min_dist = min(
            ((cx - tx) ** 2 + (cy - ty) ** 2) ** 0.5
            for tx, ty in thirds
        )
        # Max possible distance from a thirds point is ~0.47 (corner to opposite thirds point)
        placement_score = 1.0 - _clamp_normalise(min_dist, 0.0, 0.35)

        # Face size score: reward faces that fill a good portion of the frame
        face_area_frac = (fw * fh) / (w * h)
        size_score = _clamp_normalise(face_area_frac, 0.01, COMP_FACE_TARGET)

        return 0.6 * placement_score + 0.4 * size_score

    else:
        # No face detected — score by centre sharpness vs edge sharpness
        return _centre_sharpness_score(grey)


def _detect_faces_haar(grey: np.ndarray) -> list:
    """
    Quick face detection using OpenCV Haar cascade.
    Returns list of (x, y, w, h) tuples, empty list if none found.
    No external model download required.
    """
    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        face_cascade = cv2.CascadeClassifier(cascade_path)
        if face_cascade.empty():
            return []

        faces = face_cascade.detectMultiScale(
            grey,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(30, 30),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )
        return list(faces) if len(faces) > 0 else []
    except Exception:
        return []


def _centre_sharpness_score(grey: np.ndarray) -> float:
    """
    Fallback composition metric: compare sharpness of the central third
    of the image to the overall sharpness. Score 1.0 if the centre is
    at least as sharp as the whole image (subject likely in centre).
    """
    h, w = grey.shape[:2]
    y1, y2 = h // 3, 2 * h // 3
    x1, x2 = w // 3, 2 * w // 3
    centre = grey[y1:y2, x1:x2]

    overall_var = float(cv2.Laplacian(grey, cv2.CV_64F).var())
    centre_var  = float(cv2.Laplacian(centre, cv2.CV_64F).var())

    if overall_var == 0:
        return 0.5  # Can't compute, neutral score

    ratio = centre_var / overall_var
    # Ratio >= 1.0 means centre is at least as sharp → good subject placement
    return float(min(ratio, 1.0))


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _clamp_normalise(value: float, low: float, high: float) -> float:
    """
    Map value linearly from [low, high] to [0.0, 1.0].
    Values below low → 0.0, above high → 1.0.
    """
    if high == low:
        return 0.0
    return float(np.clip((value - low) / (high - low), 0.0, 1.0))
