from pathlib import Path
import struct
from uuid import uuid4

from app.services.vmd_writer import build_mature_female_idle_motion, write_vmd_file


def _make_case_dir() -> Path:
    path = Path("D:/workspace/MMD project/api/tests_runtime") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_write_vmd_file_emits_valid_header_and_counts():
    case_dir = _make_case_dir()
    output_path = case_dir / "mature_idle.vmd"
    motion = build_mature_female_idle_motion()

    write_vmd_file(output_path, motion)

    raw = output_path.read_bytes()

    assert raw[:30].rstrip(b"\x00") == b"Vocaloid Motion Data 0002"

    bone_count = struct.unpack_from("<I", raw, 50)[0]
    assert bone_count == len(motion["bone_frames"])

    bone_section_size = bone_count * 111
    morph_count_offset = 54 + bone_section_size
    morph_count = struct.unpack_from("<I", raw, morph_count_offset)[0]
    assert morph_count == len(motion["morph_frames"])

    tail_offset = morph_count_offset + 4 + morph_count * 23
    camera_count, light_count, shadow_count, ik_count = struct.unpack_from("<IIII", raw, tail_offset)
    assert (camera_count, light_count, shadow_count, ik_count) == (0, 0, 0, 0)


def test_mature_idle_motion_loops_cleanly_at_frame_120():
    motion = build_mature_female_idle_motion()
    bone_frames = motion["bone_frames"]

    frame_zero = {}
    frame_end = {}
    for frame in bone_frames:
        if frame["frame"] == 0:
            frame_zero[frame["name"]] = frame
        elif frame["frame"] == 120:
            frame_end[frame["name"]] = frame

    assert frame_zero.keys() == frame_end.keys()
    for name in frame_zero:
        assert frame_zero[name]["position"] == frame_end[name]["position"]
        assert frame_zero[name]["rotation"] == frame_end[name]["rotation"]
