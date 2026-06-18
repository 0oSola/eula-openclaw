# ImgToAction MediaPipe Reference Landmarks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a batch image landmark extraction entry point for `output/imagegen/eula-thinking-gesture` so MediaPipe can seed `imgToAction` reference landmark JSON.

**Architecture:** Keep MediaPipe as an optional extraction front end. The new Python tool converts per-image MediaPipe pose results into the existing `reference_landmarks` shape, writes raw detector output separately, and leaves VMD generation/fitting to existing `pose_to_vmd.py`, `export-model-landmarks.mjs`, and `fit_pose_nodes.py`.

**Tech Stack:** Python 3.12 standard library for conversion and JSON, optional `mediapipe` Tasks API for detection, existing `unittest` tests under `imgToAction/tests`.

---

### Task 1: Conversion Core

**Files:**
- Create: `imgToAction/tools/extract_mediapipe_landmarks.py`
- Create: `imgToAction/tests/test_extract_mediapipe_landmarks.py`

**Steps:**
1. Write failing tests for image discovery and MediaPipe landmark conversion.
2. Implement filename parsing, PNG size reading, MediaPipe index mapping, confidence tagging, and reference JSON assembly.
3. Run `pytest imgToAction/tests/test_extract_mediapipe_landmarks.py`.

### Task 2: Batch CLI

**Files:**
- Modify: `imgToAction/tools/extract_mediapipe_landmarks.py`

**Steps:**
1. Add CLI arguments for `--input`, `--out`, `--raw-out`, `--model-asset`, `--min-confidence`, and `--from-raw`.
2. Keep `mediapipe` import lazy so tests and raw conversion do not require the package.
3. Emit clear installation/model-asset errors when live detection cannot run.

### Task 3: Documentation

**Files:**
- Modify: `imgToAction/README.md`
- Modify: `docs/architecture/current-system-topology.md`

**Steps:**
1. Document the MediaPipe batch extraction command and output paths.
2. Update system topology to state that `imgToAction` now has an optional MediaPipe reference landmark extraction stage.

### Task 4: Verification

**Commands:**
- `pytest imgToAction/tests/test_extract_mediapipe_landmarks.py`
- `pytest imgToAction/tests`
- `node --test imgToAction/tests/*.test.mjs`
