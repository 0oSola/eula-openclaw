#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
from typing import Any


TOOLS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = TOOLS_DIR.parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import fit_pose_nodes  # noqa: E402
import pose_to_vmd  # noqa: E402


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _relative_to_project(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return str(resolved)


def baseline_candidate(pose: dict[str, Any], frame: int) -> dict[str, Any]:
    return {
        "name": "baseline",
        "frame": int(frame),
        "parameter": None,
        "delta": 0.0,
        "target_landmarks": [],
        "pose": json.loads(json.dumps(pose)),
    }


def build_candidate_artifacts(
    candidates: list[dict[str, Any]],
    axis_map: dict[str, Any],
    out_dir: Path,
    model_name: str,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for candidate in candidates:
        name = str(candidate["name"])
        pose_path = out_dir / "poses" / f"{name}.json"
        vmd_path = out_dir / "vmd" / f"{name}.vmd"
        candidate_pose = candidate["pose"]
        frames = pose_to_vmd.resolve_pose_to_bone_frames(candidate_pose, axis_map)
        write_json(pose_path, candidate_pose)
        pose_to_vmd.write_vmd(vmd_path, frames, model_name=model_name)
        records.append(
            {
                **{key: value for key, value in candidate.items() if key != "pose"},
                "pose_path": str(pose_path),
                "vmd_path": str(vmd_path),
                "bone_frame_count": len(frames),
            }
        )
    return records


def score_candidate_artifact(
    record: dict[str, Any],
    reference_config: dict[str, Any],
    reference_path: Path,
    out_dir: Path,
    frame_key: str,
    frame: int,
    web_url: str,
    render_pipeline: str,
    viewport: str,
    model: str,
    align: str,
    anchors: list[str],
) -> dict[str, Any]:
    name = str(record["name"])
    landmarks_path = out_dir / "landmarks" / f"{name}.json"
    report_path = out_dir / "reports" / f"{name}.json"
    command = [
        "node",
        str(PROJECT_ROOT / "imgToAction" / "tools" / "export-model-landmarks.mjs"),
        "--reference",
        _relative_to_project(reference_path),
        "--frame-key",
        frame_key,
        "--frame",
        str(frame),
        "--web-url",
        web_url,
        "--render-pipeline",
        render_pipeline,
        "--viewport",
        viewport,
        "--vmd",
        _relative_to_project(Path(str(record["vmd_path"]))),
        "--out",
        _relative_to_project(landmarks_path),
    ]
    if model:
        command.extend(["--model", model])

    subprocess.run(command, cwd=PROJECT_ROOT, check=True)
    projected = fit_pose_nodes.read_json(landmarks_path)
    report = fit_pose_nodes.build_report(
        reference_config,
        projected,
        frame_key,
        motion_name=name,
        align=align,
        anchors=anchors,
    )
    fit_pose_nodes.write_report(report_path, report)
    return {
        **record,
        "landmarks_path": str(landmarks_path),
        "report_path": str(report_path),
        "weighted_rmse": report["weighted_rmse"],
        "worst": report["worst"][:5],
    }


def score_candidate_artifacts(
    records: list[dict[str, Any]],
    reference_config: dict[str, Any],
    reference_path: Path,
    out_dir: Path,
    frame_key: str,
    frame: int,
    web_url: str,
    render_pipeline: str,
    viewport: str,
    model: str,
    align: str,
    anchors: list[str],
) -> list[dict[str, Any]]:
    return [
        score_candidate_artifact(
            record,
            reference_config=reference_config,
            reference_path=reference_path,
            out_dir=out_dir,
            frame_key=frame_key,
            frame=frame,
            web_url=web_url,
            render_pipeline=render_pipeline,
            viewport=viewport,
            model=model,
            align=align,
            anchors=anchors,
        )
        for record in records
    ]


def best_scored_record(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    scored = [record for record in records if isinstance(record.get("weighted_rmse"), (int, float))]
    return min(scored, key=lambda record: float(record["weighted_rmse"])) if scored else None


def _parse_float_list(value: str) -> list[float]:
    return [float(item.strip()) for item in value.split(",") if item.strip()]


def _parse_scan_parameters(parameters: str, deltas: list[float]) -> list[dict[str, Any]] | None:
    if not parameters:
        return None
    return [{"parameter": item.strip(), "deltas": deltas} for item in parameters.split(",") if item.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate and optionally score one landmark fitting candidate step.")
    parser.add_argument("--pose", default="imgToAction/schemas/example_pose_nodes_eula_signature.json")
    parser.add_argument("--axis-map", default="imgToAction/config/bone_axis_map.eula.json")
    parser.add_argument("--reference", default="imgToAction/config/reference_landmarks.eula_signature.json")
    parser.add_argument("--frame", type=int, default=60)
    parser.add_argument("--frame-key", default="frame_60_front")
    parser.add_argument("--out-dir", default="imgToAction/outputs/fitting/eula_signature_from_axis_map/candidate_step_001")
    parser.add_argument("--model-name", default="Eula")
    parser.add_argument("--web-url", default="http://127.0.0.1:3100")
    parser.add_argument("--render-pipeline", default="hero-shot")
    parser.add_argument("--viewport", default="1024x1536")
    parser.add_argument("--model", default="")
    parser.add_argument("--align", choices=["none", "similarity"], default="similarity")
    parser.add_argument("--anchors", default=",".join(fit_pose_nodes.DEFAULT_ALIGNMENT_ANCHORS))
    parser.add_argument("--parameters", default="")
    parser.add_argument("--deltas", default="-10,10")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--no-score", action="store_true")
    args = parser.parse_args()

    pose = read_json(PROJECT_ROOT / args.pose)
    axis_map = read_json(PROJECT_ROOT / args.axis_map)
    reference_path = PROJECT_ROOT / args.reference
    reference_config = read_json(reference_path)
    out_dir = PROJECT_ROOT / args.out_dir

    scan_parameters = _parse_scan_parameters(args.parameters, _parse_float_list(args.deltas))
    generated = fit_pose_nodes.generate_parameter_candidates(pose, frame=args.frame, scan_parameters=scan_parameters)
    if args.limit > 0:
        generated = generated[: args.limit]

    records = build_candidate_artifacts(
        [baseline_candidate(pose, args.frame), *generated],
        axis_map=axis_map,
        out_dir=out_dir,
        model_name=args.model_name,
    )

    anchors = [item.strip() for item in args.anchors.split(",") if item.strip()]
    if not args.no_score:
        records = score_candidate_artifacts(
            records,
            reference_config=reference_config,
            reference_path=reference_path,
            out_dir=out_dir,
            frame_key=args.frame_key,
            frame=args.frame,
            web_url=args.web_url,
            render_pipeline=args.render_pipeline,
            viewport=args.viewport,
            model=args.model,
            align=args.align,
            anchors=anchors,
        )

    best = best_scored_record(records)
    manifest = {
        "frame": args.frame,
        "frame_key": args.frame_key,
        "align": args.align,
        "anchors": anchors,
        "scored": not args.no_score,
        "best": best,
        "records": sorted(records, key=lambda record: float(record.get("weighted_rmse", 0.0))),
    }
    write_json(out_dir / "fit_step_manifest.json", manifest)
    if best:
        print(f"Wrote {len(records)} candidates to {args.out_dir}; best={best['name']} weighted_rmse={best['weighted_rmse']:.3f}")
    else:
        print(f"Wrote {len(records)} candidates to {args.out_dir}")


if __name__ == "__main__":
    main()
