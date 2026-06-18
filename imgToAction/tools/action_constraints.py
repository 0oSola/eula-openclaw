from __future__ import annotations

import copy
import math
from pathlib import Path
import sys
from typing import Any, Iterable


TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from skeleton_motion import add, dot, length, mul, normalize, sub, validate_skeleton  # noqa: E402


def _finite_vector(value: Iterable[float]) -> list[float]:
    vector = [float(component) for component in value]
    if any(not math.isfinite(component) for component in vector):
        raise ValueError("Vector contains a non-finite value")
    return vector


def _lerp(left: Iterable[float], right: Iterable[float], weight: float) -> list[float]:
    clamped = max(0.0, min(1.0, float(weight)))
    return add(mul(left, 1.0 - clamped), mul(right, clamped))


def contact_weight(frame_index: int, frame_count: int, phase: dict[str, Any]) -> float:
    if frame_count <= 0:
        return 0.0
    progress = max(0.0, min(1.0, float(frame_index) / float(frame_count)))
    start = float(phase.get("start", 0.0))
    full = float(phase.get("full", 1.0))
    end = float(phase.get("end", 1.0))
    if progress < start or progress > end:
        return 0.0
    if progress >= full:
        return 1.0
    if full <= start:
        return 1.0
    return (progress - start) / (full - start)


def _projected_pole(direction: list[float], pole_hint: Iterable[float]) -> list[float]:
    pole = sub(_finite_vector(pole_hint), mul(direction, dot(pole_hint, direction)))
    if length(pole) > 1e-8:
        return normalize(pole)
    fallback = [0.0, 0.0, 1.0]
    pole = sub(fallback, mul(direction, dot(fallback, direction)))
    if length(pole) > 1e-8:
        return normalize(pole)
    return [0.0, 1.0, 0.0]


def solve_two_bone_ik(
    shoulder: Iterable[float],
    elbow: Iterable[float],
    wrist: Iterable[float],
    target: Iterable[float],
    pole_hint: Iterable[float],
) -> dict[str, Any]:
    shoulder_v = _finite_vector(shoulder)
    elbow_v = _finite_vector(elbow)
    wrist_v = _finite_vector(wrist)
    target_v = _finite_vector(target)
    upper_length = length(sub(elbow_v, shoulder_v))
    lower_length = length(sub(wrist_v, elbow_v))
    target_delta = sub(target_v, shoulder_v)
    target_distance = length(target_delta)
    violations: list[dict[str, Any]] = []

    if upper_length <= 1e-8 or lower_length <= 1e-8 or target_distance <= 1e-8:
        violations.append(
            {
                "code": "right_wrist_contact_degenerate_chain",
                "severity": "blocking",
                "detail": "right arm chain has a degenerate segment",
            }
        )
        return {"elbow": elbow_v, "wrist": wrist_v, "violations": violations}

    max_reach = upper_length + lower_length
    target_eff = target_v
    solve_distance = target_distance
    if target_distance > max_reach:
        overreach_ratio = (target_distance - max_reach) / max(1e-8, max_reach)
        violations.append(
            {
                "code": "right_wrist_contact_unreachable",
                "severity": "blocking" if overreach_ratio > 0.15 else "warning",
                "detail": "target distance exceeds arm reach",
                "overreach_ratio": overreach_ratio,
            }
        )
        direction = normalize(target_delta)
        solve_distance = max(max_reach - 1e-6, 1e-6)
        target_eff = add(shoulder_v, mul(direction, solve_distance))
    else:
        direction = normalize(target_delta)

    min_reach = abs(upper_length - lower_length)
    if solve_distance < min_reach:
        solve_distance = min_reach + 1e-6
        target_eff = add(shoulder_v, mul(direction, solve_distance))

    pole = _projected_pole(direction, pole_hint)
    along_distance = (upper_length * upper_length - lower_length * lower_length + solve_distance * solve_distance) / (2.0 * solve_distance)
    height_squared = max(0.0, upper_length * upper_length - along_distance * along_distance)
    elbow_out = add(add(shoulder_v, mul(direction, along_distance)), mul(pole, math.sqrt(height_squared)))
    return {"elbow": elbow_out, "wrist": target_eff, "violations": violations}


def apply_right_wrist_to_chin_edge(
    skeleton: dict[str, Any],
    model_profile: dict[str, Any],
    action_recipe: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    validated = validate_skeleton(skeleton)
    if "right_wrist_to_chin_edge" not in action_recipe.get("contacts", ["right_wrist_to_chin_edge"]):
        return validated, {"contact": "right_wrist_to_chin_edge", "applied": False, "violations": []}

    contact = model_profile.get("contacts", {}).get("right_wrist_to_chin_edge", {})
    target_offset = contact.get("target_offset", [0.1, -0.2, 0.0])
    phase = contact.get("phase", {"start": 0.35, "full": 0.7, "end": 1.0})
    next_skeleton = copy.deepcopy(validated)
    violations: list[dict[str, Any]] = []
    frame_count = len(next_skeleton["frames"])

    for ordinal, frame in enumerate(next_skeleton["frames"]):
        weight = contact_weight(ordinal, frame_count, phase)
        if weight <= 0.0:
            continue
        joints = frame["joints"]
        target = add(joints["head"], target_offset)
        solved = solve_two_bone_ik(
            joints["right_shoulder"],
            joints["right_elbow"],
            joints["right_wrist"],
            target,
            pole_hint=[0.0, 0.0, 1.0],
        )
        joints["right_elbow"] = _lerp(joints["right_elbow"], solved["elbow"], weight)
        joints["right_wrist"] = _lerp(joints["right_wrist"], solved["wrist"], weight)
        for violation in solved["violations"]:
            next_violation = {"frame": frame["index"], "contact_weight": weight, **violation}
            if (
                weight < 1.0
                and next_violation.get("code") == "right_wrist_contact_unreachable"
                and next_violation.get("severity") == "blocking"
            ):
                next_violation["severity"] = "warning"
                next_violation["detail"] = "target distance exceeds arm reach during partial contact blend"
            violations.append(next_violation)

    return validate_skeleton(next_skeleton), {
        "contact": "right_wrist_to_chin_edge",
        "applied": True,
        "violations": violations,
    }
