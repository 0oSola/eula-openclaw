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


def test_module_loads_without_blender_python():
    tool = load_tool()

    assert tool.bpy is None
    assert tool.REFERENCE_ACTION_NAME == "POC_v16_reference"


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
