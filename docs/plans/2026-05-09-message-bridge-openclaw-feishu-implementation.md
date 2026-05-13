# Message Bridge OpenClaw Feishu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the first usable OpenClaw Feishu Message Bridge slice with SQLite binding/state, backend worker/provider, admin APIs, trace events, and Chatbox virtual scrolling.

**Architecture:** Add a Message Bridge module inside the FastAPI runtime but keep it separate from Message Service. The first provider uses OpenClaw Gateway WebSocket RPC; Hermes is represented only by provider abstractions. Chatbox keeps reading local SQLite-backed messages and becomes virtualized with `@tanstack/react-virtual`.

**Tech Stack:** FastAPI, sqlite3, pytest/TestClient, httpx-style async fakes, WebSocket provider abstraction, Next.js React, `@tanstack/react-virtual`.

---

### Task 1: SQLite Bridge Binding and State

**Files:**
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_message_bridge.py`

**Steps:**
1. Write failing tests for default bridge state, binding creation, admin scoping, and duplicate external message id dedupe.
2. Run `python -m pytest api/tests/test_message_bridge.py -q` and verify failures.
3. Add `message_bridge_bindings` and `message_bridge_state` tables plus store helpers.
4. Add message insert support for `openclaw_message_id` and external dedupe.
5. Re-run the targeted test.

### Task 2: Provider Abstraction and OpenClaw Worker

**Files:**
- Create: `api/app/services/message_bridge.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_message_bridge.py`

**Steps:**
1. Write failing tests using fake provider for latest Feishu session selection, history sync, role filtering, fallback idle, and realtime message handling.
2. Run targeted test and verify failures.
3. Implement provider data classes and `MessageBridgeService`.
4. Wire worker lifecycle behind app startup.
5. Re-run targeted test.

### Task 3: Admin Bridge API

**Files:**
- Create: `api/app/routes/message_bridge.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_message_bridge.py`

**Steps:**
1. Write failing tests for admin status, non-admin denial, settings patch, Feishu sessions list, and default binding switch.
2. Run targeted test and verify failures.
3. Implement admin routes.
4. Include router in app.
5. Re-run targeted test.

### Task 4: Chatbox Virtual List and Admin Panel

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Modify: `web/src/app/companion/CompanionChatbox.tsx`
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/lib/types.ts`
- Modify: `web/tests/run-basic-checks.mjs`

**Steps:**
1. Install `@tanstack/react-virtual`.
2. Add failing/source checks for virtualizer and bridge admin API client.
3. Implement virtualized message list with current auto-scroll behavior.
4. Add bridge status fetch and settings display in OpenClaw/admin settings.
5. Run `npm --prefix web run check:basic` and `npm --prefix web run build`.

### Task 5: Verification

**Files:**
- Existing tests and build outputs only.

**Steps:**
1. Run `python -m pytest api/tests/test_message_bridge.py api/tests/test_message_service_v2.py api/tests/test_openclaw_client.py -q`.
2. Run `npm --prefix web run check:basic`.
3. Run `npm --prefix web run build`.
4. Summarize changed files, tests, and any remaining risks.
