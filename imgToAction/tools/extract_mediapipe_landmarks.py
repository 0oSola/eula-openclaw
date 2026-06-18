#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import struct
from typing import Any


FRAME_RE = re.compile(r"^frame_(?P<frame>\d+)_(?P<view>front|side|45)\.png$", re.IGNORECASE)
VIEW_ORDER = {"front": 0, "side": 1, "45": 2}

MEDIAPIPE_LANDMARKS = {
    "head": [0],
    "left_shoulder": [11],
    "right_shoulder": [12],
    "left_elbow": [13],
    "right_elbow": [14],
    "left_wrist": [15],
    "right_wrist": [16],
    "left_hip": [23],
    "right_hip": [24],
    "left_knee": [25],
    "right_knee": [26],
    "left_ankle": [27],
    "right_ankle": [28],
    "left_toe": [31],
    "right_toe": [32],
    "neck": [11, 12],
    "pelvis": [23, 24],
}

LANDMARK_WEIGHTS = {
    "head": 0.9,
    "neck": 1.0,
    "left_shoulder": 1.0,
    "right_shoulder": 1.0,
    "left_elbow": 1.1,
    "right_elbow": 1.1,
    "left_wrist": 1.5,
    "right_wrist": 1.5,
    "pelvis": 1.0,
    "left_hip": 0.8,
    "right_hip": 0.8,
    "left_knee": 0.9,
    "right_knee": 0.9,
    "left_ankle": 1.2,
    "right_ankle": 1.2,
    "left_toe": 1.1,
    "right_toe": 1.1,
}

MODEL_LANDMARK_MAP = {
    "head": ["頭"],
    "neck": ["首"],
    "left_shoulder": ["左肩"],
    "right_shoulder": ["右肩"],
    "left_elbow": ["左ひじ"],
    "right_elbow": ["右ひじ"],
    "left_wrist": ["左手首"],
    "right_wrist": ["右手首"],
    "pelvis": ["下半身"],
    "left_hip": ["左足"],
    "right_hip": ["右足"],
    "left_knee": ["左ひざ"],
    "right_knee": ["右ひざ"],
    "left_ankle": ["左足首"],
    "right_ankle": ["右足首"],
    "left_toe": ["左つま先ＩＫ"],
    "right_toe": ["右つま先ＩＫ"],
}


def read_png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError(f"Not a PNG image with an IHDR header: {path}")
    return struct.unpack(">II", header[16:24])


def discover_reference_images(input_dir: Path) -> list[dict[str, Any]]:
    if not input_dir.exists():
        raise FileNotFoundError(f"Reference image directory does not exist: {input_dir}")

    images: list[dict[str, Any]] = []
    for path in input_dir.glob("*.png"):
        match = FRAME_RE.match(path.name)
        if not match:
            continue
        width, height = read_png_size(path)
        view = match.group("view").lower()
        frame = int(match.group("frame"))
        images.append(
            {
                "path": path,
                "name": path.name,
                "frame_key": f"frame_{frame:02d}_{view}",
                "frame": frame,
                "view": view,
                "width": width,
                "height": height,
            }
        )

    return sorted(images, key=lambda item: (int(item["frame"]), VIEW_ORDER.get(str(item["view"]), 99), str(item["name"])))


def _landmark_value(landmark: Any, key: str, default: float = 0.0) -> float:
    if isinstance(landmark, dict):
        return float(landmark.get(key, default))
    return float(getattr(landmark, key, default))


def _indexed_landmarks(raw: dict[str, Any]) -> dict[int, Any]:
    result: dict[int, Any] = {}
    for index, landmark in enumerate(raw.get("pose_landmarks", []) or []):
        landmark_index = int(landmark.get("index", index)) if isinstance(landmark, dict) else index
        result[landmark_index] = landmark
    return result


def _confidence(landmarks: list[Any]) -> float:
    if not landmarks:
        return 0.0
    values = []
    for landmark in landmarks:
        visibility = _landmark_value(landmark, "visibility", 1.0)
        presence = _landmark_value(landmark, "presence", visibility)
        values.append(min(visibility, presence))
    return min(values)


def _project_landmark(name: str, source: dict[int, Any], width: int, height: int) -> dict[str, Any] | None:
    indices = MEDIAPIPE_LANDMARKS[name]
    points = [source[index] for index in indices if index in source]
    if len(points) != len(indices):
        return None

    x = sum(_landmark_value(point, "x") for point in points) / len(points)
    y = sum(_landmark_value(point, "y") for point in points) / len(points)
    z = sum(_landmark_value(point, "z", 0.0) for point in points) / len(points)
    confidence = _confidence(points)
    return {
        "x": round(x * width, 3),
        "y": round(y * height, 3),
        "z": round(z, 6),
        "weight": LANDMARK_WEIGHTS.get(name, 1.0),
        "confidence": round(confidence, 3),
        "source_indices": indices,
    }


def convert_raw_result(raw: dict[str, Any], source_dir: Path, min_confidence: float = 0.5) -> dict[str, Any]:
    width = int(raw["image_width"])
    height = int(raw["image_height"])
    indexed = _indexed_landmarks(raw)
    landmarks: dict[str, Any] = {}
    missing: list[str] = []
    low_confidence: list[str] = []

    for name in MEDIAPIPE_LANDMARKS:
        converted = _project_landmark(name, indexed, width, height)
        if converted is None:
            missing.append(name)
            continue
        if float(converted["confidence"]) < min_confidence:
            low_confidence.append(name)
        landmarks[name] = converted

    image_name = str(raw.get("image") or f"{raw['frame_key']}.png")
    return {
        "image": (source_dir / image_name).as_posix(),
        "frame": int(raw["frame"]),
        "view": str(raw["view"]),
        "image_width": width,
        "image_height": height,
        "landmarks": landmarks,
        "missing": missing,
        "low_confidence": low_confidence,
    }


def build_reference_config(
    raw_results: list[dict[str, Any]],
    source_dir: Path,
    min_confidence: float = 0.5,
    model: str = "Eula thinking MediaPipe reference",
) -> dict[str, Any]:
    frames: dict[str, Any] = {}
    for raw in raw_results:
        frames[str(raw["frame_key"])] = convert_raw_result(raw, source_dir=source_dir, min_confidence=min_confidence)

    first = raw_results[0] if raw_results else {}
    return {
        "model": model,
        "image_width": int(first.get("image_width", 0) or 0),
        "image_height": int(first.get("image_height", 0) or 0),
        "coordinate_system": "pixel_top_left",
        "source_dir": source_dir.as_posix(),
        "generator": "mediapipe_pose_landmarker",
        "note": "Generated from MediaPipe Pose Landmarker IMAGE mode. Low-confidence points should be manually reviewed before fitting.",
        "frames": frames,
        "model_landmark_map": MODEL_LANDMARK_MAP,
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _mediapipe_landmark_to_dict(index: int, landmark: Any) -> dict[str, Any]:
    return {
        "index": index,
        "x": _landmark_value(landmark, "x"),
        "y": _landmark_value(landmark, "y"),
        "z": _landmark_value(landmark, "z", 0.0),
        "visibility": _landmark_value(landmark, "visibility", 1.0),
        "presence": _landmark_value(landmark, "presence", _landmark_value(landmark, "visibility", 1.0)),
    }


def _load_mediapipe_landmarker(model_asset: Path) -> Any:
    if not model_asset.exists():
        raise FileNotFoundError(
            f"MediaPipe pose model asset is missing: {model_asset}. "
            "Download a Pose Landmarker .task model and pass --model-asset."
        )
    try:
        import mediapipe as mp  # type: ignore
    except ImportError as exc:
        raise RuntimeError("mediapipe is not installed. Install it before running live extraction.") from exc

    base_options = mp.tasks.BaseOptions(model_asset_path=str(model_asset))
    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_poses=1,
    )
    return mp, mp.tasks.vision.PoseLandmarker.create_from_options(options)


def detect_images(input_dir: Path, model_asset: Path) -> list[dict[str, Any]]:
    images = discover_reference_images(input_dir)
    mp, landmarker = _load_mediapipe_landmarker(model_asset)
    raw_results: list[dict[str, Any]] = []
    try:
        for image in images:
            mp_image = mp.Image.create_from_file(str(image["path"]))
            result = landmarker.detect(mp_image)
            pose_landmarks = result.pose_landmarks[0] if getattr(result, "pose_landmarks", None) else []
            raw_results.append(
                {
                    "image": image["name"],
                    "frame_key": image["frame_key"],
                    "frame": image["frame"],
                    "view": image["view"],
                    "image_width": image["width"],
                    "image_height": image["height"],
                    "pose_landmarks": [_mediapipe_landmark_to_dict(index, landmark) for index, landmark in enumerate(pose_landmarks)],
                }
            )
    finally:
        landmarker.close()
    return raw_results


def read_raw_results(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    return list(payload.get("images", []))


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract MediaPipe pose landmarks from imgToAction reference images.")
    parser.add_argument("--input", default="output/imagegen/eula-thinking-gesture")
    parser.add_argument("--out", default="imgToAction/config/reference_landmarks.eula_thinking.json")
    parser.add_argument("--raw-out", default="imgToAction/outputs/mediapipe/eula-thinking-gesture/raw_mediapipe_landmarks.json")
    parser.add_argument("--model-asset", default="")
    parser.add_argument("--from-raw", default="")
    parser.add_argument("--min-confidence", type=float, default=0.5)
    args = parser.parse_args()

    source_dir = Path(args.input)
    if args.from_raw:
        raw_results = read_raw_results(Path(args.from_raw))
    else:
        if not args.model_asset:
            raise SystemExit("Live MediaPipe extraction requires --model-asset pointing to a Pose Landmarker .task file.")
        raw_results = detect_images(source_dir, Path(args.model_asset))
        write_json(Path(args.raw_out), {"images": raw_results})

    config = build_reference_config(raw_results, source_dir=source_dir, min_confidence=args.min_confidence)
    write_json(Path(args.out), config)
    print(f"Wrote {len(config['frames'])} MediaPipe reference frames to {args.out}")
    if not args.from_raw:
        print(f"Wrote raw MediaPipe landmarks to {args.raw_out}")


if __name__ == "__main__":
    main()
