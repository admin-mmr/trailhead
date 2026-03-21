"""
people.py — Person detection using YOLOv8

Counts the number of people in a photo and returns their bounding boxes
and per-detection confidence scores.

Install: pip install ultralytics
Model:   YOLOv8n (nano) downloads automatically on first use (~6 MB)

Output structure added to the record:
    people_count  : int   — total persons detected above threshold
    people_boxes  : list  — [{"bbox": [x, y, w, h], "conf": 0.91, "size_frac": 0.14}, ...]
                            bbox is [left, top, width, height] in pixels
                            size_frac is person area / image area (0.0–1.0)
"""

import cv2
import numpy as np

# Confidence thresholds — YOLO and HOG use different score scales
YOLO_CONF_THRESHOLD = 0.40   # YOLO outputs true probabilities 0–1
HOG_CONF_THRESHOLD  = 0.20   # HOG outputs SVM margin scores; 0.2 raw ≈ meaningful detection

# Load resolution for detection — larger than quality scoring (800px) so
# small/distant people are still detectable in wide crowd shots.
DETECTION_MAX_PX = 1280

# YOLO class index for "person"
YOLO_CLASS_PERSON = 0

# Module-level model cache so we only load weights once per process
_model = None


def _get_model():
    """
    Try to load YOLOv8n. Falls back to OpenCV HOG detector if the model
    file cannot be downloaded (offline / restricted network).
    Returns ("yolo", model) or ("hog", hog_detector).
    """
    global _model
    if _model is None:
        try:
            from ultralytics import YOLO
            m = YOLO("yolov8n.pt")   # downloads ~6 MB on first call
            _model = ("yolo", m)
        except Exception:
            hog = cv2.HOGDescriptor()
            hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
            _model = ("hog", hog)
            print("[people] YOLOv8 unavailable — using HOG fallback detector")
    return _model


def detect_people(bgr_image: np.ndarray) -> dict:
    """
    Run person detection on a pre-loaded BGR numpy array.
    For best results pass an image loaded at DETECTION_MAX_PX (1280px),
    not the 800px quality-scoring resolution.

    Args:
        bgr_image: OpenCV-style BGR image (as returned by quality._load_as_bgr)

    Returns:
        {
            "people_count": int,
            "people_boxes": [
                {"bbox": [x, y, w, h], "conf": float},
                ...
            ]
        }
    On failure returns people_count=None, people_boxes=None, plus "error".
    """
    try:
        backend, model = _get_model()
        img_h, img_w = bgr_image.shape[:2]
        img_area = img_h * img_w
        boxes = []

        if backend == "yolo":
            results = model(bgr_image, verbose=False)[0]
            for box in results.boxes:
                if int(box.cls[0]) != YOLO_CLASS_PERSON:
                    continue
                conf = float(box.conf[0])
                if conf < YOLO_CONF_THRESHOLD:
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                bw, bh = round(x2 - x1), round(y2 - y1)
                boxes.append({
                    "bbox":      [round(x1), round(y1), bw, bh],
                    "conf":      round(conf, 3),
                    "size_frac": round((bw * bh) / img_area, 3),
                })

        else:  # HOG fallback
            # HOG SVM outputs a margin score (not a probability).
            # Positive values = person detected; higher = more confident.
            # HOG_CONF_THRESHOLD is applied to the raw margin score before
            # we normalise it to 0–1 for the output record.
            h, w = bgr_image.shape[:2]
            scale = min(1.0, 640 / max(h, w))
            small = cv2.resize(bgr_image, (int(w * scale), int(h * scale)))
            rects, weights = model.detectMultiScale(
                small,
                winStride=(8, 8),
                padding=(4, 4),
                scale=1.05,
                hitThreshold=HOG_CONF_THRESHOLD,   # pre-filter by raw margin
            )
            for i, (rx, ry, rw, rh) in enumerate(rects):
                raw_conf = float(weights[i]) if len(weights) > i else HOG_CONF_THRESHOLD
                # Normalise: margin 0.2 → 0.1 output, 2.0 → 1.0 output
                norm_conf = min(max(raw_conf / 2.0, 0.0), 1.0)
                bw = round(rw / scale);  bh = round(rh / scale)
                boxes.append({
                    "bbox":      [round(rx / scale), round(ry / scale), bw, bh],
                    "conf":      round(norm_conf, 3),
                    "size_frac": round((bw * bh) / img_area, 3),
                })

        # Sort largest bounding box first (most prominent person at top)
        boxes.sort(key=lambda b: b["bbox"][2] * b["bbox"][3], reverse=True)

        return {
            "people_count": len(boxes),
            "people_boxes": boxes,
        }

    except Exception as exc:
        return {
            "people_count": None,
            "people_boxes": None,
            "error": f"people detection error: {exc}",
        }
