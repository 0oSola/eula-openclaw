from __future__ import annotations

import math
from pathlib import Path
import sys
from typing import Iterable


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from vmd_io import BoneFrame  # noqa: E402


def _quat_multiply(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    ax, ay, az, aw = left
    bx, by, bz, bw = right
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def _axis_angle(axis_index: int, degrees: float) -> tuple[float, float, float, float]:
    half = math.radians(float(degrees)) * 0.5
    value = math.sin(half)
    if axis_index == 0:
        return (value, 0.0, 0.0, math.cos(half))
    if axis_index == 1:
        return (0.0, value, 0.0, math.cos(half))
    return (0.0, 0.0, value, math.cos(half))


def _normalize_quaternion(value: Iterable[float]) -> tuple[float, float, float, float]:
    quat = tuple(float(component) for component in value)
    length = math.sqrt(sum(component * component for component in quat))
    if length <= 1e-8:
        return (0.0, 0.0, 0.0, 1.0)
    return tuple(component / length for component in quat)  # type: ignore[return-value]


def degrees_xyz_to_quaternion(degrees_xyz: Iterable[float]) -> tuple[float, float, float, float]:
    quat = (0.0, 0.0, 0.0, 1.0)
    for axis_index, degrees in enumerate(degrees_xyz):
        if abs(float(degrees)) <= 1e-8:
            continue
        quat = _quat_multiply(quat, _axis_angle(axis_index, float(degrees)))
    return _normalize_quaternion(quat)


def apply_hand_presets(
    frames: list[BoneFrame],
    action_recipe: dict,
    preset_config: dict,
    frame_numbers: list[int],
) -> list[BoneFrame]:
    next_frames = list(frames)
    for side, preset_name in action_recipe.get("hand_presets", {}).items():
        if preset_name not in preset_config:
            raise KeyError(f"Unknown hand preset: {preset_name}")
        side_bones = preset_config[preset_name].get(side)
        if not side_bones:
            continue
        for frame_no in frame_numbers:
            for bone_name, degrees_xyz in side_bones.items():
                next_frames.append(
                    BoneFrame(
                        str(bone_name),
                        int(frame_no),
                        (0.0, 0.0, 0.0),
                        degrees_xyz_to_quaternion(degrees_xyz),
                    )
                )
    return next_frames
