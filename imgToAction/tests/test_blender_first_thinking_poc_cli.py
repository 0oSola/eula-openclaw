import importlib.util
from pathlib import Path
import shutil
import sys
import uuid

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "blender_first_thinking_poc.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("blender_first_thinking_poc", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def cli_tmp_path():
    path = PROJECT_ROOT / ".pytest-tmp" / f"blender-first-cli-{uuid.uuid4().hex}"
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def valid_cli(tmp_path):
    source_blend = tmp_path / "source.blend"
    source_blend.touch()
    vmd = tmp_path / "reference.vmd"
    vmd.touch()
    output_blend = tmp_path / "eula_elegant_thinking_blender_first_poc.blend"
    output_dir = tmp_path / "blender_first_thinking_poc"
    return [
        "blender.exe",
        "--background",
        str(source_blend),
        "--python",
        str(TOOL_PATH),
        "--",
        "--source-blend",
        str(source_blend),
        "--vmd",
        str(vmd),
        "--output-blend",
        str(output_blend),
        "--output-dir",
        str(output_dir),
        "--setup-only",
    ]


def valid_solve_cli(tmp_path):
    poc_blend = tmp_path / "eula_elegant_thinking_blender_first_poc.blend"
    poc_blend.touch()
    output_dir = tmp_path / "blender_first_thinking_poc"
    return [
        "blender.exe",
        "--background",
        str(poc_blend),
        "--python",
        str(TOOL_PATH),
        "--",
        "--source-blend",
        str(poc_blend),
        "--output-blend",
        str(poc_blend),
        "--output-dir",
        str(output_dir),
        "--search-static",
        "--run-id",
        "run-20260715-001",
    ]


def valid_select_cli(tmp_path):
    argv = valid_solve_cli(tmp_path)
    argv[argv.index("--search-static")] = "--select-static"
    argv.extend(["--source-candidate-id", "candidate_0042"])
    run_dir = Path(argv[argv.index("--output-dir") + 1]) / "runs" / "run-20260715-001"
    run_dir.mkdir(parents=True)
    (run_dir / "static_pose_metrics.json").write_text('{"candidates": []}', encoding="utf-8")
    return argv


def test_module_loads_without_blender_python():
    tool = load_tool()

    assert tool.bpy is None
    assert tool.REFERENCE_ACTION_NAME == "POC_v16_reference"


def test_proxy_bones_preserve_matching_source_rest_orientation():
    tool = load_tool()

    assert tool.PROXY_SOURCE_BONES == {
        "POC_右腕_CTRL": "右腕",
        "POC_右ひじ_CTRL": "右ひじ",
        "POC_右手_CTRL": "右手首",
    }


def test_proxy_elbow_uses_calibrated_one_direction_local_z_hinge():
    tool = load_tool()

    assert tool.ELBOW_HINGE_AXIS == "Z"
    assert tool.ELBOW_IK_LOCKS == {"X": True, "Y": True, "Z": False}
    assert tool.ELBOW_IK_MIN_DEG == -150.0
    assert tool.ELBOW_IK_MAX_DEG == 0.0
    assert tool.ELBOW_FLEX_MIN_DEG == -150.0
    assert tool.ELBOW_FLEX_MAX_DEG == -5.0
    assert tool.signed_elbow_flex_is_valid(-108.27) is True
    assert tool.signed_elbow_flex_is_valid(1.0) is False
    assert tool.signed_elbow_flex_is_valid(-170.0) is False


def test_deform_constraints_use_inverse_calibrated_proxy_subtargets():
    tool = load_tool()

    assert tool.CONSTRAINT_SPECS["upper"] == {
        "owner_bone": "右腕",
        "target_bone": "POC_右腕_CTRL",
        "constraint_type": "CHILD_OF",
        "rotation_axes": "XYZ",
        "calibrate_inverse": True,
    }
    assert tool.CONSTRAINT_SPECS["elbow"] == {
        "owner_bone": "右ひじ",
        "target_bone": "POC_右ひじ_CTRL",
        "constraint_type": "CHILD_OF",
        "rotation_axes": "XYZ",
        "calibrate_inverse": True,
    }
    for key in ("upper_twist", "hand_twist"):
        spec = tool.CONSTRAINT_SPECS[key]
        assert spec["target_bone"] == "POC_右手_CTRL"
        assert spec["constraint_type"] == "COPY_ROTATION"
        assert spec["owner_space"] == "LOCAL"
        assert spec["target_space"] == "LOCAL"
        assert spec["mix_mode"] == "ADD"
        assert spec["rotation_axes"] == "Y"
    assert tool.CONSTRAINT_SPECS["wrist"]["target_bone"] == "POC_右手_CTRL"
    assert tool.CONSTRAINT_SPECS["wrist"]["constraint_type"] == "COPY_ROTATION"
    assert tool.CONSTRAINT_SPECS["wrist"]["owner_space"] == "LOCAL"
    assert tool.CONSTRAINT_SPECS["wrist"]["target_space"] == "LOCAL"
    assert tool.CONSTRAINT_SPECS["wrist"]["mix_mode"] == "ADD"
    assert tool.CONSTRAINT_SPECS["wrist"]["rotation_axes"] == "XYZ"


def test_palm_control_drives_proxy_hand_as_a_local_delta():
    tool = load_tool()

    assert tool.PALM_SPACE_NAME == "POC_手掌_SPACE"
    assert tool.CONSTRAINT_SPECS["palm_proxy"] == {
        "owner_bone": "POC_右手_CTRL",
        "target_control": "POC_手掌_ORIENTATION",
        "owner_space": "LOCAL",
        "target_space": "LOCAL",
        "mix_mode": "REPLACE",
    }
    assert 0.0 < tool.ENABLED_DELTA_LIMIT_DEG <= 10.0


def test_behavior_diagnostics_have_nonzero_bounded_thresholds():
    tool = load_tool()

    assert tool.HAND_TARGET_DIAGNOSTIC_OFFSET == (0.01, 0.0, 0.0)
    assert 0.0 < tool.HAND_RESPONSE_MIN_DEG < tool.HAND_RESPONSE_MAX_DEG <= 10.0
    assert tool.PALM_AXIAL_DIAGNOSTIC_DEG == 10.0
    assert 0.0 < tool.PALM_RESPONSE_TOLERANCE_DEG <= 1.0
    assert 0.0 < tool.PALM_OFF_AXIS_MAX_DEG <= 1.0


def test_backup_path_and_save_version_are_deterministic(cli_tmp_path):
    tool = load_tool()
    output = cli_tmp_path / tool.OUTPUT_BLEND_NAME

    assert tool.blender_backup_path(output) == Path(f"{output}1")
    assert tool.SAVE_VERSION_OVERRIDE == 0


def test_parse_blender_arguments_after_separator_with_deterministic_defaults(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_cli(cli_tmp_path))

    assert config.source_blend.name == "source.blend"
    assert config.vmd.name == "reference.vmd"
    assert config.output_blend.name == tool.OUTPUT_BLEND_NAME
    assert config.output_dir.name == tool.OUTPUT_DIRECTORY_NAME
    assert config.frame_start == 0
    assert config.frame_end == 240
    assert config.setup_only is True
    assert config.solve_static is False


def test_search_static_reuses_existing_poc_blend_without_vmd(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_solve_cli(cli_tmp_path))

    assert config.source_blend == config.output_blend
    assert config.source_blend.name == tool.OUTPUT_BLEND_NAME
    assert config.vmd is None
    assert config.setup_only is False
    assert config.search_static is True
    assert config.select_static is False
    assert config.run_id == "run-20260715-001"


def test_setup_search_and_select_modes_are_mutually_exclusive(cli_tmp_path):
    tool = load_tool()
    argv = valid_solve_cli(cli_tmp_path)
    argv.append("--setup-only")

    with pytest.raises(SystemExit):
        tool.parse_blender_args(argv)


def test_search_static_requires_opening_the_existing_poc_blend(cli_tmp_path):
    tool = load_tool()
    argv = valid_solve_cli(cli_tmp_path)
    other = cli_tmp_path / "other" / tool.OUTPUT_BLEND_NAME
    argv[argv.index("--output-blend") + 1] = str(other)

    with pytest.raises(ValueError, match="same existing POC blend"):
        tool.parse_blender_args(argv)


def test_select_static_requires_reviewed_source_candidate_and_existing_run(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_select_cli(cli_tmp_path))

    assert config.select_static is True
    assert config.search_static is False
    assert config.source_candidate_id == "candidate_0042"
    assert config.run_metrics_path.name == "static_pose_metrics.json"


def test_run_paths_are_isolated_and_require_explicit_overwrite(cli_tmp_path):
    tool = load_tool()
    output_dir = cli_tmp_path / tool.OUTPUT_DIRECTORY_NAME

    paths = tool.static_run_paths(output_dir, "run-20260715-001")

    assert paths.temporary.name == ".tmp-run-20260715-001"
    assert paths.final == output_dir / "runs" / "run-20260715-001"
    assert paths.metrics == paths.final / tool.STATIC_METRICS_NAME


def test_invalid_or_existing_run_id_is_rejected_without_overwrite(cli_tmp_path):
    tool = load_tool()
    argv = valid_solve_cli(cli_tmp_path)
    argv[argv.index("--run-id") + 1] = "../escape"
    with pytest.raises(ValueError, match="run ID"):
        tool.parse_blender_args(argv)

    argv = valid_solve_cli(cli_tmp_path)
    run_dir = Path(argv[argv.index("--output-dir") + 1]) / "runs" / "run-20260715-001"
    run_dir.mkdir(parents=True)
    with pytest.raises(ValueError, match="already exists"):
        tool.parse_blender_args(argv)


def test_staged_search_caps_are_bounded():
    tool = load_tool()

    assert 6 <= tool.STAGE_C_SURVIVOR_LIMIT <= tool.STAGE_B_SURVIVOR_LIMIT
    assert tool.STAGE_C_SURVIVOR_LIMIT >= 18
    assert tool.STAGE_C_SURVIVOR_LIMIT == tool.STAGE_B_SURVIVOR_LIMIT
    assert tool.STAGE_B_SURVIVOR_LIMIT <= tool.STAGE_A_SURVIVOR_LIMIT < len(tool.static_candidate_grid())


def test_stage_a_survivors_preserve_each_contact_target_stratum():
    tool = load_tool()
    candidates = (
        tool.StaticCandidate("candidate_001", 0.35, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0, (0.25, 0.5, 0.25)),
        tool.StaticCandidate("candidate_002", 0.35, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0, (0.25, 0.5, 0.25)),
        tool.StaticCandidate("candidate_003", 1.0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), 0.0, (0.25, 0.5, 0.25)),
    )
    records = tuple(
        (candidate, {"valid": True, "score": score, "source_candidate_id": candidate.candidate_id})
        for candidate, score in zip(candidates, (1.0, 2.0, 100.0), strict=True)
    )

    survivors = tool.stage_a_survivors(records, limit=2)

    assert [candidate.candidate_id for candidate, _record in survivors] == [
        "candidate_001",
        "candidate_003",
    ]


def test_rank_source_mapping_is_stable_and_rejects_gaps():
    tool = load_tool()
    records = [
        {"rank": 1, "source_candidate_id": "candidate_010"},
        {"rank": 2, "source_candidate_id": "candidate_003"},
    ]

    assert tool.rank_source_mapping(records) == {
        "candidate_001": "candidate_010",
        "candidate_002": "candidate_003",
    }
    with pytest.raises(ValueError, match="contiguous"):
        tool.rank_source_mapping([{"rank": 2, "source_candidate_id": "candidate_003"}])


def test_candidate_state_and_remeasurement_comparisons_are_explicit():
    tool = load_tool()
    baseline = {"hand": (1.0, 2.0, 3.0), "enabled": 0.0}

    assert tool.compare_static_state(baseline, dict(baseline), tolerance=1e-6) == ()
    assert tool.compare_static_state(baseline, {"hand": (1.0, 2.0, 3.01), "enabled": 0.0}, tolerance=1e-3)

    stored = {"surface_contact_distance": 0.002, "elbow_angle_deg": 60.0}
    measured = {"surface_contact_distance": 0.0020001, "elbow_angle_deg": 60.0001}
    assert tool.compare_selected_metrics(stored, measured) == ()
    measured["surface_contact_distance"] = 0.02
    assert any("surface_contact_distance" in reason for reason in tool.compare_selected_metrics(stored, measured))

    stored = {"hand_contact_world": (0.0, 0.0, 0.0)}
    measured = {"hand_contact_world": (0.0, 0.0, 0.01)}
    assert any("hand_contact_world" in reason for reason in tool.compare_selected_metrics(stored, measured))


def test_static_selection_requires_contact_patch_margin_and_clear_geometry():
    tool = load_tool()
    metrics = {
        "surface_contact_distance": 0.02,
        "contact_patch_count": 3,
        "surface_intersection_count": 0,
        "head_collision_count": 0,
        "torso_penetration_count": 0,
    }

    assert tool.static_selection_eligibility(metrics, warning_distance=0.03) == ()
    metrics["contact_patch_count"] = 0
    assert any("patch" in reason for reason in tool.static_selection_eligibility(metrics, 0.03))
    metrics["contact_patch_count"] = 3
    metrics["surface_contact_distance"] = 0.031
    assert any("warning" in reason for reason in tool.static_selection_eligibility(metrics, 0.03))


def test_lower_chin_region_uses_bounded_local_head_topology():
    tool = load_tool()
    vertices = (
        (0.0, 0.0, 0.0),
        (1.0, 0.0, 0.0),
        (1.0, 1.0, 0.0),
        (0.0, 1.0, 0.0),
        (5.0, 5.0, 0.0),
    )
    polygons = ((0, 1, 2), (0, 2, 3), (2, 4, 3))

    region = tool.lower_chin_surface_region(
        vertices,
        polygons,
        anchor=(0.5, 0.5, 0.01),
        radius=1.0,
    )

    assert region["triangle_indices"] == (0, 1)
    assert region["triangle_count"] == 2
    assert region["vertex_count"] == 4
    assert len(region["edge_lengths"]) == 6


def test_surface_contact_evidence_distinguishes_touch_separation_and_intersection():
    tool = load_tool()
    vertices = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    triangles = ((0, 1, 2),)

    touching = tool.measure_triangle_surface_contact(
        {"thumb": ((0.25, 0.25, 0.0),)}, vertices, triangles, patch_distance=0.02
    )
    separated = tool.measure_triangle_surface_contact(
        {"index": ((0.25, 0.25, 0.1),)}, vertices, triangles, patch_distance=0.02
    )
    intersecting = tool.measure_triangle_surface_contact(
        {"side_palm": ((0.25, 0.25, -0.01),)}, vertices, triangles, patch_distance=0.02
    )

    assert touching["surface_contact_distance"] == pytest.approx(0.0)
    assert touching["contact_patch_count"] == 1
    assert touching["hand_contact_world"] == pytest.approx((0.25, 0.25, 0.0))
    assert touching["nearest_chin_surface_world"] == pytest.approx((0.25, 0.25, 0.0))
    assert separated["surface_contact_distance"] == pytest.approx(0.1)
    assert intersecting["surface_intersection_count"] == 1
    assert intersecting["contact_source"] == "side_palm"


def test_pmx_chin_surface_converts_to_verified_blender_rest_point():
    tool = load_tool()

    assert tool.PMX_CHIN_SURFACE == (0.0, 18.44, -0.50)
    assert tool.pmx_point_to_blender_rest(tool.PMX_CHIN_SURFACE) == pytest.approx(
        (0.0, -0.04, 1.4752)
    )


def test_static_candidate_grid_is_deterministic_bounded_and_complete():
    tool = load_tool()

    first = tool.static_candidate_grid()
    second = tool.static_candidate_grid()

    assert first == second
    assert len(first) >= 900
    assert len({candidate.candidate_id for candidate in first}) == len(first)
    assert all(candidate.candidate_id == f"candidate_{index:03d}" for index, candidate in enumerate(first, 1))
    assert max(candidate.alignment_factor for candidate in first) == pytest.approx(1.0)
    assert min(candidate.alignment_factor for candidate in first) <= 0.4
    assert all(max(abs(value) for value in candidate.hand_offset) <= 0.04 for candidate in first)
    assert max(max(abs(value) for value in candidate.palm_euler_deg) for candidate in first) >= 35.0
    assert all(abs(candidate.pole_offset) <= 0.18 for candidate in first)
    assert all(sum(candidate.twist_influences) == pytest.approx(1.0) for candidate in first)


def test_candidate_render_names_cover_top_six_full_body_views():
    tool = load_tool()

    names = tool.candidate_render_names(6)

    assert len(names) == 24
    assert names[0] == "candidate_001/front.png"
    assert names[-1] == "candidate_006/back.png"


def test_render_artifact_paths_include_candidate_root(cli_tmp_path):
    tool = load_tool()
    run_dir = cli_tmp_path / "run"

    paths = tool.render_artifact_paths(run_dir, 1)

    assert paths[0] == run_dir / "candidates" / "candidate_001" / "front.png"
    assert paths[-1] == run_dir / "candidates" / "candidate_001" / "back.png"


def test_collision_face_classification_rejects_partial_and_adjacent_faces():
    tool = load_tool()

    assert tool.polygon_belongs_to_region((1, 2, 3), {1, 2, 3}, set()) is True
    assert tool.polygon_belongs_to_region((1, 2, 4), {1, 2, 3}, set()) is False
    assert tool.polygon_belongs_to_region((1, 2, 3), {1, 2, 3}, {3}) is False


def test_contact_alignment_grid_covers_full_calibrated_delta():
    tool = load_tool()

    variants = tool.contact_target_variants()

    assert any(factor == pytest.approx(1.0) and offset == (0.0, 0.0, 0.0) for factor, offset in variants)
    assert any(factor <= 0.4 and offset[2] >= 0.01 for factor, offset in variants)
    assert any(factor <= 0.4 and offset[0] <= -0.01 and offset[2] >= 0.01 for factor, offset in variants)
    assert all(0.0 < factor <= 1.0 for factor, _offset in variants)
    assert all(max(abs(value) for value in offset) <= 0.04 for _factor, offset in variants)


def test_finger_only_head_collision_is_not_overridden_by_clear_palm():
    tool = load_tool()

    evidence = tool.combine_head_collision_evidence(
        palm_intersections=0,
        finger_intersections=2,
        full_hand_intersections=2,
        signed_penetration_depth=0.003,
    )

    assert evidence["collision_count"] == 2
    assert evidence["penetration_depth"] == pytest.approx(0.003)
    assert evidence["sources"] == ("fingers", "full_hand")


def test_parse_blender_arguments_requires_separator(cli_tmp_path):
    tool = load_tool()
    argv = valid_cli(cli_tmp_path)
    argv.remove("--")

    with pytest.raises(ValueError, match="after Blender's -- separator"):
        tool.parse_blender_args(argv)


def test_parse_blender_arguments_accepts_explicit_frame_range(cli_tmp_path):
    tool = load_tool()
    argv = valid_cli(cli_tmp_path)
    argv[-1:-1] = ["--frame-start", "90", "--frame-end", "170"]

    config = tool.parse_blender_args(argv)

    assert (config.frame_start, config.frame_end) == (90, 170)


@pytest.mark.parametrize(
    ("argument", "replacement", "message"),
    [
        ("--source-blend", "missing.blend", "Source blend does not exist"),
        ("--vmd", "missing.vmd", "Reference VMD does not exist"),
        ("--output-blend", "wrong-name.blend", "Output blend must be named"),
        ("--output-dir", "wrong-output-directory", "Output directory must be named"),
    ],
)
def test_path_and_output_name_validation(cli_tmp_path, argument, replacement, message):
    tool = load_tool()
    argv = valid_cli(cli_tmp_path)
    argv[argv.index(argument) + 1] = str(cli_tmp_path / replacement)

    with pytest.raises(ValueError, match=message):
        tool.parse_blender_args(argv)


def test_frame_range_must_be_ordered_and_non_negative(cli_tmp_path):
    tool = load_tool()
    argv = valid_cli(cli_tmp_path)
    argv[-1:-1] = ["--frame-start", "170", "--frame-end", "90"]

    with pytest.raises(ValueError, match="valid non-negative interval"):
        tool.parse_blender_args(argv)
