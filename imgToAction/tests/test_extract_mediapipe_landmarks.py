import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "extract_mediapipe_landmarks.py"


def load_tool():
    spec = importlib.util.spec_from_file_location("extract_mediapipe_landmarks", TOOL_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def write_minimal_png(path: Path, width: int = 1024, height: int = 1536) -> None:
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x02\x00\x00\x00"
        + b"\x00\x00\x00\x00"
    )


def sample_raw_result(width: int = 1024, height: int = 1536) -> dict:
    landmarks = []
    for index in range(33):
        landmarks.append(
            {
                "index": index,
                "x": 0.5,
                "y": 0.5,
                "z": 0.0,
                "visibility": 0.95,
                "presence": 0.9,
            }
        )
    landmarks[11].update({"x": 0.42, "y": 0.22})
    landmarks[12].update({"x": 0.58, "y": 0.22})
    landmarks[13].update({"x": 0.36, "y": 0.36})
    landmarks[14].update({"x": 0.64, "y": 0.36})
    landmarks[15].update({"x": 0.31, "y": 0.5, "visibility": 0.3})
    landmarks[16].update({"x": 0.69, "y": 0.5})
    landmarks[23].update({"x": 0.45, "y": 0.55})
    landmarks[24].update({"x": 0.55, "y": 0.55})
    landmarks[25].update({"x": 0.44, "y": 0.72})
    landmarks[26].update({"x": 0.56, "y": 0.72})
    landmarks[27].update({"x": 0.43, "y": 0.91})
    landmarks[28].update({"x": 0.57, "y": 0.91})
    landmarks[31].update({"x": 0.41, "y": 0.96})
    landmarks[32].update({"x": 0.59, "y": 0.96})
    return {
        "image": "frame_60_front.png",
        "frame_key": "frame_60_front",
        "frame": 60,
        "view": "front",
        "image_width": width,
        "image_height": height,
        "pose_landmarks": landmarks,
    }


class ExtractMediaPipeLandmarksTests(unittest.TestCase):
    def test_discover_reference_images_ignores_contact_sheet_and_parses_frame_view(self):
        tool = load_tool()
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            write_minimal_png(root / "frame_00_front.png")
            write_minimal_png(root / "frame_30_side.png")
            write_minimal_png(root / "frame_60_45.png")
            write_minimal_png(root / "_contact_sheet.png")

            images = tool.discover_reference_images(root)

        self.assertEqual([item["frame_key"] for item in images], ["frame_00_front", "frame_30_side", "frame_60_45"])
        self.assertEqual(images[1]["frame"], 30)
        self.assertEqual(images[1]["view"], "side")
        self.assertEqual(images[2]["width"], 1024)
        self.assertEqual(images[2]["height"], 1536)

    def test_build_reference_config_converts_mediapipe_landmarks_to_project_shape(self):
        tool = load_tool()

        config = tool.build_reference_config(
            [sample_raw_result()],
            source_dir=Path("output/imagegen/eula-thinking-gesture"),
            min_confidence=0.5,
        )

        frame = config["frames"]["frame_60_front"]
        self.assertEqual(config["image_width"], 1024)
        self.assertEqual(config["image_height"], 1536)
        self.assertEqual(frame["image"], "output/imagegen/eula-thinking-gesture/frame_60_front.png")
        self.assertEqual(frame["frame"], 60)
        self.assertEqual(frame["view"], "front")
        self.assertAlmostEqual(frame["landmarks"]["left_shoulder"]["x"], 430.08)
        self.assertAlmostEqual(frame["landmarks"]["left_shoulder"]["y"], 337.92)
        self.assertAlmostEqual(frame["landmarks"]["pelvis"]["x"], 512.0)
        self.assertEqual(frame["landmarks"]["left_wrist"]["confidence"], 0.3)
        self.assertIn("left_wrist", frame["low_confidence"])
        self.assertEqual(config["model_landmark_map"]["left_wrist"], ["左手首"])

    def test_write_outputs_persists_reference_and_raw_json(self):
        tool = load_tool()
        raw = [sample_raw_result()]
        config = tool.build_reference_config(raw, source_dir=Path("output/imagegen/eula-thinking-gesture"))

        with tempfile.TemporaryDirectory() as tmpdir:
            out = Path(tmpdir) / "reference.json"
            raw_out = Path(tmpdir) / "raw.json"
            tool.write_json(out, config)
            tool.write_json(raw_out, {"images": raw})

            loaded = json.loads(out.read_text(encoding="utf-8"))
            loaded_raw = json.loads(raw_out.read_text(encoding="utf-8"))

        self.assertIn("frame_60_front", loaded["frames"])
        self.assertEqual(loaded_raw["images"][0]["frame_key"], "frame_60_front")


if __name__ == "__main__":
    unittest.main()
