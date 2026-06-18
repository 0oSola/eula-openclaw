#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
from typing import Any


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from vmd_io import BoneFrame, write_vmd  # noqa: E402


AXIS_INDEX = {
    "local_x": 0,
    "local_y": 1,
    "local_z": 2,
}

RIGHT_ARM_UPPER_WEIGHT = 0.18
RIGHT_ARM_SHOULDER_WEIGHT = 0.04
LEFT_ARM_UPPER_WEIGHT = 0.08
LEFT_ARM_SHOULDER_WEIGHT = 0.02
ARM_FORWARD_WEIGHT = 0.55
SHOULDER_FORWARD_WEIGHT = 0.12
ELBOW_BEND_WEIGHT = 3.0

ROTATION_BONE_ORDER = [
    "下半身",
    "上半身",
    "上半身2",
    "頭",
    "右肩",
    "右腕",
    "右ひじ",
    "右手首",
    "左肩",
    "左腕",
    "左ひじ",
    "左手首",
    "右足",
    "右ひざ",
    "右足首",
    "左足",
    "左ひざ",
    "左足首",
]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _axis_mapping(axis_map: dict[str, Any], bone: str, semantic: str) -> dict[str, Any] | None:
    return axis_map.get("semantic_to_pmx_axis", {}).get(bone, {}).get(semantic)


def _add_semantic_rotation(
    target: dict[str, list[float]],
    axis_map: dict[str, Any],
    bone: str,
    semantic: str,
    degrees: float,
    weight: float = 1.0,
) -> None:
    mapping = _axis_mapping(axis_map, bone, semantic)
    if not mapping:
        return
    axis_index = AXIS_INDEX.get(mapping.get("axis"))
    if axis_index is None:
        return
    target.setdefault(bone, [0.0, 0.0, 0.0])[axis_index] += float(degrees) * float(mapping.get("sign", 1)) * weight


def _quaternion_multiply(
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


def _axis_angle(axis_index: int, radians: float) -> tuple[float, float, float, float]:
    half = radians * 0.5
    value = math.sin(half)
    if axis_index == 0:
        return (value, 0.0, 0.0, math.cos(half))
    if axis_index == 1:
        return (0.0, value, 0.0, math.cos(half))
    return (0.0, 0.0, value, math.cos(half))


def _rotation_to_quaternion(degrees_xyz: list[float]) -> tuple[float, float, float, float]:
    quat = (0.0, 0.0, 0.0, 1.0)
    for axis_index, degrees in enumerate(degrees_xyz):
        if abs(degrees) < 1e-8:
            continue
        quat = _quaternion_multiply(quat, _axis_angle(axis_index, math.radians(degrees)))
    length = math.sqrt(sum(component * component for component in quat))
    if length <= 0:
        return (0.0, 0.0, 0.0, 1.0)
    return tuple(component / length for component in quat)


def _merge_pose(previous: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = json.loads(json.dumps(previous))
    for section in ("body", "arms", "legs"):
        if section not in patch:
            continue
        merged.setdefault(section, {})
        for key, value in patch[section].items():
            if isinstance(value, dict):
                merged[section].setdefault(key, {})
                merged[section][key].update(value)
            else:
                merged[section][key] = value
    return merged


def _apply_body(rotations: dict[str, list[float]], positions: dict[str, list[float]], axis_map: dict[str, Any], body: dict[str, Any]) -> None:
    center = body.get("center", {})
    if center:
        position = positions.setdefault("センター", [0.0, 0.0, 0.0])
        for semantic, value in (("shift_x", center.get("shift_x", 0.0)), ("shift_y", center.get("shift_y", 0.0)), ("shift_z", center.get("shift_z", 0.0))):
            mapping = _axis_mapping(axis_map, "センター", semantic)
            axis_index = AXIS_INDEX.get(mapping.get("axis")) if mapping else None
            if axis_index is not None:
                position[axis_index] += float(value) * float(mapping.get("sign", 1))

    pelvis = body.get("pelvis", {})
    for semantic in ("turn_y", "tilt_z", "lean_x"):
        _add_semantic_rotation(rotations, axis_map, "下半身", semantic, pelvis.get(semantic, 0.0))

    chest = body.get("chest", {})
    for semantic in ("turn_y", "tilt_z", "lean_x"):
        value = chest.get(semantic, 0.0)
        _add_semantic_rotation(rotations, axis_map, "上半身", semantic, value, weight=0.62)
        _add_semantic_rotation(rotations, axis_map, "上半身2", semantic, value, weight=0.38)

    head = body.get("head", {})
    _add_semantic_rotation(rotations, axis_map, "頭", "turn_y", head.get("turn_y", 0.0))
    _add_semantic_rotation(rotations, axis_map, "頭", "chin_up", head.get("chin_up", 0.0))


def _apply_arm(rotations: dict[str, list[float]], axis_map: dict[str, Any], arm: dict[str, Any], side: str) -> None:
    if side == "right":
        upper_bone, shoulder_bone, elbow_bone, wrist_bone = "右腕", "右肩", "右ひじ", "右手首"
        travel_semantic = "forward"
        travel_value = arm.get("forward", 0.0) - arm.get("backward", 0.0)
    else:
        upper_bone, shoulder_bone, elbow_bone, wrist_bone = "左腕", "左肩", "左ひじ", "左手首"
        travel_semantic = "forward" if arm.get("forward") is not None else "backward"
        travel_value = arm.get("forward", arm.get("backward", 0.0))

    upper_weight = RIGHT_ARM_UPPER_WEIGHT if side == "right" else LEFT_ARM_UPPER_WEIGHT
    shoulder_weight = RIGHT_ARM_SHOULDER_WEIGHT if side == "right" else LEFT_ARM_SHOULDER_WEIGHT

    for semantic in ("raise", "open_side"):
        value = arm.get(semantic, 0.0)
        _add_semantic_rotation(rotations, axis_map, upper_bone, semantic, value, weight=upper_weight)
        _add_semantic_rotation(rotations, axis_map, shoulder_bone, semantic, value, weight=shoulder_weight)

    _add_semantic_rotation(rotations, axis_map, upper_bone, travel_semantic, travel_value, weight=ARM_FORWARD_WEIGHT)
    _add_semantic_rotation(rotations, axis_map, shoulder_bone, travel_semantic, travel_value, weight=SHOULDER_FORWARD_WEIGHT)
    _add_semantic_rotation(rotations, axis_map, elbow_bone, "bend", arm.get("elbow_bend", 0.0), weight=ELBOW_BEND_WEIGHT)
    _add_semantic_rotation(rotations, axis_map, wrist_bone, "pitch", arm.get("wrist_pitch", 0.0))
    _add_semantic_rotation(rotations, axis_map, wrist_bone, "yaw", arm.get("wrist_yaw", 0.0))
    _add_semantic_rotation(rotations, axis_map, wrist_bone, "roll", arm.get("wrist_roll", 0.0))


def _apply_legs(rotations: dict[str, list[float]], axis_map: dict[str, Any], legs: dict[str, Any]) -> None:
    right = legs.get("right_leg", {})
    left = legs.get("left_leg", {})
    _add_semantic_rotation(rotations, axis_map, "右ひざ", "bend", right.get("knee_bend", 0.0))
    _add_semantic_rotation(rotations, axis_map, "左ひざ", "bend", left.get("knee_bend", 0.0))


def resolve_pose_to_bone_frames(pose: dict[str, Any], axis_map: dict[str, Any]) -> list[BoneFrame]:
    frames: list[BoneFrame] = []
    carried_pose: dict[str, Any] = {}

    for keyframe in sorted(pose.get("keyframes", []), key=lambda item: int(item.get("frame", 0))):
        carried_pose = _merge_pose(carried_pose, keyframe)
        frame_no = int(keyframe.get("frame", 0))
        rotations: dict[str, list[float]] = {}
        positions: dict[str, list[float]] = {}

        _apply_body(rotations, positions, axis_map, carried_pose.get("body", {}))
        arms = carried_pose.get("arms", {})
        _apply_arm(rotations, axis_map, arms.get("right_arm", {}), "right")
        _apply_arm(rotations, axis_map, arms.get("left_arm", {}), "left")
        _apply_legs(rotations, axis_map, carried_pose.get("legs", {}))

        if "センター" in positions:
            frames.append(BoneFrame("センター", frame_no, tuple(positions["センター"]), (0.0, 0.0, 0.0, 1.0)))

        for bone in ROTATION_BONE_ORDER:
            rotation = rotations.get(bone)
            if rotation is None:
                continue
            frames.append(BoneFrame(bone, frame_no, (0.0, 0.0, 0.0), _rotation_to_quaternion(rotation)))

    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert imgToAction pose node DSL to a minimal VMD motion.")
    parser.add_argument("--pose", default="imgToAction/schemas/example_pose_nodes_eula_signature.json")
    parser.add_argument("--axis-map", default="imgToAction/config/bone_axis_map.eula.json")
    parser.add_argument("--out", default="imgToAction/outputs/vmd/eula_signature_from_axis_map.vmd")
    parser.add_argument("--model-name", default="Eula")
    args = parser.parse_args()

    pose = _read_json(Path(args.pose))
    axis_map = _read_json(Path(args.axis_map))
    frames = resolve_pose_to_bone_frames(pose, axis_map)
    write_vmd(Path(args.out), frames, model_name=args.model_name)
    print(f"Wrote {len(frames)} bone frames to {args.out}")


if __name__ == "__main__":
    main()
