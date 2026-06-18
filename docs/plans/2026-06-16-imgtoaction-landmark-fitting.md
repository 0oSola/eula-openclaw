# ImgToAction Landmark Fitting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first engineering loop that compares reference-image landmarks with projected PMX bone landmarks and produces a fitting report for the generated Eula VMD.

**Architecture:** Keep axis calibration and VMD generation separate from fitting. Python owns landmark data, error metrics, and candidate parameter scoring; a small Playwright helper reuses the existing `/mmd-calibration-render` runtime to export model bone screen coordinates.

**Tech Stack:** Python 3.12 standard library, Node/Playwright via the existing `web` dependency, Three.js/MMD runtime already exposed through `window.__mmdCompanionRuntime`.

---

### Task 1: Reference Landmark Config

**Files:**
- Create: `imgToAction/config/reference_landmarks.eula_signature.json`
- Create: `imgToAction/tests/reference-landmarks.test.mjs`

**Steps:**
1. Write a failing Node test that requires `frame_60_front` landmarks with image size and weighted points.
2. Run `node --test imgToAction\tests\reference-landmarks.test.mjs` and verify it fails because the config is missing.
3. Add the JSON config with manually estimated 2D points for core joints.
4. Re-run the test and verify it passes.

### Task 2: Fitting Core

**Files:**
- Create: `imgToAction/tools/fit_pose_nodes.py`
- Create: `imgToAction/tests/test_fit_pose_nodes.py`

**Steps:**
1. Write failing Python tests for landmark error calculation and candidate ranking.
2. Implement pure functions only: load landmarks, compute weighted RMSE, compare candidates, write report.
3. Re-run `python -m unittest imgToAction.tests.test_fit_pose_nodes`.

### Task 3: Runtime Projection Export

**Files:**
- Create: `imgToAction/tools/export-model-landmarks.mjs`

**Steps:**
1. Implement a Playwright helper that loads PMX/VMD in `/mmd-calibration-render`, seeks a frame, reads named bones, projects world positions with the active camera, and writes JSON.
2. Keep it independent of fitting so projection failures are diagnosable.

### Task 4: First Report

**Files:**
- Generate: `imgToAction/outputs/fitting/eula_signature_from_axis_map/model_landmarks.frame_060_front.json`
- Generate: `imgToAction/outputs/fitting/eula_signature_from_axis_map/fitting_report.frame_060_front.json`

**Steps:**
1. Export model landmarks for frame 60 from `outputs/vmd/eula_signature_from_axis_map.vmd`.
2. Run the Python fitter against `reference_landmarks.eula_signature.json`.
3. Inspect the report and record the highest-error landmarks.

### Task 5: Verification

**Commands:**
- `node --test imgToAction\tests\axis-calibration-plan.test.mjs imgToAction\tests\bone-axis-map.test.mjs imgToAction\tests\reference-landmarks.test.mjs`
- `python -m unittest imgToAction.tests.test_pose_to_vmd imgToAction.tests.test_fit_pose_nodes`
- `node --test web\tests\calibration-render-page-source.test.mjs`
- `node --test --test-name-pattern "seekVmdFrame pins|samples VMD bone tracks|calibration capture mode freezes" web\tests\mmd-render-runtime.test.mjs`
- `npm --prefix web run check:basic`
- `npm --prefix web run build`

### Task 6: Similarity-Aligned Scoring

**Files:**
- Update: `imgToAction/tools/fit_pose_nodes.py`
- Update: `imgToAction/tests/test_fit_pose_nodes.py`

**Steps:**
1. Add a failing test proving a 2D similarity transform removes camera scale/translation error.
2. Compute alignment from shared anchors such as `neck`, `pelvis`, `right_ankle`, and `left_ankle`.
3. Include alignment metadata in each fitting report.
4. Re-run the frame 60 report as `fitting_report.frame_060_front.aligned.json`.

### Task 7: First Candidate Fitting Runner

**Files:**
- Create: `imgToAction/tools/run_landmark_fit_step.py`
- Create: `imgToAction/tests/test_landmark_fit_step.py`
- Update: `imgToAction/tools/fit_pose_nodes.py`
- Update: `docs/architecture/current-system-topology.md`

**Steps:**
1. Generate pose parameter candidates without mutating the source pose.
2. Bind each candidate parameter to target landmarks for reporting.
3. Write candidate pose JSON and VMD artifacts.
4. Optionally score each candidate by calling `export-model-landmarks.mjs` and `fit_pose_nodes.py`.
5. Write `fit_step_manifest.json` with ranked `weighted_rmse`, best candidate, projected landmarks, and per-candidate reports.
