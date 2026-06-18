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

from skeleton_motion import normalize, read_skeleton, sub, validate_skeleton  # noqa: E402
from vmd_io import BoneFrame, write_vmd  # noqa: E402
from action_constraints import apply_right_wrist_to_chin_edge  # noqa: E402
from hand_presets import apply_hand_presets  # noqa: E402


IDENTITY_QUATERNION = (0.0, 0.0, 0.0, 1.0)
VMD_FPS = 30


BONE_TARGETS = (
    {"bone": "下半身", "parent": "pelvis", "child": "neck", "rest_axis": (0.0, 1.0, 0.0), "weight": 0.35},
    {"bone": "上半身", "parent": "pelvis", "child": "neck", "rest_axis": (0.0, 1.0, 0.0), "weight": 0.55},
    {"bone": "上半身2", "parent": "pelvis", "child": "neck", "rest_axis": (0.0, 1.0, 0.0), "weight": 0.35},
    {"bone": "首", "parent": "neck", "child": "head", "rest_axis": (0.0, 1.0, 0.0), "weight": 0.45},
    {"bone": "頭", "parent": "neck", "child": "head", "rest_axis": (0.0, 1.0, 0.0), "weight": 0.75},
    {"bone": "右肩", "parent": "neck", "child": "right_shoulder", "rest_axis": (1.0, 0.0, 0.0), "weight": 0.35},
    {"bone": "右腕", "parent": "right_shoulder", "child": "right_elbow", "rest_axis": (-1.0, 0.0, 0.0), "weight": 1.0},
    {"bone": "右ひじ", "parent": "right_elbow", "child": "right_wrist", "rest_axis": (-1.0, 0.0, 0.0), "weight": 1.0},
    {"bone": "右手首", "parent": "right_elbow", "child": "right_wrist", "rest_axis": (-1.0, 0.0, 0.0), "weight": 0.45},
    {"bone": "左肩", "parent": "neck", "child": "left_shoulder", "rest_axis": (-1.0, 0.0, 0.0), "weight": 0.35},
    {"bone": "左腕", "parent": "left_shoulder", "child": "left_elbow", "rest_axis": (1.0, 0.0, 0.0), "weight": 1.0},
    {"bone": "左ひじ", "parent": "left_elbow", "child": "left_wrist", "rest_axis": (1.0, 0.0, 0.0), "weight": 1.0},
    {"bone": "左手首", "parent": "left_elbow", "child": "left_wrist", "rest_axis": (1.0, 0.0, 0.0), "weight": 0.45},
    {"bone": "右足", "parent": "right_hip", "child": "right_knee", "rest_axis": (0.0, -1.0, 0.0), "weight": 0.25},
    {"bone": "右ひざ", "parent": "right_knee", "child": "right_ankle", "rest_axis": (0.0, -1.0, 0.0), "weight": 0.25},
    {"bone": "右足首", "parent": "right_knee", "child": "right_ankle", "rest_axis": (0.0, -1.0, 0.0), "weight": 0.15},
    {"bone": "左足", "parent": "left_hip", "child": "left_knee", "rest_axis": (0.0, -1.0, 0.0), "weight": 0.25},
    {"bone": "左ひざ", "parent": "left_knee", "child": "left_ankle", "rest_axis": (0.0, -1.0, 0.0), "weight": 0.25},
    {"bone": "左足首", "parent": "left_knee", "child": "left_ankle", "rest_axis": (0.0, -1.0, 0.0), "weight": 0.15},
)


def _cross(left: Iterable[float], right: Iterable[float]) -> tuple[float, float, float]:
    ax, ay, az = [float(value) for value in left]
    bx, by, bz = [float(value) for value in right]
    return (ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)


def _dot(left: Iterable[float], right: Iterable[float]) -> float:
    return sum(float(a) * float(b) for a, b in zip(left, right, strict=True))


def _quat_normalize(quaternion: Iterable[float]) -> tuple[float, float, float, float]:
    values = tuple(float(value) for value in quaternion)
    length = math.sqrt(sum(value * value for value in values))
    if length <= 1e-8:
        return IDENTITY_QUATERNION
    return tuple(value / length for value in values)  # type: ignore[return-value]


def _axis_angle(axis: Iterable[float], radians: float) -> tuple[float, float, float, float]:
    axis_x, axis_y, axis_z = normalize(axis)
    half = radians * 0.5
    scale = math.sin(half)
    return _quat_normalize((axis_x * scale, axis_y * scale, axis_z * scale, math.cos(half)))


def _quat_slerp_identity(quaternion: tuple[float, float, float, float], weight: float) -> tuple[float, float, float, float]:
    clamped = max(0.0, min(1.0, float(weight)))
    x, y, z, w = _quat_normalize(quaternion)
    angle = 2.0 * math.acos(max(-1.0, min(1.0, w)))
    if angle <= 1e-8:
        return IDENTITY_QUATERNION
    axis_scale = math.sin(angle * 0.5)
    if abs(axis_scale) <= 1e-8:
        return IDENTITY_QUATERNION
    axis = (x / axis_scale, y / axis_scale, z / axis_scale)
    return _axis_angle(axis, angle * clamped)


def quat_between(source_direction: Iterable[float], target_direction: Iterable[float]) -> tuple[float, float, float, float]:
    source = normalize(source_direction)
    target = normalize(target_direction)
    if source == [0.0, 0.0, 0.0] or target == [0.0, 0.0, 0.0]:
        return IDENTITY_QUATERNION

    dot_value = max(-1.0, min(1.0, _dot(source, target)))
    if dot_value > 1.0 - 1e-8:
        return IDENTITY_QUATERNION
    if dot_value < -1.0 + 1e-8:
        fallback_axis = _cross(source, (1.0, 0.0, 0.0))
        if math.sqrt(sum(value * value for value in fallback_axis)) <= 1e-8:
            fallback_axis = _cross(source, (0.0, 1.0, 0.0))
        return _axis_angle(fallback_axis, math.pi)

    axis = _cross(source, target)
    return _axis_angle(axis, math.acos(dot_value))


def rotation_for_bone(
    joints: dict[str, list[float]],
    parent_joint: str,
    child_joint: str,
    target_rest_axis: Iterable[float],
    weight: float = 1.0,
) -> tuple[float, float, float, float]:
    direction = sub(joints[child_joint], joints[parent_joint])
    return _quat_slerp_identity(quat_between(target_rest_axis, direction), weight)


def _vmd_frame_number(frame_index: int, source_fps: float) -> int:
    return int(round(int(frame_index) * VMD_FPS / float(source_fps)))


def retarget_skeleton_to_bone_frames(
    skeleton: dict[str, Any],
    model_profile: dict[str, Any] | None = None,
    action_recipe: dict[str, Any] | None = None,
) -> list[BoneFrame]:
    del model_profile, action_recipe
    validated = validate_skeleton(skeleton)
    fps = float(validated["fps"])
    frames: list[BoneFrame] = []

    for frame in validated["frames"]:
        frame_no = _vmd_frame_number(int(frame["index"]), fps)
        joints = frame["joints"]
        pelvis = joints["pelvis"]
        frames.append(BoneFrame("センター", frame_no, (float(pelvis[0]), float(pelvis[1]), float(pelvis[2])), IDENTITY_QUATERNION))
        for target in BONE_TARGETS:
            rotation = rotation_for_bone(
                joints,
                str(target["parent"]),
                str(target["child"]),
                target["rest_axis"],  # type: ignore[arg-type]
                weight=float(target.get("weight", 1.0)),
            )
            frames.append(BoneFrame(str(target["bone"]), frame_no, (0.0, 0.0, 0.0), rotation))
    return frames


def write_retargeted_vmd(
    skeleton: dict[str, Any],
    out: Path,
    model_profile: dict[str, Any] | None = None,
    action_recipe: dict[str, Any] | None = None,
    hand_preset_config: dict[str, Any] | None = None,
    model_name: str = "Eula",
    apply_constraints: bool = False,
) -> list[BoneFrame]:
    retarget_source = skeleton
    if apply_constraints:
        retarget_source, _report = apply_right_wrist_to_chin_edge(
            skeleton,
            model_profile or {"contacts": {}},
            action_recipe or {"contacts": ["right_wrist_to_chin_edge"]},
        )
    frames = retarget_skeleton_to_bone_frames(retarget_source, model_profile=model_profile, action_recipe=action_recipe)
    if action_recipe and hand_preset_config:
        frame_numbers = sorted({frame.frame for frame in frames})
        frames = apply_hand_presets(frames, action_recipe, hand_preset_config, frame_numbers)
    write_vmd(out, frames, model_name=model_name)
    return frames


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Retarget imgToAction skeleton.json to a draft VMD.")
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--model-profile", default="")
    parser.add_argument("--action", default="")
    parser.add_argument("--hand-presets", default="")
    parser.add_argument("--out", required=True)
    parser.add_argument("--model-name", default="Eula")
    parser.add_argument("--apply-constraints", action="store_true")
    args = parser.parse_args()

    skeleton = read_skeleton(Path(args.skeleton))
    model_profile = _read_json(Path(args.model_profile)) if args.model_profile else None
    action_recipe = _read_json(Path(args.action)) if args.action else None
    hand_preset_config = _read_json(Path(args.hand_presets)) if args.hand_presets else None
    frames = write_retargeted_vmd(
        skeleton,
        Path(args.out),
        model_profile=model_profile,
        action_recipe=action_recipe,
        hand_preset_config=hand_preset_config,
        model_name=args.model_name,
        apply_constraints=args.apply_constraints,
    )
    print(f"Wrote {len(frames)} retargeted bone frames to {args.out}")


if __name__ == "__main__":
    main()
