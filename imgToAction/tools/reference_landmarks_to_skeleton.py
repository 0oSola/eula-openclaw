#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from skeleton_motion import normalize_frame, validate_skeleton, write_skeleton  # noqa: E402


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
    "left_hip",
    "right_knee",
    "left_knee",
    "right_ankle",
    "left_ankle",
)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _point(frame: dict[str, Any], name: str) -> dict[str, Any]:
    point = frame.get("landmarks", {}).get(name)
    if not point:
        raise KeyError(f"Missing reference landmark: {name}")
    return point


def _scale_pixels_per_unit(frame: dict[str, Any], neck_height_units: float = 1.0) -> float:
    pelvis = _point(frame, "pelvis")
    neck = _point(frame, "neck")
    pixel_distance = abs(float(pelvis["y"]) - float(neck["y"]))
    if pixel_distance <= 1e-8:
        raise ValueError("Degenerate reference frame: pelvis and neck have the same y coordinate")
    return pixel_distance / float(neck_height_units)


def frame_to_skeleton_joints(frame: dict[str, Any], *, z_scale: float = 0.0) -> dict[str, list[float]]:
    pelvis = _point(frame, "pelvis")
    origin_x = float(pelvis["x"])
    origin_y = float(pelvis["y"])
    scale = _scale_pixels_per_unit(frame)
    joints: dict[str, list[float]] = {}

    for name in REQUIRED_JOINTS:
        point = _point(frame, name)
        x = (float(point["x"]) - origin_x) / scale
        y = (origin_y - float(point["y"])) / scale
        z = float(point.get("z", 0.0)) * float(z_scale)
        joints[name] = [round(x, 6), round(y, 6), round(z, 6)]

    joints["pelvis"] = [0.0, 0.0, 0.0]
    return joints


def reference_to_skeleton(reference: dict[str, Any], frame_keys: list[str], fps: int = 30, z_scale: float = 0.0) -> dict[str, Any]:
    frames = []
    for frame_key in frame_keys:
        frame = reference.get("frames", {}).get(frame_key)
        if not frame:
            raise KeyError(f"Reference frame not found: {frame_key}")
        frame_index = int(frame.get("frame", 0))
        joints = frame_to_skeleton_joints(frame, z_scale=z_scale)
        frames.append(normalize_frame(joints, index=frame_index))

    return validate_skeleton(
        {
            "fps": int(fps),
            "source": {
                "type": "reference_landmarks",
                "frame_keys": list(frame_keys),
                "coordinate_mapping": "front_view_pelvis_relative_xy",
                "z_scale": float(z_scale),
            },
            "frames": frames,
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert front-view reference landmarks into an imgToAction skeleton.")
    parser.add_argument("--reference", default="imgToAction/config/reference_landmarks.eula_thinking.json")
    parser.add_argument("--frames", default="frame_00_front,frame_30_front,frame_60_front")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--z-scale", type=float, default=0.0)
    parser.add_argument("--out", default="imgToAction/outputs/actions/thinking_chin_edge/reference_skeleton/front_reference_skeleton.json")
    args = parser.parse_args()

    reference = read_json(Path(args.reference))
    frame_keys = [item.strip() for item in args.frames.split(",") if item.strip()]
    skeleton = reference_to_skeleton(reference, frame_keys, fps=args.fps, z_scale=args.z_scale)
    write_skeleton(Path(args.out), skeleton)
    print(f"Wrote {len(skeleton['frames'])} reference skeleton frames to {args.out}")


if __name__ == "__main__":
    main()
