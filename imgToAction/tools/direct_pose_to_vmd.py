#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
from typing import Any, Iterable


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from vmd_io import BoneFrame, write_vmd  # noqa: E402


IDENTITY_QUATERNION = (0.0, 0.0, 0.0, 1.0)


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_quaternion(quaternion: Iterable[float]) -> tuple[float, float, float, float]:
    values = tuple(float(value) for value in quaternion)
    if len(values) != 4:
        raise ValueError(f"Expected quaternion with 4 values, got {len(values)}")
    length = math.sqrt(sum(value * value for value in values))
    if length <= 1e-8:
        return IDENTITY_QUATERNION
    return tuple(value / length for value in values)  # type: ignore[return-value]


def _axis_angle(axis_index: int, radians: float) -> tuple[float, float, float, float]:
    half = radians * 0.5
    value = math.sin(half)
    if axis_index == 0:
        return (value, 0.0, 0.0, math.cos(half))
    if axis_index == 1:
        return (0.0, value, 0.0, math.cos(half))
    return (0.0, 0.0, value, math.cos(half))


def _quaternion_multiply(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    ax, ay, az, aw = left
    bx, by, bz, bw = right
    return _normalize_quaternion(
        (
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        )
    )


def _rotation_degrees_to_quaternion(rotation_degrees: Iterable[float]) -> tuple[float, float, float, float]:
    values = tuple(float(value) for value in rotation_degrees)
    if len(values) != 3:
        raise ValueError(f"Expected rotation_degrees with 3 values, got {len(values)}")
    quaternion = IDENTITY_QUATERNION
    for axis_index, degrees in enumerate(values):
        if abs(degrees) <= 1e-8:
            continue
        quaternion = _quaternion_multiply(quaternion, _axis_angle(axis_index, math.radians(degrees)))
    return quaternion


def _bone_rotation(spec: dict[str, Any]) -> tuple[float, float, float, float]:
    if "quaternion" in spec:
        return _normalize_quaternion(spec["quaternion"])
    if "rotation_degrees" in spec:
        return _rotation_degrees_to_quaternion(spec["rotation_degrees"])
    return IDENTITY_QUATERNION


def _bone_position(spec: dict[str, Any]) -> tuple[float, float, float]:
    position = spec.get("position", (0.0, 0.0, 0.0))
    values = tuple(float(value) for value in position)
    if len(values) != 3:
        raise ValueError(f"Expected position with 3 values, got {len(values)}")
    return values  # type: ignore[return-value]


def resolve_direct_pose_to_bone_frames(pose: dict[str, Any]) -> list[BoneFrame]:
    frames: list[BoneFrame] = []
    for keyframe in sorted(pose.get("keyframes", []), key=lambda item: int(item.get("frame", 0))):
        frame_no = int(keyframe.get("frame", 0))
        bones = keyframe.get("bones", {})
        if not isinstance(bones, dict):
            raise TypeError(f"Keyframe {frame_no} bones must be an object")
        for bone_name, spec in bones.items():
            if not isinstance(spec, dict):
                raise TypeError(f"Bone spec must be an object: {bone_name}")
            frames.append(
                BoneFrame(
                    str(bone_name),
                    frame_no,
                    _bone_position(spec),
                    _bone_rotation(spec),
                )
            )
    return frames


def write_direct_pose_vmd(pose: dict[str, Any], out: Path, model_name: str = "Eula") -> list[BoneFrame]:
    frames = resolve_direct_pose_to_bone_frames(pose)
    write_vmd(out, frames, model_name=model_name)
    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description="Write a direct local-bone quaternion pose JSON as VMD.")
    parser.add_argument("--pose", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model-name", default="Eula")
    args = parser.parse_args()

    pose = _read_json(Path(args.pose))
    frames = write_direct_pose_vmd(pose, Path(args.out), model_name=args.model_name)
    print(f"Wrote {len(frames)} direct pose bone frames to {args.out}")


if __name__ == "__main__":
    main()
