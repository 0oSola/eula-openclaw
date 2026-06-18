# OpenClaw Control Plane Codex Review Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the next slice where OpenClaw acts as the control plane for Codex review alignment, while FastAPI owns local state, user decisions, memory promotion, and OpenKB export.

**Architecture:** Reuse the existing Codex review draft pipeline. Add FastAPI APIs and tables for draft listing, user decisions, accepted review memory, Markdown export, and OpenKB sync status. OpenClaw daily cron consumes those APIs; OpenKB receives only accepted memory.

**Tech Stack:** FastAPI, SQLite `TraceStore`, pytest, existing OpenClaw client/service conventions, Markdown frontmatter export, optional OpenKB HTTP/CLI adapter.

---

### Task 1: Add Review Memory Store Schema

**Files:**
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_codex_review_memory_store.py`

**Step 1: Write failing store test**

Create `api/tests/test_codex_review_memory_store.py`.

Test cases:

```python
def test_accepting_review_item_creates_memory_once():
    store = _store()
    review = store.create_codex_review_item(...)
    memory = store.create_codex_review_memory_from_item(
        review_item_id=review["id"],
        title=review["title"],
        body=review["summary"],
        confirmed_by="admin-1",
    )
    again = store.create_codex_review_memory_from_item(...)
    assert memory["id"] == again["id"]
    assert memory["source_review_item_id"] == review["id"]
    assert memory["export_status"] == "pending"
```

Run:

```powershell
python -m pytest api/tests/test_codex_review_memory_store.py -q
```

Expected: fail because memory schema/helpers do not exist.

**Step 2: Add schema**

Add table:

```sql
CREATE TABLE IF NOT EXISTS codex_review_memory (
    id TEXT PRIMARY KEY,
    source_review_item_id TEXT NOT NULL UNIQUE,
    pet_session_id TEXT NOT NULL,
    codex_session_id TEXT NOT NULL,
    memory_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    evidence_refs_json TEXT NOT NULL DEFAULT '[]',
    source_hash TEXT NOT NULL,
    created_by TEXT NOT NULL,
    confirmed_by TEXT NOT NULL,
    confirmed_at TEXT NOT NULL,
    export_status TEXT NOT NULL,
    openkb_document_id TEXT,
    export_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Add index:

```sql
CREATE INDEX IF NOT EXISTS idx_codex_review_memory_status
ON codex_review_memory(export_status, memory_type, created_at);
```

**Step 3: Add store helpers**

Add:

- `create_codex_review_memory_from_item(...)`
- `get_codex_review_item(item_id)`
- `get_codex_review_memory(memory_id)`
- `list_codex_review_memory(export_status=None, limit=50)`
- `mark_codex_review_memory_exported(memory_id, document_id)`
- `mark_codex_review_memory_export_failed(memory_id, error)`

**Step 4: Run test**

Run:

```powershell
python -m pytest api/tests/test_codex_review_memory_store.py -q
```

Expected: pass.

### Task 2: Add Draft Listing And Priority API

**Files:**
- Modify: `api/app/routes/codex_review.py`
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_codex_review_decision_routes.py`

**Step 1: Write failing route test**

Add test:

```python
def test_list_drafts_orders_high_priority_failures_first():
    client = _client()
    seed_review_item(item_type="work_summary", severity=None)
    seed_review_item(item_type="pitfall", severity="high")
    response = client.get("/codex/reviews/drafts?limit=20", headers={"x-user-id": "admin-1"})
    assert response.status_code == 200
    assert response.json()["items"][0]["item_type"] == "pitfall"
```

Run:

```powershell
python -m pytest api/tests/test_codex_review_decision_routes.py::test_list_drafts_orders_high_priority_failures_first -q
```

Expected: 404 or missing route.

**Step 2: Implement store listing**

Add `list_codex_review_drafts(limit=20)` that selects `status IN ('draft', 'snoozed')`, excludes future `snooze_until`, computes priority in Python:

```text
blocker high = 100
pitfall high = 90
pitfall medium = 80
decision = 70
followup = 60
work_summary = 40
```

Keep the first implementation simple; deeper `apply_failed` ranking can be added after evidence refs are normalized.

**Step 3: Add route**

```http
GET /codex/reviews/drafts?limit=20
```

Response shape:

```json
{
  "items": [],
  "limit": 20
}
```

**Step 4: Run tests**

Run:

```powershell
python -m pytest api/tests/test_codex_review_decision_routes.py -q
```

Expected: pass for draft listing tests.

### Task 3: Add Review Decision API

**Files:**
- Modify: `api/app/routes/codex_review.py`
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_codex_review_decision_routes.py`

**Step 1: Write failing accept test**

```python
def test_accept_review_item_creates_memory_and_marks_accepted():
    client = _client()
    item = seed_review_item(item_type="pitfall", title="Bad schema", summary="JSON was invalid")
    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={"action": "accept", "target": "openkb"},
        headers={"x-user-id": "admin-1"},
    )
    assert response.status_code == 200
    assert response.json()["item"]["status"] == "accepted"
    assert response.json()["memory"]["title"] == "Bad schema"
```

**Step 2: Write edit/ignore/snooze tests**

Cover:

- `edit_accept` writes edited title/body,
- `ignore` does not create memory,
- `snooze` requires `snooze_until`,
- duplicate `accept` returns existing memory.

**Step 3: Implement request model**

In `codex_review.py`:

```python
class CodexReviewDecisionPayload(BaseModel):
    action: Literal["accept", "edit_accept", "ignore", "snooze"]
    edited_title: str | None = Field(default=None, max_length=240)
    edited_summary: str | None = Field(default=None, max_length=4000)
    notes: str | None = Field(default=None, max_length=2000)
    snooze_until: str | None = None
    target: Literal["openkb", "markdown", "none"] = "openkb"
```

**Step 4: Implement route**

```http
POST /codex/reviews/items/{item_id}/decision
```

For `accept`:

- update review item status to `accepted`,
- create memory from original title/summary,
- return item + memory.

For `edit_accept`:

- require at least one edited field,
- update review item status to `edited_accepted`,
- create memory from edited content.

For `ignore`:

- update review item status to `ignored`,
- return item and `memory=null`.

For `snooze`:

- update review item status to `snoozed`,
- store `snooze_until` in details or add column if needed.

**Step 5: Run tests**

Run:

```powershell
python -m pytest api/tests/test_codex_review_decision_routes.py -q
```

Expected: pass.

### Task 4: Add Markdown Memory Export

**Files:**
- Create: `api/app/services/codex_review_memory_export.py`
- Modify: `api/app/config.py`
- Modify: `api/app/routes/codex_review.py`
- Test: `api/tests/test_codex_review_memory_export.py`

**Step 1: Add config**

Add settings:

```python
codex_review_memory_enabled: bool
codex_review_memory_export_root: Path
codex_review_memory_target: str
openkb_sync_enabled: bool
openkb_base_url: str
openkb_token: str
```

Env vars:

```env
CODEX_REVIEW_MEMORY_ENABLED=false
CODEX_REVIEW_MEMORY_EXPORT_ROOT=api/data/openkb/codex-review
CODEX_REVIEW_MEMORY_TARGET=openkb
OPENKB_SYNC_ENABLED=false
OPENKB_BASE_URL=
OPENKB_TOKEN=
```

**Step 2: Write failing export test**

```python
def test_export_memory_writes_markdown_with_frontmatter(tmp_path):
    memory = {...}
    result = export_codex_review_memory_markdown(memory, tmp_path)
    text = result.path.read_text(encoding="utf-8")
    assert "source_review_item_id:" in text
    assert "# Bad schema" in text
```

**Step 3: Implement exporter**

Function:

```python
def export_codex_review_memory_markdown(memory: dict, export_root: Path) -> CodexMemoryExportResult:
    slug = slugify(memory["title"])
    category = memory["memory_type"] + "s"
    path = export_root / category / f"{slug}.md"
    ...
```

Use safe filenames, create directories, and write UTF-8.

**Step 4: Add route**

```http
POST /codex/reviews/memory/export
```

Request:

```json
{"memory_ids": ["..."], "target": "openkb", "force": false}
```

**Step 5: Run tests**

Run:

```powershell
python -m pytest api/tests/test_codex_review_memory_export.py api/tests/test_codex_review_decision_routes.py -q
```

Expected: pass.

### Task 5: Add OpenKB Adapter Boundary

**Files:**
- Create: `api/app/services/openkb_client.py`
- Modify: `api/app/services/codex_review_memory_export.py`
- Test: `api/tests/test_openkb_client.py`

**Step 1: Write adapter tests with mock transport**

Test that disabled sync does not call network. Test that enabled sync sends expected document metadata to `OPENKB_BASE_URL`.

**Step 2: Implement minimal adapter**

Keep Phase 1 adapter intentionally thin:

```python
class OpenKbClient:
    async def upsert_document(self, *, document_id: str, title: str, markdown: str, metadata: dict) -> OpenKbSyncResult:
        ...
```

If OpenKB API shape is not finalized, implement a local no-op/mockable interface and keep Markdown export as the canonical artifact.

**Step 3: Wire export service**

When `OPENKB_SYNC_ENABLED=true`, call `OpenKbClient.upsert_document(...)`. On failure, mark memory `export_failed` but keep Markdown file.

**Step 4: Run tests**

Run:

```powershell
python -m pytest api/tests/test_openkb_client.py api/tests/test_codex_review_memory_export.py -q
```

Expected: pass.

### Task 6: Add Daily Review Summary API

**Files:**
- Modify: `api/app/routes/codex_review.py`
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_codex_review_daily_summary.py`

**Step 1: Write failing test**

```python
def test_daily_summary_counts_pending_and_confirmed_items():
    response = client.get("/codex/reviews/daily-summary?date=2026-06-08", headers={"x-user-id": "admin-1"})
    assert response.status_code == 200
    assert response.json()["recommended_batch_size"] == 3
```

**Step 2: Implement route**

```http
GET /codex/reviews/daily-summary?date=YYYY-MM-DD
```

Return:

- `draft_count`
- `high_priority_count`
- `accepted_today`
- `ignored_today`
- `snoozed_today`
- `recommended_batch_size`

**Step 3: Run tests**

Run:

```powershell
python -m pytest api/tests/test_codex_review_daily_summary.py -q
```

Expected: pass.

### Task 7: Add OpenClaw Daily Cron Contract Doc

**Files:**
- Create: `docs/plans/2026-06-08-openclaw-daily-codex-review-cron-contract.md`

**Step 1: Document schedule**

Define:

```text
cron_name: codex-daily-review
agent_id: codex-manager
channel: codex-review
timezone: Asia/Singapore
default_time: 09:30
session_key: codex-review-daily:YYYY-MM-DD
```

**Step 2: Document conversation protocol**

OpenClaw should ask at most 3 items initially:

```text
今天有 8 条 Codex 回顾待确认。我建议先处理 3 条高优先级项。
1. [pitfall/high] ...
回复：接受 / 忽略 / 改成：... / 稍后
```

**Step 3: Document FastAPI calls**

List:

- `GET /codex/reviews/daily-summary`
- `GET /codex/reviews/drafts`
- `POST /codex/reviews/items/{id}/decision`
- `POST /codex/reviews/memory/export`

**Step 4: No tests**

This is a cross-system contract doc. Verify by reading and linking from the main spec.

### Task 8: Add OpenClaw-Facing Codex Tool Facade

**Files:**
- Create: `api/app/routes/openclaw_tools.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_openclaw_codex_tool_routes.py`

**Step 1: Write failing route test**

```python
def test_openclaw_codex_tool_requires_service_user():
    response = client.post("/openclaw/tools/codex/sessions", json={...})
    assert response.status_code == 401
```

**Step 2: Add facade route**

The facade should wrap existing `/codex/interactive/*`, not duplicate provider logic.

Recommended endpoints:

```http
POST /openclaw/tools/codex/sessions
POST /openclaw/tools/codex/sessions/{session_id}/turns
GET /openclaw/tools/codex/sessions/{session_id}/status
POST /openclaw/tools/codex/approvals/{approval_id}/decision
```

**Step 3: Keep output bounded**

Status responses should include:

- session id,
- status,
- last output preview,
- pending approvals,
- latest artifact refs,
- no full transcript.

**Step 4: Run tests**

Run:

```powershell
python -m pytest api/tests/test_openclaw_codex_tool_routes.py -q
```

Expected: pass.

### Task 9: Update Architecture Documentation

**Files:**
- Modify: `docs/architecture/current-system-topology.md`
- Modify: `docs/plans/2026-06-08-openclaw-control-plane-codex-review-memory-spec.md`

**Step 1: Update current topology only for implemented behavior**

After implementation, add:

- OpenClaw control-plane role,
- FastAPI local adapter APIs,
- `codex_review_memory`,
- Markdown/OpenKB export path,
- daily review API contract,
- security boundary.

Do not describe unimplemented future behavior as current runtime.

**Step 2: Link implementation docs**

Add references to:

- this implementation plan,
- the control-plane spec,
- existing OpenClaw Codex review ingestion doc.

### Task 10: Focused Verification

**Files:**
- No edits.

**Step 1: Run review test suite**

Run:

```powershell
python -m pytest api/tests/test_codex_review_fact_extractor.py api/tests/test_codex_openclaw_review_sync.py api/tests/test_codex_review_routes.py api/tests/test_codex_review_memory_store.py api/tests/test_codex_review_decision_routes.py api/tests/test_codex_review_memory_export.py api/tests/test_codex_review_daily_summary.py -q
```

Expected: all pass.

**Step 2: Run OpenClaw client/tool tests**

Run:

```powershell
python -m pytest api/tests/test_openclaw_client.py api/tests/test_openkb_client.py api/tests/test_openclaw_codex_tool_routes.py -q
```

Expected: all pass.

**Step 3: Run desktop-pet facts test**

Run:

```powershell
npm --prefix desktop-pet test -- electron/codexSessionFiles.test.ts
```

Expected: pass.

**Step 4: Run broader validation if touched APIs compile cleanly**

Run:

```powershell
python -m pytest api/tests/test_desktop_pet_routes.py api/tests/test_openclaw_client.py -q
```

Expected: pass.

---

## Execution Notes

1. Keep FastAPI as the only writer of `codex_review_memory`.
2. Keep OpenKB sync behind an adapter and feature flag.
3. Do not let OpenClaw or Codex bypass FastAPI for local file access.
4. Prefer Markdown export first; direct OpenKB sync can remain optional.
5. Preserve existing Codex interactive sandbox and approval gates.
