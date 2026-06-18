import importlib.util
import json
import math
from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "hand_presets.py"
VMD_IO_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "vmd_io.py"
PRESET_PATH = PROJECT_ROOT / "imgToAction" / "config" / "hand_presets.json"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class HandPresetsTests(unittest.TestCase):
    def test_hand_preset_config_contains_initial_presets(self):
        config = json.loads(PRESET_PATH.read_text(encoding="utf-8"))

        self.assertIn("neutral_relaxed", config)
        self.assertIn("thinking_relaxed", config)
        self.assertIn("soft_rest", config)
        self.assertIn("right", config["thinking_relaxed"])
        self.assertIn("left", config["soft_rest"])

    def test_apply_hand_presets_adds_finger_bone_frames(self):
        tool = load_module("hand_presets", TOOL_PATH)
        vmd_io = load_module("vmd_io", VMD_IO_PATH)
        frames = [
            vmd_io.BoneFrame("右腕", 0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
            vmd_io.BoneFrame("右腕", 30, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
        ]
        action = {"hand_presets": {"right": "thinking_relaxed", "left": "soft_rest"}}
        presets = json.loads(PRESET_PATH.read_text(encoding="utf-8"))

        next_frames = tool.apply_hand_presets(frames, action, presets, frame_numbers=[0, 30])
        added = [frame for frame in next_frames if "指" in frame.bone]

        self.assertGreater(len(added), 0)
        self.assertIn("右人指１", {frame.bone for frame in added})
        self.assertIn("左人指１", {frame.bone for frame in added})
        for frame in added:
            length = math.sqrt(sum(component * component for component in frame.rotation))
            self.assertAlmostEqual(length, 1.0, places=5)

    def test_unknown_hand_preset_raises_key_error(self):
        tool = load_module("hand_presets", TOOL_PATH)
        action = {"hand_presets": {"right": "missing_preset"}}
        presets = json.loads(PRESET_PATH.read_text(encoding="utf-8"))

        with self.assertRaisesRegex(KeyError, "missing_preset"):
            tool.apply_hand_presets([], action, presets, frame_numbers=[0])


if __name__ == "__main__":
    unittest.main()
