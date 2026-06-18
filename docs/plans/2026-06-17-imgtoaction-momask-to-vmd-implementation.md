# ImgToAction MoMask-to-VMD Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI-first `thinking_chin_edge` pipeline that converts existing MoMask `.npy` joint output into an Eula-compatible VMD draft with contact constraints, hand presets, quality scoring, and candidate selection.

**Architecture:** Keep MoMask generation, skeleton import, PMX retargeting, constraints, and scoring as separate modules. Version 1 accepts existing MoMask `.npy` files from an external environment, converts them to a project-owned `skeleton.json`, then writes VMD output through a reusable VMD writer. The first action is configured by recipe instead of hard-coded into the top-level CLI.

**Tech Stack:** Python 3.12, `numpy` for `.npy` import, existing `imgToAction/tools/pose_to_vmd.py` VMD writer patterns, existing `unittest` tests under `imgToAction/tests`, optional Node tests for JSON config validation.

---

## Preconditions

- Do not install or invoke MoMask in the first implementation pass.
- Use existing `.npy` files produced by the user's external MoMask environment.
- Keep all generated outputs under `imgToAction/outputs/actions/`.
- Keep the first implementation scoped to `thinking_chin_edge` and Eula.
- If runtime behavior is added beyond local docs/tests, update `docs/architecture/current-system-topology.md`.

---

### Task 1: Action Recipe and Model Profile Configs

**Files:**
- Create: `imgToAction/actions/thinking_chin_edge.json`
- Create: `imgToAction/config/model_profile.eula.json`
- Create: `imgToAction/tests/action-configs.test.mjs`

**Step 1: Write the failing config test**

Add a Node test that loads the action recipe and Eula profile.

Assertions:
- `thinking_chin_edge.json` has `id = "thinking_chin_edge"`.
- `generator = "momask"`.
- `contacts` includes `right_wrist_to_chin_edge`.
- `hand_presets.right = "thinking_relaxed"`.
- `model_profile.eula.json` defines `contacts.right_wrist_to_chin_edge`.
- The contact has `target_bone`, `effector_bone`, `chain`, `target_offset`, and `phase`.

**Step 2: Run the test and verify it fails**

```powershell
node --test imgToAction\tests\action-configs.test.mjs
```

Expected: fails because the files do not exist.

**Step 3: Add minimal configs**

Add the action recipe with:

```json
{
  "id": "thinking_chin_edge",
  "generator": "momask",
  "duration_seconds": 3,
  "motion_type": "stationary_upper_body",
  "momask_prompt": "A person stands still and slowly raises the right hand toward the chin in a thoughtful gesture.",
  "lower_body_policy": "stable_stance",
  "contacts": ["right_wrist_to_chin_edge"],
  "hand_presets": {
    "right": "thinking_relaxed",
    "left": "soft_rest"
  },
  "quality_checks": [
    "right_wrist_near_chin_edge",
    "right_elbow_naturalness",
    "head_chin_down",
    "left_arm_support",
    "feet_stable",
    "smoothness"
  ]
}
```

Use Japanese PMX bone names in `model_profile.eula.json`, but keep semantic IDs ASCII:

```json
{
  "id": "eula",
  "contacts": {
    "right_wrist_to_chin_edge": {
      "target_bone": "頭",
      "target_space": "bone_local",
      "target_offset": [0.035, -0.115, 0.045],
      "effector_bone": "右手首",
      "chain": ["右腕", "右ひじ", "右手首"],
      "phase": {
        "start": 0.35,
        "full": 0.7,
        "end": 1.0
      }
    }
  }
}
```

**Step 4: Re-run the test**

```powershell
node --test imgToAction\tests\action-configs.test.mjs
```

Expected: passes.

---

### Task 2: Internal Skeleton Data Model

**Files:**
- Create: `imgToAction/tools/skeleton_motion.py`
- Create: `imgToAction/tests/test_skeleton_motion.py`

**Step 1: Write failing tests**

Tests should cover:
- Normalizing a raw frame into named joints.
- Rejecting frames with missing required joints.
- Writing and reading `skeleton.json`.
- Computing duration from `fps` and frame count.

Use a tiny synthetic skeleton:

```python
frames = [
    {
        "pelvis": [0.0, 0.0, 0.0],
        "neck": [0.0, 1.0, 0.0],
        "head": [0.0, 1.2, 0.0],
        "right_shoulder": [0.2, 0.9, 0.0],
        "right_elbow": [0.4, 0.7, 0.0],
        "right_wrist": [0.5, 0.5, 0.0],
        "left_shoulder": [-0.2, 0.9, 0.0],
        "left_elbow": [-0.4, 0.7, 0.0],
        "left_wrist": [-0.5, 0.5, 0.0],
        "right_hip": [0.1, -0.1, 0.0],
        "right_knee": [0.1, -0.6, 0.0],
        "right_ankle": [0.1, -1.0, 0.0],
        "left_hip": [-0.1, -0.1, 0.0],
        "left_knee": [-0.1, -0.6, 0.0],
        "left_ankle": [-0.1, -1.0, 0.0]
    }
]
```

**Step 2: Run the tests and verify failure**

```powershell
pytest imgToAction\tests\test_skeleton_motion.py
```

Expected: import failure or missing functions.

**Step 3: Implement `skeleton_motion.py`**

Implement:
- `REQUIRED_JOINTS`
- `validate_skeleton(payload)`
- `write_skeleton(path, payload)`
- `read_skeleton(path)`
- `duration_seconds(payload)`
- small vector helpers used by later tasks: `sub`, `add`, `mul`, `length`, `normalize`, `dot`, `angle_degrees`

Do not add retargeting here.

**Step 4: Re-run tests**

```powershell
pytest imgToAction\tests\test_skeleton_motion.py
```

Expected: passes.

---

### Task 3: MoMask `.npy` Importer

**Files:**
- Create: `imgToAction/tools/import_momask_joints.py`
- Create: `imgToAction/tests/test_import_momask_joints.py`

**Step 1: Write failing tests**

Create a temporary `.npy` using `numpy.save` with shape `(2, 22, 3)`.

Assert:
- The importer maps MoMask joint index names to internal names.
- Output `fps` defaults to `20`.
- Output contains `source.type = "momask"`.
- Missing or wrong shape raises a clear `ValueError`.

**Step 2: Run the tests and verify failure**

```powershell
pytest imgToAction\tests\test_import_momask_joints.py
```

Expected: fails because importer is missing.

**Step 3: Implement importer**

Implement:
- `MOMASK_JOINT_NAMES`
- `load_momask_npy(path)`
- `momask_to_skeleton(joints, fps=20)`
- CLI:

```powershell
python imgToAction/tools/import_momask_joints.py `
  --input path/to/momask_joints.npy `
  --out imgToAction/outputs/actions/thinking_chin_edge/run_001/candidates/seed_001/skeleton.json
```

If the exact MoMask 22-joint order differs after testing with real output, adjust `MOMASK_JOINT_NAMES` in this module only.

**Step 4: Re-run tests**

```powershell
pytest imgToAction\tests\test_import_momask_joints.py
```

Expected: passes.

---

### Task 4: VMD IO Shared Module

**Files:**
- Create: `imgToAction/tools/vmd_io.py`
- Modify: `imgToAction/tools/pose_to_vmd.py`
- Create: `imgToAction/tests/test_vmd_io.py`
- Modify: `imgToAction/tests/test_pose_to_vmd.py`

**Step 1: Write failing VMD IO tests**

Cover:
- `BoneFrame` dataclass can be imported from `vmd_io`.
- `write_vmd` writes a valid VMD header and bone frame count.
- `read_vmd_summary(path)` returns `bone_frame_count`, `max_frame`, and unique bone names.

**Step 2: Run the tests and verify failure**

```powershell
pytest imgToAction\tests\test_vmd_io.py
```

Expected: fails because module is missing.

**Step 3: Extract shared writer**

Move or duplicate the current `BoneFrame`, `_encode_fixed_text`, `_default_interpolation`, and `write_vmd` logic from `pose_to_vmd.py` into `vmd_io.py`.

Update `pose_to_vmd.py` to import:

```python
from vmd_io import BoneFrame, write_vmd
```

Keep script execution working when called directly from the repo root. If needed, add the tool directory to `sys.path` locally.

**Step 4: Re-run affected tests**

```powershell
pytest imgToAction\tests\test_vmd_io.py imgToAction\tests\test_pose_to_vmd.py
```

Expected: passes.

---

### Task 5: Minimal Skeleton-to-VMD Retarget

**Files:**
- Create: `imgToAction/tools/retarget_skeleton_to_vmd.py`
- Create: `imgToAction/tests/test_retarget_skeleton_to_vmd.py`

**Step 1: Write failing tests**

Use a synthetic two-frame skeleton.

Assert:
- `retarget_skeleton_to_bone_frames` returns nonzero `BoneFrame` items.
- VMD frames are resampled from source `fps` to 30fps with `round(source_frame * 30 / source_fps)`.
- Output contains core bones such as center, upper body, head, right arm, right elbow, and right wrist.
- Quaternion outputs are normalized.

Use aliases in tests where possible to avoid brittle display issues:

```python
CORE_BONE_ALIASES = {
    "center": "センター",
    "upper_body": "上半身",
    "head": "頭",
    "right_arm": "右腕",
    "right_elbow": "右ひじ",
    "right_wrist": "右手首"
}
```

**Step 2: Run tests and verify failure**

```powershell
pytest imgToAction\tests\test_retarget_skeleton_to_vmd.py
```

Expected: fails because retarget module is missing.

**Step 3: Implement minimal retarget**

Implement:
- Quaternion helpers.
- `quat_between(source_dir, target_dir)`.
- `rotation_for_bone(parent_joint, child_joint, target_rest_axis)`.
- `retarget_skeleton_to_bone_frames(skeleton, model_profile, action_recipe)`.
- CLI:

```powershell
python imgToAction/tools/retarget_skeleton_to_vmd.py `
  --skeleton imgToAction/outputs/actions/thinking_chin_edge/run_001/candidates/seed_001/skeleton.json `
  --model-profile imgToAction/config/model_profile.eula.json `
  --out imgToAction/outputs/actions/thinking_chin_edge/run_001/candidates/seed_001/draft.vmd
```

For v1, use conservative rest axes and document that exact PMX rest-pose extraction is a later improvement.

**Step 4: Re-run tests**

```powershell
pytest imgToAction\tests\test_retarget_skeleton_to_vmd.py
```

Expected: passes.

---

### Task 6: Right Wrist Chin-Edge Contact Constraint

**Files:**
- Create: `imgToAction/tools/action_constraints.py`
- Create: `imgToAction/tests/test_action_constraints.py`
- Modify: `imgToAction/tools/retarget_skeleton_to_vmd.py`

**Step 1: Write failing tests**

Use a synthetic right arm:

```text
right_shoulder -> right_elbow -> right_wrist
```

Assert:
- `contact_weight(progress)` is `0` before phase start, blends between start/full, and is `1` after full.
- `solve_two_bone_ik` returns a wrist closer to target than the original wrist.
- Unreachable target returns a warning or violation instead of producing NaN.
- Elbow angle remains within a configured range.

**Step 2: Run tests and verify failure**

```powershell
pytest imgToAction\tests\test_action_constraints.py
```

Expected: fails because constraint module is missing.

**Step 3: Implement constraints**

Implement:
- `contact_weight(frame_index, frame_count, phase)`
- `solve_two_bone_ik(shoulder, elbow, wrist, target, pole_hint)`
- `apply_right_wrist_to_chin_edge(skeleton, model_profile, action_recipe)`
- violation structure:

```python
{
    "code": "right_wrist_contact_unreachable",
    "severity": "blocking",
    "frame": 42,
    "detail": "target distance exceeds arm reach"
}
```

In v1, the chin target can be approximated in normalized skeleton space for scoring and IK. Exact PMX head-bone-space conversion can be refined after render validation.

**Step 4: Wire into retarget CLI**

Add optional flag:

```powershell
--apply-constraints
```

When set, constraints modify the skeleton before VMD bone frames are emitted.

**Step 5: Re-run tests**

```powershell
pytest imgToAction\tests\test_action_constraints.py imgToAction\tests\test_retarget_skeleton_to_vmd.py
```

Expected: passes.

---

### Task 7: Hand Preset Overlay

**Files:**
- Create: `imgToAction/config/hand_presets.json`
- Create: `imgToAction/tools/hand_presets.py`
- Create: `imgToAction/tests/test_hand_presets.py`
- Modify: `imgToAction/tools/retarget_skeleton_to_vmd.py`

**Step 1: Write failing tests**

Assert:
- `thinking_relaxed` and `soft_rest` exist.
- Applying presets adds finger `BoneFrame` entries at start and final frames.
- Finger rotations are normalized quaternions.
- Unknown preset raises `KeyError` with preset name.

**Step 2: Run tests and verify failure**

```powershell
pytest imgToAction\tests\test_hand_presets.py
```

Expected: fails because config/module is missing.

**Step 3: Add minimal presets**

Add conservative finger rotations for:

```text
neutral_relaxed
thinking_relaxed
soft_rest
```

Do not attempt fine hand animation in v1. Use static keyframes and let later render validation tune angles.

**Step 4: Wire overlay**

Add:

```python
apply_hand_presets(frames, action_recipe, preset_config, frame_numbers)
```

Call it after retarget and contact constraints.

**Step 5: Re-run tests**

```powershell
pytest imgToAction\tests\test_hand_presets.py imgToAction\tests\test_retarget_skeleton_to_vmd.py
```

Expected: passes.

---

### Task 8: Reference Target Builder

**Files:**
- Create: `imgToAction/tools/build_reference_targets.py`
- Create: `imgToAction/tests/test_build_reference_targets.py`

**Step 1: Write failing tests**

Use a small in-memory reference landmark config with front/side/45 frames.

Assert:
- Normalization uses pelvis as origin and `neck-pelvis` distance as scale.
- Front contributes x/y.
- Side contributes z/y.
- 45-degree view can mark a joint as uncertain when inconsistent.
- Output includes `frames["60"].right_wrist.near = "chin_edge"`.

**Step 2: Run tests and verify failure**

```powershell
pytest imgToAction\tests\test_build_reference_targets.py
```

Expected: fails because module is missing.

**Step 3: Implement builder**

Implement:
- `normalize_view_landmarks(frame)`
- `fuse_keyframe_views(front, side, view45)`
- `build_thinking_chin_edge_targets(reference_config)`
- CLI:

```powershell
python imgToAction/tools/build_reference_targets.py `
  --landmarks imgToAction/config/reference_landmarks.eula_thinking.json `
  --action thinking_chin_edge `
  --model-profile imgToAction/config/model_profile.eula.json `
  --out imgToAction/config/reference_targets.thinking_chin_edge.json
```

**Step 4: Re-run tests**

```powershell
pytest imgToAction\tests\test_build_reference_targets.py
```

Expected: passes.

---

### Task 9: Quality Scoring

**Files:**
- Create: `imgToAction/tools/quality_scoring.py`
- Create: `imgToAction/tests/test_quality_scoring.py`

**Step 1: Write failing tests**

Create synthetic skeletons for:
- Good thinking pose: wrist near chin target, elbow natural, stable feet.
- Bad pose: wrist far from target.
- Blocking pose: NaN joint or unreachable contact.

Assert:
- Good pose score is at least 75.
- Bad pose score is lower.
- Blocking violations are listed with `severity = "blocking"`.
- Report includes component scores.

**Step 2: Run tests and verify failure**

```powershell
pytest imgToAction\tests\test_quality_scoring.py
```

Expected: fails because module is missing.

**Step 3: Implement scoring**

Implement component scoring:
- `contact_score`
- `elbow_score`
- `head_score`
- `left_arm_support_score`
- `stable_stance_score`
- `smoothness_score`
- `hand_preset_score`
- `violation_penalty`

Return:

```python
{
    "score": 82.4,
    "components": {...},
    "violations": [],
    "warnings": []
}
```

**Step 4: Re-run tests**

```powershell
pytest imgToAction\tests\test_quality_scoring.py
```

Expected: passes.

---

### Task 10: End-to-End CLI Orchestrator

**Files:**
- Create: `imgToAction/tools/generate_action_vmd.py`
- Create: `imgToAction/tests/test_generate_action_vmd.py`

**Step 1: Write failing tests**

Use temporary candidate folders with synthetic `.npy` files.

Assert:
- CLI loads the action recipe and model profile.
- Each candidate produces `skeleton.json`, `draft.vmd`, `final_candidate.vmd`, and `quality_report.json`.
- `selection_report.json` selects the highest non-blocking score.
- `final.vmd` and `--out` exist.

**Step 2: Run tests and verify failure**

```powershell
pytest imgToAction\tests\test_generate_action_vmd.py
```

Expected: fails because CLI is missing.

**Step 3: Implement orchestrator**

CLI should support:

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-npy path/to/seed_001.npy `
  --candidate-npy path/to/seed_002.npy `
  --out imgToAction/outputs/vmd/eula_thinking_chin_edge.vmd
```

Do not require MoMask command invocation yet.

**Step 4: Re-run test**

```powershell
pytest imgToAction\tests\test_generate_action_vmd.py
```

Expected: passes.

---

### Task 11: Documentation and Architecture Update

**Files:**
- Modify: `imgToAction/README.md`
- Modify: `docs/architecture/current-system-topology.md`

**Step 1: Update README**

Add:
- Expected MoMask prompt.
- Offline `.npy` import workflow.
- End-to-end CLI example.
- Output directory layout.
- Current limitations.

**Step 2: Update topology**

Add a short `imgToAction` section stating:
- Optional MediaPipe reference landmark extraction already exists.
- New local text-to-motion/VMD path accepts external MoMask `.npy` outputs.
- MoMask is not invoked by the main FastAPI or web runtime in v1.
- Generated artifacts remain local under `imgToAction/outputs`.

**Step 3: Check docs**

Run:

```powershell
git diff -- docs\plans\2026-06-17-imgtoaction-momask-to-vmd-design.md docs\plans\2026-06-17-imgtoaction-momask-to-vmd-implementation.md imgToAction\README.md docs\architecture\current-system-topology.md
```

Expected: only intended docs changes appear.

---

### Task 12: Verification

**Commands:**

```powershell
pytest imgToAction\tests
```

```powershell
node --test imgToAction\tests\*.test.mjs
```

Smoke command with real MoMask output:

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --model-profile eula `
  --candidate-npy path\to\momask_seed_001.npy `
  --out imgToAction/outputs/vmd/eula_thinking_chin_edge.vmd
```

Expected:
- `final.vmd` exists.
- VMD bone frame count is greater than zero.
- `selection_report.json` exists.
- Selected candidate has no blocking violations.

Optional render validation:

```powershell
npm --prefix web run dev
```

Then use the existing MMD render/debug route or current render helper to inspect whether the right wrist approaches the chin edge without obvious arm breakage.

---

## Completion Criteria

- `thinking_chin_edge` action recipe exists and validates.
- Existing MoMask `.npy` files can be imported into `skeleton.json`.
- A non-empty VMD can be generated from at least one candidate.
- Right wrist contact constraint is applied.
- Hand presets write finger keyframes.
- Quality scoring selects the best non-blocking candidate.
- README and topology docs describe the new local pipeline.
