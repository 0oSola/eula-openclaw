import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "fit_pose_nodes.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("fit_pose_nodes", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FitPoseNodesTests(unittest.TestCase):
    def test_compute_landmark_errors_returns_weighted_score_and_worst_points(self):
        tool = load_tool()
        reference = {
            "landmarks": {
                "right_wrist": {"x": 100, "y": 100, "weight": 2.0},
                "neck": {"x": 50, "y": 50, "weight": 1.0},
            }
        }
        projected = {
            "landmarks": {
                "right_wrist": {"x": 110, "y": 80},
                "neck": {"x": 50, "y": 55},
            }
        }

        report = tool.compute_landmark_errors(reference, projected)

        self.assertAlmostEqual(report["landmarks"]["right_wrist"]["dx"], 10.0)
        self.assertAlmostEqual(report["landmarks"]["right_wrist"]["dy"], -20.0)
        self.assertGreater(report["weighted_rmse"], 18.0)
        self.assertEqual(report["worst"][0]["name"], "right_wrist")

    def test_choose_best_candidate_selects_lowest_error_variant(self):
        tool = load_tool()
        reference = {
            "landmarks": {
                "right_wrist": {"x": 100, "y": 100, "weight": 1.0},
            }
        }
        candidates = [
            {"name": "base", "parameter": None, "delta": 0, "landmarks": {"right_wrist": {"x": 140, "y": 100}}},
            {"name": "raise_plus", "parameter": "right_arm.raise", "delta": 5, "landmarks": {"right_wrist": {"x": 104, "y": 102}}},
        ]

        best = tool.choose_best_candidate(reference, candidates)

        self.assertEqual(best["name"], "raise_plus")
        self.assertEqual(best["parameter"], "right_arm.raise")
        self.assertLess(best["report"]["weighted_rmse"], 5.0)

    def test_similarity_alignment_reduces_camera_scale_and_translation_error(self):
        tool = load_tool()
        reference = {
            "landmarks": {
                "neck": {"x": 100, "y": 100, "weight": 1.0},
                "pelvis": {"x": 100, "y": 300, "weight": 1.0},
                "right_wrist": {"x": 20, "y": 180, "weight": 1.0},
            }
        }
        projected = {
            "landmarks": {
                "neck": {"x": 50, "y": 50},
                "pelvis": {"x": 50, "y": 150},
                "right_wrist": {"x": 10, "y": 90},
            }
        }

        raw = tool.compute_landmark_errors(reference, projected)
        aligned = tool.compute_landmark_errors(reference, projected, align="similarity", anchors=["neck", "pelvis"])

        self.assertGreater(raw["weighted_rmse"], 80)
        self.assertLess(aligned["weighted_rmse"], 1.0)
        self.assertEqual(aligned["alignment"]["mode"], "similarity")

    def test_generate_parameter_candidates_applies_deltas_without_mutating_source_pose(self):
        tool = load_tool()
        pose = {
            "motion_name": "sample_motion",
            "keyframes": [
                {
                    "frame": 60,
                    "pose": "target",
                    "arms": {
                        "right_arm": {
                            "raise": 65,
                        }
                    },
                }
            ],
        }

        candidates = tool.generate_parameter_candidates(
            pose,
            frame=60,
            scan_parameters=[
                {"parameter": "arms.right_arm.raise", "deltas": [-10, 10], "landmarks": ["right_wrist"]},
            ],
        )

        self.assertEqual([candidate["name"] for candidate in candidates], ["arms_right_arm_raise_minus_10", "arms_right_arm_raise_plus_10"])
        self.assertEqual(candidates[0]["parameter"], "arms.right_arm.raise")
        self.assertEqual(candidates[0]["delta"], -10)
        self.assertEqual(candidates[0]["target_landmarks"], ["right_wrist"])
        self.assertEqual(candidates[0]["pose"]["keyframes"][0]["arms"]["right_arm"]["raise"], 55)
        self.assertEqual(candidates[1]["pose"]["keyframes"][0]["arms"]["right_arm"]["raise"], 75)
        self.assertEqual(pose["keyframes"][0]["arms"]["right_arm"]["raise"], 65)

    def test_default_parameter_scan_includes_knee_bindings_for_leg_errors(self):
        tool = load_tool()
        pose = json.loads((PROJECT_ROOT / "imgToAction" / "schemas" / "example_pose_nodes_eula_signature.json").read_text(encoding="utf-8"))

        candidates = tool.generate_parameter_candidates(pose, frame=60)

        by_parameter = {candidate["parameter"]: candidate for candidate in candidates}
        self.assertIn("legs.right_leg.knee_bend", by_parameter)
        self.assertIn("legs.left_leg.knee_bend", by_parameter)
        self.assertEqual(by_parameter["legs.left_leg.knee_bend"]["target_landmarks"], ["left_knee", "left_ankle"])

    def test_write_fitting_report_persists_json(self):
        tool = load_tool()
        report = {"weighted_rmse": 1.25, "landmarks": {}, "worst": []}

        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "report.json"
            tool.write_report(out, report)
            text = out.read_text(encoding="utf-8")

        self.assertIn('"weighted_rmse": 1.25', text)


if __name__ == "__main__":
    unittest.main()
