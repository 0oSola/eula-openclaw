import importlib.util
import math
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "import_bvh_motion.py"
SAMPLE_BVH = PROJECT_ROOT / "imgToAction" / "samples" / "bvh" / "sample0_repeat0_len196_ik.bvh"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ImportBvhMotionTests(unittest.TestCase):
    def test_sample_bvh_parses_to_internal_skeleton(self):
        tool = load_module("import_bvh_motion", TOOL_PATH)

        parsed = tool.load_bvh(SAMPLE_BVH)
        skeleton = tool.bvh_to_skeleton(parsed)

        self.assertEqual(parsed["frame_count"], 196)
        self.assertAlmostEqual(parsed["frame_time"], 0.05)
        self.assertEqual(skeleton["fps"], 20)
        self.assertEqual(skeleton["source"]["type"], "bvh")
        self.assertEqual(len(skeleton["frames"]), 196)

        joints = skeleton["frames"][0]["joints"]
        for joint_name in (
            "pelvis",
            "neck",
            "head",
            "right_shoulder",
            "right_elbow",
            "right_wrist",
            "left_shoulder",
            "left_elbow",
            "left_wrist",
            "right_hip",
            "right_knee",
            "right_ankle",
            "left_hip",
            "left_knee",
            "left_ankle",
        ):
            self.assertIn(joint_name, joints)
            self.assertTrue(all(math.isfinite(value) for value in joints[joint_name]))
        self.assertNotEqual(joints["right_wrist"], joints["right_elbow"])

    def test_missing_mapped_joint_raises_clear_error(self):
        tool = load_module("import_bvh_motion", TOOL_PATH)
        parsed = tool.load_bvh(SAMPLE_BVH)

        with self.assertRaisesRegex(ValueError, "Missing BVH joint"):
            tool.bvh_to_skeleton(parsed, joint_map={"pelvis": "MissingJoint"})

    def test_sample_bvh_exports_motion_payload_with_local_and_world_data(self):
        tool = load_module("import_bvh_motion", TOOL_PATH)

        parsed = tool.load_bvh(SAMPLE_BVH)
        payload = tool.bvh_to_motion_payload(parsed)

        self.assertEqual(payload["source"]["type"], "bvh_motion")
        self.assertEqual(payload["source"]["frame_count"], 196)
        self.assertEqual(payload["source"]["fps"], 20)
        self.assertAlmostEqual(payload["source"]["frame_time"], 0.05)
        self.assertEqual(payload["hierarchy"]["name"], "Hips")
        self.assertEqual(payload["joint_map"]["right_wrist"], "RightHand")
        self.assertEqual(len(payload["frames"]), 196)

        first_frame = payload["frames"][0]
        self.assertEqual(first_frame["index"], 0)
        self.assertIn("Hips", first_frame["local"])
        self.assertIn("RightHand", first_frame["local"])
        self.assertIn("RightHand", first_frame["world"])
        self.assertIn("Zrotation", first_frame["local"]["RightHand"]["rotation_degrees"])
        self.assertEqual(len(first_frame["world"]["RightHand"]["position"]), 3)
        self.assertEqual(len(first_frame["world"]["RightHand"]["rotation_matrix"]), 3)
        self.assertTrue(all(math.isfinite(value) for value in first_frame["world"]["RightHand"]["position"]))

    def test_cli_writes_skeleton_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = Path(tmpdir) / "skeleton.json"
            result = __import__("subprocess").run(
                [
                    sys.executable,
                    str(TOOL_PATH),
                    "--input",
                    str(SAMPLE_BVH),
                    "--out",
                    str(out_path),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(out_path.exists())
            self.assertGreater(out_path.stat().st_size, 1000)


if __name__ == "__main__":
    unittest.main()
