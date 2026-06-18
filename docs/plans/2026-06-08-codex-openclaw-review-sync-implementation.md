# Codex OpenClaw Review Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first production slice for syncing desktop-pet managed Codex sessions to OpenClaw as draft structured reviews.

**Architecture:** desktop-pet continues to read local Codex JSONL and upsert `desktop_pet_sessions`; it will add bounded, redacted `metadata.facts`. FastAPI will build an `evidence_pack`, enqueue it in `codex_openclaw_sync_outbox`, call OpenClaw from a background worker, parse the JSON response, and save draft rows in `codex_review_items`.

**Tech Stack:** Electron/Vitest/TypeScript for desktop-pet, FastAPI/Python/SQLite/pytest for API, existing OpenClaw `/v1/responses` HTTP client contract.

---

### Task 1: desktop-pet JSONL fact extraction

**Files:**
- Modify: `desktop-pet/electron/codexSessionFiles.ts`
- Test: `desktop-pet/electron/codexSessionFiles.test.ts`

**Steps:**
1. Add a failing Vitest case that parses JSONL with command output, failed output, approval, file change, and error events.
2. Assert `buildDesktopPetSessionPayload(...).metadata.facts` includes `failed_commands`, `errors`, `approvals`, `changed_files`, and `event_counts`.
3. Run the focused Vitest test and verify it fails because `metadata.facts` is missing.
4. Implement bounded fact extraction from already-read head/tail events.
5. Re-run the focused Vitest test and verify it passes.

### Task 2: API review storage and evidence extraction

**Files:**
- Modify: `api/app/db/store.py`
- Create: `api/app/services/codex_review_fact_extractor.py`
- Test: `api/tests/test_codex_review_fact_extractor.py`

**Steps:**
1. Add failing pytest coverage for `build_evidence_pack(store, pet_session_id)`.
2. Seed `desktop_pet_sessions`, Codex artifacts, Codex events, and pending approvals.
3. Assert the evidence pack includes session info, Pet JSONL facts, artifact changed files, failed checks, pending approvals, and evidence refs.
4. Run the focused pytest and verify failure due to missing module/methods.
5. Add `codex_review_items` and `codex_openclaw_sync_outbox` schema and store helpers.
6. Implement evidence pack builder with redaction/truncation.
7. Re-run focused pytest and verify it passes.

### Task 3: OpenClaw review sync service

**Files:**
- Create: `api/app/services/codex_openclaw_review_sync.py`
- Modify: `api/app/services/openclaw_client.py`
- Test: `api/tests/test_codex_openclaw_review_sync.py`

**Steps:**
1. Add failing pytest coverage for parsing OpenClaw JSON from `/v1/responses` into draft review rows.
2. Add failing pytest coverage for non-JSON response marking outbox failed.
3. Implement `OpenClawClient.generate_codex_review(...)` or a small review-specific service using existing client request target/header behavior.
4. Implement `process_next_codex_review_sync(app)` and `run_codex_review_sync_worker(app)`.
5. Re-run focused pytest and verify it passes.

### Task 4: Route integration and manual trigger

**Files:**
- Modify: `api/app/routes/desktop_pet.py`
- Create: `api/app/routes/codex_review.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_codex_review_routes.py`

**Steps:**
1. Add failing route test showing `/desktop-pet/sessions` enqueues review sync only for review-worthy statuses.
2. Add failing route test for manual `POST /codex/reviews/sessions/{pet_session_id}/enqueue`.
3. Wire route helpers to build and enqueue evidence packs.
4. Start the worker only when `CODEX_OPENCLAW_REVIEW_ENABLED=true`, token exists, and not disabled by tests.
5. Re-run focused route tests and verify they pass.

### Task 5: docs and focused verification

**Files:**
- Modify: `docs/architecture/current-system-topology.md`
- Modify: `docs/plans/2026-06-08-openclaw-codex-review-ingestion.md`

**Steps:**
1. Document new env vars, data tables, sync flow, failure behavior, and debug/export policy.
2. Run focused desktop-pet Vitest.
3. Run focused API pytest files.
4. Run broader project validation if time allows.
