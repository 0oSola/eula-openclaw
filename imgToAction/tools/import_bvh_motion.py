#!/usr/bin/env python
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import math
from pathlib import Path
import sys
from typing import Any, Iterable


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from skeleton_motion import normalize_frame, validate_skeleton, write_skeleton  # noqa: E402


Vector = tuple[float, float, float]
Matrix3 = tuple[Vector, Vector, Vector]


DEFAULT_JOINT_MAP = {
    "pelvis": "Hips",
    "neck": "Neck",
    "head": "Head",
    "right_shoulder": "RightArm",
    "right_elbow": "RightForeArm",
    "right_wrist": "RightHand",
    "left_shoulder": "LeftArm",
    "left_elbow": "LeftForeArm",
    "left_wrist": "LeftHand",
    "right_hip": "RightUpLeg",
    "right_knee": "RightLeg",
    "right_ankle": "RightFoot",
    "left_hip": "LeftUpLeg",
    "left_knee": "LeftLeg",
    "left_ankle": "LeftFoot",
}


@dataclass
class BvhJoint:
    name: str
    offset: Vector = (0.0, 0.0, 0.0)
    channels: list[str] = field(default_factory=list)
    children: list["BvhJoint"] = field(default_factory=list)


def _identity_matrix() -> Matrix3:
    return (
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0),
    )


def _mat_mul(left: Matrix3, right: Matrix3) -> Matrix3:
    rows = []
    for row in range(3):
        rows.append(
            tuple(
                sum(left[row][inner] * right[inner][col] for inner in range(3))
                for col in range(3)
            )
        )
    return tuple(rows)  # type: ignore[return-value]


def _mat_vec(matrix: Matrix3, vector: Iterable[float]) -> Vector:
    values = tuple(float(value) for value in vector)
    return tuple(sum(matrix[row][col] * values[col] for col in range(3)) for row in range(3))  # type: ignore[return-value]


def _vec_add(left: Iterable[float], right: Iterable[float]) -> Vector:
    return tuple(float(a) + float(b) for a, b in zip(left, right, strict=True))  # type: ignore[return-value]


def _rotation_matrix(axis: str, degrees: float) -> Matrix3:
    radians = math.radians(float(degrees))
    cosine = math.cos(radians)
    sine = math.sin(radians)
    if axis == "X":
        return (
            (1.0, 0.0, 0.0),
            (0.0, cosine, -sine),
            (0.0, sine, cosine),
        )
    if axis == "Y":
        return (
            (cosine, 0.0, sine),
            (0.0, 1.0, 0.0),
            (-sine, 0.0, cosine),
        )
    if axis == "Z":
        return (
            (cosine, -sine, 0.0),
            (sine, cosine, 0.0),
            (0.0, 0.0, 1.0),
        )
    raise ValueError(f"Unsupported BVH rotation axis: {axis}")


def _parse_vector(tokens: list[str]) -> Vector:
    if len(tokens) != 4:
        raise ValueError(f"Expected OFFSET with 3 values, got: {' '.join(tokens)}")
    return (float(tokens[1]), float(tokens[2]), float(tokens[3]))


def _skip_end_site(lines: list[str], index: int) -> int:
    if index >= len(lines) or lines[index] != "{":
        raise ValueError("BVH End Site must be followed by '{'")
    depth = 0
    while index < len(lines):
        line = lines[index]
        if line == "{":
            depth += 1
        elif line == "}":
            depth -= 1
            if depth == 0:
                return index + 1
        index += 1
    raise ValueError("Unclosed BVH End Site block")


def _parse_joint(lines: list[str], index: int, joints: dict[str, BvhJoint]) -> tuple[BvhJoint, int]:
    tokens = lines[index].split()
    if len(tokens) != 2 or tokens[0] not in {"ROOT", "JOINT"}:
        raise ValueError(f"Expected ROOT or JOINT at line {index + 1}, got: {lines[index]}")
    joint = BvhJoint(tokens[1])
    if joint.name in joints:
        raise ValueError(f"Duplicate BVH joint name: {joint.name}")
    joints[joint.name] = joint
    index += 1
    if index >= len(lines) or lines[index] != "{":
        raise ValueError(f"BVH joint {joint.name} must be followed by '{{'")
    index += 1

    while index < len(lines):
        line = lines[index]
        if line == "}":
            return joint, index + 1
        if line.startswith("OFFSET "):
            joint.offset = _parse_vector(line.split())
            index += 1
            continue
        if line.startswith("CHANNELS "):
            channel_tokens = line.split()
            channel_count = int(channel_tokens[1])
            channels = channel_tokens[2:]
            if len(channels) != channel_count:
                raise ValueError(f"BVH joint {joint.name} declares {channel_count} channels but lists {len(channels)}")
            joint.channels = channels
            index += 1
            continue
        if line.startswith("JOINT "):
            child, index = _parse_joint(lines, index, joints)
            joint.children.append(child)
            continue
        if line == "End Site":
            index = _skip_end_site(lines, index + 1)
            continue
        raise ValueError(f"Unsupported BVH hierarchy line {index + 1}: {line}")
    raise ValueError(f"Unclosed BVH joint block: {joint.name}")


def _total_channel_count(joint: BvhJoint) -> int:
    return len(joint.channels) + sum(_total_channel_count(child) for child in joint.children)


def load_bvh(path: Path) -> dict[str, Any]:
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines or lines[0] != "HIERARCHY":
        raise ValueError(f"BVH file must start with HIERARCHY: {path}")
    joints: dict[str, BvhJoint] = {}
    root, index = _parse_joint(lines, 1, joints)
    if index >= len(lines) or lines[index] != "MOTION":
        raise ValueError("BVH hierarchy must be followed by MOTION")
    index += 1
    if index >= len(lines) or not lines[index].startswith("Frames:"):
        raise ValueError("BVH MOTION section must declare Frames")
    frame_count = int(lines[index].split(":", 1)[1].strip())
    index += 1
    if index >= len(lines) or not lines[index].startswith("Frame Time:"):
        raise ValueError("BVH MOTION section must declare Frame Time")
    frame_time = float(lines[index].split(":", 1)[1].strip())
    index += 1

    channel_count = _total_channel_count(root)
    motion: list[list[float]] = []
    for frame_index in range(frame_count):
        if index + frame_index >= len(lines):
            raise ValueError(f"BVH MOTION expected {frame_count} frames, got {frame_index}")
        values = [float(value) for value in lines[index + frame_index].split()]
        if len(values) != channel_count:
            raise ValueError(
                f"BVH frame {frame_index} has {len(values)} values, expected {channel_count}"
            )
        if any(not math.isfinite(value) for value in values):
            raise ValueError(f"BVH frame {frame_index} contains non-finite values")
        motion.append(values)

    return {
        "path": str(path),
        "root": root,
        "joints": joints,
        "frame_count": frame_count,
        "frame_time": frame_time,
        "channel_count": channel_count,
        "motion": motion,
    }


def _fk_joint(
    joint: BvhJoint,
    values: list[float],
    cursor: int,
    parent_position: Vector,
    parent_rotation: Matrix3,
    positions: dict[str, list[float]],
) -> int:
    channel_position = [0.0, 0.0, 0.0]
    local_rotation = _identity_matrix()
    for channel in joint.channels:
        value = values[cursor]
        cursor += 1
        if channel.endswith("position"):
            axis_index = {"X": 0, "Y": 1, "Z": 2}[channel[0]]
            channel_position[axis_index] = value
        elif channel.endswith("rotation"):
            local_rotation = _mat_mul(local_rotation, _rotation_matrix(channel[0], value))
        else:
            raise ValueError(f"Unsupported BVH channel: {channel}")

    local_position = _vec_add(joint.offset, channel_position)
    world_position = _vec_add(parent_position, _mat_vec(parent_rotation, local_position))
    world_rotation = _mat_mul(parent_rotation, local_rotation)
    positions[joint.name] = [float(value) for value in world_position]
    for child in joint.children:
        cursor = _fk_joint(child, values, cursor, world_position, world_rotation, positions)
    return cursor


def forward_kinematics(parsed: dict[str, Any], frame_values: list[float]) -> dict[str, list[float]]:
    positions: dict[str, list[float]] = {}
    cursor = _fk_joint(
        parsed["root"],
        frame_values,
        0,
        (0.0, 0.0, 0.0),
        _identity_matrix(),
        positions,
    )
    if cursor != parsed["channel_count"]:
        raise ValueError(f"BVH FK consumed {cursor} channels, expected {parsed['channel_count']}")
    return positions


def _vector_payload(vector: Iterable[float]) -> list[float]:
    return [float(value) for value in vector]


def _matrix_payload(matrix: Matrix3) -> list[list[float]]:
    return [[float(value) for value in row] for row in matrix]


def _joint_hierarchy_payload(joint: BvhJoint) -> dict[str, Any]:
    return {
        "name": joint.name,
        "offset": _vector_payload(joint.offset),
        "channels": list(joint.channels),
        "children": [_joint_hierarchy_payload(child) for child in joint.children],
    }


def _fk_joint_with_transforms(
    joint: BvhJoint,
    values: list[float],
    cursor: int,
    parent_position: Vector,
    parent_rotation: Matrix3,
    local_payload: dict[str, Any],
    world_payload: dict[str, Any],
) -> int:
    channel_position = [0.0, 0.0, 0.0]
    local_rotation = _identity_matrix()
    channel_values: dict[str, float] = {}
    rotation_degrees: dict[str, float] = {}
    rotation_order: list[str] = []
    for channel in joint.channels:
        value = float(values[cursor])
        cursor += 1
        channel_values[channel] = value
        if channel.endswith("position"):
            axis_index = {"X": 0, "Y": 1, "Z": 2}[channel[0]]
            channel_position[axis_index] = value
        elif channel.endswith("rotation"):
            rotation_degrees[channel] = value
            rotation_order.append(channel)
            local_rotation = _mat_mul(local_rotation, _rotation_matrix(channel[0], value))
        else:
            raise ValueError(f"Unsupported BVH channel: {channel}")

    local_position = _vec_add(joint.offset, channel_position)
    world_position = _vec_add(parent_position, _mat_vec(parent_rotation, local_position))
    world_rotation = _mat_mul(parent_rotation, local_rotation)
    local_payload[joint.name] = {
        "offset": _vector_payload(joint.offset),
        "channel_position": _vector_payload(channel_position),
        "position": _vector_payload(local_position),
        "channels": channel_values,
        "rotation_degrees": rotation_degrees,
        "rotation_order": rotation_order,
    }
    world_payload[joint.name] = {
        "position": _vector_payload(world_position),
        "rotation_matrix": _matrix_payload(world_rotation),
    }
    for child in joint.children:
        cursor = _fk_joint_with_transforms(
            child,
            values,
            cursor,
            world_position,
            world_rotation,
            local_payload,
            world_payload,
        )
    return cursor


def forward_kinematics_with_transforms(parsed: dict[str, Any], frame_values: list[float]) -> dict[str, Any]:
    local_payload: dict[str, Any] = {}
    world_payload: dict[str, Any] = {}
    cursor = _fk_joint_with_transforms(
        parsed["root"],
        frame_values,
        0,
        (0.0, 0.0, 0.0),
        _identity_matrix(),
        local_payload,
        world_payload,
    )
    if cursor != parsed["channel_count"]:
        raise ValueError(f"BVH FK consumed {cursor} channels, expected {parsed['channel_count']}")
    return {"local": local_payload, "world": world_payload}


def _fps_from_frame_time(frame_time: float) -> int | float:
    if frame_time <= 0 or not math.isfinite(frame_time):
        raise ValueError("BVH frame time must be positive and finite")
    fps = 1.0 / frame_time
    rounded = round(fps)
    if abs(fps - rounded) < 1e-6:
        return int(rounded)
    return fps


def bvh_to_skeleton(parsed: dict[str, Any], joint_map: dict[str, str] | None = None) -> dict[str, Any]:
    effective_map = dict(DEFAULT_JOINT_MAP)
    if joint_map:
        effective_map.update(joint_map)

    missing = sorted({bvh_name for bvh_name in effective_map.values() if bvh_name not in parsed["joints"]})
    if missing:
        raise ValueError(f"Missing BVH joint(s) required by map: {', '.join(missing)}")

    frames = []
    for frame_index, frame_values in enumerate(parsed["motion"]):
        bvh_positions = forward_kinematics(parsed, frame_values)
        joints = {
            internal_name: bvh_positions[bvh_name]
            for internal_name, bvh_name in effective_map.items()
        }
        frames.append(normalize_frame(joints, frame_index))

    return validate_skeleton(
        {
            "fps": _fps_from_frame_time(float(parsed["frame_time"])),
            "source": {
                "type": "bvh",
                "path": parsed.get("path", ""),
                "frame_time": parsed["frame_time"],
                "joint_map": effective_map,
            },
            "frames": frames,
        }
    )


def bvh_to_motion_payload(parsed: dict[str, Any], joint_map: dict[str, str] | None = None) -> dict[str, Any]:
    effective_map = dict(DEFAULT_JOINT_MAP)
    if joint_map:
        effective_map.update(joint_map)

    missing = sorted({bvh_name for bvh_name in effective_map.values() if bvh_name not in parsed["joints"]})
    if missing:
        raise ValueError(f"Missing BVH joint(s) required by map: {', '.join(missing)}")

    frames = []
    for frame_index, frame_values in enumerate(parsed["motion"]):
        transforms = forward_kinematics_with_transforms(parsed, frame_values)
        frames.append(
            {
                "index": int(frame_index),
                "local": transforms["local"],
                "world": transforms["world"],
            }
        )

    return {
        "source": {
            "type": "bvh_motion",
            "path": parsed.get("path", ""),
            "frame_count": int(parsed["frame_count"]),
            "frame_time": float(parsed["frame_time"]),
            "fps": _fps_from_frame_time(float(parsed["frame_time"])),
            "channel_count": int(parsed["channel_count"]),
        },
        "joint_map": effective_map,
        "hierarchy": _joint_hierarchy_payload(parsed["root"]),
        "frames": frames,
    }


def load_bvh_skeleton(path: Path) -> dict[str, Any]:
    return bvh_to_skeleton(load_bvh(path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert a BVH motion file into imgToAction skeleton.json.")
    parser.add_argument("--input", required=True, help="Path to BVH file.")
    parser.add_argument("--out", required=True, help="Path to write skeleton.json.")
    args = parser.parse_args()

    skeleton = load_bvh_skeleton(Path(args.input))
    write_skeleton(Path(args.out), skeleton)
    print(f"Wrote {len(skeleton['frames'])} BVH skeleton frames to {args.out}")


if __name__ == "__main__":
    main()
