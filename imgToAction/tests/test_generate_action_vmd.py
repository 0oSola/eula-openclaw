import json
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOL_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "generate_action_vmd.py"
VMD_IO_PATH = PROJECT_ROOT / "imgToAction" / "tools" / "vmd_io.py"
SAMPLE_BVH = PROJECT_ROOT / "imgToAction" / "samples" / "bvh" / "sample0_repeat0_len196_ik.bvh"

MOMASK_JOINT_NAMES = (
    "pelvis",
    "right_hip",
    "left_hip",
    "spine",
    "right_knee",
    "left_knee",
    "chest",
    "right_ankle",
    "left_ankle",
    "upper_chest",
    "right_foot",
    "left_foot",
    "neck",
    "right_collar",
    "left_collar",
    "head",
    "right_shoulder",
    "left_shoulder",
    "right_elbow",
    "left_elbow",
    "right_wrist",
    "left_wrist",
)


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def make_candidate(foot_drift=False):
    frames = []
    for frame_index in range(4):
        progress = frame_index / 3.0
        joints = {
            "pelvis": [0.0, 0.0, 0.0],
            "right_hip": [0.1, -0.1, 0.0],
            "left_hip": [-0.1, -0.1, 0.0],
            "spine": [0.0, 0.35, 0.0],
            "right_knee": [0.1, -0.6, 0.0],
            "left_knee": [-0.1, -0.6, 0.0],
            "chest": [0.0, 0.75, 0.0],
            "right_ankle": [0.1, -1.0, 0.0],
            "left_ankle": [-0.1, -1.0, 0.0],
            "upper_chest": [0.0, 0.9, 0.0],
            "right_foot": [0.1, -1.08, 0.12],
            "left_foot": [-0.1, -1.08, 0.12],
            "neck": [0.0, 1.0, 0.0],
            "right_collar": [0.1, 0.95, 0.0],
            "left_collar": [-0.1, 0.95, 0.0],
            "head": [0.0, 1.2, 0.0],
            "right_shoulder": [0.2, 0.9, 0.0],
            "left_shoulder": [-0.2, 0.9, 0.0],
            "right_elbow": [0.4 - 0.05 * progress, 0.68 + 0.14 * progress, 0.02],
            "left_elbow": [-0.35, 0.55, 0.0],
            "right_wrist": [0.55 - 0.42 * progress, 0.45 + 0.52 * progress, 0.04],
            "left_wrist": [-0.12, 0.35, 0.0],
        }
        if foot_drift and frame_index == 3:
            joints["right_ankle"] = [0.45, -0.85, 0.2]
            joints["left_ankle"] = [-0.45, -0.85, 0.2]
        frames.append([joints[name] for name in MOMASK_JOINT_NAMES])
    return np.array(frames, dtype=np.float32)


class GenerateActionVmdTests(unittest.TestCase):
    def test_applies_configured_stationary_vmd_stabilization(self):
        tool = load_module("generate_action_vmd", TOOL_PATH)
        vmd_io = load_module("vmd_io", VMD_IO_PATH)
        frames = [
            vmd_io.BoneFrame("\u30bb\u30f3\u30bf\u30fc", 0, (0.0, -0.7, 0.0), (0.0, 0.0, 0.0, 1.0)),
            vmd_io.BoneFrame("\u30bb\u30f3\u30bf\u30fc", 60, (1.5, -0.5, 0.4), (0.0, 0.0, 0.0, 1.0)),
            vmd_io.BoneFrame("\u53f3\u8db3", 0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.1, 0.995)),
            vmd_io.BoneFrame("\u53f3\u8db3", 60, (0.0, 0.0, 0.0), (0.0, 0.0, 0.6, 0.8)),
            vmd_io.BoneFrame("\u53f3\u8155", 60, (0.0, 0.0, 0.0), (0.0, 0.0, 0.7, 0.714)),
        ]
        action = {
            "vmd_stationary_stabilization": {
                "reference_frame": 0,
                "position_locked_bones": ["\u30bb\u30f3\u30bf\u30fc"],
                "rotation_locked_bones": ["\u53f3\u8db3"],
            }
        }

        stabilized, report = tool.apply_vmd_stationary_stabilization(frames, action)

        center60 = next(frame for frame in stabilized if frame.bone == "\u30bb\u30f3\u30bf\u30fc" and frame.frame == 60)
        right_leg60 = next(frame for frame in stabilized if frame.bone == "\u53f3\u8db3" and frame.frame == 60)
        right_arm60 = next(frame for frame in stabilized if frame.bone == "\u53f3\u8155")
        self.assertEqual(center60.position, (0.0, -0.7, 0.0))
        self.assertEqual(right_leg60.rotation, (0.0, 0.0, 0.1, 0.995))
        self.assertEqual(right_arm60.rotation, (0.0, 0.0, 0.7, 0.714))
        self.assertTrue(report["applied"])
        self.assertEqual(report["reference_frame"], 0)
        self.assertEqual(report["position_locked_bones"], ["\u30bb\u30f3\u30bf\u30fc"])
        self.assertEqual(report["rotation_locked_bones"], ["\u53f3\u8db3"])

    def test_cli_generates_outputs_and_selects_best_non_blocking_candidate(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            good_npy = tmp_path / "seed_good.npy"
            drift_npy = tmp_path / "seed_drift.npy"
            run_dir = tmp_path / "run"
            out_vmd = tmp_path / "selected.vmd"
            np.save(good_npy, make_candidate(foot_drift=False))
            np.save(drift_npy, make_candidate(foot_drift=True))

            result = subprocess.run(
                [
                    sys.executable,
                    str(TOOL_PATH),
                    "--action",
                    "thinking_chin_edge",
                    "--model-profile",
                    "eula",
                    "--candidate-npy",
                    str(good_npy),
                    "--candidate-npy",
                    str(drift_npy),
                    "--run-dir",
                    str(run_dir),
                    "--out",
                    str(out_vmd),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            candidate_dirs = sorted((run_dir / "candidates").iterdir())
            self.assertEqual(len(candidate_dirs), 2)
            for candidate_dir in candidate_dirs:
                self.assertTrue((candidate_dir / "skeleton.json").exists())
                self.assertTrue((candidate_dir / "draft.vmd").exists())
                self.assertTrue((candidate_dir / "final_candidate.vmd").exists())
                self.assertTrue((candidate_dir / "quality_report.json").exists())

            selection = json.loads((run_dir / "selection_report.json").read_text(encoding="utf-8"))
            self.assertEqual(selection["selected_candidate_id"], "candidate_001_seed_good")
            self.assertTrue((run_dir / "final.vmd").exists())
            self.assertTrue(out_vmd.exists())
            self.assertGreater(out_vmd.stat().st_size, 54)
            self.assertTrue(all(not item["blocking"] for item in selection["eligible_candidates"]))

    def test_cli_accepts_bvh_candidate(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            run_dir = tmp_path / "run_bvh"
            out_vmd = tmp_path / "selected_bvh.vmd"

            result = subprocess.run(
                [
                    sys.executable,
                    str(TOOL_PATH),
                    "--action",
                    "thinking_chin_edge",
                    "--model-profile",
                    "eula",
                    "--candidate-bvh",
                    str(SAMPLE_BVH),
                    "--run-dir",
                    str(run_dir),
                    "--out",
                    str(out_vmd),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            selection = json.loads((run_dir / "selection_report.json").read_text(encoding="utf-8"))
            self.assertEqual(selection["selected_candidate_id"], "candidate_001_sample0_repeat0_len196_ik")
            self.assertFalse(selection["selected_blocking"])
            candidate_dir = run_dir / "candidates" / selection["selected_candidate_id"]
            self.assertTrue((candidate_dir / "skeleton.json").exists())
            self.assertTrue((candidate_dir / "final_candidate.vmd").exists())
            quality = json.loads((candidate_dir / "quality_report.json").read_text(encoding="utf-8"))
            self.assertEqual(quality["source_type"], "bvh")
            self.assertEqual(quality["frame_counts"]["skeleton"], 196)
            self.assertTrue((run_dir / "final.vmd").exists())
            self.assertTrue(out_vmd.exists())

    def test_cli_preserve_source_motion_keeps_bvh_unconstrained(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            run_dir = tmp_path / "run_bvh_preserve"
            out_vmd = tmp_path / "selected_bvh_preserve.vmd"

            result = subprocess.run(
                [
                    sys.executable,
                    str(TOOL_PATH),
                    "--action",
                    "thinking_chin_edge",
                    "--model-profile",
                    "eula",
                    "--candidate-bvh",
                    str(SAMPLE_BVH),
                    "--mode",
                    "preserve-source-motion",
                    "--run-dir",
                    str(run_dir),
                    "--out",
                    str(out_vmd),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            selection = json.loads((run_dir / "selection_report.json").read_text(encoding="utf-8"))
            self.assertEqual(selection["mode"], "preserve-source-motion")
            self.assertEqual(selection["selected_candidate_id"], "candidate_001_sample0_repeat0_len196_ik")
            self.assertFalse(selection["selected_blocking"])

            candidate_dir = run_dir / "candidates" / selection["selected_candidate_id"]
            self.assertTrue((candidate_dir / "skeleton.json").exists())
            self.assertTrue((candidate_dir / "bvh_motion.json").exists())
            self.assertTrue((candidate_dir / "draft.vmd").exists())
            self.assertTrue((candidate_dir / "final_candidate.vmd").exists())
            self.assertTrue((candidate_dir / "retarget_fidelity_report.json").exists())
            self.assertFalse((candidate_dir / "final_skeleton.json").exists())

            quality = json.loads((candidate_dir / "quality_report.json").read_text(encoding="utf-8"))
            self.assertEqual(quality["mode"], "preserve-source-motion")
            self.assertEqual(quality["score_type"], "retarget_fidelity")
            self.assertTrue(quality["action_score_skipped"])
            self.assertFalse(quality["constraint_report"]["applied"])
            self.assertFalse(quality["hand_preset_overlay_applied"])
            self.assertEqual(quality["frame_counts"]["skeleton"], 196)
            self.assertEqual(quality["frame_counts"]["draft_bone_frames"], 3920)
            self.assertEqual(quality["frame_counts"]["final_bone_frames"], 3920)
            self.assertEqual(quality["vmd_summary"]["bone_frame_count"], 3920)
            self.assertTrue((run_dir / "final.vmd").exists())
            self.assertTrue(out_vmd.exists())

            fidelity = json.loads((candidate_dir / "retarget_fidelity_report.json").read_text(encoding="utf-8"))
            self.assertEqual(fidelity["mode"], "preserve-source-motion")
            self.assertEqual(fidelity["source_frame_count"], 196)
            self.assertEqual(fidelity["vmd_bone_frame_count"], 3920)
            self.assertIn("pmx_render_fidelity_not_measured", fidelity["limitations"])


if __name__ == "__main__":
    unittest.main()
