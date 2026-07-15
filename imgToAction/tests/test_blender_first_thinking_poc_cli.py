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
        "--solve-static",
    ]


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


def test_solve_static_reuses_existing_poc_blend_without_vmd(cli_tmp_path):
    tool = load_tool()

    config = tool.parse_blender_args(valid_solve_cli(cli_tmp_path))

    assert config.source_blend == config.output_blend
    assert config.source_blend.name == tool.OUTPUT_BLEND_NAME
    assert config.vmd is None
    assert config.setup_only is False
    assert config.solve_static is True


def test_setup_and_solve_modes_are_mutually_exclusive(cli_tmp_path):
    tool = load_tool()
    argv = valid_solve_cli(cli_tmp_path)
    argv.append("--setup-only")

    with pytest.raises(SystemExit):
        tool.parse_blender_args(argv)


def test_solve_static_requires_opening_and_saving_the_same_poc_blend(cli_tmp_path):
    tool = load_tool()
    argv = valid_solve_cli(cli_tmp_path)
    other = cli_tmp_path / "other" / tool.OUTPUT_BLEND_NAME
    argv[argv.index("--output-blend") + 1] = str(other)

    with pytest.raises(ValueError, match="same existing POC blend"):
        tool.parse_blender_args(argv)


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
    assert len(first) == 81
    assert len({candidate.candidate_id for candidate in first}) == len(first)
    assert all(candidate.candidate_id == f"candidate_{index:03d}" for index, candidate in enumerate(first, 1))
    assert all(max(abs(value) for value in candidate.hand_offset) <= 0.025 for candidate in first)
    assert all(max(abs(value) for value in candidate.palm_euler_deg) <= 20.0 for candidate in first)
    assert all(abs(candidate.pole_offset) <= 0.12 for candidate in first)
    assert all(sum(candidate.twist_influences) == pytest.approx(1.0) for candidate in first)


def test_candidate_render_names_cover_top_six_full_body_views():
    tool = load_tool()

    names = tool.candidate_render_names(6)

    assert len(names) == 24
    assert names[0] == "candidate_001/front.png"
    assert names[-1] == "candidate_006/back.png"


def test_collision_face_classification_rejects_partial_and_adjacent_faces():
    tool = load_tool()

    assert tool.polygon_belongs_to_region((1, 2, 3), {1, 2, 3}, set()) is True
    assert tool.polygon_belongs_to_region((1, 2, 4), {1, 2, 3}, set()) is False
    assert tool.polygon_belongs_to_region((1, 2, 3), {1, 2, 3}, {3}) is False


def test_contact_alignment_uses_bounded_response_gain():
    tool = load_tool()

    assert 0.0 < tool.CONTACT_ALIGNMENT_GAIN < 1.0
    assert tool.CONTACT_ALIGNMENT_GAIN == pytest.approx(0.5)


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
