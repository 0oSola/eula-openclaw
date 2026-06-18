import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "import_momask_joints.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("import_momask_joints", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ImportMoMaskJointsTests(unittest.TestCase):
    def test_imports_momask_npy_to_named_skeleton(self):
        tool = load_tool()
        joints = np.zeros((2, 22, 3), dtype=np.float32)
        for frame_index in range(2):
            for joint_index in range(22):
                joints[frame_index, joint_index] = [
                    float(frame_index),
                    float(joint_index),
                    float(joint_index) + 0.25,
                ]

        skeleton = tool.momask_to_skeleton(joints)

        self.assertEqual(skeleton["fps"], 20)
        self.assertEqual(skeleton["source"]["type"], "momask")
        self.assertEqual(len(skeleton["frames"]), 2)
        self.assertEqual(skeleton["frames"][0]["joints"]["pelvis"], [0.0, 0.0, 0.25])
        self.assertEqual(skeleton["frames"][0]["joints"]["right_wrist"], [0.0, 20.0, 20.25])
        self.assertEqual(skeleton["frames"][0]["joints"]["left_wrist"], [0.0, 21.0, 21.25])

    def test_loads_npy_file(self):
        tool = load_tool()
        joints = np.zeros((1, 22, 3), dtype=np.float32)

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "sample.npy"
            np.save(path, joints)
            loaded = tool.load_momask_npy(path)

        self.assertEqual(loaded.shape, (1, 22, 3))

    def test_rejects_wrong_shape(self):
        tool = load_tool()

        with self.assertRaisesRegex(ValueError, "shape"):
            tool.momask_to_skeleton(np.zeros((22, 3), dtype=np.float32))

        with self.assertRaisesRegex(ValueError, "22"):
            tool.momask_to_skeleton(np.zeros((1, 21, 3), dtype=np.float32))


if __name__ == "__main__":
    unittest.main()
