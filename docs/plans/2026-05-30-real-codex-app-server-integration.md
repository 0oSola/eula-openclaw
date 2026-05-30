# Real Codex App Server Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the deterministic local Codex provider with a real `codex app-server --listen stdio://` adapter while preserving the existing FastAPI/UI/worktree safety shell.

**Architecture:** FastAPI remains the browser boundary. A new `CodexAppServerClient` owns one stdio JSON-RPC app-server process per interactive session, maps app-server notifications/server requests into stable UI events, and exposes approval response methods. `CodexInteractiveProvider` becomes the orchestration layer that starts threads in the right cwd/sandbox and streams normalized events into the existing WebSocket route.

**Tech Stack:** FastAPI, asyncio subprocess stdio, JSON-RPC JSONL, SQLite, pytest, Next.js/React.

---

### Task 1: JSON-RPC App Server Client

**Files:**
- Create: `api/app/services/codex_app_server_client.py`
- Test: `api/tests/test_codex_app_server_client.py`

**Step 1: Write failing tests**

Add tests for:
- response id matching resolves the right request future;
- notifications are queued as normalized events;
- command/file approval server requests create approval events and can be answered with app-server decisions;
- unknown server requests are rejected instead of hanging;
- env whitelist excludes sensitive OpenClaw/TTS/database variables and keeps `PATH`, `HOME`, `CODEX_HOME`, `NO_COLOR`.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_app_server_client.py -q`
Expected: fail because the client module does not exist.

**Step 3: Implement minimal client**

Implement JSON line request/response handling, stdio process startup, reader task, notification queue, pending approval map, approval response writer, process close, and safe env building. Pin methods from generated schema: `initialize`, `thread/start`, `turn/start`, `turn/interrupt`, `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, legacy `execCommandApproval`, legacy `applyPatchApproval`.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_app_server_client.py -q`
Expected: pass.

### Task 2: Real Provider Orchestration

**Files:**
- Modify: `api/app/services/codex_interactive_provider.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_codex_interactive_provider.py`

**Step 1: Write failing tests**

Add tests using a fake app-server client factory for:
- preparing a read-only session starts a thread in the base workspace with `read-only` sandbox;
- preparing a patch session starts a thread in the worktree with `workspace-write` sandbox;
- streaming a turn sends `turn/start`, maps completion, and preserves one thread id across multiple turns;
- cancelling a turn sends `turn/interrupt`;
- approval decisions are forwarded to the client.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_interactive_provider.py -q`
Expected: fail because provider still emits deterministic events only.

**Step 3: Implement provider**

Keep a deterministic provider for tests, but make the production `CodexInteractiveProvider` use `CodexAppServerClient`. Track session id -> runtime client/thread id/cwd/sandbox, expose `prepare_session`, `stream_turn`, `cancel_turn`, `decide_approval`, and `close_session`.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_interactive_provider.py -q`
Expected: pass.

### Task 3: Route Wiring And Approval Round Trip

**Files:**
- Modify: `api/app/routes/codex_interactive.py`
- Modify: `api/app/db/store.py` if needed
- Test: `api/tests/test_codex_interactive_routes.py`

**Step 1: Write failing tests**

Add route tests with a fake real provider for:
- session creation calls provider preparation and persists `codex_thread_id`;
- websocket turn streams provider events and auto-generates `diff_ready` after a patch turn;
- approval decision endpoint persists and forwards decisions to provider;
- cancel and close/discard call provider cleanup.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_interactive_routes.py -q`
Expected: fail on missing provider wiring.

**Step 3: Implement route wiring**

Call `prepare_session` during create, `stream_turn` with full session context, `cancel_turn` on cancel, `decide_approval` on approval endpoint, and `close_session` on close/discard. After patch turn completion, call worktree diff and persist/send `diff_ready`.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_interactive_routes.py -q`
Expected: pass.

### Task 4: Event Normalizer Coverage

**Files:**
- Modify: `api/app/services/codex_event_normalizer.py`
- Test: `api/tests/test_codex_event_normalizer.py`

**Step 1: Write failing tests**

Add tests for real app-server notifications:
- `item/agentMessage/delta` -> `text_delta`;
- `item/plan/delta` and `turn/plan/updated` -> `plan_delta`;
- command item start/completion/output -> `command_started` / `command_output`;
- file change patch update -> `file_changed`;
- `turn/completed` -> `turn_completed`;
- unknown notifications persist as `raw_codex_event`.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_event_normalizer.py -q`
Expected: fail because normalizer is pass-through.

**Step 3: Implement normalizer**

Map schema-pinned notification methods and include raw payload for unknown notifications.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_event_normalizer.py -q`
Expected: pass.

### Task 5: Docs And Verification

**Files:**
- Modify: `docs/architecture/current-system-topology.md`

**Step 1: Update docs**

Document app-server process lifecycle, stdio transport, per-session runtime, schema-pinned method names, approval round trip, and deterministic test provider.

**Step 2: Full verification**

Run:
- `pytest api/tests/test_codex_app_server_client.py api/tests/test_codex_interactive_provider.py api/tests/test_codex_event_normalizer.py api/tests/test_codex_interactive_routes.py api/tests/test_codex_worktree_manager.py api/tests/test_codex_store.py api/tests/test_codex_interactive_config.py api/tests/test_runtime_health.py -q`
- `pytest api/tests -q`
- `node web/tests/codex-console-state.test.mjs`
- `npm --prefix web run check:basic`
- `npm --prefix web run build`

**Step 3: Commit and push**

Commit the real app-server integration and push to `codex/local-interactive-integration`.
