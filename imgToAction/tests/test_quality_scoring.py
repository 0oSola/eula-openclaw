import importlib.util
import math
from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "quality_scoring.py"
SKELETON_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "skeleton_motion.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def make_pose(right_wrist, right_elbow=None, left_wrist=None):
    skeleton_motion = load_module("skeleton_motion", SKELETON_PATH)
    joints = {
        "pelvis": [0.0, 0.0, 0.0],
        "neck": [0.0, 1.0, 0.0],
        "head": [0.0, 1.2, 0.0],
        "right_shoulder": [0.2, 0.9, 0.0],
        "right_elbow": right_elbow or [0.38, 0.82, 0.0],
        "right_wrist": right_wrist,
        "left_shoulder": [-0.2, 0.9, 0.0],
        "left_elbow": [-0.35, 0.55, 0.0],
        "left_wrist": left_wrist or [-0.12, 0.35, 0.0],
        "right_hip": [0.1, -0.1, 0.0],
        "right_knee": [0.1, -0.6, 0.0],
        "right_ankle": [0.1, -1.0, 0.0],
        "left_hip": [-0.1, -0.1, 0.0],
        "left_knee": [-0.1, -0.6, 0.0],
        "left_ankle": [-0.1, -1.0, 0.0],
    }
    return skeleton_motion.validate_skeleton(
        {
            "fps": 20,
            "source": {"type": "test"},
            "frames": [
                skeleton_motion.normalize_frame(joints, 0),
                skeleton_motion.normalize_frame(joints, 1),
            ],
        }
    )


class QualityScoringTests(unittest.TestCase):
    def test_scores_good_thinking_pose_above_threshold(self):
        tool = load_module("quality_scoring", TOOL_PATH)
        profile = {"contacts": {"right_wrist_to_chin_edge": {"target_offset": [0.1, -0.2, 0.0]}}}
        action = {"hand_presets": {"right": "thinking_relaxed", "left": "soft_rest"}}

        report = tool.score_thinking_chin_edge(make_pose([0.1, 1.0, 0.0]), profile, action)

        self.assertGreaterEqual(report["score"], 75)
        self.assertFalse(report["violations"])
        self.assertIn("contact_score", report["components"])
        self.assertIn("stable_stance_score", report["components"])

    def test_scores_bad_wrist_distance_lower_than_good_pose(self):
        tool = load_module("quality_scoring", TOOL_PATH)
        profile = {"contacts": {"right_wrist_to_chin_edge": {"target_offset": [0.1, -0.2, 0.0]}}}
        action = {"hand_presets": {"right": "thinking_relaxed", "left": "soft_rest"}}

        good = tool.score_thinking_chin_edge(make_pose([0.1, 1.0, 0.0]), profile, action)
        bad = tool.score_thinking_chin_edge(make_pose([1.0, -0.2, 0.0]), profile, action)

        self.assertLess(bad["score"], good["score"])
        self.assertIn("right_wrist_far_from_chin", {warning["code"] for warning in bad["warnings"]})

    def test_blocks_non_finite_joint_values(self):
        tool = load_module("quality_scoring", TOOL_PATH)
        skeleton = make_pose([0.1, 1.0, 0.0])
        skeleton["frames"][-1]["joints"]["right_wrist"][0] = math.nan
        profile = {"contacts": {"right_wrist_to_chin_edge": {"target_offset": [0.1, -0.2, 0.0]}}}
        action = {"hand_presets": {"right": "thinking_relaxed", "left": "soft_rest"}}

        report = tool.score_thinking_chin_edge(skeleton, profile, action)

        self.assertEqual(report["score"], 0)
        self.assertIn("non_finite_joint", {violation["code"] for violation in report["violations"]})
        self.assertTrue(all(violation["severity"] == "blocking" for violation in report["violations"]))


if __name__ == "__main__":
    unittest.main()
