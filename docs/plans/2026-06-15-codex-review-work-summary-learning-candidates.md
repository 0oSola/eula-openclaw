# Codex Review Work Summary And Learning Candidates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the FastAPI -> OpenClaw Codex review snapshot so OpenClaw can summarize project work and propose reusable learning candidates, not only show a draft review queue.

**Architecture:** Keep `codex_review_daily_snapshot` backward compatible by retaining `summary`, `drafts`, and `cursor`, then add derived `work_units` and `learning_candidates` fields. Derive both from existing `desktop_pet_sessions` and `codex_review_items`; do not add tables in this first slice.

**Tech Stack:** FastAPI/Python services, SQLite-backed `TraceStore`, pytest, Markdown architecture docs.

---

### Task 1: Add Snapshot Contract Tests

**Files:**
- Modify: `api/tests/test_openclaw_control_plane_sync.py`

**Steps:**
1. Add a test that seeds a desktop-pet session with review items and asserts `build_codex_review_daily_snapshot()` includes `work_units`.
2. Add a test that seeds pitfall/decision/followup/blocker review items and asserts `learning_candidates` includes normalized problem/lesson fields.
3. Run: `pytest api/tests/test_openclaw_control_plane_sync.py -q`
4. Expected before implementation: new tests fail because fields are missing.

### Task 2: Implement Derived Snapshot Fields

**Files:**
- Modify: `api/app/services/openclaw_control_plane.py`

**Steps:**
1. Add compact helpers that group draft review items by `pet_session_id`.
2. Build `work_units` from each related `desktop_pet_sessions` row plus item counts and top item titles.
3. Build `learning_candidates` from review items with `item_type` in `pitfall`, `decision`, `followup`, `blocker`, and `work_summary`.
4. Keep all text bounded and derive from already-saved `details`, `summary`, tags, severity, and evidence refs.
5. Run: `pytest api/tests/test_openclaw_control_plane_sync.py -q`

### Task 3: Document Runtime Contract

**Files:**
- Modify: `docs/architecture/current-system-topology.md`

**Steps:**
1. Update the Codex Review Sync section to describe `work_units` and `learning_candidates`.
2. State that these are derived snapshot fields and not long-term memory until accepted.
3. Run the focused test set and a current SQLite snapshot sample.

### Task 4: Add Daily Rollup

**Files:**
- Modify: `api/app/services/openclaw_control_plane.py`
- Modify: `api/tests/test_openclaw_control_plane_sync.py`
- Modify: `docs/architecture/current-system-topology.md`

**Steps:**
1. Add a failing test that expects a `rollup` object in the snapshot.
2. Implement `rollup` from already-derived `work_units` and `learning_candidates`.
3. Include work unit count, status counts, review item counts, learning candidate counts, high-priority candidate count, top tags, changed files, failed command count, and successful check count.
4. Verify: `pytest api/tests/test_openclaw_control_plane_sync.py -q`.
