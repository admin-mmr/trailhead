"""
outfit.py — Outfit colour signature extraction and matching

Extracts a compact colour "fingerprint" from the torso region of a
detected person.  Within a single race event every runner wears the
same outfit, so colour matching is a surprisingly strong signal —
often more reliable than face recognition at distance.

The module is deliberately simple: HSV colour histograms + k-means
dominant colours.  No deep learning, no extra model downloads.

Output fields per person (appended to each people_boxes entry):
    outfit_signature : {
        "dominant_colors": [[H, S, V], ...],   # top 3 cluster centres
        "color_weights":   [float, ...],        # fraction of pixels per cluster
        "histogram":       [float x 48],        # compact HSV histogram (16H x 3S bins)
    }

Matching API:
    match_outfit(sig_a, sig_b) -> float   # 0.0–1.0 similarity score

Why HSV instead of RGB?
    HSV separates colour (Hue) from brightness (Value).  Race photos
    have wildly different lighting — sunny start line vs shaded trail.
    By weighting Hue and Saturation heavily, the same teal shirt reads
    as "teal" whether the runner is in sunlight or shadow.

Why crop to the torso?
    The full person bounding box includes the head (skin tones, hair,
    hat — already captured by face recognition) and legs (often black
    tights/shorts, low signal).  The torso (shirt/jersey) is the most
    distinctive and consistent region.

Limitations:
    - Two runners in the same club jersey will match.  The cascade in
      bib_analyzer.py handles this by requiring a second signal (face
      or partial bib) alongside outfit.
    - Very dark or very white shirts produce weak signatures because
      they occupy a narrow HSV range.  The match score will be
      moderate (0.5–0.7) rather than high, so the cascade naturally
      demands stronger evidence from other signals.
"""

import cv2
import numpy as np
from typing import Optional


# ── Configuration ────────────────────────────────────────────────
# How many dominant colours to extract via k-means
N_CLUSTERS = 3

# Torso crop: take the vertical slice from 15% to 55% of the person
# bounding box height.  This avoids the head (top 15%) and legs
# (bottom 45%).  Horizontal: full width of the person box.
TORSO_TOP_FRAC    = 0.15
TORSO_BOTTOM_FRAC = 0.55

# HSV histogram bins: 16 Hue x 3 Saturation = 48 bins total.
# We drop the Value channel from the histogram to make it
# lighting-invariant.  Value is still captured in dominant_colors
# for display / debugging purposes.
HIST_H_BINS = 16
HIST_S_BINS = 3

# Minimum torso crop size in pixels.  Below this the crop is too
# small to produce a meaningful colour signature (distant runners).
MIN_TORSO_PX = 20

# k-means iterations (OpenCV)
KMEANS_MAX_ITER  = 10
KMEANS_EPSILON   = 1.0
KMEANS_ATTEMPTS  = 3

# Weights for combining histogram similarity and dominant-colour
# similarity in match_outfit().
W_HISTOGRAM = 0.6
W_DOMINANT  = 0.4


# ─────────────────────────────────────────────────────────────────
# Torso extraction
# ─────────────────────────────────────────────────────────────────

def _crop_torso(bgr_image: np.ndarray, bbox: list) -> Optional[np.ndarray]:
    """
    Crop the torso region from a person bounding box.

    Args:
        bgr_image: full BGR image
        bbox:      [x, y, w, h] person bounding box from people.py

    Returns:
        BGR torso crop, or None if too small / out of bounds.
    """
    px, py, pw, ph = bbox
    img_h, img_w = bgr_image.shape[:2]

    # Calculate torso vertical slice within the person box
    torso_y1 = int(py + ph * TORSO_TOP_FRAC)
    torso_y2 = int(py + ph * TORSO_BOTTOM_FRAC)
    torso_x1 = max(0, px)
    torso_x2 = min(img_w, px + pw)

    # Clamp to image bounds
    torso_y1 = max(0, min(torso_y1, img_h))
    torso_y2 = max(0, min(torso_y2, img_h))

    crop_h = torso_y2 - torso_y1
    crop_w = torso_x2 - torso_x1

    if crop_h < MIN_TORSO_PX or crop_w < MIN_TORSO_PX:
        return None

    return bgr_image[torso_y1:torso_y2, torso_x1:torso_x2]


# ─────────────────────────────────────────────────────────────────
# Colour signature extraction
# ─────────────────────────────────────────────────────────────────

def extract_outfit_signature(bgr_image: np.ndarray, bbox: list) -> Optional[dict]:
    """
    Extract an outfit colour signature from a person bounding box.

    Args:
        bgr_image: full BGR image (as loaded by quality._load_as_bgr)
        bbox:      [x, y, w, h] person bounding box

    Returns:
        {
            "dominant_colors": [[H, S, V], [H, S, V], [H, S, V]],
            "color_weights":   [0.55, 0.30, 0.15],
            "histogram":       [float x 48]
        }
        or None if the torso crop is too small.

    The dominant_colors are the k-means cluster centres in HSV space
    (H: 0–180, S: 0–255, V: 0–255 — OpenCV convention).
    color_weights sum to 1.0 and indicate how much of the torso each
    colour occupies.  The histogram is a normalised 48-bin HS
    distribution for robust matching.
    """
    torso = _crop_torso(bgr_image, bbox)
    if torso is None:
        return None

    hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)

    # ── Dominant colours via k-means ─────────────────────────────
    # Reshape pixels into (N, 3) for k-means
    pixels = hsv.reshape(-1, 3).astype(np.float32)

    # OpenCV k-means needs (criteria, k, flags)
    criteria = (
        cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER,
        KMEANS_MAX_ITER,
        KMEANS_EPSILON,
    )

    # Handle edge case: fewer unique pixels than clusters
    n_clusters = min(N_CLUSTERS, len(np.unique(pixels, axis=0)))
    if n_clusters < 1:
        return None

    _, labels, centres = cv2.kmeans(
        pixels, n_clusters, None, criteria, KMEANS_ATTEMPTS,
        cv2.KMEANS_PP_CENTERS,
    )

    # Compute weight (fraction of pixels) per cluster
    label_counts = np.bincount(labels.flatten(), minlength=n_clusters)
    weights = label_counts / label_counts.sum()

    # Sort by weight descending (most dominant colour first)
    order = np.argsort(-weights)
    centres = centres[order]
    weights = weights[order]

    # Pad to N_CLUSTERS if fewer unique colours
    while len(centres) < N_CLUSTERS:
        centres = np.vstack([centres, centres[-1:]])
        weights = np.append(weights, 0.0)

    dominant_colors = [[int(c[0]), int(c[1]), int(c[2])] for c in centres]
    color_weights = [round(float(w), 4) for w in weights]

    # ── Compact HS histogram ─────────────────────────────────────
    # 2D histogram on Hue and Saturation only (drop Value for
    # lighting invariance).
    hist = cv2.calcHist(
        [hsv], [0, 1], None,
        [HIST_H_BINS, HIST_S_BINS],
        [0, 180, 0, 256],   # H range 0–180, S range 0–256 in OpenCV
    )

    # Normalise to sum to 1.0
    hist_sum = hist.sum()
    if hist_sum > 0:
        hist = hist / hist_sum

    histogram = [round(float(v), 6) for v in hist.flatten()]

    return {
        "dominant_colors": dominant_colors,
        "color_weights":   color_weights,
        "histogram":       histogram,
    }


# ─────────────────────────────────────────────────────────────────
# Outfit matching
# ─────────────────────────────────────────────────────────────────

def _histogram_similarity(hist_a: list, hist_b: list) -> float:
    """
    Compare two HS histograms using Bhattacharyya distance
    (cv2.HISTCMP_BHATTACHARYYA), converted to a 0–1 similarity
    score where 1.0 = identical distributions.

    Bhattacharyya distance ranges from 0 (identical) to 1 (disjoint).
    We invert it: similarity = 1 - distance.
    """
    a = np.array(hist_a, dtype=np.float32)
    b = np.array(hist_b, dtype=np.float32)

    if a.shape != b.shape or a.sum() == 0 or b.sum() == 0:
        return 0.0

    # Reshape to (N, 1) as required by compareHist
    distance = cv2.compareHist(a, b, cv2.HISTCMP_BHATTACHARYYA)
    return float(max(0.0, 1.0 - distance))


def _dominant_color_similarity(sig_a: dict, sig_b: dict) -> float:
    """
    Compare dominant colours by matching each cluster in A to the
    nearest cluster in B (in HSV space), weighted by cluster size.

    This catches cases the histogram misses: two shirts might have
    very similar colour distributions but different spatial patterns.
    The dominant-colour comparison is more forgiving of small shifts
    in hue and saturation.

    Distance metric: weighted Euclidean in HSV, with Hue wrapped
    (since H=0 and H=179 are adjacent — both are red).
    """
    colors_a = np.array(sig_a["dominant_colors"], dtype=np.float32)
    colors_b = np.array(sig_b["dominant_colors"], dtype=np.float32)
    weights_a = np.array(sig_a["color_weights"], dtype=np.float32)

    if len(colors_a) == 0 or len(colors_b) == 0:
        return 0.0

    total_similarity = 0.0
    total_weight = 0.0

    for i, (ca, wa) in enumerate(zip(colors_a, weights_a)):
        if wa < 0.01:
            continue   # skip negligible clusters

        # Find nearest colour in B
        best_dist = float("inf")
        for cb in colors_b:
            dist = _hsv_distance(ca, cb)
            if dist < best_dist:
                best_dist = dist

        # Max meaningful distance is ~180 (opposite hues, full saturation diff)
        # Normalise to 0–1 similarity
        sim = max(0.0, 1.0 - best_dist / 180.0)
        total_similarity += wa * sim
        total_weight += wa

    if total_weight == 0:
        return 0.0

    return float(total_similarity / total_weight)


def _hsv_distance(hsv_a: np.ndarray, hsv_b: np.ndarray) -> float:
    """
    Weighted Euclidean distance in HSV space with circular Hue handling.

    Hue is circular (0 and 180 are adjacent in OpenCV's 0–180 range),
    so we use the minimum angular distance.  Saturation and Value
    differences are scaled to the same range as Hue for balanced
    weighting.

    Channel weights: H=1.0, S=0.5, V=0.3
    (Hue matters most; Value matters least for lighting invariance)
    """
    # Circular hue distance (OpenCV Hue range: 0–180)
    h_diff = abs(float(hsv_a[0]) - float(hsv_b[0]))
    h_diff = min(h_diff, 180.0 - h_diff)

    # S and V are 0–255; scale to 0–180 range to match Hue
    s_diff = abs(float(hsv_a[1]) - float(hsv_b[1])) * (180.0 / 255.0)
    v_diff = abs(float(hsv_a[2]) - float(hsv_b[2])) * (180.0 / 255.0)

    # Weighted combination
    return float(np.sqrt(1.0 * h_diff**2 + 0.5 * s_diff**2 + 0.3 * v_diff**2))


def match_outfit(sig_a: dict, sig_b: dict) -> float:
    """
    Compare two outfit signatures and return a similarity score (0.0–1.0).

    Combines histogram similarity (global colour distribution) with
    dominant colour matching (cluster-level comparison).

    Args:
        sig_a: outfit_signature dict from extract_outfit_signature()
        sig_b: outfit_signature dict from extract_outfit_signature()

    Returns:
        float 0.0–1.0 where:
            > 0.85  very likely same outfit
            > 0.65  probable same outfit (combine with other signals)
            < 0.50  likely different outfit
    """
    if sig_a is None or sig_b is None:
        return 0.0

    hist_sim = _histogram_similarity(sig_a["histogram"], sig_b["histogram"])
    dom_sim  = _dominant_color_similarity(sig_a, sig_b)

    return round(float(W_HISTOGRAM * hist_sim + W_DOMINANT * dom_sim), 4)


# ─────────────────────────────────────────────────────────────────
# Batch extraction (for use by process_photos.py)
# ─────────────────────────────────────────────────────────────────

def extract_outfit_signatures(bgr_image: np.ndarray,
                              people_boxes: list) -> list:
    """
    Extract outfit signatures for all detected people in an image.

    Args:
        bgr_image:    full BGR image
        people_boxes: list of person dicts from people.py, each with
                      a "bbox" key [x, y, w, h]

    Returns:
        The same people_boxes list, with each entry enriched with an
        "outfit_signature" key (dict or None if torso too small).
    """
    for person in people_boxes:
        bbox = person.get("bbox")
        if bbox is None:
            person["outfit_signature"] = None
            continue

        sig = extract_outfit_signature(bgr_image, bbox)
        person["outfit_signature"] = sig

    return people_boxes
