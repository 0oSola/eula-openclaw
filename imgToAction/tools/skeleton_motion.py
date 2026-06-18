from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Iterable


REQUIRED_JOINTS = (
    "pelvis",
    "neck",
    "head",
    "right_shoulder",
    "right_elbow",
    "right_wrist",
    "left_shoulder",
    "left_elbow",
    "left_wrist",
    "right_hip",
    "right_knee",
    "right_ankle",
    "left_hip",
    "left_knee",
    "left_ankle",
)


Vector = list[float]


def _as_vector(value: Any, name: str) -> Vector:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"Joint {name} must be a 3D vector")
    result = [float(component) for component in value]
    if any(not math.isfinite(component) for component in result):
        raise ValueError(f"Joint {name} contains a non-finite value")
    return result


def normalize_frame(joints: dict[str, Any], index: int) -> dict[str, Any]:
    missing = [name for name in REQUIRED_JOINTS if name not in joints]
    if missing:
        raise ValueError(f"Missing required joints: {', '.join(missing)}")
    return {
        "index": int(index),
        "joints": {name: _as_vector(value, name) for name, value in joints.items()},
    }


def validate_skeleton(payload: dict[str, Any]) -> dict[str, Any]:
    fps = float(payload.get("fps", 0))
    if fps <= 0 or not math.isfinite(fps):
        raise ValueError("Skeleton fps must be a positive finite number")
    frames = payload.get("frames")
    if not isinstance(frames, list) or not frames:
        raise ValueError("Skeleton must contain at least one frame")

    normalized_frames = []
    for ordinal, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise ValueError(f"Skeleton frame {ordinal} must be an object")
        frame_index = int(frame.get("index", ordinal))
        joints = frame.get("joints")
        if not isinstance(joints, dict):
            raise ValueError(f"Skeleton frame {frame_index} must contain joints")
        normalized_frames.append(normalize_frame(joints, frame_index))

    return {
        "fps": int(fps) if fps.is_integer() else fps,
        "source": dict(payload.get("source", {})),
        "frames": normalized_frames,
    }


def write_skeleton(path: Path, payload: dict[str, Any]) -> None:
    validated = validate_skeleton(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(validated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_skeleton(path: Path) -> dict[str, Any]:
    return validate_skeleton(json.loads(path.read_text(encoding="utf-8")))


def duration_seconds(payload: dict[str, Any]) -> float:
    validated = validate_skeleton(payload)
    return len(validated["frames"]) / float(validated["fps"])


def _vec(value: Iterable[float]) -> Vector:
    return [float(component) for component in value]


def add(left: Iterable[float], right: Iterable[float]) -> Vector:
    return [a + b for a, b in zip(_vec(left), _vec(right), strict=True)]


def sub(left: Iterable[float], right: Iterable[float]) -> Vector:
    return [a - b for a, b in zip(_vec(left), _vec(right), strict=True)]


def mul(value: Iterable[float], scalar: float) -> Vector:
    return [component * float(scalar) for component in _vec(value)]


def dot(left: Iterable[float], right: Iterable[float]) -> float:
    return sum(a * b for a, b in zip(_vec(left), _vec(right), strict=True))


def length(value: Iterable[float]) -> float:
    return math.sqrt(dot(value, value))


def normalize(value: Iterable[float]) -> Vector:
    vector = _vec(value)
    vector_length = length(vector)
    if vector_length <= 1e-8:
        return [0.0, 0.0, 0.0]
    return [component / vector_length for component in vector]


def angle_degrees(left: Iterable[float], right: Iterable[float]) -> float:
    left_norm = normalize(left)
    right_norm = normalize(right)
    left_length = length(left_norm)
    right_length = length(right_norm)
    if left_length <= 1e-8 or right_length <= 1e-8:
        return 0.0
    value = max(-1.0, min(1.0, dot(left_norm, right_norm)))
    return math.degrees(math.acos(value))
