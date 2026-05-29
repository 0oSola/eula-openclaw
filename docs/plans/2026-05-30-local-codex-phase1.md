# Local Codex Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first disabled-by-default local Codex interactive integration path for read-only sessions.

**Architecture:** Next.js stays the browser boundary and proxies HTTP to FastAPI. FastAPI owns Codex configuration, session persistence, event normalization, WebSocket delivery, and a pluggable read-only provider that can run against the real Codex app-server later while using a deterministic local adapter in tests and disabled environments.

**Tech Stack:** FastAPI, SQLite, Starlette WebSocket, Next.js App Router, React, TypeScript, Node test runner, pytest.

---

### Task 1: Backend Config And Health

**Files:**
- Modify: `api/app/config.py`
- Modify: `api/app/routes/health.py`
- Modify: `web/src/lib/types.ts`
- Test: `api/tests/test_codex_interactive_config.py`

**Step 1: Write failing tests**

Add tests that assert:
- `Settings.from_env()` parses `CODEX_INTERACTIVE_ENABLED`, `CODEX_BIN`, `CODEX_ALLOWED_USERS`, workspace allowlist, timeouts, and sandbox defaults.
- `/admin/runtime-health` includes a `codex` object without probing remote services.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_interactive_config.py -q`
Expected: fail because Codex settings and health payload do not exist.

**Step 3: Implement minimal config and health**

Add dataclass fields, env parsing helpers, and health payload fields. Keep feature default disabled.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_interactive_config.py api/tests/test_runtime_health.py -q`
Expected: pass.

### Task 2: Codex Store Schema

**Files:**
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_codex_store.py`

**Step 1: Write failing tests**

Add tests for creating a Codex session, appending ordered events, creating a turn, and persisting approval rows.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_store.py -q`
Expected: fail because tables and store methods do not exist.

**Step 3: Implement minimal store methods**

Add the Phase 1 tables from the spec and small CRUD helpers used by routes.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_store.py -q`
Expected: pass.

### Task 3: Read-Only Session Service And WebSocket

**Files:**
- Create: `api/app/services/codex_interactive_provider.py`
- Create: `api/app/services/codex_event_normalizer.py`
- Create: `api/app/routes/codex_interactive.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_codex_interactive_routes.py`

**Step 1: Write failing tests**

Add route tests for:
- Disabled feature rejects session creation with 404 or 403.
- Admin can create a read-only session when enabled.
- Non-allowlisted user is rejected.
- WebSocket sends `session_ready`, accepts `user_message`, streams `turn_started`, `text_delta`, `turn_completed`, and persists events.
- `cancel_turn` emits a cancellation event.

**Step 2: Run red tests**

Run: `pytest api/tests/test_codex_interactive_routes.py -q`
Expected: fail because routes do not exist.

**Step 3: Implement minimal provider and routes**

Implement a deterministic read-only provider that echoes a short analysis event sequence. Keep real `codex app-server` spawning behind a provider seam for later phases.

**Step 4: Run green tests**

Run: `pytest api/tests/test_codex_interactive_routes.py -q`
Expected: pass.

### Task 4: Frontend Console Shell

**Files:**
- Create: `web/src/lib/codexEvents.ts`
- Create: `web/src/lib/codexApi.ts`
- Create: `web/src/app/companion/CodexConsole.tsx`
- Modify: `web/src/app/companion/CompanionRightRail.tsx`
- Modify: `web/src/app/companion/page.tsx`
- Test: `web/tests/codex-console-state.test.mjs`

**Step 1: Write failing tests**

Add Node tests for Codex event reducer behavior: session ready, text streaming append, turn completion, cancellation, and failure.

**Step 2: Run red tests**

Run: `node web/tests/codex-console-state.test.mjs`
Expected: fail because reducer module does not exist.

**Step 3: Implement minimal UI modules**

Add typed API helpers, WebSocket URL helper, reducer, and a compact Tasks rail console that creates a session, sends messages, cancels, and displays transcript/status.

**Step 4: Run green tests**

Run: `node web/tests/codex-console-state.test.mjs`
Expected: pass.

### Task 5: Docs And Verification

**Files:**
- Modify: `docs/architecture/current-system-topology.md`

**Step 1: Update topology**

Document the disabled-by-default Codex interactive path, env vars, and that Phase 1 uses the FastAPI provider seam rather than exposing Codex directly to the browser.

**Step 2: Verify**

Run:
- `pytest api/tests/test_codex_interactive_config.py api/tests/test_codex_store.py api/tests/test_codex_interactive_routes.py api/tests/test_runtime_health.py -q`
- `node web/tests/codex-console-state.test.mjs`
- `npm --prefix web run check:basic`

**Step 3: Commit**

Commit the implementation with a focused message, then push the implementation branch.
