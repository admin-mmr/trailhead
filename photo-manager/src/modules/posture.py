"""
posture.py — Person posture and bib facing direction estimation

Uses MediaPipe Pose keypoints when available; falls back to a
bounding-box heuristic when MediaPipe is not installed.

Install (optional, better accuracy):
    pip install mediapipe

Output fields per person (appended to each people_boxes entry):
    posture   : str  — "running" | "jogging" | "standing" | "walking"
                        | "bent" | "unknown"
    posture_conf : float  — 0.0–1.0 confidence in the posture label

Output fields on the record (for the primary/most prominent person):
    bib_facing : str  — "camera" | "left" | "right" | "back" | "unknown"
    bib_facing_conf : float
"""

import cv2
import numpy as np

# ── Heuristic thresholds ──────────────────────────────────────────
# Aspect ratio of the person bounding box (height / width)
# Tall & narrow → standing/running; wide → bent/crouching
ASPECT_TALL   = 2.2   # h/w >= this → likely upright
ASPECT_WIDE   = 1.2   # h/w < this  → likely bent/crouching

# When using pose keypoints (MediaPipe), angles in degrees
RUNNING_KNEE_ANGLE_MAX = 130   # bent knee during run stride
JOGGING_KNEE_ANGLE_MAX = 150

_mp_pose  = None   # MediaPipe pose object cache
_mp_avail = None   # None=not checked, True/False after first attempt


def _get_mediapipe():
    global _mp_pose, _mp_avail
    if _mp_avail is None:
        try:
            import mediapipe as mp
            _mp_pose  = mp.solutions.pose.Pose(
                static_image_mode=True,
                model_complexity=0,     # 0=lite, fast
                min_detection_confidence=0.4,
            )
            _mp_avail = True
        except Exception:
            _mp_avail = False
    return _mp_avail, _mp_pose


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────

def estimate_posture(bgr_image: np.ndarray, people_boxes: list) -> list:
    """
    Estimate posture for each detected person.

    Args:
        bgr_image:    Full image as BGR numpy array.
        people_boxes: List from people.detect_people() — each item has "bbox".

    Returns:
        Same list with "posture" and "posture_conf" added to each entry.
        Original list is not mutated; a new list is returned.
    """
    if not people_boxes:
        return []

    results = []
    mp_ok, mp_pose = _get_mediapipe()

    for person in people_boxes:
        entry = dict(person)   # shallow copy so we don't mutate caller's data
        px, py, pw, ph = person["bbox"]

        # Crop the person from the full image
        x1 = max(0, px);  y1 = max(0, py)
        x2 = min(bgr_image.shape[1], px + pw)
        y2 = min(bgr_image.shape[0], py + ph)
        crop = bgr_image[y1:y2, x1:x2]

        if crop.size == 0 or pw <= 0 or ph <= 0:
            entry["posture"]      = "unknown"
            entry["posture_conf"] = 0.0
            results.append(entry)
            continue

        if mp_ok:
            posture, conf = _posture_from_keypoints(crop, mp_pose)
        else:
            posture, conf = _posture_from_bbox(pw, ph)

        entry["posture"]      = posture
        entry["posture_conf"] = round(conf, 3)

        # Per-person facing direction
        facing, facing_conf = "unknown", 0.0
        if mp_ok:
            facing, facing_conf = _facing_from_keypoints(crop, mp_pose)
        if facing == "unknown":
            facing, facing_conf = _facing_from_face(crop)
        entry["facing"]      = facing
        entry["facing_conf"] = round(facing_conf, 3)

        results.append(entry)

    return results


def estimate_bib_facing(bgr_image: np.ndarray, people_boxes: list,
                         bib_primary: dict) -> dict:
    """
    Estimate which direction the primary bib subject is facing.

    Strategy (in order of reliability):
      1. If MediaPipe found shoulder keypoints → use shoulder line angle
      2. If a face was detected on the person crop → facing camera or slight angle
      3. Fallback: use bib OCR confidence as proxy
           high ocr_conf (>0.7)  → facing camera (text was readable)
           medium (0.4–0.7)      → partial angle
           low (<0.4)            → back or side

    Returns:
        {
            "bib_facing":      "camera" | "left" | "right" | "back" | "unknown",
            "bib_facing_conf": float
        }
    """
    if bib_primary is None:
        return {"bib_facing": "unknown", "bib_facing_conf": 0.0}

    # Find the primary person's box (matches bib_primary["bbox"])
    primary_box = None
    bib_bbox = bib_primary.get("bbox")
    for p in (people_boxes or []):
        if p["bbox"] == bib_bbox:
            primary_box = p
            break
    if primary_box is None and people_boxes:
        primary_box = people_boxes[0]   # fallback: use largest person

    mp_ok, mp_pose = _get_mediapipe()

    if primary_box and mp_ok:
        px, py, pw, ph = primary_box["bbox"]
        x1 = max(0, px);  y1 = max(0, py)
        x2 = min(bgr_image.shape[1], px + pw)
        y2 = min(bgr_image.shape[0], py + ph)
        crop = bgr_image[y1:y2, x1:x2]
        if crop.size > 0:
            facing, conf = _facing_from_keypoints(crop, mp_pose)
            if facing != "unknown":
                return {"bib_facing": facing, "bib_facing_conf": round(conf, 3)}

    # Fallback: use face detection on person crop
    if primary_box:
        px, py, pw, ph = primary_box["bbox"]
        x1 = max(0, px);  y1 = max(0, py)
        x2 = min(bgr_image.shape[1], px + pw)
        y2 = min(bgr_image.shape[0], py + ph)
        crop = bgr_image[y1:y2, x1:x2]
        if crop.size > 0:
            facing, conf = _facing_from_face(crop)
            if facing != "unknown":
                return {"bib_facing": facing, "bib_facing_conf": round(conf, 3)}

    # Last resort: infer from OCR confidence
    ocr_conf = bib_primary.get("ocr_conf", 0.0)
    if ocr_conf >= 0.75:
        return {"bib_facing": "camera", "bib_facing_conf": round(ocr_conf * 0.8, 3)}
    elif ocr_conf >= 0.45:
        return {"bib_facing": "side",   "bib_facing_conf": 0.4}
    else:
        return {"bib_facing": "back",   "bib_facing_conf": 0.35}


# ─────────────────────────────────────────────────────────────────
# Internal: MediaPipe-based estimation
# ─────────────────────────────────────────────────────────────────

def _posture_from_keypoints(crop: np.ndarray, pose) -> tuple:
    """
    Use MediaPipe Pose to estimate posture from joint angles.
    Returns (posture_label, confidence).
    """
    try:
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        res = pose.process(rgb)
        if not res.pose_landmarks:
            return _posture_from_bbox(crop.shape[1], crop.shape[0])

        lm = res.pose_landmarks.landmark
        import mediapipe as mp
        LP = mp.solutions.pose.PoseLandmark

        # Get key landmark positions (normalised 0–1 within the crop)
        def pt(idx):
            l = lm[idx]
            return np.array([l.x, l.y]), l.visibility

        (lhip,  lhip_v)  = pt(LP.LEFT_HIP)
        (rhip,  rhip_v)  = pt(LP.RIGHT_HIP)
        (lknee, lknee_v) = pt(LP.LEFT_KNEE)
        (rknee, rknee_v) = pt(LP.RIGHT_KNEE)
        (lankle,la_v)    = pt(LP.LEFT_ANKLE)
        (rankle,ra_v)    = pt(LP.RIGHT_ANKLE)
        (lsho,  ls_v)    = pt(LP.LEFT_SHOULDER)
        (rsho,  rs_v)    = pt(LP.RIGHT_SHOULDER)

        visibility = min(lhip_v, rhip_v, lknee_v, rknee_v)
        if visibility < 0.3:
            return _posture_from_bbox(crop.shape[1], crop.shape[0])

        # Knee angles
        l_knee_angle = _angle(lhip, lknee, lankle)
        r_knee_angle = _angle(rhip, rknee, rankle)
        min_knee = min(l_knee_angle, r_knee_angle)

        # Torso lean: angle of hip-midpoint → shoulder-midpoint vector from vertical
        hip_mid = (lhip + rhip) / 2
        sho_mid = (lsho + rsho) / 2
        torso_vec = sho_mid - hip_mid
        torso_lean = abs(np.degrees(np.arctan2(torso_vec[0], -torso_vec[1])))

        # Vertical spread of feet relative to body height
        body_height = abs(hip_mid[1] - sho_mid[1]) + 1e-6
        ankle_spread = abs(lankle[1] - rankle[1]) / body_height

        # Classify
        if torso_lean > 35:
            label, conf = "bent", 0.75
        elif min_knee < RUNNING_KNEE_ANGLE_MAX and ankle_spread > 0.3:
            label, conf = "running", 0.80
        elif min_knee < JOGGING_KNEE_ANGLE_MAX and ankle_spread > 0.15:
            label, conf = "jogging", 0.72
        elif min_knee >= JOGGING_KNEE_ANGLE_MAX and ankle_spread < 0.1:
            label, conf = "standing", 0.78
        else:
            label, conf = "walking", 0.60

        return label, conf

    except Exception:
        return _posture_from_bbox(crop.shape[1], crop.shape[0])


def _facing_from_keypoints(crop: np.ndarray, pose) -> tuple:
    """Use shoulder width ratio to infer camera-facing angle."""
    try:
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        res = pose.process(rgb)
        if not res.pose_landmarks:
            return "unknown", 0.0

        lm = res.pose_landmarks.landmark
        import mediapipe as mp
        LP = mp.solutions.pose.PoseLandmark

        ls = lm[LP.LEFT_SHOULDER]
        rs = lm[LP.RIGHT_SHOULDER]

        if ls.visibility < 0.4 or rs.visibility < 0.4:
            return "unknown", 0.0

        # Shoulder width in normalised coords
        sho_width = abs(ls.x - rs.x)

        # When facing camera, shoulder width is ~0.25–0.45 of the person width
        # When side-on, it collapses toward 0
        if sho_width > 0.20:
            return "camera", min(sho_width * 3, 0.95)
        elif sho_width > 0.08:
            # Determine left or right based on which shoulder is more forward (z axis)
            if ls.z < rs.z:   # left shoulder closer to camera
                return "right", 0.65
            else:
                return "left", 0.65
        else:
            return "back", 0.70

    except Exception:
        return "unknown", 0.0


# ─────────────────────────────────────────────────────────────────
# Internal: face-detection-based facing
# ─────────────────────────────────────────────────────────────────

def _facing_from_face(crop: np.ndarray) -> tuple:
    """
    Quick Haar face detection on the person crop.
    If a face is found in the upper half → facing camera.
    If no face found → back or side.
    """
    try:
        grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        face_cascade = cv2.CascadeClassifier(cascade_path)
        if face_cascade.empty():
            return "unknown", 0.0

        h, w = grey.shape
        # Only look in the upper 60% of the person box (where the head is)
        upper = grey[:int(h * 0.6), :]
        faces = face_cascade.detectMultiScale(
            upper, scaleFactor=1.1, minNeighbors=4, minSize=(20, 20)
        )
        if len(faces) > 0:
            return "camera", 0.80
        # Try profile cascade
        profile_path = cv2.data.haarcascades + "haarcascade_profileface.xml"
        profile_cascade = cv2.CascadeClassifier(profile_path)
        if not profile_cascade.empty():
            profiles = profile_cascade.detectMultiScale(
                upper, scaleFactor=1.1, minNeighbors=4, minSize=(20, 20)
            )
            if len(profiles) > 0:
                return "side", 0.65

        return "unknown", 0.0
    except Exception:
        return "unknown", 0.0


# ─────────────────────────────────────────────────────────────────
# Internal: bbox heuristic fallback
# ─────────────────────────────────────────────────────────────────

def _posture_from_bbox(w: int, h: int) -> tuple:
    """
    Simple aspect-ratio heuristic when no keypoints are available.
    Less accurate — only distinguishes upright vs bent.
    """
    if w <= 0:
        return "unknown", 0.0
    ratio = h / w
    if ratio >= ASPECT_TALL:
        return "standing", 0.45   # upright, but could be running — low confidence
    elif ratio < ASPECT_WIDE:
        return "bent", 0.45
    else:
        return "unknown", 0.30


# ─────────────────────────────────────────────────────────────────
# Internal: geometry
# ─────────────────────────────────────────────────────────────────

def _angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle at point b formed by vectors b→a and b→c, in degrees."""
    ba = a - b
    bc = c - b
    cos_angle = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    return float(np.degrees(np.arccos(np.clip(cos_angle, -1.0, 1.0))))
