# Local Codex Phases 3-5 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the remaining local Codex interactive integration phases: patch worktrees, diff review, approvals, checks, apply, and cleanup.

**Architecture:** FastAPI remains the only browser-facing backend and owns worktree creation, session state, persisted approvals, diff artifacts, check execution, and guarded patch apply. The current deterministic Codex provider stays pluggable; patch-mode sessions run against isolated git worktrees and expose stable UI events and HTTP actions without directly exposing Codex app-server to the browser.

**Tech Stack:** FastAPI, SQLite, subprocess git/check commands, pytest, Next.js/React, TypeScript, Node test runner.

---

### Task 1: Worktree Manager

**Files:**
- Create: `api/app/services/codex_worktree_manager.py`
- Test: `api/tests/test_codex_worktree_manager.py`

**Step 1: Write failing tests**

Add tests for:
- creating a worktree under a configured root with branch prefix;
- rejecting path traversal session ids;
- returning changed files, stat, and patch from a modified worktree;
- blocking apply when the main workspace is dirty;
- applying a worktree patch only after `git apply --check`.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_worktree_manager.py -q`
Expected: fail because the manager module does not exist.

**Step 3: Implement minimal worktree manager**

Use subprocess git commands with explicit argument arrays. Validate resolved paths remain under configured workspace/worktree roots. Implement diff, apply-check/apply, main dirty detection, and discard cleanup.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_worktree_manager.py -q`
Expected: pass.

### Task 2: Store Helpers And Backend Routes

**Files:**
- Modify: `api/app/db/store.py`
- Modify: `api/app/routes/codex_interactive.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_codex_store.py`
- Test: `api/tests/test_codex_interactive_routes.py`

**Step 1: Write failing tests**

Add route/store tests for:
- patch mode session creates a worktree, branch name, and `workspace-write` sandbox;
- `GET /codex/interactive/{session_id}/diff` returns changed files/stat/patch and persists a diff artifact;
- `POST /codex/interactive/{session_id}/approvals/{approval_id}` persists approve/deny decisions and emits a stored event;
- `POST /codex/interactive/{session_id}/checks` stores check artifacts and fails when unresolved approvals exist;
- `POST /codex/interactive/{session_id}/apply` requires `confirm: true`, clean main workspace, no unresolved approvals, and successful `git apply --check`;
- close/discard session removes the worktree when requested.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_store.py api/tests/test_codex_interactive_routes.py -q`
Expected: fail because helpers and routes are missing.

**Step 3: Implement minimal routes**

Wire `CodexWorktreeManager` into app state. Extend session create to support patch mode. Add diff, approval decision, checks, apply, and discard endpoints. Keep default check commands conservative and configurable in code for now: pytest for `api`, Next basic check for `web_basic`.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_store.py api/tests/test_codex_interactive_routes.py -q`
Expected: pass.

### Task 3: Provider Events And Frontend State

**Files:**
- Modify: `api/app/services/codex_interactive_provider.py`
- Modify: `web/src/lib/codexEvents.js`
- Test: `web/tests/codex-console-state.test.mjs`

**Step 1: Write failing tests**

Add reducer tests for:
- `diff_ready` records changed files and artifact id;
- `approval_required` stores approval metadata;
- `approval_decided`, `checks_completed`, and `apply_completed` append visible transcript items;
- `command_output` appends command output.

**Step 2: Run red tests**

Run: `node web/tests/codex-console-state.test.mjs`
Expected: fail because the reducer does not handle all events.

**Step 3: Implement minimal event state**

Extend the deterministic provider to emit patch-mode command/file/diff/approval-style events when requested. Extend reducer state with `mode`, `changedFiles`, `diffArtifactId`, `pendingApprovals`, `checks`, and `applied`.

**Step 4: Run green tests**

Run: `node web/tests/codex-console-state.test.mjs`
Expected: pass.

### Task 4: Frontend API And Console Controls

**Files:**
- Modify: `web/src/lib/codexApi.ts`
- Modify: `web/src/app/companion/CodexConsole.tsx`

**Step 1: Write focused frontend tests**

Use the existing reducer/API surface where practical. Add tests that cover request payload shapes only if the project has a local pattern for testing API helpers; otherwise keep this as typed implementation plus TypeScript verification.

**Step 2: Implement UI controls**

Add compact mode selection, diff loading, checks, apply, approve/deny, and discard actions. Keep the console separated from OpenClaw chat and use existing right-rail card styling.

**Step 3: Verify TypeScript**

Run: `npm --prefix web run check:basic`
Expected: pass.

### Task 5: Architecture Docs And Full Verification

**Files:**
- Modify: `docs/architecture/current-system-topology.md`

**Step 1: Update topology**

Document patch-mode worktrees, diff/check/apply endpoints, approval persistence, cleanup, and runtime-health status.

**Step 2: Full verification**

Run:
- `pytest api/tests/test_codex_worktree_manager.py api/tests/test_codex_store.py api/tests/test_codex_interactive_routes.py api/tests/test_codex_interactive_config.py api/tests/test_runtime_health.py -q`
- `pytest api/tests -q`
- `node web/tests/codex-console-state.test.mjs`
- `npm --prefix web run check:basic`
- `npm --prefix web run build`

**Step 3: Commit and push**

Commit the completed phases and push the resulting commit to `codex/local-interactive-integration`.
