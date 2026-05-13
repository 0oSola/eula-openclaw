# Message Service v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the first usable slice of the confirmed Chinese message-service-v2 spec.

**Architecture:** Keep OpenClaw as the chat generation hub and add an application-side SQLite ledger for account, workspace, session, message, TTS reference, and motion resolution records. New v2 routes sit beside deprecated `/chat` and `/tts/speak` so the frontend can migrate incrementally.

**Tech Stack:** FastAPI, Pydantic, sqlite3, existing `TraceStore`, existing `OpenClawClient`, existing `VoiceWorkflowTtsClient`, pytest/TestClient.

---

### Task 1: SQLite Ledger

**Files:**
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_message_service_v2.py`

**Steps:**
1. Write tests for `GET /workspaces/current`, `POST /sessions`, session listing, message listing, and workspace isolation.
2. Run the new tests and verify they fail because routes/tables do not exist.
3. Add SQLite tables and store helpers for accounts, workspaces, memberships, sessions, and messages.
4. Run the new tests and verify they pass.

### Task 2: v2 Routes

**Files:**
- Create: `api/app/routes/message_service.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_message_service_v2.py`

**Steps:**
1. Extend tests for session CRUD and soft delete.
2. Implement `/workspaces/current`, `/sessions`, `/sessions/{id}`, and `/sessions/{id}/messages`.
3. Verify access is always scoped by resolved account + workspace membership.

### Task 3: Unified Send

**Files:**
- Modify: `api/app/routes/message_service.py`
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_message_service_v2.py`

**Steps:**
1. Write failing test for `POST /sessions/{id}/messages` returning persisted user and assistant messages.
2. Use existing OpenClaw client and response parser.
3. Persist OpenClaw normalized fields: `emotion`, `action`, `motion_plan`, `memory_ops`, `tts_emotion_label`, and `tts_pause_profile`.
4. Verify fallback stores the user message even when OpenClaw fails.

### Task 4: TTS Reference Slice

**Files:**
- Modify: `api/app/routes/message_service.py`
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_message_service_v2.py`

**Steps:**
1. Write failing test for `tts_enabled=true` storing a ready `message_tts` row with remote URL and no local audio file.
2. Implement synchronous TTS generation using the existing client.
3. Return `remote_audio_url` and `proxy_audio_url`.
4. Leave async job worker and proxy streaming for the next slice if time requires.
