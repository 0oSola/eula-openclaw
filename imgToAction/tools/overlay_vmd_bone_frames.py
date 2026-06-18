#!/usr/bin/env python
from __future__ import annotations

import argparse
import math
from pathlib import Path
import sys
from typing import Iterable, Sequence


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from vmd_io import BoneFrame, read_vmd_bone_frames, read_vmd_summary, write_vmd  # noqa: E402


RIGHT_ARM_CHAIN = ["\u53f3\u80a9", "\u53f3\u8155", "\u53f3\u3072\u3058", "\u53f3\u624b\u9996"]


def _normalize_quaternion(quaternion: Iterable[float]) -> tuple[float, float, float, float]:
    values = tuple(float(value) for value in quaternion)
    length = math.sqrt(sum(value * value for value in values))
    if length <= 1e-8:
        return (0.0, 0.0, 0.0, 1.0)
    return tuple(value / length for value in values)  # type: ignore[return-value]


def _slerp(
    start: tuple[float, float, float, float],
    end: tuple[float, float, float, float],
    amount: float,
) -> tuple[float, float, float, float]:
    t = max(0.0, min(1.0, float(amount)))
    ax, ay, az, aw = _normalize_quaternion(start)
    bx, by, bz, bw = _normalize_quaternion(end)
    dot = ax * bx + ay * by + az * bz + aw * bw
    if dot < 0.0:
        bx, by, bz, bw = -bx, -by, -bz, -bw
        dot = -dot
    if dot > 0.9995:
        return _normalize_quaternion(
            (
                ax + t * (bx - ax),
                ay + t * (by - ay),
                az + t * (bz - az),
                aw + t * (bw - aw),
            )
        )
    theta_0 = math.acos(max(-1.0, min(1.0, dot)))
    sin_theta_0 = math.sin(theta_0)
    theta = theta_0 * t
    sin_theta = math.sin(theta)
    s0 = math.cos(theta) - dot * sin_theta / sin_theta_0
    s1 = sin_theta / sin_theta_0
    return _normalize_quaternion(
        (
            s0 * ax + s1 * bx,
            s0 * ay + s1 * by,
            s0 * az + s1 * bz,
            s0 * aw + s1 * bw,
        )
    )


def _lerp_position(
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    amount: float,
) -> tuple[float, float, float]:
    t = max(0.0, min(1.0, float(amount)))
    return (
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t,
    )


def _group_by_bone(frames: Sequence[BoneFrame]) -> dict[str, list[BoneFrame]]:
    grouped: dict[str, list[BoneFrame]] = {}
    for frame in frames:
        grouped.setdefault(frame.bone, []).append(frame)
    for bone_frames in grouped.values():
        bone_frames.sort(key=lambda item: item.frame)
    return grouped


def _sample_bone_frame(frames: Sequence[BoneFrame], frame_no: int, bone: str) -> BoneFrame:
    if not frames:
        return BoneFrame(bone, frame_no, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    if frame_no <= frames[0].frame:
        source = frames[0]
        return BoneFrame(bone, frame_no, source.position, source.rotation, source.interpolation)
    if frame_no >= frames[-1].frame:
        source = frames[-1]
        return BoneFrame(bone, frame_no, source.position, source.rotation, source.interpolation)
    for left, right in zip(frames, frames[1:]):
        if left.frame <= frame_no <= right.frame:
            if left.frame == right.frame:
                return BoneFrame(bone, frame_no, left.position, left.rotation, left.interpolation)
            amount = (frame_no - left.frame) / (right.frame - left.frame)
            return BoneFrame(
                bone,
                frame_no,
                _lerp_position(left.position, right.position, amount),
                _slerp(left.rotation, right.rotation, amount),
                left.interpolation,
            )
    source = frames[-1]
    return BoneFrame(bone, frame_no, source.position, source.rotation, source.interpolation)


def _map_frame(
    source_frame: int,
    *,
    source_start_frame: int,
    source_end_frame: int,
    target_start_frame: int,
    target_end_frame: int,
) -> int:
    if source_end_frame == source_start_frame:
        return int(target_start_frame)
    amount = (source_frame - source_start_frame) / (source_end_frame - source_start_frame)
    return int(round(target_start_frame + amount * (target_end_frame - target_start_frame)))


def compose_bone_overlay(
    base_frames: Sequence[BoneFrame],
    overlay_frames: Sequence[BoneFrame],
    *,
    target_bones: set[str],
    source_start_frame: int,
    source_end_frame: int,
    target_start_frame: int,
    target_end_frame: int,
    strength: float,
) -> list[BoneFrame]:
    if not target_bones:
        raise ValueError("At least one target bone is required")
    if source_end_frame < source_start_frame:
        raise ValueError("source_end_frame must be >= source_start_frame")
    if target_end_frame < target_start_frame:
        raise ValueError("target_end_frame must be >= target_start_frame")
    if strength < 0.0 or strength > 1.0:
        raise ValueError("strength must be in [0, 1]")

    base_by_bone = _group_by_bone(base_frames)
    output: dict[tuple[str, int], BoneFrame] = {}
    for frame in base_frames:
        in_target_window = target_start_frame <= frame.frame <= target_end_frame
        if frame.bone in target_bones and in_target_window:
            continue
        output[(frame.bone, frame.frame)] = frame

    for overlay in overlay_frames:
        if overlay.bone not in target_bones:
            continue
        if not (source_start_frame <= overlay.frame <= source_end_frame):
            continue
        target_frame = _map_frame(
            overlay.frame,
            source_start_frame=source_start_frame,
            source_end_frame=source_end_frame,
            target_start_frame=target_start_frame,
            target_end_frame=target_end_frame,
        )
        base = _sample_bone_frame(base_by_bone.get(overlay.bone, []), target_frame, overlay.bone)
        output[(overlay.bone, target_frame)] = BoneFrame(
            overlay.bone,
            target_frame,
            _lerp_position(base.position, overlay.position, strength),
            _slerp(base.rotation, overlay.rotation, strength),
            overlay.interpolation,
        )

    return sorted(output.values(), key=lambda item: (item.frame, item.bone))


def drop_bone_frames_in_window(
    frames: Sequence[BoneFrame],
    *,
    target_bones: set[str] | Sequence[str],
    start_frame: int,
    end_frame: int,
) -> list[BoneFrame]:
    bones = set(target_bones)
    if not bones:
        return sorted(frames, key=lambda item: (item.frame, item.bone))
    return sorted(
        [
            frame
            for frame in frames
            if not (frame.bone in bones and start_frame <= frame.frame <= end_frame)
        ],
        key=lambda item: (item.frame, item.bone),
    )


def stabilize_stationary_frames(
    frames: Sequence[BoneFrame],
    *,
    position_locked_bones: set[str] | Sequence[str],
    rotation_locked_bones: set[str] | Sequence[str] = (),
    reference_frame: int = 0,
) -> list[BoneFrame]:
    position_locked = set(position_locked_bones)
    rotation_locked = set(rotation_locked_bones)
    if not position_locked and not rotation_locked:
        return sorted(frames, key=lambda item: (item.frame, item.bone))

    grouped = _group_by_bone(frames)
    reference_positions: dict[str, tuple[float, float, float]] = {}
    reference_rotations: dict[str, tuple[float, float, float, float]] = {}
    for bone in position_locked:
        bone_frames = grouped.get(bone, [])
        if bone_frames:
            reference = _sample_bone_frame(bone_frames, reference_frame, bone)
            reference_positions[bone] = reference.position
    for bone in rotation_locked:
        bone_frames = grouped.get(bone, [])
        if bone_frames:
            reference = _sample_bone_frame(bone_frames, reference_frame, bone)
            reference_rotations[bone] = reference.rotation

    stabilized = []
    for frame in frames:
        position = reference_positions.get(frame.bone, frame.position)
        rotation = reference_rotations.get(frame.bone, frame.rotation)
        stabilized.append(BoneFrame(frame.bone, frame.frame, position, rotation, frame.interpolation))
    return sorted(stabilized, key=lambda item: (item.frame, item.bone))


def write_composed_vmd(
    base_vmd: Path,
    overlay_vmd: Path,
    out_vmd: Path,
    *,
    target_bones: Sequence[str],
    source_start_frame: int,
    source_end_frame: int,
    target_start_frame: int,
    target_end_frame: int,
    strength: float,
    position_locked_bones: Sequence[str] | None = None,
    rotation_locked_bones: Sequence[str] | None = None,
    position_reference_frame: int = 0,
) -> list[BoneFrame]:
    base_frames = read_vmd_bone_frames(base_vmd)
    overlay_frames = read_vmd_bone_frames(overlay_vmd)
    frames = compose_bone_overlay(
        base_frames,
        overlay_frames,
        target_bones=set(target_bones),
        source_start_frame=source_start_frame,
        source_end_frame=source_end_frame,
        target_start_frame=target_start_frame,
        target_end_frame=target_end_frame,
        strength=strength,
    )
    if position_locked_bones or rotation_locked_bones:
        frames = stabilize_stationary_frames(
            frames,
            position_locked_bones=position_locked_bones or (),
            rotation_locked_bones=rotation_locked_bones or (),
            reference_frame=position_reference_frame,
        )
    model_name = str(read_vmd_summary(base_vmd).get("model_name") or "Eula")
    write_vmd(out_vmd, frames, model_name=model_name)
    return frames


def _parse_bones(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Overlay selected bone frames from one VMD onto a base VMD.")
    parser.add_argument("--base", required=True)
    parser.add_argument("--overlay", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--target-bones", default=",".join(RIGHT_ARM_CHAIN))
    parser.add_argument("--source-start-frame", type=int, default=0)
    parser.add_argument("--source-end-frame", type=int, required=True)
    parser.add_argument("--target-start-frame", type=int, default=0)
    parser.add_argument("--target-end-frame", type=int, required=True)
    parser.add_argument("--strength", type=float, default=1.0)
    parser.add_argument("--position-locked-bones", default="", help="Comma-separated bones whose position should be locked to the reference frame.")
    parser.add_argument("--rotation-locked-bones", default="", help="Comma-separated bones whose rotation should be locked to the reference frame.")
    parser.add_argument("--position-reference-frame", type=int, default=0)
    args = parser.parse_args()

    frames = write_composed_vmd(
        Path(args.base),
        Path(args.overlay),
        Path(args.out),
        target_bones=_parse_bones(args.target_bones),
        source_start_frame=args.source_start_frame,
        source_end_frame=args.source_end_frame,
        target_start_frame=args.target_start_frame,
        target_end_frame=args.target_end_frame,
        strength=args.strength,
        position_locked_bones=_parse_bones(args.position_locked_bones),
        rotation_locked_bones=_parse_bones(args.rotation_locked_bones),
        position_reference_frame=args.position_reference_frame,
    )
    print(f"Wrote {len(frames)} composed bone frames to {args.out}")


if __name__ == "__main__":
    main()
