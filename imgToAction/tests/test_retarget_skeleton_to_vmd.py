import importlib.util
import math
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "retarget_skeleton_to_vmd.py"
SKELETON_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "skeleton_motion.py"
VMD_IO_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "vmd_io.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sample_skeleton():
    skeleton_motion = load_module("skeleton_motion", SKELETON_PATH)
    frame0 = {
        "pelvis": [0.0, 0.0, 0.0],
        "neck": [0.0, 1.0, 0.0],
        "head": [0.0, 1.2, 0.0],
        "right_shoulder": [0.2, 0.9, 0.0],
        "right_elbow": [0.4, 0.65, 0.0],
        "right_wrist": [0.55, 0.45, 0.0],
        "left_shoulder": [-0.2, 0.9, 0.0],
        "left_elbow": [-0.4, 0.65, 0.0],
        "left_wrist": [-0.55, 0.45, 0.0],
        "right_hip": [0.1, -0.1, 0.0],
        "right_knee": [0.1, -0.6, 0.0],
        "right_ankle": [0.1, -1.0, 0.0],
        "left_hip": [-0.1, -0.1, 0.0],
        "left_knee": [-0.1, -0.6, 0.0],
        "left_ankle": [-0.1, -1.0, 0.0],
    }
    frame1 = {name: list(value) for name, value in frame0.items()}
    frame1["right_wrist"] = [0.35, 0.9, 0.1]
    frame1["right_elbow"] = [0.45, 0.78, 0.05]
    return skeleton_motion.validate_skeleton(
        {
            "fps": 20,
            "source": {"type": "test"},
            "frames": [
                skeleton_motion.normalize_frame(frame0, 0),
                skeleton_motion.normalize_frame(frame1, 1),
            ],
        }
    )


class RetargetSkeletonToVmdTests(unittest.TestCase):
    def test_eula_arm_chain_uses_horizontal_pmx_rest_axes(self):
        tool = load_module("retarget_skeleton_to_vmd", TOOL_PATH)
        targets = {target["bone"]: target for target in tool.BONE_TARGETS}

        self.assertEqual(targets["右腕"]["rest_axis"], (-1.0, 0.0, 0.0))
        self.assertEqual(targets["右ひじ"]["rest_axis"], (-1.0, 0.0, 0.0))
        self.assertEqual(targets["右手首"]["rest_axis"], (-1.0, 0.0, 0.0))
        self.assertEqual(targets["左腕"]["rest_axis"], (1.0, 0.0, 0.0))
        self.assertEqual(targets["左ひじ"]["rest_axis"], (1.0, 0.0, 0.0))
        self.assertEqual(targets["左手首"]["rest_axis"], (1.0, 0.0, 0.0))

    def test_retargets_core_bones_and_resamples_to_vmd_fps(self):
        tool = load_module("retarget_skeleton_to_vmd", TOOL_PATH)

        frames = tool.retarget_skeleton_to_bone_frames(sample_skeleton())

        self.assertGreater(len(frames), 0)
        frame_numbers = sorted({frame.frame for frame in frames})
        self.assertEqual(frame_numbers, [0, 2])
        bone_names = {frame.bone for frame in frames}
        self.assertIn("センター", bone_names)
        self.assertIn("上半身", bone_names)
        self.assertIn("頭", bone_names)
        self.assertIn("右腕", bone_names)
        self.assertIn("右ひじ", bone_names)
        self.assertIn("右手首", bone_names)

        for frame in frames:
            rotation_length = math.sqrt(sum(component * component for component in frame.rotation))
            self.assertAlmostEqual(rotation_length, 1.0, places=5)

    def test_writes_non_empty_vmd_from_skeleton(self):
        tool = load_module("retarget_skeleton_to_vmd", TOOL_PATH)
        vmd_io = load_module("vmd_io", VMD_IO_PATH)

        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "draft.vmd"
            tool.write_retargeted_vmd(sample_skeleton(), out)
            summary = vmd_io.read_vmd_summary(out)

        self.assertGreater(summary["bone_frame_count"], 0)
        self.assertEqual(summary["max_frame"], 2)


if __name__ == "__main__":
    unittest.main()
