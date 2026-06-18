import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "skeleton_motion.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("skeleton_motion", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SAMPLE_JOINTS = {
    "pelvis": [0.0, 0.0, 0.0],
    "neck": [0.0, 1.0, 0.0],
    "head": [0.0, 1.2, 0.0],
    "right_shoulder": [0.2, 0.9, 0.0],
    "right_elbow": [0.4, 0.7, 0.0],
    "right_wrist": [0.5, 0.5, 0.0],
    "left_shoulder": [-0.2, 0.9, 0.0],
    "left_elbow": [-0.4, 0.7, 0.0],
    "left_wrist": [-0.5, 0.5, 0.0],
    "right_hip": [0.1, -0.1, 0.0],
    "right_knee": [0.1, -0.6, 0.0],
    "right_ankle": [0.1, -1.0, 0.0],
    "left_hip": [-0.1, -0.1, 0.0],
    "left_knee": [-0.1, -0.6, 0.0],
    "left_ankle": [-0.1, -1.0, 0.0],
}


class SkeletonMotionTests(unittest.TestCase):
    def test_normalizes_frame_and_computes_duration(self):
        tool = load_tool()
        frame0 = tool.normalize_frame(SAMPLE_JOINTS, index=0)
        frame1 = tool.normalize_frame(SAMPLE_JOINTS, index=1)
        payload = {"fps": 20, "source": {"type": "test"}, "frames": [frame0, frame1]}

        validated = tool.validate_skeleton(payload)

        self.assertEqual(validated["frames"][0]["index"], 0)
        self.assertEqual(validated["frames"][0]["joints"]["right_wrist"], [0.5, 0.5, 0.0])
        self.assertAlmostEqual(tool.duration_seconds(validated), 0.1)

    def test_rejects_missing_required_joint(self):
        tool = load_tool()
        joints = dict(SAMPLE_JOINTS)
        del joints["right_wrist"]

        with self.assertRaisesRegex(ValueError, "right_wrist"):
            tool.normalize_frame(joints, index=0)

    def test_writes_and_reads_skeleton_json(self):
        tool = load_tool()
        payload = {
            "fps": 20,
            "source": {"type": "test"},
            "frames": [tool.normalize_frame(SAMPLE_JOINTS, index=0)],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "skeleton.json"
            tool.write_skeleton(path, payload)
            loaded = tool.read_skeleton(path)

        self.assertEqual(loaded["fps"], 20)
        self.assertEqual(loaded["source"]["type"], "test")
        self.assertEqual(loaded["frames"][0]["joints"]["neck"], [0.0, 1.0, 0.0])

    def test_vector_helpers_support_angles(self):
        tool = load_tool()

        self.assertEqual(tool.add([1, 2, 3], [4, 5, 6]), [5.0, 7.0, 9.0])
        self.assertEqual(tool.sub([4, 5, 6], [1, 2, 3]), [3.0, 3.0, 3.0])
        self.assertEqual(tool.mul([1, 2, 3], 2), [2.0, 4.0, 6.0])
        self.assertAlmostEqual(tool.length([3, 4, 0]), 5.0)
        self.assertAlmostEqual(tool.dot([1, 0, 0], [0, 1, 0]), 0.0)
        self.assertAlmostEqual(tool.angle_degrees([1, 0, 0], [0, 1, 0]), 90.0)


if __name__ == "__main__":
    unittest.main()
