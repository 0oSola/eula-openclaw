# MMD Virtual Companion Monorepo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a runnable monorepo MVP with `web` (Next.js + Three.js MMD client) and `api` (FastAPI) that proxies OpenClaw, tracks full-chain traces, supports VMD mapping, and keeps SQLite+NDJSON logs with retention.

**Architecture:** `web` calls only `api`; `api` owns OpenClaw credentials and normalizes mixed text/JSON replies to a stable interaction contract. Long-term memory retrieval remains in OpenClaw; local SQLite stores full request/response mirrors, trace events, config, and retry jobs. Frontend executes action resolution chain: user mapping -> global mapping -> procedural fallback.

**Tech Stack:** Next.js (TypeScript), Three.js, FastAPI, SQLAlchemy, pytest, SQLite, NDJSON logging.

---

### Task 1: Repository Scaffold

**Files:**
- Create: `web/*`
- Create: `api/*`
- Create: `docs/architecture/trace-contract.md`
- Modify: `README.md`

**Step 1: Write failing tests**
- Add API smoke tests expecting `/healthz` and `/chat` contract shape.

**Step 2: Run tests to verify fail**
- Run: `python -m pytest api/tests/test_smoke.py -q`
- Expected: FAIL because app/routes not present.

**Step 3: Write minimal implementation**
- Add FastAPI app factory and health route.
- Add minimal monorepo README instructions.

**Step 4: Run tests to verify pass**
- Run: `python -m pytest api/tests/test_smoke.py -q`
- Expected: PASS.

### Task 2: Response Normalization and Fallback Logic

**Files:**
- Create: `api/app/services/response_parser.py`
- Create: `api/tests/test_response_parser.py`

**Step 1: Write failing tests**
- Cover strict JSON block, mixed text+JSON, invalid payload fallback.

**Step 2: Run tests to verify fail**
- Run: `python -m pytest api/tests/test_response_parser.py -q`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- Parse JSON fenced blocks first, then inline JSON object extraction, then rule fallback.
- Output schema: `{text, emotion, action, memory_ops, parse_mode}`.

**Step 4: Run tests to verify pass**
- Run: `python -m pytest api/tests/test_response_parser.py -q`
- Expected: PASS.

### Task 3: Trace Logging Pipeline (SQLite + NDJSON)

**Files:**
- Create: `api/app/db/models.py`
- Create: `api/app/services/trace_logger.py`
- Create: `api/tests/test_trace_logger.py`

**Step 1: Write failing tests**
- Validate event insert, mirror insert, trace query filter, NDJSON append.

**Step 2: Run tests to verify fail**
- Run: `python -m pytest api/tests/test_trace_logger.py -q`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- SQLAlchemy models + migration bootstrap.
- Trace logger that dual-writes DB and NDJSON files by date.

**Step 4: Run tests to verify pass**
- Run: `python -m pytest api/tests/test_trace_logger.py -q`
- Expected: PASS.

### Task 4: OpenClaw Client and Chat Endpoint

**Files:**
- Create: `api/app/services/openclaw_client.py`
- Create: `api/app/routes/chat.py`
- Create: `api/tests/test_chat_route.py`

**Step 1: Write failing tests**
- Test `/chat` emits normalized payload and includes `trace_id`.
- Test fallback from `/v1/responses` to `/v1/chat/completions`.

**Step 2: Run tests to verify fail**
- Run: `python -m pytest api/tests/test_chat_route.py -q`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- Timeout 15s + one retry.
- Route traces: ingress -> openclaw request -> parse -> mirror -> egress.

**Step 4: Run tests to verify pass**
- Run: `python -m pytest api/tests/test_chat_route.py -q`
- Expected: PASS.

### Task 5: Config, VMD Asset, and Trace Query Routes

**Files:**
- Create: `api/app/routes/config.py`
- Create: `api/app/routes/assets.py`
- Create: `api/app/routes/trace.py`
- Create: `api/tests/test_config_assets_trace_routes.py`

**Step 1: Write failing tests**
- User override and default mapping behavior.
- VMD upload/list/delete and slot assignment.
- Trace query access control for admin/non-admin.

**Step 2: Run tests to verify fail**
- Run: `python -m pytest api/tests/test_config_assets_trace_routes.py -q`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- Implement endpoints and file storage under `api/storage/vmd`.
- Enforce admin whitelist.

**Step 4: Run tests to verify pass**
- Run: `python -m pytest api/tests/test_config_assets_trace_routes.py -q`
- Expected: PASS.

### Task 6: Web App MVP (Next.js)

**Files:**
- Create: `web/package.json`, `web/next.config.mjs`, `web/tsconfig.json`
- Create: `web/src/app/*`
- Create: `web/src/features/*`
- Create: `web/src/lib/api.ts`
- Create: `web/tests/*`

**Step 1: Write failing tests**
- Chat submit sends `trace_id`.
- Action resolver chain works.
- Trace viewer filters own vs admin traces.

**Step 2: Run tests to verify fail**
- Run: `npm --prefix web test`
- Expected: FAIL.

**Step 3: Write minimal implementation**
- Pages: login, chat/stage, mappings, trace viewer.
- Integrate with API endpoints.

**Step 4: Run tests to verify pass**
- Run: `npm --prefix web test`
- Expected: PASS.

### Task 7: End-to-End Verification

**Files:**
- Create: `scripts/verify-demo.ps1`
- Modify: `README.md`

**Step 1: Write failing checks**
- Verify API/server startup and endpoint contract.

**Step 2: Run checks to verify fail**
- Run verification script before env setup.

**Step 3: Implement script and env docs**
- Add `.env.example` for `api` and `web`.

**Step 4: Run checks to verify pass**
- Run: `powershell -File scripts/verify-demo.ps1`
- Expected: all checks pass.
