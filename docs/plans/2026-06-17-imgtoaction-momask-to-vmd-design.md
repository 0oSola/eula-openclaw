# ImgToAction MoMask-to-VMD Design

**Goal:** Build a local CLI-first pipeline that turns an explicit action id into an Eula-compatible VMD by using MoMask as a text-to-motion draft generator, then applying project-owned PMX retargeting, contact constraints, hand presets, and quality scoring.

**First target action:** `thinking_chin_edge`.

**Quality target:** A usable MMD motion draft that approaches the semantic level of the existing `03_thinking_waiting/思考1.vmd` collection item for the narrow case of a standing upper-body thinking gesture. The first version should aim for a 70-80 score; with multi-seed selection and contact IK, 75-85 is the practical target.

---

## Direction

The pipeline should not ask MoMask to satisfy precise bone constraints. MoMask should only generate a natural human motion draft from a short natural-language prompt. `imgToAction` owns the exact motion requirements after generation.

```text
action_id + style
  -> action recipe
  -> MoMask prompt
  -> MoMask joints .npy
  -> internal skeleton.json
  -> Eula PMX retarget
  -> right wrist chin-edge contact IK
  -> hand preset overlay
  -> quality scoring and candidate selection
  -> final VMD
```

The first version is CLI-only and does not integrate with the web UI or asset ingestion APIs.

---

## Non-Goals

- Do not use generated video as the primary motion source.
- Do not use MediaPipe/OpenPose as a motion generator.
- Do not rely on screenshot pixel matching as the core scoring method.
- Do not promise fingers, facial expression, cloth, or hair motion from MoMask.
- Do not support automatic natural-language action classification in v1.
- Do not support multiple target PMX profiles in v1; only Eula is in scope.

---

## CLI Shape

```powershell
python imgToAction/tools/generate_action_vmd.py `
  --action thinking_chin_edge `
  --style "composed, noble, mature, restrained" `
  --model-profile eula `
  --candidates 16 `
  --out imgToAction/outputs/vmd/eula_thinking_chin_edge.vmd
```

`--action` is the stable action contract. `--style` can be appended to the MoMask prompt, but it must not change the hard constraints or retarget rules.

---

## Action Recipe

Action behavior is configured, not hard-coded. The first recipe should live at:

```text
imgToAction/actions/thinking_chin_edge.json
```

Example shape:

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

Future actions should be added as new recipes, for example `wave_soft`, `listen_lean`, or `arms_cross`, while reusing the same source adapter and retarget stack.

---

## Reference Targets

Reference images are used to create structured targets for scoring and constraints. They are not passed to MoMask.

Existing images:

```text
frame_00_front / frame_00_side / frame_00_45
frame_30_front / frame_30_side / frame_30_45
frame_60_front / frame_60_side / frame_60_45
```

The reference target builder should consume the existing MediaPipe landmark config:

```text
imgToAction/config/reference_landmarks.eula_thinking.json
```

and write:

```text
imgToAction/config/reference_targets.thinking_chin_edge.json
```

The conversion is intentionally weak 3D:

```text
front view -> x/y
side view  -> z/y
45 view    -> consistency check
```

Coordinates are normalized per image:

```text
origin = pelvis
scale = distance(neck, pelvis)
x = (pixel_x - pelvis_x) / scale
y = -(pixel_y - pelvis_y) / scale
```

The output should be semantic, not a precise reconstructed skeleton:

```json
{
  "action": "thinking_chin_edge",
  "frames": {
    "0": {
      "right_wrist": { "phase": "relaxed", "contact_weight": 0.0 },
      "head": { "chin_down_degrees": [0, 5] }
    },
    "30": {
      "right_wrist": { "toward": "chin_edge", "progress": [0.4, 0.7] },
      "right_elbow": { "bend_degrees": [45, 95] }
    },
    "60": {
      "right_wrist": { "near": "chin_edge", "distance_cm": [2, 5] },
      "right_elbow": { "bend_degrees": [70, 120] },
      "head": { "chin_down_degrees": [5, 15] },
      "left_wrist": { "region": "waist_or_lower_chest" }
    }
  }
}
```

Low-confidence anime landmarks should reduce scoring weight rather than become hard failures.

---

## MoMask Adapter

MoMask is treated as an external generator. The adapter should support two modes:

1. Reuse an existing MoMask `.npy` output.
2. Later, invoke a configured local MoMask command.

The first implementation can start with existing `.npy` files produced in the user's separate MoMask environment. This avoids coupling the retarget work to MoMask installation.

MoMask prompts should stay short. Recommended prompt for the first action:

```text
A person stands still in an elegant composed posture, slowly raises the right hand toward the chin, lightly rests the hand near the chin in a thoughtful gesture, while the other arm settles calmly near the waist. The head tilts slightly downward, the body remains stable and restrained, graceful and mature.
```

Short fallback:

```text
A person stands still and slowly raises the right hand to the chin in a thoughtful pose, with the other hand resting near the waist.
```

Each generated candidate should be converted to:

```text
imgToAction/outputs/actions/thinking_chin_edge/run_001/candidates/seed_001/skeleton.json
```

The internal skeleton format should include `fps`, source metadata, and per-frame named joints.

---

## Retarget

The project needs a new frame-by-frame skeleton retarget path. Existing `pose_to_vmd.py` writes VMD from a semantic pose DSL, but it does not solve arbitrary MoMask skeleton frames.

Retargeting should map source joint directions to PMX bone rotations:

```text
source joint direction
  -> target PMX rest direction
  -> quaternion delta
  -> local bone rotation
  -> VMD bone frame
```

Core v1 bones:

```text
センター
下半身
上半身
上半身2
首
頭
右肩 / 右腕 / 右ひじ / 右手首
左肩 / 左腕 / 左ひじ / 左手首
右足 / 右ひざ / 右足首
左足 / 左ひざ / 左足首
```

The lower body policy for `thinking_chin_edge` is `stable_stance`: keep feet stable and only allow small center or torso shifts.

---

## Eula Model Profile

Model-specific offsets and constraints should live in:

```text
imgToAction/config/model_profile.eula.json
```

The first required contact target:

```json
{
  "contacts": {
    "right_wrist_to_chin_edge": {
      "target_bone": "頭",
      "target_space": "bone_local",
      "target_offset": [0.035, -0.115, 0.045],
      "effector_bone": "右手首",
      "chain": ["右腕", "右ひじ", "右手首"],
      "phase": {
        "start": 0.35,
        "full": 0.70,
        "end": 1.00
      }
    }
  }
}
```

The offset should be tuned by render inspection. The target is the chin edge, not the mouth center. The solver should keep a small visual gap rather than forcing exact contact.

---

## IK and Constraints

For the thinking action, the right wrist contact is solved after the initial retarget:

```text
0%-35%    preserve MoMask
35%-70%   blend IK weight from 0 to 1
70%-100%  hold wrist near chin edge
```

The right arm uses a two-bone IK solve:

```text
shoulder -> elbow -> wrist
```

The solver should prefer natural-looking results over exact contact:

- Allow 2-5 cm wrist-to-chin-edge visual distance.
- Reject or penalize unreachable targets.
- Keep the elbow outside the torso silhouette.
- Clamp shoulder, elbow, and wrist rotations.
- Prevent wrist/head penetration.

---

## Hand Presets

MoMask does not generate MMD finger detail. Finger motion should be added by preset overlay.

Initial presets:

```text
neutral_relaxed
thinking_relaxed
soft_rest
open_wave
soft_fist
```

For `thinking_chin_edge`:

```text
right = thinking_relaxed
left = soft_rest
```

Presets should write finger bone keyframes into the final VMD. They should be reusable across actions.

---

## Quality Gate

Every candidate should produce a `quality_report.json`. Blocking failures should prevent a candidate from becoming `final.vmd`.

Blocking checks:

- Missing required joints.
- NaN or Inf coordinates.
- Too few frames.
- Unreachable right wrist contact.
- Severe elbow or knee hyperextension.
- Severe shoulder or wrist over-rotation.
- Wrist/head penetration.
- Invalid VMD header or missing bone frames.

Warnings:

- Wrist near, but outside preferred 2-5 cm range.
- Mild foot drift.
- Weak head tilt.
- Left arm does not read as waist/lower-chest support.
- Low detector confidence in reference targets.

---

## Scoring

Candidate scoring should be structural:

```text
total_score =
  contact_score
+ elbow_score
+ head_score
+ left_arm_support_score
+ stable_stance_score
+ smoothness_score
+ hand_preset_score
- violation_penalty
```

The first practical threshold:

```text
selected candidate score >= 75
no blocking violations
```

Selection report shape:

```json
{
  "action": "thinking_chin_edge",
  "selected_seed": 7,
  "selected_score": 82.4,
  "rejected": [
    { "seed": 1, "score": 54.2, "reason": "right_wrist_far_from_chin" },
    { "seed": 2, "score": 0, "reason": "elbow_hyperextended" }
  ]
}
```

---

## Output Layout

```text
imgToAction/outputs/actions/thinking_chin_edge/run_001/
  candidates/
    seed_001/
      momask_joints.npy
      skeleton.json
      draft.vmd
      final_candidate.vmd
      quality_report.json
    seed_002/
      ...
  reference_targets.json
  selection_report.json
  final.vmd
```

The final CLI `--out` path should copy or write the selected VMD there:

```text
imgToAction/outputs/vmd/eula_thinking_chin_edge.vmd
```

---

## Implementation Phases

### Phase 1: Offline Retarget Harness

Accept an existing MoMask `.npy` file and convert it to `skeleton.json`. Do not invoke MoMask yet.

### Phase 2: Minimal VMD Retarget

Map core body and arm bones to Eula PMX and write a draft VMD.

### Phase 3: Thinking Contact

Add `right_wrist_to_chin_edge` target, two-bone IK, elbow pole preference, and contact phase blending.

### Phase 4: Hand Presets

Add `thinking_relaxed` and `soft_rest` finger overlays.

### Phase 5: Quality Reports and Selection

Score multiple candidate folders, reject invalid outputs, and select `final.vmd`.

### Phase 6: Optional MoMask Invocation

Add a configurable local MoMask command once the retarget path works with existing `.npy` files.

---

## Risks

- The hardest part is PMX retargeting, not MoMask generation.
- MoMask output may not raise the right hand close enough; contact IK is required.
- Twist and wrist orientation are underconstrained from joint positions alone.
- Anime reference landmarks are noisy; they should guide scoring, not serve as hard truth.
- Existing high-quality VMD files include style, rhythm, hand detail, and sometimes morphs. The generated v1 pipeline will produce useful drafts, not full handcrafted animation quality.

---

## Validation

Minimum validation before calling v1 usable:

- Unit tests for VMD parsing/writing, skeleton conversion, and quality scoring.
- A smoke command using one existing MoMask `.npy` sample.
- `final.vmd` has nonzero bone frames and loads in the MMD runtime.
- Quality report shows no blocking violations.
- Render inspection confirms the right wrist approaches the chin edge without obvious non-human arm bending.
