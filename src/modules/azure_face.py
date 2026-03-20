"""
azure_face.py — Azure AI Face API wrapper for MMR Photo Manager

Replaces the local `face_recognition` (dlib) used in bib_analyzer.py with
Azure's cloud Face API. Provides three capabilities:

  DETECTION   — find faces in an event photo, return bboxes + attributes
  VERIFICATION — compare two face crops 1:1 (is this the same person?)
  IDENTIFICATION — given a face, find the matching MMR member in the PersonGroup
                   (requires Microsoft Limited Access approval for PersonGroup/Identify)

Setup
-----
1. Create a Face resource in Azure Portal (Cognitive Services → Face).
2. Copy .env.local.example → .env.local and fill in AZURE_FACE_KEY + AZURE_FACE_ENDPOINT.
3. pip install azure-ai-vision-face python-dotenv

Azure Face API Docs:
  https://learn.microsoft.com/azure/ai-services/computer-vision/overview-identity

⚠️  Important — Limited Access
  Face detection and verification are available to all.
  PersonGroup / Identify (1:N matching) requires Microsoft approval:
  https://aka.ms/facerecognition
  For initial testing, detection + verification cover most of the workflow.
"""

import os
import io
import time
from pathlib import Path
from typing import Optional

# ── SDK imports ───────────────────────────────────────────────────
try:
    from azure.ai.vision.face import FaceClient, FaceAdministrationClient
    from azure.ai.vision.face.models import (
        FaceDetectionModel,
        FaceRecognitionModel,
        FaceAttributeTypeDetection01,
        FaceAttributeTypeRecognition04,
    )
    from azure.core.credentials import AzureKeyCredential
    from azure.core.exceptions import HttpResponseError
    _AZURE_SDK = True
except ImportError:
    _AZURE_SDK = False

# ── .env.local loader ─────────────────────────────────────────────
def _load_env():
    """Load .env.local from the photo-manager root (two levels up from here)."""
    env_path = Path(__file__).parent.parent.parent / ".env.local"
    if env_path.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(env_path)
        except ImportError:
            # Fallback: parse manually
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        os.environ.setdefault(k.strip(), v.strip())

_load_env()


# ─────────────────────────────────────────────────────────────────
# Client factory
# ─────────────────────────────────────────────────────────────────

def _get_clients() -> tuple:
    """Return (FaceClient, FaceAdministrationClient) or raise RuntimeError."""
    if not _AZURE_SDK:
        raise RuntimeError(
            "azure-ai-vision-face is not installed.\n"
            "Run: pip install azure-ai-vision-face python-dotenv"
        )
    key      = os.environ.get("AZURE_FACE_KEY", "").strip()
    endpoint = os.environ.get("AZURE_FACE_ENDPOINT", "").strip()
    if not key or not endpoint or key.startswith("your_"):
        raise RuntimeError(
            "Azure credentials not set.\n"
            "Copy .env.local.example → .env.local and fill in "
            "AZURE_FACE_KEY and AZURE_FACE_ENDPOINT."
        )
    cred = AzureKeyCredential(key)
    face_client  = FaceClient(endpoint=endpoint, credential=cred)
    admin_client = FaceAdministrationClient(endpoint=endpoint, credential=cred)
    return face_client, admin_client


# ─────────────────────────────────────────────────────────────────
# 1. Face Detection
# ─────────────────────────────────────────────────────────────────

def detect_faces(image_path: str, return_attributes: bool = True) -> dict:
    """
    Detect all faces in a local image file.

    Returns
    -------
    {
        "file_path":  str,
        "face_count": int,
        "faces": [
            {
                "face_id":    str,           # temporary ID (valid 24 h)
                "bbox":       [left, top, width, height],
                "confidence": float,         # detection confidence
                "head_pose":  {"pitch": float, "roll": float, "yaw": float},
                "occlusion":  {"forehead": bool, "eye": bool, "mouth": bool},
                "blur":       {"level": str, "value": float},
                "noise":      {"level": str, "value": float},
                "exposure":   {"level": str, "value": float},
            }
        ],
        "error": str | None
    }
    """
    result = {"file_path": image_path, "face_count": 0, "faces": [], "error": None}
    try:
        face_client, _ = _get_clients()
        with open(image_path, "rb") as f:
            image_data = f.read()

        attributes = (
            [
                FaceAttributeTypeDetection01.HEAD_POSE,
                FaceAttributeTypeDetection01.OCCLUSION,
                FaceAttributeTypeDetection01.BLUR,
                FaceAttributeTypeDetection01.NOISE,
                FaceAttributeTypeDetection01.EXPOSURE,
            ]
            if return_attributes
            else []
        )

        detected = face_client.detect(
            io.BytesIO(image_data),
            detection_model=FaceDetectionModel.DETECTION03,
            recognition_model=FaceRecognitionModel.RECOGNITION04,
            return_face_id=True,
            return_face_attributes=attributes if attributes else None,
        )

        faces = []
        for f in detected:
            r = f.face_rectangle
            face_info = {
                "face_id": f.face_id,
                "bbox":    [r.left, r.top, r.width, r.height],
                "confidence": None,  # Detection03 doesn't expose a per-face score
            }
            if f.face_attributes:
                fa = f.face_attributes
                if fa.head_pose:
                    face_info["head_pose"] = {
                        "pitch": round(fa.head_pose.pitch, 1),
                        "roll":  round(fa.head_pose.roll,  1),
                        "yaw":   round(fa.head_pose.yaw,   1),
                    }
                if fa.occlusion:
                    face_info["occlusion"] = {
                        "forehead": fa.occlusion.forehead_occluded,
                        "eye":      fa.occlusion.eye_occluded,
                        "mouth":    fa.occlusion.mouth_occluded,
                    }
                if fa.blur:
                    face_info["blur"] = {
                        "level": fa.blur.blur_level.value if fa.blur.blur_level else None,
                        "value": round(fa.blur.value, 3) if fa.blur.value is not None else None,
                    }
                if fa.noise:
                    face_info["noise"] = {
                        "level": fa.noise.noise_level.value if fa.noise.noise_level else None,
                        "value": round(fa.noise.value, 3) if fa.noise.value is not None else None,
                    }
                if fa.exposure:
                    face_info["exposure"] = {
                        "level": fa.exposure.exposure_level.value if fa.exposure.exposure_level else None,
                        "value": round(fa.exposure.value, 3) if fa.exposure.value is not None else None,
                    }
            faces.append(face_info)

        result["face_count"] = len(faces)
        result["faces"]      = faces

    except HttpResponseError as e:
        result["error"] = f"Azure API error {e.status_code}: {e.message}"
    except FileNotFoundError:
        result["error"] = f"File not found: {image_path}"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"

    return result


# ─────────────────────────────────────────────────────────────────
# 2. Face Verification (1:1 — no approval needed)
# ─────────────────────────────────────────────────────────────────

def verify_faces(image_path_a: str, image_path_b: str) -> dict:
    """
    Check whether the most prominent face in image_a is the same person
    as the most prominent face in image_b.

    Does NOT require PersonGroup / Limited Access approval.

    Returns
    -------
    {
        "is_identical": bool,
        "confidence":   float,   # 0.0–1.0
        "threshold":    float,   # recommended: 0.50
        "error":        str | None
    }
    """
    result = {"is_identical": None, "confidence": None, "threshold": 0.50, "error": None}
    try:
        face_client, _ = _get_clients()

        # Detect the primary face in each image
        det_a = detect_faces(image_path_a, return_attributes=False)
        det_b = detect_faces(image_path_b, return_attributes=False)

        if det_a.get("error"):
            result["error"] = f"Image A: {det_a['error']}"
            return result
        if det_b.get("error"):
            result["error"] = f"Image B: {det_b['error']}"
            return result
        if not det_a["faces"]:
            result["error"] = "No face detected in image A"
            return result
        if not det_b["faces"]:
            result["error"] = "No face detected in image B"
            return result

        face_id_a = det_a["faces"][0]["face_id"]
        face_id_b = det_b["faces"][0]["face_id"]

        verification = face_client.verify_face_to_face(
            face_id1=face_id_a,
            face_id2=face_id_b,
        )
        result["is_identical"] = verification.is_identical
        result["confidence"]   = round(verification.confidence, 4)

    except HttpResponseError as e:
        result["error"] = f"Azure API error {e.status_code}: {e.message}"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"

    return result


# ─────────────────────────────────────────────────────────────────
# 3. PersonGroup management (requires Limited Access for Identify)
# ─────────────────────────────────────────────────────────────────

def create_person_group(group_id: Optional[str] = None, name: str = "MMR Members") -> dict:
    """
    Create (or confirm existence of) a PersonGroup for MMR members.
    group_id defaults to AZURE_FACE_GROUP_ID env var.

    ⚠️  Using this group for Face Identify requires Limited Access approval.
    """
    group_id = group_id or os.environ.get("AZURE_FACE_GROUP_ID", "mmr-members")
    result = {"group_id": group_id, "created": False, "error": None}
    try:
        _, admin_client = _get_clients()
        admin_client.large_person_group.create(
            large_person_group_id=group_id,
            name=name,
            recognition_model=FaceRecognitionModel.RECOGNITION04,
        )
        result["created"] = True
        print(f"[azure_face] PersonGroup '{group_id}' created.")
    except HttpResponseError as e:
        if e.status_code == 409:
            print(f"[azure_face] PersonGroup '{group_id}' already exists — OK.")
        else:
            result["error"] = f"Azure API error {e.status_code}: {e.message}"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"
    return result


def add_member_photo(member_id: str, name: str, photo_path: str,
                     group_id: Optional[str] = None) -> dict:
    """
    Enroll a member in the PersonGroup by adding their profile photo.

    member_id  — MMR member ID, e.g. "A0042"
    name       — Display name, e.g. "Jane Smith"
    photo_path — Path to the profile photo (JPG/PNG)
    group_id   — Defaults to AZURE_FACE_GROUP_ID env var

    On first call for a member, creates a new Person.
    Subsequent calls add additional face photos to the same Person.
    The person_id is printed so you can save it to a member record.
    """
    group_id = group_id or os.environ.get("AZURE_FACE_GROUP_ID", "mmr-members")
    result   = {"member_id": member_id, "person_id": None, "face_id": None, "error": None}
    try:
        _, admin_client = _get_clients()

        # Create the Person entry
        person = admin_client.large_person_group.create_person(
            large_person_group_id=group_id,
            name=name,
            user_data=member_id,
        )
        result["person_id"] = person.person_id
        print(f"[azure_face] Created Person: {name} ({member_id}) → person_id={person.person_id}")

        # Add the face photo
        with open(photo_path, "rb") as f:
            image_data = f.read()

        face = admin_client.large_person_group.add_face(
            large_person_group_id=group_id,
            person_id=person.person_id,
            image_content=io.BytesIO(image_data),
            detection_model=FaceDetectionModel.DETECTION03,
        )
        result["face_id"] = face.persisted_face_id
        print(f"[azure_face] Added face photo for {name} → face_id={face.persisted_face_id}")

    except HttpResponseError as e:
        result["error"] = f"Azure API error {e.status_code}: {e.message}"
    except FileNotFoundError:
        result["error"] = f"File not found: {photo_path}"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"

    return result


def train_group(group_id: Optional[str] = None, wait: bool = True, timeout: int = 120) -> dict:
    """
    Trigger training of the PersonGroup and optionally wait for it to finish.
    Must be called after adding/updating member photos before Identify will work.
    """
    group_id = group_id or os.environ.get("AZURE_FACE_GROUP_ID", "mmr-members")
    result   = {"group_id": group_id, "status": None, "error": None}
    try:
        _, admin_client = _get_clients()
        admin_client.large_person_group.train(large_person_group_id=group_id)
        print(f"[azure_face] Training started for group '{group_id}'...")

        if wait:
            start = time.time()
            while True:
                status = admin_client.large_person_group.get_training_status(
                    large_person_group_id=group_id
                )
                result["status"] = status.status.value
                if status.status.value == "succeeded":
                    print(f"[azure_face] Training succeeded.")
                    break
                if status.status.value == "failed":
                    result["error"] = f"Training failed: {status.message}"
                    break
                if time.time() - start > timeout:
                    result["error"] = f"Training timed out after {timeout}s"
                    break
                time.sleep(3)

    except HttpResponseError as e:
        result["error"] = f"Azure API error {e.status_code}: {e.message}"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"

    return result


def identify_faces(image_path: str, group_id: Optional[str] = None,
                   max_candidates: int = 1, confidence_threshold: float = 0.50) -> dict:
    """
    Identify faces in an event photo against the MMR PersonGroup.

    ⚠️  Requires Limited Access approval from Microsoft:
         https://aka.ms/facerecognition

    Returns
    -------
    {
        "file_path":   str,
        "face_count":  int,
        "matches": [
            {
                "face_bbox":   [left, top, width, height],
                "candidates":  [{"person_id": str, "confidence": float}],
            }
        ],
        "error": str | None
    }
    """
    group_id = group_id or os.environ.get("AZURE_FACE_GROUP_ID", "mmr-members")
    result   = {"file_path": image_path, "face_count": 0, "matches": [], "error": None}
    try:
        face_client, _ = _get_clients()

        det = detect_faces(image_path, return_attributes=False)
        if det.get("error"):
            result["error"] = det["error"]
            return result

        face_ids = [f["face_id"] for f in det["faces"]]
        result["face_count"] = len(face_ids)

        if not face_ids:
            return result

        identifications = face_client.identify_from_large_person_group(
            face_ids=face_ids,
            large_person_group_id=group_id,
            max_num_of_candidates_returned=max_candidates,
            confidence_threshold=confidence_threshold,
        )

        for ident, face in zip(identifications, det["faces"]):
            match = {
                "face_bbox":  face["bbox"],
                "candidates": [
                    {"person_id": str(c.person_id), "confidence": round(c.confidence, 4)}
                    for c in ident.candidates
                ],
            }
            result["matches"].append(match)

    except HttpResponseError as e:
        if e.status_code == 403:
            result["error"] = (
                "Access denied (403). Face Identify requires Limited Access approval.\n"
                "Apply at: https://aka.ms/facerecognition\n"
                "For now, use verify_faces() for 1:1 comparison instead."
            )
        else:
            result["error"] = f"Azure API error {e.status_code}: {e.message}"
    except Exception as e:
        result["error"] = f"Unexpected error: {e}"

    return result
