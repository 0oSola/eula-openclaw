#!/usr/bin/env python
from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import shutil
import sys
from typing import Any


TOOLS_DIR = Path(__file__).resolve().parent
IMGTOACTION_DIR = TOOLS_DIR.parent
PROJECT_ROOT = IMGTOACTION_DIR.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from action_constraints import apply_right_wrist_to_chin_edge  # noqa: E402
from import_bvh_motion import bvh_to_motion_payload, bvh_to_skeleton, load_bvh  # noqa: E402
from import_momask_joints import load_momask_npy, momask_to_skeleton  # noqa: E402
from overlay_vmd_bone_frames import stabilize_stationary_frames  # noqa: E402
from quality_scoring import score_thinking_chin_edge  # noqa: E402
from retarget_skeleton_to_vmd import write_retargeted_vmd  # noqa: E402
from skeleton_motion import write_skeleton  # noqa: E402
from vmd_io import write_vmd, read_vmd_summary  # noqa: E402


MODE_ACTION_FIT = "action-fit"
MODE_PRESERVE_SOURCE_MOTION = "preserve-source-motion"
SUPPORTED_MODES = (MODE_ACTION_FIT, MODE_PRESERVE_SOURCE_MOTION)


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _resolve_existing_path(value: str, *, named_path: Path) -> Path:
    direct = Path(value)
    if direct.exists():
        return direct
    if not direct.is_absolute():
        root_relative = PROJECT_ROOT / direct
        if root_relative.exists():
            return root_relative
    if named_path.exists():
        return named_path
    raise FileNotFoundError(f"Could not resolve {value!r}; also checked {named_path}")


def resolve_action_path(action: str) -> Path:
    return _resolve_existing_path(action, named_path=IMGTOACTION_DIR / "actions" / f"{action}.json")


def resolve_model_profile_path(model_profile: str) -> Path:
    return _resolve_existing_path(
        model_profile,
        named_path=IMGTOACTION_DIR / "config" / f"model_profile.{model_profile}.json",
    )


def resolve_hand_presets_path(hand_presets: str | None = None) -> Path:
    if hand_presets:
        return _resolve_existing_path(hand_presets, named_path=IMGTOACTION_DIR / "config" / hand_presets)
    return IMGTOACTION_DIR / "config" / "hand_presets.json"


def default_run_dir(action_id: str) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return IMGTOACTION_DIR / "outputs" / "actions" / action_id / f"run_{stamp}"


def _slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._-")
    return slug or "candidate"


def candidate_id(index: int, source_path: Path) -> str:
    return f"candidate_{index:03d}_{_slug(source_path.stem)}"


def _has_blocking_violation(violations: list[dict[str, Any]]) -> bool:
    return any(violation.get("severity") == "blocking" for violation in violations)


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]


def apply_vmd_stationary_stabilization(
    frames: list[Any],
    action_recipe: dict[str, Any],
) -> tuple[list[Any], dict[str, Any]]:
    config = action_recipe.get("vmd_stationary_stabilization")
    if not isinstance(config, dict):
        return list(frames), {"applied": False, "reason": "not_configured"}

    reference_frame = int(config.get("reference_frame", 0) or 0)
    position_locked_bones = _string_list(config.get("position_locked_bones"))
    rotation_locked_bones = _string_list(config.get("rotation_locked_bones"))
    if not position_locked_bones and not rotation_locked_bones:
        return list(frames), {"applied": False, "reason": "no_locked_bones"}

    stabilized = stabilize_stationary_frames(
        frames,
        position_locked_bones=position_locked_bones,
        rotation_locked_bones=rotation_locked_bones,
        reference_frame=reference_frame,
    )
    return stabilized, {
        "applied": True,
        "reference_frame": reference_frame,
        "position_locked_bones": position_locked_bones,
        "rotation_locked_bones": rotation_locked_bones,
    }


def _write_bvh_motion_sidecar(source_path: Path, candidate_dir: Path) -> tuple[dict[str, Any], Path]:
    parsed = load_bvh(source_path)
    motion_path = candidate_dir / "bvh_motion.json"
    _write_json(motion_path, bvh_to_motion_payload(parsed))
    return bvh_to_skeleton(parsed), motion_path


def _source_skeleton(
    *,
    source_type: str,
    source_path: Path,
    candidate_dir: Path,
    fps: int,
) -> tuple[dict[str, Any], Path | None]:
    if source_type == "npy":
        return momask_to_skeleton(load_momask_npy(source_path), fps=fps), None
    if source_type == "bvh":
        return _write_bvh_motion_sidecar(source_path, candidate_dir)
    raise ValueError(f"Unsupported candidate source type: {source_type}")


def _retarget_fidelity_report(
    *,
    candidate_id_value: str,
    source_type: str,
    source_path: Path,
    skeleton: dict[str, Any],
    final_candidate_vmd: Path,
    vmd_summary: dict[str, Any],
) -> dict[str, Any]:
    return {
        "candidate_id": candidate_id_value,
        "mode": MODE_PRESERVE_SOURCE_MOTION,
        "score_type": "retarget_fidelity",
        "score": 100.0,
        "source_type": source_type,
        "source_path": str(source_path),
        "source_frame_count": len(skeleton["frames"]),
        "source_fps": skeleton["fps"],
        "vmd_bone_frame_count": vmd_summary["bone_frame_count"],
        "max_frame": vmd_summary["max_frame"],
        "checks": {
            "source_skeleton_written": True,
            "constraints_applied": False,
            "hand_preset_overlay_applied": False,
            "final_vmd_path": str(final_candidate_vmd),
        },
        "limitations": [
            "pmx_render_fidelity_not_measured",
            "bvh_local_rotation_to_pmx_bone_space_not_preserved_by_current_retargeter",
        ],
    }


def _add_source_report_fields(
    report: dict[str, Any],
    *,
    source_type: str,
    source_path: Path,
    bvh_motion_path: Path | None,
) -> None:
    if source_type == "npy":
        report["source_npy"] = str(source_path)
    if source_type == "bvh":
        report["source_bvh"] = str(source_path)
    if bvh_motion_path:
        report["outputs"]["bvh_motion"] = str(bvh_motion_path)


def process_candidate(
    *,
    source_type: str,
    source_path: Path,
    candidate_dir: Path,
    candidate_id_value: str,
    action_recipe: dict[str, Any],
    model_profile: dict[str, Any],
    hand_presets: dict[str, Any],
    fps: int,
    model_name: str,
    mode: str = MODE_ACTION_FIT,
) -> dict[str, Any]:
    if mode not in SUPPORTED_MODES:
        raise ValueError(f"Unsupported generation mode: {mode}")
    candidate_dir.mkdir(parents=True, exist_ok=True)
    skeleton, bvh_motion_path = _source_skeleton(
        source_type=source_type,
        source_path=source_path,
        candidate_dir=candidate_dir,
        fps=fps,
    )
    skeleton_path = candidate_dir / "skeleton.json"
    write_skeleton(skeleton_path, skeleton)

    draft_vmd = candidate_dir / "draft.vmd"
    draft_frames = write_retargeted_vmd(
        skeleton,
        draft_vmd,
        model_profile=model_profile,
        action_recipe=action_recipe,
        model_name=model_name,
        apply_constraints=False,
    )

    if mode == MODE_PRESERVE_SOURCE_MOTION:
        stale_constrained_skeleton_path = candidate_dir / "final_skeleton.json"
        if stale_constrained_skeleton_path.exists():
            stale_constrained_skeleton_path.unlink()

        final_candidate_vmd = candidate_dir / "final_candidate.vmd"
        if draft_vmd.resolve() != final_candidate_vmd.resolve():
            shutil.copyfile(draft_vmd, final_candidate_vmd)
        final_frames = draft_frames
        stabilization_report = {"applied": False, "reason": "preserve_source_motion"}
        vmd_summary = read_vmd_summary(final_candidate_vmd)

        fidelity_report = _retarget_fidelity_report(
            candidate_id_value=candidate_id_value,
            source_type=source_type,
            source_path=source_path,
            skeleton=skeleton,
            final_candidate_vmd=final_candidate_vmd,
            vmd_summary=vmd_summary,
        )
        fidelity_path = candidate_dir / "retarget_fidelity_report.json"
        _write_json(fidelity_path, fidelity_report)

        quality_report = {
            "candidate_id": candidate_id_value,
            "mode": mode,
            "source_type": source_type,
            "source_path": str(source_path),
            "score_type": "retarget_fidelity",
            "score": fidelity_report["score"],
            "blocking": False,
            "components": {
                "source_skeleton_preservation": fidelity_report["score"],
            },
            "violations": [],
            "warnings": list(fidelity_report["limitations"]),
            "constraint_report": {
                "applied": False,
                "reason": "preserve_source_motion",
            },
            "vmd_stationary_stabilization": stabilization_report,
            "hand_preset_overlay_applied": False,
            "action_score_skipped": True,
            "outputs": {
                "skeleton": str(skeleton_path),
                "draft_vmd": str(draft_vmd),
                "final_candidate_vmd": str(final_candidate_vmd),
                "retarget_fidelity_report": str(fidelity_path),
            },
            "vmd_summary": vmd_summary,
            "frame_counts": {
                "skeleton": len(skeleton["frames"]),
                "draft_bone_frames": len(draft_frames),
                "final_bone_frames": len(final_frames),
            },
        }
        _add_source_report_fields(
            quality_report,
            source_type=source_type,
            source_path=source_path,
            bvh_motion_path=bvh_motion_path,
        )
        quality_path = candidate_dir / "quality_report.json"
        _write_json(quality_path, quality_report)
        quality_report["quality_report"] = str(quality_path)
        return quality_report

    constrained_skeleton, constraint_report = apply_right_wrist_to_chin_edge(skeleton, model_profile, action_recipe)
    constrained_skeleton_path = candidate_dir / "final_skeleton.json"
    write_skeleton(constrained_skeleton_path, constrained_skeleton)

    final_candidate_vmd = candidate_dir / "final_candidate.vmd"
    final_frames = write_retargeted_vmd(
        constrained_skeleton,
        final_candidate_vmd,
        model_profile=model_profile,
        action_recipe=action_recipe,
        hand_preset_config=hand_presets,
        model_name=model_name,
        apply_constraints=False,
    )
    final_frames, stabilization_report = apply_vmd_stationary_stabilization(final_frames, action_recipe)
    if stabilization_report["applied"]:
        write_vmd(final_candidate_vmd, final_frames, model_name=model_name)

    score_report = score_thinking_chin_edge(constrained_skeleton, model_profile, action_recipe)
    violations = list(constraint_report.get("violations", [])) + list(score_report.get("violations", []))
    warnings = list(score_report.get("warnings", []))
    blocking = _has_blocking_violation(violations)
    quality_report = {
        "candidate_id": candidate_id_value,
        "mode": mode,
        "source_type": source_type,
        "source_path": str(source_path),
        "score_type": "thinking_chin_edge",
        "score": score_report["score"],
        "blocking": blocking,
        "components": score_report.get("components", {}),
        "violations": violations,
        "warnings": warnings,
        "constraint_report": constraint_report,
        "vmd_stationary_stabilization": stabilization_report,
        "hand_preset_overlay_applied": True,
        "action_score_skipped": False,
        "outputs": {
            "skeleton": str(skeleton_path),
            "final_skeleton": str(constrained_skeleton_path),
            "draft_vmd": str(draft_vmd),
            "final_candidate_vmd": str(final_candidate_vmd),
        },
        "vmd_summary": read_vmd_summary(final_candidate_vmd),
        "frame_counts": {
            "skeleton": len(skeleton["frames"]),
            "draft_bone_frames": len(draft_frames),
            "final_bone_frames": len(final_frames),
        },
    }
    _add_source_report_fields(
        quality_report,
        source_type=source_type,
        source_path=source_path,
        bvh_motion_path=bvh_motion_path,
    )
    quality_path = candidate_dir / "quality_report.json"
    _write_json(quality_path, quality_report)
    quality_report["quality_report"] = str(quality_path)
    return quality_report


def select_candidate(candidate_reports: list[dict[str, Any]]) -> dict[str, Any]:
    eligible = [report for report in candidate_reports if not report["blocking"]]
    if not eligible:
        best_blocking = max(candidate_reports, key=lambda report: float(report["score"]))
        return {
            "selected_candidate_id": best_blocking["candidate_id"],
            "selected_score": best_blocking["score"],
            "selected_blocking": True,
            "reason": "all_candidates_blocking",
            "eligible_candidates": [],
            "candidates": _candidate_summaries(candidate_reports),
        }
    selected = max(eligible, key=lambda report: float(report["score"]))
    return {
        "selected_candidate_id": selected["candidate_id"],
        "selected_score": selected["score"],
        "selected_blocking": False,
        "reason": "highest_non_blocking_score",
        "eligible_candidates": _candidate_summaries(eligible),
        "candidates": _candidate_summaries(candidate_reports),
    }


def _candidate_summaries(candidate_reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "candidate_id": report["candidate_id"],
            "score": report["score"],
            "blocking": report["blocking"],
            "quality_report": report["quality_report"],
            "final_candidate_vmd": report["outputs"]["final_candidate_vmd"],
            "source_type": report["source_type"],
            "source_path": report["source_path"],
        }
        for report in candidate_reports
    ]


def _candidate_inputs(
    candidate_npys: list[Path] | None,
    candidate_bvhs: list[Path] | None,
) -> list[tuple[str, Path]]:
    candidates: list[tuple[str, Path]] = []
    for path in candidate_npys or []:
        candidates.append(("npy", path))
    for path in candidate_bvhs or []:
        candidates.append(("bvh", path))
    return candidates


def generate_action_vmd(
    *,
    action: str,
    model_profile: str,
    out: Path,
    candidate_npys: list[Path] | None = None,
    candidate_bvhs: list[Path] | None = None,
    run_dir: Path | None = None,
    hand_presets_path: str | None = None,
    fps: int = 20,
    model_name: str = "Eula",
    mode: str = MODE_ACTION_FIT,
) -> dict[str, Any]:
    if mode not in SUPPORTED_MODES:
        raise ValueError(f"Unsupported generation mode: {mode}")
    candidates = _candidate_inputs(candidate_npys, candidate_bvhs)
    if not candidates:
        raise ValueError("At least one --candidate-npy or --candidate-bvh is required")

    action_path = resolve_action_path(action)
    model_profile_path = resolve_model_profile_path(model_profile)
    presets_path = resolve_hand_presets_path(hand_presets_path)
    action_recipe = _read_json(action_path)
    model_profile_config = _read_json(model_profile_path)
    hand_presets = _read_json(presets_path)
    run_root = run_dir or default_run_dir(str(action_recipe["id"]))
    candidates_root = run_root / "candidates"

    reports = []
    for index, (source_type, candidate_path) in enumerate(candidates, start=1):
        source_path = candidate_path if candidate_path.is_absolute() else PROJECT_ROOT / candidate_path
        cid = candidate_id(index, source_path)
        reports.append(
            process_candidate(
                source_type=source_type,
                source_path=source_path,
                candidate_dir=candidates_root / cid,
                candidate_id_value=cid,
                action_recipe=action_recipe,
                model_profile=model_profile_config,
                hand_presets=hand_presets,
                fps=fps,
                model_name=model_name,
                mode=mode,
            )
        )

    selection = select_candidate(reports)
    selection.update(
        {
            "action": str(action_recipe["id"]),
            "model_profile": str(model_profile_config.get("id", model_profile)),
            "mode": mode,
            "run_dir": str(run_root),
            "action_path": str(action_path),
            "model_profile_path": str(model_profile_path),
            "hand_presets_path": str(presets_path),
        }
    )
    selection_path = run_root / "selection_report.json"
    _write_json(selection_path, selection)

    if selection["selected_blocking"]:
        raise RuntimeError(f"No non-blocking candidate was available. See {selection_path}")

    selected_report = next(report for report in reports if report["candidate_id"] == selection["selected_candidate_id"])
    selected_vmd = Path(selected_report["outputs"]["final_candidate_vmd"])
    final_vmd = run_root / "final.vmd"
    final_vmd.parent.mkdir(parents=True, exist_ok=True)
    if selected_vmd.resolve() != final_vmd.resolve():
        shutil.copyfile(selected_vmd, final_vmd)

    out.parent.mkdir(parents=True, exist_ok=True)
    if final_vmd.resolve() != out.resolve():
        shutil.copyfile(final_vmd, out)

    selection["final_vmd"] = str(final_vmd)
    selection["out"] = str(out)
    _write_json(selection_path, selection)
    return selection


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a VMD action from existing MoMask .npy or BVH candidates.")
    parser.add_argument("--action", required=True, help="Action id or path to action recipe JSON.")
    parser.add_argument("--model-profile", required=True, help="Model profile id or path to JSON.")
    parser.add_argument("--candidate-npy", action="append", default=[], help="MoMask joint .npy candidate. Repeat for multi-seed selection.")
    parser.add_argument("--candidate-bvh", action="append", default=[], help="BVH candidate. Repeat for multi-seed selection.")
    parser.add_argument("--out", required=True, help="Final selected VMD output path.")
    parser.add_argument("--run-dir", default="", help="Optional deterministic run output directory.")
    parser.add_argument("--hand-presets", default="", help="Optional hand preset JSON path.")
    parser.add_argument("--fps", type=int, default=20, help="Input MoMask skeleton FPS.")
    parser.add_argument("--model-name", default="Eula", help="Model name stored in the VMD header.")
    parser.add_argument(
        "--mode",
        choices=SUPPORTED_MODES,
        default=MODE_ACTION_FIT,
        help="action-fit applies action constraints; preserve-source-motion only retargets the source motion.",
    )
    args = parser.parse_args()

    selection = generate_action_vmd(
        action=args.action,
        model_profile=args.model_profile,
        candidate_npys=[Path(value) for value in args.candidate_npy],
        candidate_bvhs=[Path(value) for value in args.candidate_bvh],
        out=Path(args.out),
        run_dir=Path(args.run_dir) if args.run_dir else None,
        hand_presets_path=args.hand_presets or None,
        fps=args.fps,
        model_name=args.model_name,
        mode=args.mode,
    )
    print(
        f"Selected {selection['selected_candidate_id']} "
        f"score={selection['selected_score']} out={selection['out']}"
    )


if __name__ == "__main__":
    main()
