import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "direct_pose_to_vmd.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("direct_pose_to_vmd", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DirectPoseToVmdTests(unittest.TestCase):
    def test_resolves_direct_quaternion_keyframes_to_vmd_bone_frames(self):
        tool = load_tool()
        pose = {
            "keyframes": [
                {
                    "frame": 0,
                    "bones": {
                        "\u53f3\u8155": {"quaternion": [0.0, 0.0, 0.0, 1.0]},
                        "\u53f3\u3072\u3058": {"rotation_degrees": [0.0, 0.0, -45.0]},
                    },
                },
                {
                    "frame": 60,
                    "bones": {
                        "\u53f3\u8155": {"quaternion": [0.0, 0.0, 0.7071068, 0.7071068]},
                    },
                },
            ]
        }

        frames = tool.resolve_direct_pose_to_bone_frames(pose)

        self.assertEqual([(frame.bone, frame.frame) for frame in frames], [
            ("\u53f3\u8155", 0),
            ("\u53f3\u3072\u3058", 0),
            ("\u53f3\u8155", 60),
        ])
        self.assertEqual(frames[0].rotation, (0.0, 0.0, 0.0, 1.0))
        self.assertAlmostEqual(frames[1].rotation[3], 0.9238795, places=5)

    def test_writes_direct_pose_vmd(self):
        tool = load_tool()
        pose = {
            "keyframes": [
                {
                    "frame": 60,
                    "bones": {
                        "\u982d": {"rotation_degrees": [-8.0, 0.0, 0.0]},
                        "\u53f3\u624b\u9996": {"quaternion": [0.0, 0.0, 0.0, 1.0]},
                    },
                }
            ]
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "direct.vmd"
            frames = tool.write_direct_pose_vmd(pose, out, model_name="Eula")
            data = out.read_bytes()

        self.assertEqual(len(frames), 2)
        self.assertEqual(data[:25], b"Vocaloid Motion Data 0002")
        self.assertEqual(int.from_bytes(data[50:54], "little"), 2)


if __name__ == "__main__":
    unittest.main()
