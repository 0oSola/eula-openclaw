#!/usr/bin/env python
from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any

import numpy as np


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from skeleton_motion import normalize_frame, validate_skeleton, write_skeleton  # noqa: E402


MOMASK_JOINT_NAMES = (
    "pelvis",
    "right_hip",
    "left_hip",
    "spine",
    "right_knee",
    "left_knee",
    "chest",
    "right_ankle",
    "left_ankle",
    "upper_chest",
    "right_foot",
    "left_foot",
    "neck",
    "right_collar",
    "left_collar",
    "head",
    "right_shoulder",
    "left_shoulder",
    "right_elbow",
    "left_elbow",
    "right_wrist",
    "left_wrist",
)


def load_momask_npy(path: Path) -> np.ndarray:
    joints = np.load(path)
    _validate_joint_array(joints)
    return joints


def _validate_joint_array(joints: Any) -> None:
    if not isinstance(joints, np.ndarray):
        raise ValueError("MoMask joints must be a numpy array")
    if len(joints.shape) != 3:
        raise ValueError(f"MoMask joints must have shape (frames, 22, 3), got {joints.shape}")
    if joints.shape[1] != len(MOMASK_JOINT_NAMES):
        raise ValueError(f"MoMask joints must contain 22 joints, got {joints.shape[1]}")
    if joints.shape[2] != 3:
        raise ValueError(f"MoMask joint coordinates must be 3D, got {joints.shape[2]}")
    if joints.shape[0] <= 0:
        raise ValueError("MoMask joints must contain at least one frame")
    if not np.isfinite(joints).all():
        raise ValueError("MoMask joints contain non-finite values")


def momask_to_skeleton(joints: np.ndarray, fps: int = 20) -> dict[str, Any]:
    _validate_joint_array(joints)
    frames = []
    for frame_index, frame in enumerate(joints):
        named_joints = {
            name: [float(value) for value in frame[joint_index].tolist()]
            for joint_index, name in enumerate(MOMASK_JOINT_NAMES)
        }
        frames.append(normalize_frame(named_joints, index=frame_index))

    return validate_skeleton(
        {
            "fps": int(fps),
            "source": {
                "type": "momask",
                "joint_count": len(MOMASK_JOINT_NAMES),
            },
            "frames": frames,
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert MoMask .npy joint output into imgToAction skeleton.json.")
    parser.add_argument("--input", required=True, help="Path to MoMask joints .npy file.")
    parser.add_argument("--out", required=True, help="Path to write skeleton.json.")
    parser.add_argument("--fps", type=int, default=20, help="Source motion FPS. MoMask HumanML3D output defaults to 20.")
    args = parser.parse_args()

    skeleton = momask_to_skeleton(load_momask_npy(Path(args.input)), fps=args.fps)
    write_skeleton(Path(args.out), skeleton)
    print(f"Wrote {len(skeleton['frames'])} skeleton frames to {args.out}")


if __name__ == "__main__":
    main()
