#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

DEFAULT_ALIGNMENT_ANCHORS = ["neck", "pelvis", "right_ankle", "left_ankle"]
DEFAULT_PARAMETER_SCAN = [
    {"parameter": "arms.right_arm.raise", "deltas": [-12, 12], "landmarks": ["right_elbow", "right_wrist"]},
    {"parameter": "arms.right_arm.open_side", "deltas": [-12, 12], "landmarks": ["right_elbow", "right_wrist"]},
    {"parameter": "arms.left_arm.open_side", "deltas": [-12, 12], "landmarks": ["left_elbow", "left_wrist"]},
    {"parameter": "arms.left_arm.backward", "deltas": [-12, 12], "landmarks": ["left_elbow", "left_wrist"]},
    {"parameter": "body.head.turn_y", "deltas": [-8, 8], "landmarks": ["head", "neck"]},
    {"parameter": "legs.right_leg.knee_bend", "deltas": [-4, 4], "min": 0, "landmarks": ["right_knee", "right_ankle"]},
    {"parameter": "legs.left_leg.knee_bend", "deltas": [-4, 4], "min": 0, "landmarks": ["left_knee", "left_ankle"]},
]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def reference_frame(reference_config: dict[str, Any], frame_key: str) -> dict[str, Any]:
    frame = reference_config.get("frames", {}).get(frame_key)
    if not frame:
        raise KeyError(f"Reference frame not found: {frame_key}")
    return frame


def _projected_landmark_map(projected: dict[str, Any]) -> dict[str, Any]:
    landmarks = projected.get("landmarks", {})
    if isinstance(landmarks, list):
        return {item.get("name"): item for item in landmarks if item.get("name")}
    return landmarks


def _compute_similarity_transform(
    reference_points: dict[str, Any],
    projected_points: dict[str, Any],
    anchors: list[str],
) -> dict[str, Any]:
    pairs = []
    for name in anchors:
        target = reference_points.get(name)
        source = projected_points.get(name)
        if target and source:
            pairs.append(
                (
                    (float(source.get("x", 0.0)), float(source.get("y", 0.0))),
                    (float(target.get("x", 0.0)), float(target.get("y", 0.0))),
                )
            )
    if len(pairs) < 2:
        return {"mode": "none", "reason": "not_enough_anchors", "anchors": [name for name in anchors if name in reference_points]}

    source_cx = sum(point[0][0] for point in pairs) / len(pairs)
    source_cy = sum(point[0][1] for point in pairs) / len(pairs)
    target_cx = sum(point[1][0] for point in pairs) / len(pairs)
    target_cy = sum(point[1][1] for point in pairs) / len(pairs)

    numerator_a = 0.0
    numerator_b = 0.0
    denominator = 0.0
    for (source_x, source_y), (target_x, target_y) in pairs:
        sx = source_x - source_cx
        sy = source_y - source_cy
        tx = target_x - target_cx
        ty = target_y - target_cy
        numerator_a += sx * tx + sy * ty
        numerator_b += sx * ty - sy * tx
        denominator += sx * sx + sy * sy

    if denominator <= 1e-8:
        return {"mode": "none", "reason": "degenerate_anchors", "anchors": [name for name in anchors if name in reference_points]}

    a = numerator_a / denominator
    b = numerator_b / denominator
    translate_x = target_cx - (a * source_cx - b * source_cy)
    translate_y = target_cy - (b * source_cx + a * source_cy)
    return {
        "mode": "similarity",
        "a": a,
        "b": b,
        "scale": math.hypot(a, b),
        "rotation_degrees": math.degrees(math.atan2(b, a)),
        "translate_x": translate_x,
        "translate_y": translate_y,
        "anchors": [name for name in anchors if name in reference_points and name in projected_points],
    }


def _apply_alignment(projected_points: dict[str, Any], alignment: dict[str, Any]) -> dict[str, Any]:
    if alignment.get("mode") != "similarity":
        return projected_points
    a = float(alignment["a"])
    b = float(alignment["b"])
    translate_x = float(alignment["translate_x"])
    translate_y = float(alignment["translate_y"])
    aligned = {}
    for name, point in projected_points.items():
        x = float(point.get("x", 0.0))
        y = float(point.get("y", 0.0))
        next_point = dict(point)
        next_point["raw_x"] = x
        next_point["raw_y"] = y
        next_point["x"] = a * x - b * y + translate_x
        next_point["y"] = b * x + a * y + translate_y
        aligned[name] = next_point
    return aligned


def compute_landmark_errors(
    reference: dict[str, Any],
    projected: dict[str, Any],
    align: str = "none",
    anchors: list[str] | None = None,
) -> dict[str, Any]:
    reference_points = reference.get("landmarks", {})
    projected_points = _projected_landmark_map(projected)
    alignment = {"mode": "none"}
    if align == "similarity":
        alignment = _compute_similarity_transform(reference_points, projected_points, anchors or DEFAULT_ALIGNMENT_ANCHORS)
        projected_points = _apply_alignment(projected_points, alignment)
    landmark_errors: dict[str, Any] = {}
    weighted_sum = 0.0
    total_weight = 0.0
    missing: list[str] = []

    for name, target in reference_points.items():
        observed = projected_points.get(name)
        if not observed:
            missing.append(name)
            continue
        weight = float(target.get("weight", 1.0))
        dx = float(observed.get("x", 0.0)) - float(target.get("x", 0.0))
        dy = float(observed.get("y", 0.0)) - float(target.get("y", 0.0))
        distance = math.hypot(dx, dy)
        landmark_errors[name] = {
            "target": {"x": float(target.get("x", 0.0)), "y": float(target.get("y", 0.0))},
            "projected": {"x": float(observed.get("x", 0.0)), "y": float(observed.get("y", 0.0))},
            "dx": dx,
            "dy": dy,
            "distance": distance,
            "weight": weight,
        }
        weighted_sum += (distance * distance) * weight
        total_weight += weight

    weighted_rmse = math.sqrt(weighted_sum / total_weight) if total_weight else math.inf
    worst = sorted(
        ({"name": name, **error} for name, error in landmark_errors.items()),
        key=lambda item: item["distance"] * item["weight"],
        reverse=True,
    )
    return {
        "weighted_rmse": weighted_rmse,
        "alignment": alignment,
        "landmark_count": len(landmark_errors),
        "missing": missing,
        "landmarks": landmark_errors,
        "worst": worst[:10],
    }


def choose_best_candidate(reference: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    ranked = []
    for candidate in candidates:
        projected = {"landmarks": candidate.get("landmarks", {})}
        report = compute_landmark_errors(reference, projected)
        ranked.append({**candidate, "report": report})
    if not ranked:
        raise ValueError("No candidates provided")
    return min(ranked, key=lambda item: item["report"]["weighted_rmse"])


def _normalize_parameter_path(parameter: str) -> list[str]:
    parts = [part for part in parameter.split(".") if part]
    if not parts:
        raise ValueError("Parameter path is empty")
    if parts[0] in {"body", "arms", "legs"}:
        return parts
    if parts[0] in {"center", "pelvis", "chest", "head"}:
        return ["body", *parts]
    if parts[0] in {"right_arm", "left_arm"}:
        return ["arms", *parts]
    if parts[0] in {"right_leg", "left_leg"}:
        return ["legs", *parts]
    raise ValueError(f"Unknown pose parameter path: {parameter}")


def _find_keyframe(pose: dict[str, Any], frame: int) -> dict[str, Any]:
    for keyframe in pose.get("keyframes", []):
        if int(keyframe.get("frame", -1)) == int(frame):
            return keyframe
    raise KeyError(f"Pose keyframe not found: {frame}")


def _format_delta(delta: float) -> str:
    prefix = "plus" if delta >= 0 else "minus"
    magnitude = f"{abs(delta):g}".replace(".", "p")
    return f"{prefix}_{magnitude}"


def _candidate_name(parameter: str, delta: float) -> str:
    return f"{parameter.replace('.', '_')}_{_format_delta(delta)}"


def apply_pose_parameter_delta(
    pose: dict[str, Any],
    frame: int,
    parameter: str,
    delta: float,
    minimum: float | None = None,
    maximum: float | None = None,
) -> dict[str, Any]:
    candidate_pose = json.loads(json.dumps(pose))
    keyframe = _find_keyframe(candidate_pose, frame)
    parts = _normalize_parameter_path(parameter)
    node: Any = keyframe
    for part in parts[:-1]:
        if not isinstance(node, dict) or part not in node:
            raise KeyError(f"Pose parameter parent not found: {'.'.join(parts[:-1])}")
        node = node[part]

    leaf = parts[-1]
    if not isinstance(node, dict) or leaf not in node:
        raise KeyError(f"Pose parameter not found: {'.'.join(parts)}")
    value = node[leaf]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"Pose parameter is not numeric: {'.'.join(parts)}")

    next_value = float(value) + float(delta)
    if minimum is not None:
        next_value = max(next_value, float(minimum))
    if maximum is not None:
        next_value = min(next_value, float(maximum))
    node[leaf] = next_value
    return candidate_pose


def generate_parameter_candidates(
    pose: dict[str, Any],
    frame: int,
    scan_parameters: list[Any] | None = None,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for entry in scan_parameters or DEFAULT_PARAMETER_SCAN:
        spec = {"parameter": entry} if isinstance(entry, str) else dict(entry)
        parameter = ".".join(_normalize_parameter_path(str(spec["parameter"])))
        for delta in spec.get("deltas", [-10, 10]):
            candidate_pose = apply_pose_parameter_delta(
                pose,
                frame,
                parameter,
                float(delta),
                minimum=spec.get("min"),
                maximum=spec.get("max"),
            )
            keyframe = _find_keyframe(candidate_pose, frame)
            node: Any = keyframe
            parts = _normalize_parameter_path(parameter)
            for part in parts:
                node = node[part]
            candidates.append(
                {
                    "name": _candidate_name(parameter, float(delta)),
                    "frame": int(frame),
                    "parameter": parameter,
                    "delta": float(delta),
                    "value": float(node),
                    "target_landmarks": list(spec.get("landmarks", [])),
                    "pose": candidate_pose,
                }
            )
    return candidates


def build_report(
    reference_config: dict[str, Any],
    projected: dict[str, Any],
    frame_key: str,
    motion_name: str | None = None,
    align: str = "similarity",
    anchors: list[str] | None = None,
) -> dict[str, Any]:
    frame = reference_frame(reference_config, frame_key)
    report = compute_landmark_errors(frame, projected, align=align, anchors=anchors or DEFAULT_ALIGNMENT_ANCHORS)
    return {
        "motion_name": motion_name or projected.get("motion_name") or "unknown",
        "frame_key": frame_key,
        "reference_image": frame.get("image"),
        "projected_source": projected.get("source"),
        **report,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare reference landmarks with projected model landmarks.")
    parser.add_argument("--reference", default="imgToAction/config/reference_landmarks.eula_signature.json")
    parser.add_argument("--projected", required=True)
    parser.add_argument("--frame-key", default="frame_60_front")
    parser.add_argument("--out", default="imgToAction/outputs/fitting/fitting_report.frame_60_front.json")
    parser.add_argument("--motion-name", default="")
    parser.add_argument("--align", choices=["none", "similarity"], default="similarity")
    parser.add_argument("--anchors", default=",".join(DEFAULT_ALIGNMENT_ANCHORS))
    args = parser.parse_args()

    reference_config = read_json(Path(args.reference))
    projected = read_json(Path(args.projected))
    anchors = [item.strip() for item in args.anchors.split(",") if item.strip()]
    report = build_report(reference_config, projected, args.frame_key, motion_name=args.motion_name or None, align=args.align, anchors=anchors)
    write_report(Path(args.out), report)
    print(f"Wrote fitting report to {args.out} (weighted_rmse={report['weighted_rmse']:.3f})")


if __name__ == "__main__":
    main()
