import importlib.util
import math
from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "action_constraints.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("action_constraints", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def distance(left, right):
    return math.sqrt(sum((float(a) - float(b)) ** 2 for a, b in zip(left, right, strict=True)))


class ActionConstraintsTests(unittest.TestCase):
    def test_contact_weight_blends_across_phase(self):
        tool = load_tool()
        phase = {"start": 0.25, "full": 0.75, "end": 1.0}

        self.assertEqual(tool.contact_weight(0, 10, phase), 0.0)
        self.assertAlmostEqual(tool.contact_weight(5, 10, phase), 0.5)
        self.assertEqual(tool.contact_weight(8, 10, phase), 1.0)

    def test_two_bone_ik_moves_wrist_closer_to_target(self):
        tool = load_tool()
        shoulder = [0.0, 0.0, 0.0]
        elbow = [0.4, -0.4, 0.0]
        wrist = [0.8, -0.8, 0.0]
        target = [0.2, 0.7, 0.0]

        result = tool.solve_two_bone_ik(shoulder, elbow, wrist, target, pole_hint=[0.0, 0.0, 1.0])

        self.assertLess(distance(result["wrist"], target), distance(wrist, target))
        self.assertFalse(result["violations"])
        self.assertAlmostEqual(distance(shoulder, result["elbow"]), distance(shoulder, elbow), places=5)
        self.assertAlmostEqual(distance(result["elbow"], result["wrist"]), distance(elbow, wrist), places=5)

    def test_unreachable_two_bone_ik_reports_blocking_violation_without_nan(self):
        tool = load_tool()

        result = tool.solve_two_bone_ik(
            [0.0, 0.0, 0.0],
            [0.25, 0.0, 0.0],
            [0.5, 0.0, 0.0],
            [10.0, 0.0, 0.0],
            pole_hint=[0.0, 0.0, 1.0],
        )

        self.assertEqual(result["violations"][0]["code"], "right_wrist_contact_unreachable")
        self.assertEqual(result["violations"][0]["severity"], "blocking")
        for point_name in ("elbow", "wrist"):
            self.assertTrue(all(math.isfinite(value) for value in result[point_name]))

    def test_slightly_unreachable_two_bone_ik_warns_but_keeps_candidate_eligible(self):
        tool = load_tool()

        result = tool.solve_two_bone_ik(
            [0.0, 0.0, 0.0],
            [0.5, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.05, 0.0, 0.0],
            pole_hint=[0.0, 0.0, 1.0],
        )

        self.assertEqual(result["violations"][0]["code"], "right_wrist_contact_unreachable")
        self.assertEqual(result["violations"][0]["severity"], "warning")
        self.assertAlmostEqual(distance([0.0, 0.0, 0.0], result["wrist"]), 1.0, places=5)

    def test_applies_right_wrist_constraint_to_final_frames(self):
        tool = load_tool()
        skeleton = {
            "fps": 20,
            "source": {"type": "test"},
            "frames": [
                {
                    "index": 0,
                    "joints": {
                        "pelvis": [0.0, 0.0, 0.0],
                        "neck": [0.0, 1.0, 0.0],
                        "head": [0.0, 1.2, 0.0],
                        "right_shoulder": [0.2, 0.9, 0.0],
                        "right_elbow": [0.4, 0.6, 0.0],
                        "right_wrist": [0.55, 0.35, 0.0],
                        "left_shoulder": [-0.2, 0.9, 0.0],
                        "left_elbow": [-0.4, 0.6, 0.0],
                        "left_wrist": [-0.55, 0.35, 0.0],
                        "right_hip": [0.1, -0.1, 0.0],
                        "right_knee": [0.1, -0.6, 0.0],
                        "right_ankle": [0.1, -1.0, 0.0],
                        "left_hip": [-0.1, -0.1, 0.0],
                        "left_knee": [-0.1, -0.6, 0.0],
                        "left_ankle": [-0.1, -1.0, 0.0],
                    },
                },
                {
                    "index": 1,
                    "joints": {
                        "pelvis": [0.0, 0.0, 0.0],
                        "neck": [0.0, 1.0, 0.0],
                        "head": [0.0, 1.2, 0.0],
                        "right_shoulder": [0.2, 0.9, 0.0],
                        "right_elbow": [0.4, 0.6, 0.0],
                        "right_wrist": [0.55, 0.35, 0.0],
                        "left_shoulder": [-0.2, 0.9, 0.0],
                        "left_elbow": [-0.4, 0.6, 0.0],
                        "left_wrist": [-0.55, 0.35, 0.0],
                        "right_hip": [0.1, -0.1, 0.0],
                        "right_knee": [0.1, -0.6, 0.0],
                        "right_ankle": [0.1, -1.0, 0.0],
                        "left_hip": [-0.1, -0.1, 0.0],
                        "left_knee": [-0.1, -0.6, 0.0],
                        "left_ankle": [-0.1, -1.0, 0.0],
                    },
                },
            ],
        }
        profile = {
            "contacts": {
                "right_wrist_to_chin_edge": {
                    "target_offset": [0.1, -0.2, 0.0],
                    "phase": {"start": 0.0, "full": 1.0, "end": 1.0},
                }
            }
        }
        action = {"contacts": ["right_wrist_to_chin_edge"]}

        constrained, report = tool.apply_right_wrist_to_chin_edge(skeleton, profile, action)
        target = [0.1, 1.0, 0.0]

        original_distance = distance(skeleton["frames"][1]["joints"]["right_wrist"], target)
        constrained_distance = distance(constrained["frames"][1]["joints"]["right_wrist"], target)
        self.assertLess(constrained_distance, original_distance)
        self.assertEqual(report["contact"], "right_wrist_to_chin_edge")

    def test_partial_contact_overreach_warns_without_blocking_candidate(self):
        tool = load_tool()

        def joints(short_arm=False):
            right_elbow = [0.24, 0.92, 0.0] if short_arm else [0.4, 0.82, 0.0]
            right_wrist = [0.28, 0.98, 0.0] if short_arm else [0.13, 0.97, 0.04]
            return {
                "pelvis": [0.0, 0.0, 0.0],
                "neck": [0.0, 1.0, 0.0],
                "head": [0.0, 1.2, 0.0],
                "right_shoulder": [0.2, 0.9, 0.0],
                "right_elbow": right_elbow,
                "right_wrist": right_wrist,
                "left_shoulder": [-0.2, 0.9, 0.0],
                "left_elbow": [-0.35, 0.55, 0.0],
                "left_wrist": [-0.12, 0.35, 0.0],
                "right_hip": [0.1, -0.1, 0.0],
                "right_knee": [0.1, -0.6, 0.0],
                "right_ankle": [0.1, -1.0, 0.0],
                "left_hip": [-0.1, -0.1, 0.0],
                "left_knee": [-0.1, -0.6, 0.0],
                "left_ankle": [-0.1, -1.0, 0.0],
            }

        skeleton = {
            "fps": 20,
            "source": {"type": "test"},
            "frames": [
                {"index": 0, "joints": joints()},
                {"index": 1, "joints": joints()},
                {"index": 2, "joints": joints(short_arm=True)},
                {"index": 3, "joints": joints()},
            ],
        }
        profile = {
            "contacts": {
                "right_wrist_to_chin_edge": {
                    "target_offset": [0.12, 0.105, 0.09],
                    "phase": {"start": 0.35, "full": 0.7, "end": 1.0},
                }
            }
        }

        _constrained, report = tool.apply_right_wrist_to_chin_edge(
            skeleton,
            profile,
            {"contacts": ["right_wrist_to_chin_edge"]},
        )

        severities = {violation["severity"] for violation in report["violations"]}
        self.assertIn("warning", severities)
        self.assertNotIn("blocking", severities)


if __name__ == "__main__":
    unittest.main()
