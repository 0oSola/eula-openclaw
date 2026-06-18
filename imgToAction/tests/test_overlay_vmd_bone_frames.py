import importlib.util
import math
from pathlib import Path
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = PROJECT_ROOT / "imgToAction" / "tools"


def load_tool(name: str):
    path = TOOLS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def quat_z(degrees: float):
    radians = math.radians(degrees)
    return (0.0, 0.0, math.sin(radians / 2.0), math.cos(radians / 2.0))


class OverlayVmdBoneFramesTests(unittest.TestCase):
    def test_overlays_only_target_bones_and_preserves_others(self):
        vmd_io = load_tool("vmd_io")
        overlay_tool = load_tool("overlay_vmd_bone_frames")
        base_frames = [
            vmd_io.BoneFrame("\u5de6\u8155", 0, (0.0, 0.0, 0.0), quat_z(10)),
            vmd_io.BoneFrame("\u53f3\u8155", 0, (0.0, 0.0, 0.0), quat_z(20)),
            vmd_io.BoneFrame("\u982d", 0, (0.0, 0.0, 0.0), quat_z(30)),
        ]
        overlay_frames = [
            vmd_io.BoneFrame("\u5de6\u8155", 0, (0.0, 0.0, 0.0), quat_z(80)),
            vmd_io.BoneFrame("\u53f3\u8155", 0, (0.0, 0.0, 0.0), quat_z(90)),
        ]

        result = overlay_tool.compose_bone_overlay(
            base_frames,
            overlay_frames,
            target_bones={"\u53f3\u8155"},
            source_start_frame=0,
            source_end_frame=0,
            target_start_frame=0,
            target_end_frame=0,
            strength=1.0,
        )
        by_bone = {frame.bone: frame for frame in result}

        self.assertEqual(by_bone["\u5de6\u8155"].rotation, base_frames[0].rotation)
        self.assertEqual(by_bone["\u982d"].rotation, base_frames[2].rotation)
        self.assertAlmostEqual(by_bone["\u53f3\u8155"].rotation[2], quat_z(90)[2], places=6)

    def test_cli_writes_composed_vmd(self):
        vmd_io = load_tool("vmd_io")
        overlay_tool = load_tool("overlay_vmd_bone_frames")
        base_frames = [
            vmd_io.BoneFrame("\u53f3\u8155", 0, (0.0, 0.0, 0.0), quat_z(0)),
            vmd_io.BoneFrame("\u982d", 0, (0.0, 0.0, 0.0), quat_z(15)),
        ]
        overlay_frames = [vmd_io.BoneFrame("\u53f3\u8155", 0, (0.0, 0.0, 0.0), quat_z(45))]

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir) / "base.vmd"
            overlay = Path(tmpdir) / "overlay.vmd"
            out = Path(tmpdir) / "out.vmd"
            vmd_io.write_vmd(base, base_frames)
            vmd_io.write_vmd(overlay, overlay_frames)

            overlay_tool.write_composed_vmd(
                base,
                overlay,
                out,
                target_bones=["\u53f3\u8155"],
                source_start_frame=0,
                source_end_frame=0,
                target_start_frame=0,
                target_end_frame=0,
                strength=1.0,
            )
            result = vmd_io.read_vmd_bone_frames(out)

        self.assertEqual(len(result), 2)
        by_bone = {frame.bone: frame for frame in result}
        self.assertAlmostEqual(by_bone["\u53f3\u8155"].rotation[2], quat_z(45)[2], places=6)
        self.assertAlmostEqual(by_bone["\u982d"].rotation[2], quat_z(15)[2], places=6)

    def test_stabilizes_stationary_center_translation_without_changing_rotations(self):
        vmd_io = load_tool("vmd_io")
        overlay_tool = load_tool("overlay_vmd_bone_frames")
        frames = [
            vmd_io.BoneFrame("\u30bb\u30f3\u30bf\u30fc", 0, (0.0, -0.7, 0.0), quat_z(0)),
            vmd_io.BoneFrame("\u30bb\u30f3\u30bf\u30fc", 60, (0.4, -0.6, 0.2), quat_z(10)),
            vmd_io.BoneFrame("\u30bb\u30f3\u30bf\u30fc", 120, (2.4, -0.9, -0.2), quat_z(20)),
            vmd_io.BoneFrame("\u53f3\u8155", 120, (0.0, 0.0, 0.0), quat_z(45)),
        ]

        result = overlay_tool.stabilize_stationary_frames(
            frames,
            position_locked_bones={"\u30bb\u30f3\u30bf\u30fc"},
            reference_frame=0,
        )

        centers = [frame for frame in result if frame.bone == "\u30bb\u30f3\u30bf\u30fc"]
        self.assertEqual([frame.position for frame in centers], [(0.0, -0.7, 0.0)] * 3)
        self.assertAlmostEqual(centers[1].rotation[2], quat_z(10)[2], places=6)
        self.assertAlmostEqual(centers[2].rotation[2], quat_z(20)[2], places=6)
        right_arm = next(frame for frame in result if frame.bone == "\u53f3\u8155")
        self.assertEqual(right_arm.position, (0.0, 0.0, 0.0))
        self.assertAlmostEqual(right_arm.rotation[2], quat_z(45)[2], places=6)

    def test_stabilizes_stationary_lower_body_rotations_without_changing_arms(self):
        vmd_io = load_tool("vmd_io")
        overlay_tool = load_tool("overlay_vmd_bone_frames")
        frames = [
            vmd_io.BoneFrame("\u53f3\u8db3", 0, (0.0, 0.0, 0.0), quat_z(5)),
            vmd_io.BoneFrame("\u53f3\u8db3", 60, (0.0, 0.0, 0.0), quat_z(35)),
            vmd_io.BoneFrame("\u5de6\u8db3\u9996", 0, (0.0, 0.0, 0.0), quat_z(-10)),
            vmd_io.BoneFrame("\u5de6\u8db3\u9996", 60, (0.0, 0.0, 0.0), quat_z(-45)),
            vmd_io.BoneFrame("\u53f3\u8155", 60, (0.0, 0.0, 0.0), quat_z(80)),
        ]

        result = overlay_tool.stabilize_stationary_frames(
            frames,
            position_locked_bones=set(),
            rotation_locked_bones={"\u53f3\u8db3", "\u5de6\u8db3\u9996"},
            reference_frame=0,
        )

        right_leg = [frame for frame in result if frame.bone == "\u53f3\u8db3"]
        left_ankle = [frame for frame in result if frame.bone == "\u5de6\u8db3\u9996"]
        self.assertAlmostEqual(right_leg[1].rotation[2], quat_z(5)[2], places=6)
        self.assertAlmostEqual(left_ankle[1].rotation[2], quat_z(-10)[2], places=6)
        right_arm = next(frame for frame in result if frame.bone == "\u53f3\u8155")
        self.assertAlmostEqual(right_arm.rotation[2], quat_z(80)[2], places=6)


if __name__ == "__main__":
    unittest.main()
