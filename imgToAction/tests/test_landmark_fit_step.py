import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "run_landmark_fit_step.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("run_landmark_fit_step", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class LandmarkFitStepTests(unittest.TestCase):
    def test_build_candidate_artifacts_writes_pose_vmd_and_manifest_records(self):
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
        axis_map = {
            "semantic_to_pmx_axis": {
                "右腕": {
                    "raise": {"axis": "local_z", "sign": -1},
                },
                "右肩": {
                    "raise": {"axis": "local_z", "sign": -1},
                },
            }
        }
        candidates = [
            {
                "name": "arms_right_arm_raise_plus_10",
                "frame": 60,
                "parameter": "arms.right_arm.raise",
                "delta": 10,
                "target_landmarks": ["right_wrist"],
                "pose": json.loads(json.dumps(pose)),
            }
        ]
        candidates[0]["pose"]["keyframes"][0]["arms"]["right_arm"]["raise"] = 75

        with tempfile.TemporaryDirectory() as tmpdir:
            records = tool.build_candidate_artifacts(
                candidates,
                axis_map=axis_map,
                out_dir=Path(tmpdir),
                model_name="Eula",
            )

            self.assertEqual(len(records), 1)
            pose_path = Path(records[0]["pose_path"])
            vmd_path = Path(records[0]["vmd_path"])
            self.assertTrue(pose_path.exists())
            self.assertTrue(vmd_path.exists())
            self.assertGreater(records[0]["bone_frame_count"], 0)
            self.assertEqual(json.loads(pose_path.read_text(encoding="utf-8"))["keyframes"][0]["arms"]["right_arm"]["raise"], 75)


if __name__ == "__main__":
    unittest.main()
