from __future__ import annotations

import math
from pathlib import Path
import sys
from typing import Any, Iterable


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from skeleton_motion import angle_degrees, length, sub  # noqa: E402


def _distance(left: Iterable[float], right: Iterable[float]) -> float:
    return length(sub(left, right))


def _target_for_frame(joints: dict[str, list[float]], model_profile: dict[str, Any]) -> list[float]:
    offset = model_profile.get("contacts", {}).get("right_wrist_to_chin_edge", {}).get("target_offset", [0.1, -0.2, 0.0])
    return [float(joints["head"][index]) + float(offset[index]) for index in range(3)]


def _score_range(value: float, ideal_min: float, ideal_max: float, hard_max: float) -> float:
    if ideal_min <= value <= ideal_max:
        return 100.0
    if value < ideal_min:
        distance = ideal_min - value
    else:
        distance = value - ideal_max
    return max(0.0, 100.0 * (1.0 - distance / max(1e-8, hard_max)))


def _non_finite_violations(skeleton: dict[str, Any]) -> list[dict[str, Any]]:
    violations = []
    for frame in skeleton.get("frames", []):
        for joint_name, vector in frame.get("joints", {}).items():
            if any(not math.isfinite(float(value)) for value in vector):
                violations.append(
                    {
                        "code": "non_finite_joint",
                        "severity": "blocking",
                        "frame": frame.get("index", 0),
                        "joint": joint_name,
                    }
                )
    return violations


def _final_joints(skeleton: dict[str, Any]) -> dict[str, list[float]]:
    frames = skeleton.get("frames", [])
    if not frames:
        return {}
    return frames[-1].get("joints", {})


def _contact_score(joints: dict[str, list[float]], model_profile: dict[str, Any]) -> tuple[float, list[dict[str, Any]]]:
    if not joints:
        return 0.0, [{"code": "missing_final_joints", "severity": "blocking"}]
    target = _target_for_frame(joints, model_profile)
    distance = _distance(joints["right_wrist"], target)
    warnings = []
    if distance > 0.25:
        warnings.append({"code": "right_wrist_far_from_chin", "severity": "warning", "distance": distance})
    return _score_range(distance, 0.0, 0.08, 0.45), warnings


def _right_elbow_score(joints: dict[str, list[float]]) -> float:
    upper = sub(joints["right_shoulder"], joints["right_elbow"])
    lower = sub(joints["right_wrist"], joints["right_elbow"])
    angle = angle_degrees(upper, lower)
    return _score_range(angle, 55.0, 145.0, 80.0)


def _head_score(joints: dict[str, list[float]]) -> float:
    neck_to_head = sub(joints["head"], joints["neck"])
    vertical = [0.0, 1.0, 0.0]
    angle = angle_degrees(neck_to_head, vertical)
    return _score_range(angle, 0.0, 18.0, 55.0)


def _left_arm_support_score(joints: dict[str, list[float]]) -> float:
    pelvis_y = float(joints["pelvis"][1])
    neck_y = float(joints["neck"][1])
    wrist_y = float(joints["left_wrist"][1])
    if pelvis_y <= wrist_y <= neck_y * 0.75:
        return 100.0
    return 55.0


def _stable_stance_score(skeleton: dict[str, Any]) -> float:
    frames = skeleton.get("frames", [])
    if len(frames) < 2:
        return 100.0
    first = frames[0]["joints"]
    last = frames[-1]["joints"]
    drift = _distance(first["right_ankle"], last["right_ankle"]) + _distance(first["left_ankle"], last["left_ankle"])
    return _score_range(drift, 0.0, 0.08, 0.35)


def _smoothness_score(skeleton: dict[str, Any]) -> float:
    frames = skeleton.get("frames", [])
    if len(frames) < 3:
        return 100.0
    max_step = 0.0
    for previous, current in zip(frames, frames[1:], strict=False):
        max_step = max(max_step, _distance(previous["joints"]["right_wrist"], current["joints"]["right_wrist"]))
    return _score_range(max_step, 0.0, 0.35, 0.75)


def _hand_preset_score(action_recipe: dict[str, Any]) -> float:
    presets = action_recipe.get("hand_presets", {})
    if presets.get("right") == "thinking_relaxed" and presets.get("left") == "soft_rest":
        return 100.0
    if presets:
        return 70.0
    return 0.0


def score_thinking_chin_edge(
    skeleton: dict[str, Any],
    model_profile: dict[str, Any],
    action_recipe: dict[str, Any],
) -> dict[str, Any]:
    violations = _non_finite_violations(skeleton)
    if violations:
        return {
            "score": 0,
            "components": {},
            "violations": violations,
            "warnings": [],
        }

    joints = _final_joints(skeleton)
    contact_score, contact_warnings = _contact_score(joints, model_profile)
    components = {
        "contact_score": contact_score,
        "elbow_score": _right_elbow_score(joints),
        "head_score": _head_score(joints),
        "left_arm_support_score": _left_arm_support_score(joints),
        "stable_stance_score": _stable_stance_score(skeleton),
        "smoothness_score": _smoothness_score(skeleton),
        "hand_preset_score": _hand_preset_score(action_recipe),
    }
    weights = {
        "contact_score": 0.3,
        "elbow_score": 0.18,
        "head_score": 0.12,
        "left_arm_support_score": 0.1,
        "stable_stance_score": 0.12,
        "smoothness_score": 0.1,
        "hand_preset_score": 0.08,
    }
    score = sum(components[name] * weights[name] for name in components)
    return {
        "score": round(score, 3),
        "components": {name: round(value, 3) for name, value in components.items()},
        "violations": violations,
        "warnings": contact_warnings,
    }
