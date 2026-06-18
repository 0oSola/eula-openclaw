import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "pose_to_vmd.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("pose_to_vmd", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class PoseToVmdTests(unittest.TestCase):
    def test_resolves_signature_pose_to_expected_bone_frames(self):
        tool = load_tool()
        pose = json.loads((PROJECT_ROOT / "imgToAction" / "schemas" / "example_pose_nodes_eula_signature.json").read_text(encoding="utf-8"))
        axis_map = json.loads((PROJECT_ROOT / "imgToAction" / "config" / "bone_axis_map.eula.json").read_text(encoding="utf-8"))

        frames = tool.resolve_pose_to_bone_frames(pose, axis_map)

        frame_numbers = sorted({frame.frame for frame in frames})
        self.assertEqual(frame_numbers, [0, 40, 60, 90])
        self.assertIn(("右腕", 60), {(frame.bone, frame.frame) for frame in frames})
        self.assertIn(("右ひじ", 60), {(frame.bone, frame.frame) for frame in frames})
        final_right_arm = next(frame for frame in frames if frame.bone == "右腕" and frame.frame == 60)
        self.assertNotEqual(final_right_arm.rotation, (0.0, 0.0, 0.0, 1.0))

    def test_writes_vmd_header_and_bone_frame_count(self):
        tool = load_tool()
        frames = [
            tool.BoneFrame("右腕", 0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
            tool.BoneFrame("右腕", 30, (0.0, 0.0, 0.0), (0.0, 0.0, 0.7071068, 0.7071068)),
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "motion.vmd"
            tool.write_vmd(out, frames, model_name="Eula")
            data = out.read_bytes()

        self.assertEqual(data[:25], b"Vocaloid Motion Data 0002")
        self.assertEqual(int.from_bytes(data[50:54], "little"), 2)
        self.assertGreater(len(data), 54 + 111 * 2)


if __name__ == "__main__":
    unittest.main()
