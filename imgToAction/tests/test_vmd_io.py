import importlib.util
from pathlib import Path
import struct
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "vmd_io.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("vmd_io", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def encode_fixed_text(value: str, length: int) -> bytes:
    data = value.encode("cp932", errors="replace")[:length]
    return data + (b"\x00" * (length - len(data)))


class VmdIoTests(unittest.TestCase):
    def test_writes_vmd_and_reads_summary(self):
        tool = load_tool()
        frames = [
            tool.BoneFrame("\u53f3\u8155", 0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)),
            tool.BoneFrame("\u53f3\u8155", 30, (0.0, 0.0, 0.0), (0.0, 0.0, 0.7071068, 0.7071068)),
            tool.BoneFrame("\u982d", 30, (0.0, 0.0, 0.0), (0.1, 0.0, 0.0, 0.9949874)),
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "motion.vmd"
            tool.write_vmd(out, frames, model_name="Eula")
            data = out.read_bytes()
            summary = tool.read_vmd_summary(out)

        self.assertEqual(data[:25], b"Vocaloid Motion Data 0002")
        self.assertEqual(int.from_bytes(data[50:54], "little"), 3)
        self.assertEqual(summary["bone_frame_count"], 3)
        self.assertEqual(summary["max_frame"], 30)
        self.assertEqual(summary["bone_names"], ["\u53f3\u8155", "\u982d"])

    def test_reads_vmd_bone_frames_with_interpolation(self):
        tool = load_tool()
        interpolation = bytes(range(64))
        record = b"".join(
            [
                encode_fixed_text("\u53f3\u624b\u9996", 15),
                struct.pack("<I", 42),
                struct.pack("<3f", 1.25, -2.5, 3.75),
                struct.pack("<4f", 0.1, 0.2, 0.3, 0.9),
                interpolation,
            ]
        )
        data = b"".join(
            [
                encode_fixed_text("Vocaloid Motion Data 0002", 30),
                encode_fixed_text("Eula", 20),
                struct.pack("<I", 1),
                record,
                struct.pack("<IIIII", 0, 0, 0, 0, 0),
            ]
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            vmd = Path(tmpdir) / "minimal.vmd"
            vmd.write_bytes(data)
            frames = tool.read_vmd_bone_frames(vmd)

        self.assertEqual(len(frames), 1)
        frame = frames[0]
        self.assertEqual(frame.bone, "\u53f3\u624b\u9996")
        self.assertEqual(frame.frame, 42)
        self.assertEqual(frame.position, (1.25, -2.5, 3.75))
        self.assertAlmostEqual(frame.rotation[0], 0.1, places=6)
        self.assertEqual(frame.interpolation, interpolation)

    def test_writes_per_frame_interpolation_when_present(self):
        tool = load_tool()
        interpolation = bytes(reversed(range(64)))
        frame = tool.BoneFrame(
            "\u53f3\u624b\u9996",
            12,
            (0.0, 0.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
            interpolation=interpolation,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "motion.vmd"
            tool.write_vmd(out, [frame], model_name="Eula")
            data = out.read_bytes()

        self.assertEqual(data[54 + 47 : 54 + 111], interpolation)


if __name__ == "__main__":
    unittest.main()
