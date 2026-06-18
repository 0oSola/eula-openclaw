import importlib.util
from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "reference_landmarks_to_skeleton.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("reference_landmarks_to_skeleton", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ReferenceLandmarksToSkeletonTests(unittest.TestCase):
    def test_maps_front_reference_pixels_to_pelvis_relative_skeleton_coordinates(self):
        tool = load_tool()
        frame = {
            "frame": 60,
            "landmarks": {
                "pelvis": {"x": 500, "y": 700},
                "neck": {"x": 500, "y": 300},
                "head": {"x": 500, "y": 220},
                "right_shoulder": {"x": 420, "y": 320},
                "right_elbow": {"x": 400, "y": 460},
                "right_wrist": {"x": 460, "y": 400},
                "left_shoulder": {"x": 590, "y": 320},
                "left_elbow": {"x": 610, "y": 470},
                "left_wrist": {"x": 540, "y": 475},
                "right_hip": {"x": 445, "y": 690},
                "left_hip": {"x": 565, "y": 690},
                "right_knee": {"x": 448, "y": 945},
                "left_knee": {"x": 558, "y": 950},
                "right_ankle": {"x": 441, "y": 1175},
                "left_ankle": {"x": 550, "y": 1195},
            },
        }

        joints = tool.frame_to_skeleton_joints(frame)

        self.assertEqual(joints["pelvis"], [0.0, 0.0, 0.0])
        self.assertEqual(joints["neck"], [0.0, 1.0, 0.0])
        self.assertAlmostEqual(joints["head"][1], 1.2)
        self.assertLess(joints["right_shoulder"][0], 0.0)
        self.assertGreater(joints["left_shoulder"][0], 0.0)
        self.assertLess(joints["right_ankle"][1], 0.0)

    def test_build_skeleton_uses_requested_front_frames(self):
        tool = load_tool()
        reference = {
            "frames": {
                f"frame_{index:02d}_front": {
                    "frame": index,
                    "landmarks": {
                        "pelvis": {"x": 500, "y": 700},
                        "neck": {"x": 500, "y": 300},
                        "head": {"x": 500, "y": 220},
                        "right_shoulder": {"x": 420, "y": 320},
                        "right_elbow": {"x": 400, "y": 460},
                        "right_wrist": {"x": 460, "y": 400},
                        "left_shoulder": {"x": 590, "y": 320},
                        "left_elbow": {"x": 610, "y": 470},
                        "left_wrist": {"x": 540, "y": 475},
                        "right_hip": {"x": 445, "y": 690},
                        "left_hip": {"x": 565, "y": 690},
                        "right_knee": {"x": 448, "y": 945},
                        "left_knee": {"x": 558, "y": 950},
                        "right_ankle": {"x": 441, "y": 1175},
                        "left_ankle": {"x": 550, "y": 1195},
                    },
                }
                for index in (0, 30, 60)
            }
        }

        skeleton = tool.reference_to_skeleton(reference, ["frame_00_front", "frame_30_front", "frame_60_front"], fps=30)

        self.assertEqual(skeleton["fps"], 30)
        self.assertEqual([frame["index"] for frame in skeleton["frames"]], [0, 30, 60])
        self.assertEqual(skeleton["source"]["type"], "reference_landmarks")


if __name__ == "__main__":
    unittest.main()
