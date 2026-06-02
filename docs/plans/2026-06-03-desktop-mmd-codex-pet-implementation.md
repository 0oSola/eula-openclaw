# Desktop MMD Codex Pet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a separate on-demand `desktop-pet` desktop widget that renders the current MMD companion as a transparent always-on-top Codex status pet, can start the local API, can open/reuse VSCode workspaces, can launch/resume Codex CLI sessions through a local app-server, and can show readable status/reminder context menus.

**Architecture:** Add two small API surfaces for shared companion config and pet session registry, then add an independent Electron + Vite + React frontend subproject that reuses the existing MMD stage runtime from `web/src`. Codex status comes from a pet-managed local `codex app-server --listen ws://127.0.0.1:<port>` relay where possible, with explicit fallback states when app-server or VSCode bridge integration is unavailable. VSCode terminal control is handled by a small bridge extension so the pet can reuse an existing workspace window or open one and run the resume command in an integrated terminal.

**Tech Stack:** FastAPI, SQLite, pytest, Vite, React 19, Electron, TypeScript, Vitest, Three.js/MMD runtime reused from `web/src/features/stage`, VSCode Extension API, Codex CLI app-server WebSocket transport.

---

## References And Constraints

- Confirmed design doc: `docs/plans/2026-06-03-desktop-mmd-codex-pet-design.md`.
- Project architecture doc must be updated when functionality/runtime/API topology changes: `docs/architecture/current-system-topology.md`.
- Existing MMD runtime entry points:
  - `web/src/features/stage/MMDStage.tsx`
  - `web/src/features/stage/mmdCompanionRuntime.js`
  - `web/src/features/stage/stageCharacterClick.js`
  - `web/src/features/mapping/vmdPreview.js`
- Existing asset APIs:
  - `GET /assets/mmd/models`
  - `GET /assets/vmd`
  - `GET /assets/vmd/file/{asset_id}`
- Existing Codex APIs and schema references:
  - `api/app/routes/codex_interactive.py`
  - `api/app/services/codex_app_server_client.py`
  - `api/app/codex_schema/generated/`
  - `web/src/codex-schema/generated/`
- Codex manual and local CLI help confirm:
  - `codex --remote ws://127.0.0.1:<port> --cd "<workspace>"`
  - `codex resume <SESSION_ID> --remote ws://127.0.0.1:<port> --cd "<workspace>"`
  - `codex app-server --listen ws://127.0.0.1:<port>`
  - WebSocket app-server transport is experimental and should be kept loopback-only.
- Use `@superpowers:test-driven-development` while implementing each behavior change.
- Use `@mmd-character-rendering` when touching MMD render parameters, lighting, toon material, or stage visibility.
- Use `@playwright-best-practices` for browser/Electron smoke tests that inspect rendered UI or canvas output.
- Use `@superpowers:verification-before-completion` before claiming the implementation is done.

## Phase 0: Preflight

### Task 0: Confirm Worktree And Baseline

**Files:**
- Read only: repository state

**Step 1: Confirm branch and clean state**

Run from `D:\workspace\MMD project\.worktrees\desktop-mmd-codex-pet`:

```powershell
git branch --show-current
git status --short
```

Expected:

```text
codex/desktop-mmd-codex-pet
```

`git status --short` should print nothing. If it shows unrelated files, stop and inspect before editing.

**Step 2: Confirm web baseline still passes**

Run:

```powershell
npm --prefix web run check:basic
```

Expected:

```text
basic checks passed
```

**Step 3: Confirm API test command availability**

Run:

```powershell
pytest api/tests/test_codex_store.py -q
```

Expected: existing Codex store tests pass. If `pytest` or dependencies are missing, run:

```powershell
python -m pip install -r api/requirements.txt
pytest api/tests/test_codex_store.py -q
```

**Step 4: Commit nothing**

This is a verification-only task. Do not commit.

---

## Phase 1: API Shared Companion Config

### Task 1: Add SQLite Storage For Shared Companion Config

**Files:**
- Modify: `api/app/db/store.py`
- Test: `api/tests/test_desktop_pet_store.py`

This table stores only the settings shared between `/companion` and `desktop-pet`: selected MMD model and render pipeline. It must not store pet camera, pet window position, notification profile, or terminal state.

**Step 1: Write the failing store test**

Create `api/tests/test_desktop_pet_store.py` with:

```python
from pathlib import Path
from uuid import uuid4

from app.db.store import TraceStore


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def test_shared_companion_config_defaults_and_updates():
    store = _store()

    default = store.get_companion_shared_config("admin-1")

    assert default["user_id"] == "admin-1"
    assert default["selected_model_path"] is None
    assert default["render_pipeline"] == "classic"
    assert default["updated_at"] is None

    updated = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline="genshin",
    )

    assert updated["selected_model_path"] == "Eula/Eula.pmx"
    assert updated["render_pipeline"] == "genshin"
    assert updated["updated_at"]
    assert store.get_companion_shared_config("admin-1") == updated


def test_shared_companion_config_rejects_unknown_render_pipeline():
    store = _store()

    try:
        store.upsert_companion_shared_config(
            user_id="admin-1",
            selected_model_path=None,
            render_pipeline="toon-unknown",
        )
    except ValueError as error:
        assert "render_pipeline" in str(error)
    else:
        raise AssertionError("expected invalid render pipeline to fail")
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pytest api/tests/test_desktop_pet_store.py -q
```

Expected: FAIL because `TraceStore.get_companion_shared_config` does not exist.

**Step 3: Add schema and store methods**

In `api/app/db/store.py`, inside `_init_db()` `executescript`, add:

```sql
CREATE TABLE IF NOT EXISTS companion_shared_config (
    user_id TEXT PRIMARY KEY,
    selected_model_path TEXT,
    render_pipeline TEXT NOT NULL DEFAULT 'classic',
    updated_at TEXT NOT NULL
);
```

Near other small config/store helpers, add:

```python
    def get_companion_shared_config(self, user_id: str) -> dict[str, Any]:
        row = self._conn.execute(
            "SELECT * FROM companion_shared_config WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is None:
            return {
                "user_id": user_id,
                "selected_model_path": None,
                "render_pipeline": "classic",
                "updated_at": None,
            }
        return dict(row)

    def upsert_companion_shared_config(
        self,
        *,
        user_id: str,
        selected_model_path: str | None,
        render_pipeline: str,
    ) -> dict[str, Any]:
        normalized_pipeline = (render_pipeline or "classic").strip()
        if normalized_pipeline not in {"classic", "genshin"}:
            raise ValueError("render_pipeline must be classic or genshin")
        now = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO companion_shared_config (
                user_id, selected_model_path, render_pipeline, updated_at
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                selected_model_path = excluded.selected_model_path,
                render_pipeline = excluded.render_pipeline,
                updated_at = excluded.updated_at
            """,
            (user_id, selected_model_path, normalized_pipeline, now),
        )
        self._conn.commit()
        return self.get_companion_shared_config(user_id)
```

**Step 4: Run test to verify it passes**

Run:

```powershell
pytest api/tests/test_desktop_pet_store.py -q
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add api/app/db/store.py api/tests/test_desktop_pet_store.py
git commit -m "feat: store companion shared config"
```

### Task 2: Add API Routes For Shared Config

**Files:**
- Create: `api/app/routes/desktop_pet.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_desktop_pet_routes.py`

**Step 1: Write failing route tests**

Create `api/tests/test_desktop_pet_routes.py`:

```python
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _client() -> TestClient:
    return TestClient(
        create_app(
            {
                "data_dir": str(_case_dir()),
                "admin_user_ids": ["admin-1"],
            }
        )
    )


def test_shared_config_round_trip():
    client = _client()

    default = client.get("/desktop-pet/shared-config", headers={"x-user-id": "admin-1"})

    assert default.status_code == 200
    assert default.json() == {
        "user_id": "admin-1",
        "selected_model_path": None,
        "render_pipeline": "classic",
        "updated_at": None,
    }

    updated = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": "genshin"},
        headers={"x-user-id": "admin-1"},
    )

    assert updated.status_code == 200
    assert updated.json()["selected_model_path"] == "Eula/Eula.pmx"
    assert updated.json()["render_pipeline"] == "genshin"
    assert updated.json()["updated_at"]


def test_shared_config_uses_requester_not_payload_user():
    client = _client()

    response = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": "Ayaka/Ayaka.pmx", "render_pipeline": "classic"},
        headers={"x-user-id": "user-2"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == "user-2"


def test_shared_config_rejects_invalid_pipeline():
    client = _client()

    response = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": None, "render_pipeline": "unknown"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pytest api/tests/test_desktop_pet_routes.py -q
```

Expected: FAIL with 404 for `/desktop-pet/shared-config`.

**Step 3: Implement route**

Create `api/app/routes/desktop_pet.py`:

```python
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.security import resolve_requester


router = APIRouter(prefix="/desktop-pet", tags=["desktop-pet"])


class CompanionSharedConfigPayload(BaseModel):
    selected_model_path: str | None = Field(default=None, max_length=1000)
    render_pipeline: Literal["classic", "genshin"] = "classic"


@router.get("/shared-config")
def get_shared_config(request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    return request.app.state.trace_store.get_companion_shared_config(requester.effective_user_id)


@router.put("/shared-config")
def put_shared_config(
    payload: CompanionSharedConfigPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    try:
        return request.app.state.trace_store.upsert_companion_shared_config(
            user_id=requester.effective_user_id,
            selected_model_path=payload.selected_model_path,
            render_pipeline=payload.render_pipeline,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
```

Modify `api/app/main.py`:

```python
from app.routes.desktop_pet import router as desktop_pet_router
```

and include it near other routers:

```python
app.include_router(desktop_pet_router)
```

**Step 4: Run route tests**

Run:

```powershell
pytest api/tests/test_desktop_pet_routes.py -q
```

Expected: PASS.

**Step 5: Run related route tests**

Run:

```powershell
pytest api/tests/test_config_assets_trace_routes.py api/tests/test_codex_interactive_routes.py -q
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add api/app/main.py api/app/routes/desktop_pet.py api/tests/test_desktop_pet_routes.py
git commit -m "feat: expose desktop pet shared config"
```

### Task 3: Publish Shared Config From The Existing Companion Page

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/app/companion/page.tsx`
- Test: `web/tests/run-basic-checks.mjs`

The desktop pet cannot follow the browser companion if the browser never writes selected model and render pipeline to the API. Keep the browser localStorage behavior for compatibility, but mirror the relevant fields to `/desktop-pet/shared-config`.

**Step 1: Extend web API types and functions**

Add to `web/src/lib/types.ts`:

```ts
export type CompanionSharedConfig = {
  user_id: string;
  selected_model_path: string | null;
  render_pipeline: RenderPipeline;
  updated_at: string | null;
};
```

Add to `web/src/lib/api.ts`:

```ts
export async function getCompanionSharedConfig(userId: string): Promise<CompanionSharedConfig> {
  return requestJSON<CompanionSharedConfig>("/desktop-pet/shared-config", {
    headers: buildTraceHeaders(userId),
  });
}

export async function putCompanionSharedConfig(
  userId: string,
  payload: { selected_model_path: string | null; render_pipeline: RenderPipeline },
): Promise<CompanionSharedConfig> {
  return requestJSON<CompanionSharedConfig>("/desktop-pet/shared-config", {
    method: "PUT",
    headers: buildTraceHeaders(userId),
    body: JSON.stringify(payload),
  });
}
```

**Step 2: Add failing static checks**

In `web/tests/run-basic-checks.mjs`, add assertions near the existing `apiSource` and `companionPageSource` checks:

```js
assert.match(typesSource, /export type CompanionSharedConfig/);
assert.match(apiSource, /export async function getCompanionSharedConfig/);
assert.match(apiSource, /export async function putCompanionSharedConfig/);
assert.match(companionPageSource, /putCompanionSharedConfig/);
```

**Step 3: Run check to verify it fails before page wiring**

Run:

```powershell
npm --prefix web run check:basic
```

Expected: FAIL until `page.tsx` imports and calls `putCompanionSharedConfig`.

**Step 4: Mirror companion changes to API**

In `web/src/app/companion/page.tsx`, import `putCompanionSharedConfig`. Add a debounced or guarded `useEffect` after `session`, `selectedModelPath`, and `renderPipeline` are initialized:

```tsx
useEffect(() => {
  if (!session?.userId) return;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    putCompanionSharedConfig(session.userId, {
      selected_model_path: selectedModelPath || null,
      render_pipeline: renderPipeline,
    }).catch(() => {
      // Shared config is best-effort. Local companion state must not break.
    });
  }, 250);
  return () => {
    controller.abort();
    window.clearTimeout(timeoutId);
  };
}, [session?.userId, selectedModelPath, renderPipeline]);
```

Do not move camera snapshots to this API. The pet camera remains independent.

**Step 5: Run web check**

Run:

```powershell
npm --prefix web run check:basic
```

Expected:

```text
basic checks passed
```

**Step 6: Run API route tests again**

Run:

```powershell
pytest api/tests/test_desktop_pet_routes.py -q
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add web/src/lib/types.ts web/src/lib/api.ts web/src/app/companion/page.tsx web/tests/run-basic-checks.mjs
git commit -m "feat: mirror companion config for desktop pet"
```

---

## Phase 2: API Pet Session Registry

### Task 4: Add Pet Session Registry Storage

**Files:**
- Modify: `api/app/db/store.py`
- Modify: `api/tests/test_desktop_pet_store.py`

This registry is metadata only. It must not copy or move Codex transcripts. Codex session persistence remains in the user's existing `CODEX_HOME`; the registry only stores enough readable metadata to show a menu and run `codex resume`.

**Step 1: Add failing store tests**

Append to `api/tests/test_desktop_pet_store.py`:

```python
def test_desktop_pet_session_registry_round_trip_and_sorting():
    store = _store()

    first = store.upsert_desktop_pet_session(
        pet_session_id="pet-1",
        codex_session_id="11111111-1111-1111-1111-111111111111",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home="C:/Users/KSG/.codex",
        display_title=None,
        first_prompt_preview="fix login layout and run checks",
        last_summary=None,
        last_status="running",
        launch_mode="workspace-write",
        remote_url="ws://127.0.0.1:4501",
        app_server_pid=1234,
        app_server_port=4501,
        metadata={"approval_count": 0},
    )
    second = store.upsert_desktop_pet_session(
        pet_session_id="pet-2",
        codex_session_id="22222222-2222-2222-2222-222222222222",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home="C:/Users/KSG/.codex",
        display_title="Codex Console integration",
        first_prompt_preview=None,
        last_summary="Added status bridge.",
        last_status="completed",
        launch_mode="read-only",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )

    assert first["display_title"] == "fix login layout and run checks"
    assert second["display_title"] == "Codex Console integration"
    sessions = store.list_desktop_pet_sessions(limit=10)
    assert [item["pet_session_id"] for item in sessions] == ["pet-2", "pet-1"]
    assert sessions[0]["metadata"] == {}


def test_desktop_pet_session_registry_delete_only_removes_registry_row():
    store = _store()
    store.upsert_desktop_pet_session(
        pet_session_id="pet-1",
        codex_session_id="11111111-1111-1111-1111-111111111111",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Readable title",
        first_prompt_preview=None,
        last_summary=None,
        last_status="failed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )

    assert store.delete_desktop_pet_session("pet-1") is True
    assert store.get_desktop_pet_session("pet-1") is None
    assert store.delete_desktop_pet_session("pet-1") is False
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pytest api/tests/test_desktop_pet_store.py -q
```

Expected: FAIL because session registry methods do not exist.

**Step 3: Add schema**

In `api/app/db/store.py`, inside `_init_db()` `executescript`, add:

```sql
CREATE TABLE IF NOT EXISTS desktop_pet_sessions (
    pet_session_id TEXT PRIMARY KEY,
    codex_session_id TEXT NOT NULL,
    workspace_id TEXT,
    workspace_path TEXT NOT NULL,
    codex_home TEXT,
    display_title TEXT NOT NULL,
    first_prompt_preview TEXT,
    last_summary TEXT,
    last_status TEXT NOT NULL,
    launch_mode TEXT NOT NULL,
    remote_url TEXT,
    app_server_pid INTEGER,
    app_server_port INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_desktop_pet_sessions_last_seen
ON desktop_pet_sessions(last_seen_at DESC);
```

**Step 4: Add registry helpers**

Add helpers in `TraceStore`:

```python
    @staticmethod
    def _desktop_pet_display_title(
        *,
        display_title: str | None,
        first_prompt_preview: str | None,
        workspace_path: str,
        codex_session_id: str,
    ) -> str:
        for candidate in (display_title, first_prompt_preview):
            normalized = _normalize_message_content(candidate)
            if normalized:
                return normalized[:48]
        workspace_name = Path(workspace_path).name or "Codex session"
        short_id = codex_session_id.replace("-", "")[:8]
        return f"{workspace_name} {short_id}".strip()

    def _desktop_pet_session_row(self, row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        item = dict(row)
        item["metadata"] = self._json_loads(item.pop("metadata_json", None), {})
        return item

    def upsert_desktop_pet_session(
        self,
        *,
        pet_session_id: str,
        codex_session_id: str,
        workspace_id: str | None,
        workspace_path: str,
        codex_home: str | None,
        display_title: str | None,
        first_prompt_preview: str | None,
        last_summary: str | None,
        last_status: str,
        launch_mode: str,
        remote_url: str | None,
        app_server_pid: int | None,
        app_server_port: int | None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        title = self._desktop_pet_display_title(
            display_title=display_title,
            first_prompt_preview=first_prompt_preview,
            workspace_path=workspace_path,
            codex_session_id=codex_session_id,
        )
        self._conn.execute(
            """
            INSERT INTO desktop_pet_sessions (
                pet_session_id, codex_session_id, workspace_id, workspace_path,
                codex_home, display_title, first_prompt_preview, last_summary,
                last_status, launch_mode, remote_url, app_server_pid,
                app_server_port, metadata_json, created_at, updated_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(pet_session_id) DO UPDATE SET
                codex_session_id = excluded.codex_session_id,
                workspace_id = excluded.workspace_id,
                workspace_path = excluded.workspace_path,
                codex_home = excluded.codex_home,
                display_title = excluded.display_title,
                first_prompt_preview = excluded.first_prompt_preview,
                last_summary = excluded.last_summary,
                last_status = excluded.last_status,
                launch_mode = excluded.launch_mode,
                remote_url = excluded.remote_url,
                app_server_pid = excluded.app_server_pid,
                app_server_port = excluded.app_server_port,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at,
                last_seen_at = excluded.last_seen_at
            """,
            (
                pet_session_id,
                codex_session_id,
                workspace_id,
                workspace_path,
                codex_home,
                title,
                first_prompt_preview,
                last_summary,
                last_status,
                launch_mode,
                remote_url,
                app_server_pid,
                app_server_port,
                json.dumps(metadata or {}, ensure_ascii=False),
                now,
                now,
                now,
            ),
        )
        self._conn.commit()
        return self.get_desktop_pet_session(pet_session_id) or {}

    def get_desktop_pet_session(self, pet_session_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM desktop_pet_sessions WHERE pet_session_id = ?",
            (pet_session_id,),
        ).fetchone()
        return self._desktop_pet_session_row(row)

    def list_desktop_pet_sessions(self, limit: int = 10) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT * FROM desktop_pet_sessions
            ORDER BY last_seen_at DESC, updated_at DESC
            LIMIT ?
            """,
            (max(1, min(int(limit), 50)),),
        ).fetchall()
        return [self._desktop_pet_session_row(row) for row in rows if row is not None]

    def delete_desktop_pet_session(self, pet_session_id: str) -> bool:
        cursor = self._conn.execute(
            "DELETE FROM desktop_pet_sessions WHERE pet_session_id = ?",
            (pet_session_id,),
        )
        self._conn.commit()
        return cursor.rowcount > 0
```

**Step 5: Run store tests**

Run:

```powershell
pytest api/tests/test_desktop_pet_store.py -q
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add api/app/db/store.py api/tests/test_desktop_pet_store.py
git commit -m "feat: store desktop pet sessions"
```

### Task 5: Expose Pet Session Registry Routes

**Files:**
- Modify: `api/app/routes/desktop_pet.py`
- Modify: `api/tests/test_desktop_pet_routes.py`

**Step 1: Add failing route tests**

Append to `api/tests/test_desktop_pet_routes.py`:

```python
def test_desktop_pet_sessions_crud():
    client = _client()

    created = client.post(
        "/desktop-pet/sessions",
        json={
            "pet_session_id": "pet-1",
            "codex_session_id": "11111111-1111-1111-1111-111111111111",
            "workspace_id": "mmd-companion",
            "workspace_path": "D:/workspace/MMD project",
            "codex_home": "C:/Users/KSG/.codex",
            "display_title": None,
            "first_prompt_preview": "fix login layout and run checks",
            "last_summary": None,
            "last_status": "waiting_approval",
            "launch_mode": "workspace-write",
            "remote_url": "ws://127.0.0.1:4501",
            "app_server_pid": 1234,
            "app_server_port": 4501,
            "metadata": {"approval_count": 1},
        },
        headers={"x-user-id": "admin-1"},
    )

    assert created.status_code == 200
    assert created.json()["display_title"] == "fix login layout and run checks"

    listed = client.get("/desktop-pet/sessions?limit=5", headers={"x-user-id": "admin-1"})
    assert listed.status_code == 200
    assert listed.json()["sessions"][0]["pet_session_id"] == "pet-1"
    assert listed.json()["sessions"][0]["metadata"]["approval_count"] == 1

    deleted = client.delete("/desktop-pet/sessions/pet-1", headers={"x-user-id": "admin-1"})
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}


def test_desktop_pet_sessions_limit_is_bounded():
    client = _client()

    response = client.get("/desktop-pet/sessions?limit=500", headers={"x-user-id": "admin-1"})

    assert response.status_code == 200
    assert response.json()["limit"] == 50
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pytest api/tests/test_desktop_pet_routes.py -q
```

Expected: FAIL because `/desktop-pet/sessions` routes do not exist.

**Step 3: Add payload model and routes**

In `api/app/routes/desktop_pet.py`, add:

```python
class DesktopPetSessionPayload(BaseModel):
    pet_session_id: str = Field(min_length=1, max_length=120)
    codex_session_id: str = Field(min_length=1, max_length=200)
    workspace_id: str | None = Field(default=None, max_length=120)
    workspace_path: str = Field(min_length=1, max_length=2000)
    codex_home: str | None = Field(default=None, max_length=2000)
    display_title: str | None = Field(default=None, max_length=200)
    first_prompt_preview: str | None = Field(default=None, max_length=500)
    last_summary: str | None = Field(default=None, max_length=2000)
    last_status: str = Field(default="starting", max_length=80)
    launch_mode: str = Field(default="workspace-write", max_length=80)
    remote_url: str | None = Field(default=None, max_length=500)
    app_server_pid: int | None = None
    app_server_port: int | None = Field(default=None, ge=1, le=65535)
    metadata: dict[str, object] = Field(default_factory=dict)


@router.get("/sessions")
def list_pet_sessions(
    request: Request,
    limit: int = 10,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    bounded_limit = max(1, min(int(limit), 50))
    return {
        "sessions": request.app.state.trace_store.list_desktop_pet_sessions(limit=bounded_limit),
        "limit": bounded_limit,
    }


@router.post("/sessions")
def upsert_pet_session(
    payload: DesktopPetSessionPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    return request.app.state.trace_store.upsert_desktop_pet_session(**payload.model_dump())


@router.delete("/sessions/{pet_session_id}")
def delete_pet_session(
    pet_session_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    return {"deleted": request.app.state.trace_store.delete_desktop_pet_session(pet_session_id)}
```

**Step 4: Run route tests**

Run:

```powershell
pytest api/tests/test_desktop_pet_routes.py -q
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add api/app/routes/desktop_pet.py api/tests/test_desktop_pet_routes.py
git commit -m "feat: expose desktop pet sessions"
```

---

## Phase 3: Desktop Pet Subproject Scaffold

### Task 6: Create Independent Electron + Vite Project

**Files:**
- Create: `desktop-pet/package.json`
- Create: `desktop-pet/package-lock.json`
- Create: `desktop-pet/index.html`
- Create: `desktop-pet/tsconfig.json`
- Create: `desktop-pet/tsconfig.electron.json`
- Create: `desktop-pet/vite.config.ts`
- Create: `desktop-pet/electron/main.ts`
- Create: `desktop-pet/electron/preload.ts`
- Create: `desktop-pet/src/App.tsx`
- Create: `desktop-pet/src/main.tsx`
- Create: `desktop-pet/src/styles.css`
- Create: `desktop-pet/src/vite-env.d.ts`

**Step 1: Create package scaffold**

Use a subproject-only package. Do not add a root `package.json`.

`desktop-pet/package.json`:

```json
{
  "name": "mmd-codex-desktop-pet",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5174",
    "dev:electron": "electron .",
    "build": "tsc -p tsconfig.json && vite build && tsc -p tsconfig.electron.json",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.electron.json --noEmit",
    "test": "vitest run",
    "check": "npm run test && npm run typecheck && npm run build"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "three": "^0.181.1",
    "three-stdlib": "^2.36.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "@types/node": "^24.7.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "electron": "^39.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

If `npm install` resolves newer compatible versions, keep the generated lockfile. Do not chase unrelated dependency upgrades.

**Step 2: Install dependencies**

Run:

```powershell
npm --prefix desktop-pet install
```

Expected: creates `desktop-pet/package-lock.json`. If Electron download fails because of network restrictions, retry after approval with the same command.

**Step 3: Add Vite and TS config**

`desktop-pet/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../web/src", import.meta.url)),
    },
  },
  define: {
    "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify("http://127.0.0.1:8000"),
  },
});
```

`desktop-pet/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["../web/src/*"]
    }
  },
  "include": ["src", "../web/src/features", "../web/src/lib/types.ts"]
}
```

`desktop-pet/tsconfig.electron.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist-electron",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node", "electron"]
  },
  "include": ["electron"]
}
```

**Step 4: Add minimal Electron main/preload**

`desktop-pet/electron/main.ts`:

```ts
import { BrowserWindow, app, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

async function createPetWindow() {
  const window = new BrowserWindow({
    width: 320,
    height: 420,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setAlwaysOnTop(true, "floating");
  if (isDev) {
    await window.loadURL("http://127.0.0.1:5174");
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("pet:runtime-info", () => ({
  apiBaseUrl: "http://127.0.0.1:8000",
}));

app.whenReady().then(createPetWindow);
app.on("window-all-closed", () => app.quit());
```

`desktop-pet/electron/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopPet", {
  runtimeInfo: () => ipcRenderer.invoke("pet:runtime-info"),
});
```

`desktop-pet/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopPet: {
      runtimeInfo: () => Promise<{ apiBaseUrl: string }>;
    };
  }
}

export {};
```

**Step 5: Add minimal renderer**

`desktop-pet/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MMD Codex Pet</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`desktop-pet/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`desktop-pet/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState("http://127.0.0.1:8000");

  useEffect(() => {
    window.desktopPet?.runtimeInfo().then((info) => setApiBaseUrl(info.apiBaseUrl)).catch(() => {});
  }, []);

  return (
    <main className="pet-shell">
      <div className="pet-placeholder">
        <span className="pet-status-dot" />
        <span>Codex Pet</span>
      </div>
      <p>{apiBaseUrl}</p>
    </main>
  );
}
```

`desktop-pet/src/styles.css`:

```css
html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}

body {
  font-family: Inter, "Segoe UI", Arial, sans-serif;
}

.pet-shell {
  width: 100vw;
  height: 100vh;
  display: grid;
  place-items: center;
  color: #f7f8fb;
  user-select: none;
}

.pet-placeholder {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: rgba(24, 28, 33, 0.74);
}

.pet-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #35d07f;
}
```

**Step 6: Run checks**

Run:

```powershell
npm --prefix desktop-pet run typecheck
npm --prefix desktop-pet run build
```

Expected: both commands pass.

**Step 7: Commit**

```powershell
git add desktop-pet
git commit -m "feat: scaffold desktop pet app"
```

---

## Phase 4: Desktop API Lifecycle

### Task 7: Add API Health Check And Auto-Start In Electron Main

**Files:**
- Create: `desktop-pet/electron/apiLifecycle.ts`
- Modify: `desktop-pet/electron/main.ts`
- Test: `desktop-pet/electron/apiLifecycle.test.ts`

**Step 1: Write failing tests**

Create `desktop-pet/electron/apiLifecycle.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { resolveApiPythonCommand, shouldReuseApi } from "./apiLifecycle";

describe("api lifecycle", () => {
  it("prefers explicit pet API python env", () => {
    const resolved = resolveApiPythonCommand({
      env: { MMD_PET_API_PYTHON: "D:/venv/Scripts/python.exe" },
      apiDir: "D:/repo/api",
      exists: () => false,
    });

    expect(resolved.command).toBe("D:/venv/Scripts/python.exe");
  });

  it("uses api venv python when present", () => {
    const resolved = resolveApiPythonCommand({
      env: {},
      apiDir: "D:/repo/api",
      exists: (candidate) => candidate.endsWith("api/.venv/Scripts/python.exe"),
    });

    expect(resolved.command.replaceAll("\\", "/")).toContain("api/.venv/Scripts/python.exe");
  });

  it("reuses api only for ready health responses", async () => {
    expect(await shouldReuseApi(async () => ({ ok: true, status: 200 }))).toBe(true);
    expect(await shouldReuseApi(async () => ({ ok: false, status: 503 }))).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
npm --prefix desktop-pet test -- apiLifecycle
```

Expected: FAIL because `apiLifecycle.ts` does not exist.

**Step 3: Implement lifecycle helper**

Create `desktop-pet/electron/apiLifecycle.ts`:

```ts
import { ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type ApiRuntime = {
  apiBaseUrl: string;
  startedByPet: boolean;
  pid: number | null;
  process: ChildProcess | null;
};

export function resolveApiPythonCommand(options: {
  env: NodeJS.ProcessEnv;
  apiDir: string;
  exists?: (candidate: string) => boolean;
}) {
  const exists = options.exists ?? existsSync;
  if (options.env.MMD_PET_API_PYTHON) {
    return { command: options.env.MMD_PET_API_PYTHON };
  }
  const venvPython = path.join(options.apiDir, ".venv", "Scripts", "python.exe");
  if (exists(venvPython)) {
    return { command: venvPython };
  }
  return { command: "python" };
}

export async function shouldReuseApi(
  fetchHealth: () => Promise<{ ok: boolean; status: number }>,
): Promise<boolean> {
  try {
    const response = await fetchHealth();
    return response.ok && response.status === 200;
  } catch {
    return false;
  }
}

export async function waitForApi(apiBaseUrl: string, timeoutMs = 15000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (
      await shouldReuseApi(async () => {
        const response = await fetch(`${apiBaseUrl}/healthz`);
        return { ok: response.ok, status: response.status };
      })
    ) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

export async function ensureApiRuntime(options: {
  repoRoot: string;
  apiBaseUrl?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ApiRuntime> {
  const apiBaseUrl = options.apiBaseUrl ?? "http://127.0.0.1:8000";
  const env = options.env ?? process.env;
  if (
    await shouldReuseApi(async () => {
      const response = await fetch(`${apiBaseUrl}/healthz`);
      return { ok: response.ok, status: response.status };
    })
  ) {
    return { apiBaseUrl, startedByPet: false, pid: null, process: null };
  }

  const apiDir = path.join(options.repoRoot, "api");
  const python = resolveApiPythonCommand({ env, apiDir });
  const child = spawn(
    python.command,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: apiDir,
      env: {
        ...env,
        PYTHONPATH: apiDir,
      },
      windowsHide: true,
    },
  );

  const ready = await waitForApi(apiBaseUrl);
  if (!ready) {
    child.kill();
    throw new Error("FastAPI did not become ready on http://127.0.0.1:8000");
  }

  return { apiBaseUrl, startedByPet: true, pid: child.pid ?? null, process: child };
}
```

**Step 4: Wire Electron main**

In `desktop-pet/electron/main.ts`, compute `repoRoot` as two directories up from `dist-electron` in production and current project root in dev. Call `ensureApiRuntime()` before creating the window. Keep `ApiRuntime` in memory. On `will-quit`, kill only `runtime.process` when `startedByPet === true`.

Expected shape:

```ts
let apiRuntime: ApiRuntime | null = null;

app.whenReady().then(async () => {
  apiRuntime = await ensureApiRuntime({ repoRoot: resolveRepoRoot() });
  await createPetWindow(apiRuntime);
});

app.on("will-quit", () => {
  if (apiRuntime?.startedByPet) {
    apiRuntime.process?.kill();
  }
});
```

**Step 5: Run tests and typecheck**

Run:

```powershell
npm --prefix desktop-pet test -- apiLifecycle
npm --prefix desktop-pet run typecheck
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add desktop-pet/electron
git commit -m "feat: manage api lifecycle from desktop pet"
```

---

## Phase 5: Pet Settings And MMD Renderer

### Task 8: Add Pet-Local Settings Store For Camera, Window, And Notification Detail

**Files:**
- Create: `desktop-pet/electron/petSettings.ts`
- Modify: `desktop-pet/electron/main.ts`
- Modify: `desktop-pet/electron/preload.ts`
- Create: `desktop-pet/electron/petSettings.test.ts`

**Step 1: Write failing tests**

Create `desktop-pet/electron/petSettings.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { normalizePetSettings } from "./petSettings";

describe("pet settings", () => {
  it("defaults to low-distraction notifications and no camera", () => {
    expect(normalizePetSettings({})).toMatchObject({
      notificationDetail: "low",
      cameraSnapshot: null,
      windowBounds: null,
    });
  });

  it("preserves supported notification detail profiles", () => {
    expect(normalizePetSettings({ notificationDetail: "medium" }).notificationDetail).toBe("medium");
    expect(normalizePetSettings({ notificationDetail: "high" }).notificationDetail).toBe("high");
  });

  it("falls back from unsupported profiles", () => {
    expect(normalizePetSettings({ notificationDetail: "verbose" }).notificationDetail).toBe("low");
  });
});
```

**Step 2: Implement settings helper**

Create `desktop-pet/electron/petSettings.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type NotificationDetail = "low" | "medium" | "high";

export type PetSettings = {
  notificationDetail: NotificationDetail;
  cameraSnapshot: unknown | null;
  windowBounds: Electron.Rectangle | null;
};

export function normalizePetSettings(raw: any): PetSettings {
  const profile = raw?.notificationDetail;
  return {
    notificationDetail: profile === "medium" || profile === "high" ? profile : "low",
    cameraSnapshot: raw?.cameraSnapshot ?? null,
    windowBounds: raw?.windowBounds ?? null,
  };
}

export function readPetSettings(userDataPath: string): PetSettings {
  const settingsPath = path.join(userDataPath, "pet-settings.json");
  if (!existsSync(settingsPath)) return normalizePetSettings({});
  try {
    return normalizePetSettings(JSON.parse(readFileSync(settingsPath, "utf8")));
  } catch {
    return normalizePetSettings({});
  }
}

export function writePetSettings(userDataPath: string, settings: PetSettings): void {
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(path.join(userDataPath, "pet-settings.json"), JSON.stringify(settings, null, 2), "utf8");
}
```

**Step 3: Expose IPC**

In `preload.ts`, expose:

```ts
settings: {
  read: () => ipcRenderer.invoke("pet:settings:read"),
  write: (settings: unknown) => ipcRenderer.invoke("pet:settings:write", settings),
}
```

In `main.ts`, register handlers using `readPetSettings(app.getPath("userData"))` and `writePetSettings(...)`.

**Step 4: Run tests**

Run:

```powershell
npm --prefix desktop-pet test -- petSettings
npm --prefix desktop-pet run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add desktop-pet/electron
git commit -m "feat: persist desktop pet settings"
```

### Task 9: Add Desktop Pet Data Client

**Files:**
- Create: `desktop-pet/src/lib/apiClient.ts`
- Create: `desktop-pet/src/lib/apiClient.test.ts`
- Modify: `desktop-pet/src/vite-env.d.ts`

**Step 1: Write failing tests**

Create `desktop-pet/src/lib/apiClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./apiClient";

describe("desktop pet api client", () => {
  it("sends x-user-id for shared config", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ render_pipeline: "classic" }), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8000", userId: "admin-1", fetchImpl });

    await client.getSharedConfig();

    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "x-user-id": "admin-1" });
  });

  it("normalizes model file urls", () => {
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8000", userId: "admin-1" });

    expect(client.toAbsoluteUrl("/assets/vmd/file/a")).toBe("http://127.0.0.1:8000/assets/vmd/file/a");
  });
});
```

**Step 2: Implement client**

Create `desktop-pet/src/lib/apiClient.ts`:

```ts
export type ApiClientOptions = {
  baseUrl: string;
  userId: string;
  fetchImpl?: typeof fetch;
};

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const headers = { "x-user-id": options.userId };

  async function requestJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`API ${path} failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    toAbsoluteUrl(path: string) {
      if (/^https?:\/\//i.test(path)) return path;
      return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    },
    getSharedConfig() {
      return requestJSON<any>("/desktop-pet/shared-config");
    },
    listModels() {
      return requestJSON<any>("/assets/mmd/models");
    },
    listVmdAssets() {
      return requestJSON<any>("/assets/vmd");
    },
    listPetSessions(limit = 10) {
      return requestJSON<any>(`/desktop-pet/sessions?limit=${limit}`);
    },
    upsertPetSession(payload: unknown) {
      return requestJSON<any>("/desktop-pet/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
    },
  };
}
```

**Step 3: Run tests**

Run:

```powershell
npm --prefix desktop-pet test -- apiClient
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add desktop-pet/src/lib
git commit -m "feat: add desktop pet api client"
```

### Task 10: Render Reused MMDStage In Bare Pet Window

**Files:**
- Modify: `desktop-pet/src/App.tsx`
- Modify: `desktop-pet/src/styles.css`
- Create: `desktop-pet/src/mmd/petStageState.ts`
- Create: `desktop-pet/src/mmd/petStageState.test.ts`

**Step 1: Write state resolver tests**

Create `desktop-pet/src/mmd/petStageState.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { pickSelectedModel, selectFavoriteVmdUrls } from "./petStageState";

const models = [
  { relative_path: "Eula/Eula.pmx", url: "/assets/mmd/Eula/Eula.pmx", display_name: "Eula" },
  { relative_path: "Ayaka/Ayaka.pmx", url: "/assets/mmd/Ayaka/Ayaka.pmx", display_name: "Ayaka" },
];

describe("pet stage state", () => {
  it("selects configured model when available", () => {
    expect(pickSelectedModel(models as any, "Ayaka/Ayaka.pmx")?.relative_path).toBe("Ayaka/Ayaka.pmx");
  });

  it("falls back to first model", () => {
    expect(pickSelectedModel(models as any, "Missing.pmx")?.relative_path).toBe("Eula/Eula.pmx");
  });

  it("keeps only current model favorite vmd assets", () => {
    const urls = selectFavoriteVmdUrls(
      [
        { is_favorite: true, favorite_model_relative_path: "Eula/Eula.pmx", asset_id: "a" },
        { is_favorite: true, favorite_model_relative_path: "Ayaka/Ayaka.pmx", asset_id: "b" },
        { is_favorite: false, favorite_model_relative_path: "Eula/Eula.pmx", asset_id: "c" },
      ] as any,
      "Eula/Eula.pmx",
    );

    expect(urls).toEqual(["/assets/vmd/file/a"]);
  });
});
```

**Step 2: Implement resolver**

Create `desktop-pet/src/mmd/petStageState.ts`:

```ts
import type { MmdModelAsset, VmdAsset } from "@/lib/types";

export function pickSelectedModel(models: MmdModelAsset[], selectedModelPath: string | null | undefined) {
  return models.find((model) => model.relative_path === selectedModelPath) ?? models[0] ?? null;
}

export function selectFavoriteVmdUrls(assets: VmdAsset[], selectedModelPath: string): string[] {
  return assets
    .filter((asset) => asset.is_favorite && asset.favorite_model_relative_path === selectedModelPath)
    .map((asset) => `/assets/vmd/file/${asset.asset_id}`);
}
```

**Step 3: Replace placeholder with MMDStage**

In `desktop-pet/src/App.tsx`:

- Load runtime info and settings.
- Create API client with `userId: "admin-1"` for first version. Make this a constant near the top so later auth can replace it.
- Fetch shared config, models, and VMD assets.
- Select model via `pickSelectedModel`.
- Render:

```tsx
<MMDStage
  chrome="bare"
  interaction={interaction}
  speaking={false}
  models={models}
  selectedModelPath={selectedModel.relative_path}
  modelUrl={api.toAbsoluteUrl(selectedModel.url)}
  modelLabel={selectedModel.display_name}
  onModelChange={() => {}}
  renderPipeline={sharedConfig.render_pipeline}
  cameraSnapshot={settings.cameraSnapshot}
/>
```

Initial interaction:

```ts
const interaction = {
  emotion: "neutral",
  action: "idle",
  mode: favoriteVmdUrls.length > 0 ? "vmd" : "procedural",
  vmdLoopUrls: favoriteVmdUrls.map(api.toAbsoluteUrl),
  loopMode: "random",
  loopGapMs: 600,
};
```

Import existing stage:

```tsx
import { MMDStage } from "@/features/stage/MMDStage";
```

**Step 4: Add pet-specific CSS**

In `desktop-pet/src/styles.css`, ensure:

```css
.pet-shell {
  width: 100vw;
  height: 100vh;
  background: transparent;
}

.pet-stage {
  position: fixed;
  inset: 0;
}

.pet-stage :global(.mio-stage),
.pet-stage :global(canvas) {
  background: transparent;
}
```

If CSS modules are not used, do not include `:global`; target the real classes from `MMDStage.tsx` and `web/src/app/globals.css`. Import only the stage CSS needed if the full global CSS causes layout spillover.

**Step 5: Run tests and typecheck**

Run:

```powershell
npm --prefix desktop-pet test -- petStageState
npm --prefix desktop-pet run typecheck
```

Expected: PASS.

**Step 6: Manual smoke**

Run the API if not already running:

```powershell
python -m uvicorn app.main:app --app-dir api --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
npm --prefix desktop-pet run dev
npm --prefix desktop-pet run dev:electron
```

Expected:

- Transparent desktop pet window opens.
- MMD model loads if assets are available.
- If model loading fails, app remains open and shows an unobtrusive status text.

**Step 7: Commit**

```powershell
git add desktop-pet/src desktop-pet/electron desktop-pet/package.json desktop-pet/package-lock.json
git commit -m "feat: render mmd desktop pet"
```

---

## Phase 6: Codex Status, Notifications, And MMD Actions

### Task 11: Add Codex Status Normalizer

**Files:**
- Create: `desktop-pet/src/codex/status.ts`
- Create: `desktop-pet/src/codex/status.test.ts`

**Step 1: Write failing tests**

Create `desktop-pet/src/codex/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { normalizeCodexEvent } from "./status";

describe("codex status normalizer", () => {
  it("maps turn lifecycle events", () => {
    expect(normalizeCodexEvent({ method: "turn/started", params: {} }).status).toBe("running");
    expect(normalizeCodexEvent({ method: "turn/completed", params: { status: "success" } }).status).toBe("completed");
  });

  it("maps command, file, approval, and process events", () => {
    expect(normalizeCodexEvent({ method: "item/commandExecution/outputDelta", params: { command: "npm test" } }).status).toBe(
      "command_running",
    );
    expect(normalizeCodexEvent({ method: "item/fileChange/patchUpdated", params: { path: "web/src/app/page.tsx" } }).status).toBe(
      "file_changed",
    );
    expect(normalizeCodexEvent({ method: "item/commandExecution/requestApproval", params: { command: "git push" } }).status).toBe(
      "waiting_approval",
    );
    expect(normalizeCodexEvent({ method: "process/exited", params: { code: 1 } }).status).toBe("failed");
  });

  it("keeps unknown events non-terminal", () => {
    expect(normalizeCodexEvent({ method: "item/unknown", params: {} }).status).toBe("running");
  });
});
```

**Step 2: Implement normalizer**

Create `desktop-pet/src/codex/status.ts`:

```ts
export type CodexPetStatus =
  | "no_session"
  | "starting"
  | "running"
  | "command_running"
  | "file_changed"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "disconnected";

export type NormalizedCodexStatus = {
  status: CodexPetStatus;
  label: string;
  detail?: string;
  terminal: boolean;
};

function short(value: unknown, max = 96): string | undefined {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function normalizeCodexEvent(event: { method?: string; params?: any }): NormalizedCodexStatus {
  switch (event.method) {
    case "turn/started":
      return { status: "running", label: "Codex is working", terminal: false };
    case "item/commandExecution/outputDelta":
    case "command/exec/outputDelta":
      return {
        status: "command_running",
        label: "Running command",
        detail: short(event.params?.command ?? event.params?.cmd),
        terminal: false,
      };
    case "item/fileChange/patchUpdated":
    case "item/fileChange/outputDelta":
    case "fs/changed":
      return {
        status: "file_changed",
        label: "Files changed",
        detail: short(event.params?.path ?? event.params?.filePath),
        terminal: false,
      };
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/permissions/requestApproval":
    case "execCommandApproval":
    case "applyPatchApproval":
      return {
        status: "waiting_approval",
        label: "Codex waits for approval",
        detail: short(event.params?.command ?? event.params?.title ?? event.params?.reason),
        terminal: false,
      };
    case "turn/completed":
      return { status: "completed", label: "Codex completed", terminal: true };
    case "process/exited":
      return Number(event.params?.code ?? 0) === 0
        ? { status: "completed", label: "Codex completed", terminal: true }
        : { status: "failed", label: "Codex failed", detail: short(event.params?.error), terminal: true };
    case "error":
      return { status: "failed", label: "Codex failed", detail: short(event.params?.message), terminal: true };
    default:
      return { status: "running", label: "Codex is working", terminal: false };
  }
}
```

**Step 3: Run tests**

Run:

```powershell
npm --prefix desktop-pet test -- status
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add desktop-pet/src/codex
git commit -m "feat: normalize codex pet status"
```

### Task 12: Add Notification Policy Profiles

**Files:**
- Create: `desktop-pet/src/notifications/policy.ts`
- Create: `desktop-pet/src/notifications/policy.test.ts`

**Step 1: Write failing tests**

Create `desktop-pet/src/notifications/policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildNotification } from "./policy";

describe("notification policy", () => {
  it("low profile only notifies terminal or approval states", () => {
    expect(buildNotification("low", { status: "running", label: "Working", terminal: false })).toBeNull();
    expect(buildNotification("low", { status: "waiting_approval", label: "Approval", detail: "npm install", terminal: false })?.text).toBe(
      "Codex waits for approval",
    );
  });

  it("medium hides exact command detail", () => {
    expect(
      buildNotification("medium", {
        status: "command_running",
        label: "Running command",
        detail: "npm --prefix web run build",
        terminal: false,
      })?.text,
    ).toBe("Running command");
  });

  it("high includes sanitized short detail", () => {
    expect(
      buildNotification("high", {
        status: "command_running",
        label: "Running command",
        detail: "TOKEN=secret npm test",
        terminal: false,
      })?.text,
    ).toBe("Running command: TOKEN=[REDACTED] npm test");
  });
});
```

**Step 2: Implement policy**

Create `desktop-pet/src/notifications/policy.ts`:

```ts
import type { NormalizedCodexStatus } from "../codex/status";
import type { NotificationDetail } from "../../electron/petSettings";

const SECRET_PATTERN = /\b([A-Z0-9_]*(TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*)=([^\s]+)/gi;

function sanitize(value: string): string {
  return value.replace(SECRET_PATTERN, "$1=[REDACTED]").slice(0, 140);
}

export function buildNotification(
  profile: NotificationDetail,
  status: NormalizedCodexStatus,
): { text: string; urgency: "normal" | "critical" } | null {
  if (profile === "low") {
    if (!status.terminal && status.status !== "waiting_approval") return null;
    return {
      text:
        status.status === "waiting_approval"
          ? "Codex waits for approval"
          : status.status === "failed"
            ? "Codex failed"
            : "Codex completed",
      urgency: status.status === "failed" || status.status === "waiting_approval" ? "critical" : "normal",
    };
  }

  if (profile === "medium") {
    return { text: status.label, urgency: status.status === "failed" ? "critical" : "normal" };
  }

  return {
    text: status.detail ? `${status.label}: ${sanitize(status.detail)}` : status.label,
    urgency: status.status === "failed" || status.status === "waiting_approval" ? "critical" : "normal",
  };
}
```

**Step 3: Run tests**

Run:

```powershell
npm --prefix desktop-pet test -- policy
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add desktop-pet/src/notifications
git commit -m "feat: add desktop pet notification policy"
```

### Task 13: Add MMD Status Action Resolver

**Files:**
- Create: `desktop-pet/src/mmd/statusAction.ts`
- Create: `desktop-pet/src/mmd/statusAction.test.ts`
- Modify: `desktop-pet/src/App.tsx`

**Step 1: Write failing tests**

Create `desktop-pet/src/mmd/statusAction.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolvePetInteraction } from "./statusAction";

describe("pet status action resolver", () => {
  it("uses idle loop for no session", () => {
    const interaction = resolvePetInteraction({ status: "no_session", favoriteVmdUrls: ["/idle.vmd"] });
    expect(interaction.mode).toBe("vmd");
    expect(interaction.vmdLoopUrls).toEqual(["/idle.vmd"]);
  });

  it("approval interrupts with reminder action", () => {
    const interaction = resolvePetInteraction({ status: "waiting_approval", favoriteVmdUrls: [] });
    expect(interaction.action).toBe("remind");
    expect(interaction.mode).toBe("procedural");
  });

  it("file changed can be throttled", () => {
    const now = new Date("2026-06-03T00:00:10Z").getTime();
    const interaction = resolvePetInteraction({
      status: "file_changed",
      favoriteVmdUrls: ["/idle.vmd"],
      lastFileChangedAt: now - 1000,
      now,
    });
    expect(interaction.action).toBe("focus");
  });
});
```

**Step 2: Implement resolver**

Create `desktop-pet/src/mmd/statusAction.ts`:

```ts
import type { CodexPetStatus } from "../codex/status";

export type PetStageInteraction = {
  emotion: string;
  action: string;
  mode?: "procedural" | "vmd";
  vmdLoopUrls?: string[];
  loopMode?: "random" | "sequential";
  loopGapMs?: number;
};

export function resolvePetInteraction(options: {
  status: CodexPetStatus;
  favoriteVmdUrls: string[];
  lastFileChangedAt?: number;
  now?: number;
}): PetStageInteraction {
  const now = options.now ?? Date.now();
  const idle: PetStageInteraction =
    options.favoriteVmdUrls.length > 0
      ? {
          emotion: "neutral",
          action: "idle",
          mode: "vmd",
          vmdLoopUrls: options.favoriteVmdUrls,
          loopMode: "random",
          loopGapMs: 800,
        }
      : { emotion: "neutral", action: "idle", mode: "procedural" };

  switch (options.status) {
    case "starting":
      return { emotion: "happy", action: "wave", mode: "procedural" };
    case "running":
    case "command_running":
      return { ...idle, action: "focus" };
    case "file_changed":
      if (options.lastFileChangedAt && now - options.lastFileChangedAt < 10_000) {
        return { ...idle, action: "focus" };
      }
      return { emotion: "happy", action: "cheer", mode: "procedural" };
    case "waiting_approval":
      return { emotion: "caring", action: "remind", mode: "procedural" };
    case "completed":
      return { emotion: "happy", action: "cheer", mode: "procedural" };
    case "failed":
      return { emotion: "sad", action: "confused", mode: "procedural" };
    case "disconnected":
      return { emotion: "neutral", action: "observe", mode: "procedural" };
    case "no_session":
    default:
      return idle;
  }
}
```

**Step 3: Wire App state**

In `desktop-pet/src/App.tsx`, keep a `currentCodexStatus` state and call `resolvePetInteraction()` before rendering `MMDStage`. Use `favoriteVmdUrls` from Task 10.

**Step 4: Run tests**

Run:

```powershell
npm --prefix desktop-pet test -- statusAction
npm --prefix desktop-pet run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add desktop-pet/src/mmd desktop-pet/src/App.tsx
git commit -m "feat: drive mmd pet actions from codex status"
```

---

## Phase 7: Codex App-Server Relay

### Task 14: Add Codex App-Server Process Manager

**Files:**
- Create: `desktop-pet/electron/codexAppServer.ts`
- Create: `desktop-pet/electron/codexAppServer.test.ts`
- Modify: `desktop-pet/electron/main.ts`
- Modify: `desktop-pet/electron/preload.ts`

**Step 1: Write failing tests**

Create `desktop-pet/electron/codexAppServer.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildCodexAppServerArgs, buildCodexCliCommand } from "./codexAppServer";

describe("codex app-server commands", () => {
  it("builds loopback websocket app-server args", () => {
    expect(buildCodexAppServerArgs(4517)).toEqual(["app-server", "--listen", "ws://127.0.0.1:4517"]);
  });

  it("builds new session cli command", () => {
    expect(
      buildCodexCliCommand({
        remoteUrl: "ws://127.0.0.1:4517",
        workspacePath: "D:/workspace/MMD project",
      }),
    ).toBe('codex --remote ws://127.0.0.1:4517 --cd "D:/workspace/MMD project"');
  });

  it("builds resume cli command", () => {
    expect(
      buildCodexCliCommand({
        remoteUrl: "ws://127.0.0.1:4517",
        workspacePath: "D:/workspace/MMD project",
        codexSessionId: "11111111-1111-1111-1111-111111111111",
      }),
    ).toBe('codex resume 11111111-1111-1111-1111-111111111111 --remote ws://127.0.0.1:4517 --cd "D:/workspace/MMD project"');
  });
});
```

**Step 2: Implement command builder and process manager**

Create `desktop-pet/electron/codexAppServer.ts`:

```ts
import { ChildProcess, spawn } from "node:child_process";
import net from "node:net";

export type CodexServerRuntime = {
  port: number;
  remoteUrl: string;
  pid: number | null;
  process: ChildProcess;
};

function quotePath(path: string): string {
  return `"${path.replaceAll('"', '\\"')}"`;
}

export function buildCodexAppServerArgs(port: number): string[] {
  return ["app-server", "--listen", `ws://127.0.0.1:${port}`];
}

export function buildCodexCliCommand(options: {
  remoteUrl: string;
  workspacePath: string;
  codexSessionId?: string | null;
}): string {
  if (options.codexSessionId) {
    return `codex resume ${options.codexSessionId} --remote ${options.remoteUrl} --cd ${quotePath(options.workspacePath)}`;
  }
  return `codex --remote ${options.remoteUrl} --cd ${quotePath(options.workspacePath)}`;
}

export async function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export function startCodexAppServer(options: {
  port: number;
  codexBin?: string;
  codexHome?: string | null;
}): CodexServerRuntime {
  const remoteUrl = `ws://127.0.0.1:${options.port}`;
  const env = { ...process.env };
  if (options.codexHome) env.CODEX_HOME = options.codexHome;
  const child = spawn(options.codexBin ?? "codex", buildCodexAppServerArgs(options.port), {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { port: options.port, remoteUrl, pid: child.pid ?? null, process: child };
}
```

**Step 3: Wire IPC**

In `main.ts`, add `ipcMain.handle("pet:codex:start-app-server", ...)` that:

1. Allocates a free loopback port.
2. Starts `codex app-server --listen ws://127.0.0.1:<port>`.
3. Polls `GET http://127.0.0.1:<port>/readyz` until ready.
4. Returns `{ remoteUrl, port, pid }`.

Do not kill app-server automatically when a Codex session is still active unless user explicitly chooses close/disconnect.

**Step 4: Run tests**

Run:

```powershell
npm --prefix desktop-pet test -- codexAppServer
npm --prefix desktop-pet run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add desktop-pet/electron
git commit -m "feat: manage codex app-server for pet"
```

### Task 15: Add Relay Event Client With Fake Event Tests

**Files:**
- Create: `desktop-pet/src/codex/relayClient.ts`
- Create: `desktop-pet/src/codex/relayClient.test.ts`
- Modify: `desktop-pet/src/App.tsx`

**Step 1: Write fake relay tests**

Create `desktop-pet/src/codex/relayClient.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createRelayEventHandler } from "./relayClient";

describe("relay event handler", () => {
  it("updates status from app-server events", () => {
    const seen: string[] = [];
    const handler = createRelayEventHandler((status) => seen.push(status.status));

    handler({ method: "turn/started", params: {} });
    handler({ method: "item/commandExecution/requestApproval", params: { command: "npm install" } });
    handler({ method: "turn/completed", params: {} });

    expect(seen).toEqual(["running", "waiting_approval", "completed"]);
  });
});
```

**Step 2: Implement relay client**

Create `desktop-pet/src/codex/relayClient.ts`:

```ts
import { normalizeCodexEvent, type NormalizedCodexStatus } from "./status";

export function createRelayEventHandler(onStatus: (status: NormalizedCodexStatus) => void) {
  return (event: { method?: string; params?: any }) => {
    onStatus(normalizeCodexEvent(event));
  };
}

export function connectCodexRelay(options: {
  remoteUrl: string;
  onStatus: (status: NormalizedCodexStatus) => void;
  onError?: (error: Error) => void;
}): () => void {
  const socket = new WebSocket(options.remoteUrl);
  const handleEvent = createRelayEventHandler(options.onStatus);
  let nextId = 1;

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        method: "initialize",
        id: nextId++,
        params: {
          clientInfo: {
            name: "mmd_desktop_pet",
            title: "MMD Desktop Pet",
            version: "0.1.0",
          },
          capabilities: { experimentalApi: true },
        },
      }),
    );
    socket.send(JSON.stringify({ method: "initialized", params: {} }));
  });

  socket.addEventListener("message", (message) => {
    try {
      const event = JSON.parse(String(message.data));
      if (event.method) handleEvent(event);
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  });

  socket.addEventListener("close", () => {
    options.onStatus({ status: "disconnected", label: "Codex disconnected", terminal: true });
  });

  socket.addEventListener("error", () => {
    options.onStatus({ status: "disconnected", label: "Codex disconnected", terminal: true });
  });

  return () => socket.close();
}
```

**Step 3: Wire renderer**

When a session is started or restored, call `connectCodexRelay({ remoteUrl, onStatus })`. Update notification and MMD status state from `onStatus`.

Important: app-server WebSocket event fanout must be verified in Task 16. If a second observer connection does not receive events initiated by the CLI TUI, keep the relay client but treat status precision as fallback until the app-server protocol probe is resolved.

**Step 4: Run tests**

Run:

```powershell
npm --prefix desktop-pet test -- relayClient
npm --prefix desktop-pet run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add desktop-pet/src/codex desktop-pet/src/App.tsx
git commit -m "feat: connect desktop pet to codex relay"
```

### Task 16: Probe Real App-Server Status Precision

**Files:**
- Create: `desktop-pet/scripts/probe-app-server-events.mjs`
- Create or modify: `docs/architecture/current-system-topology.md` later in Task 22

This task determines the real precision available when a CLI TUI connects with `--remote` and the pet opens a second WebSocket observer connection.

**Step 1: Create probe script**

Create `desktop-pet/scripts/probe-app-server-events.mjs` that:

1. Starts `codex app-server --listen ws://127.0.0.1:<free-port>`.
2. Waits for `GET /readyz`.
3. Opens observer WebSocket.
4. Sends `initialize` and `initialized`.
5. Prints every server notification for 60 seconds.
6. Prints the exact command to run in another terminal:

```text
codex --remote ws://127.0.0.1:<port> --cd "<repo-root>" --no-alt-screen
```

**Step 2: Run probe**

Run:

```powershell
node desktop-pet/scripts/probe-app-server-events.mjs
```

In the VSCode terminal command printed by the script, start a simple Codex prompt. Use a harmless prompt like:

```text
status smoke test; run no commands
```

Expected if observer fanout works:

- Observer receives `turn/started`.
- Observer receives `item/agentMessage/delta` or reasoning/plan events.
- Observer receives `turn/completed`.

Expected if observer fanout does not work:

- Observer only receives initialization/account/thread events or no CLI turn events.

**Step 3: Record result in implementation notes**

If fanout works, continue with event-level precision:

```text
running / command_running / file_changed / waiting_approval / completed / failed
```

If fanout does not work, implement fallback precision:

```text
starting / connected / waiting_approval only when relay owns protocol / completed only from process or explicit registry update / disconnected
```

and add a follow-up plan to make the pet own the app-server protocol directly for full precision.

**Step 4: Commit probe**

```powershell
git add desktop-pet/scripts/probe-app-server-events.mjs
git commit -m "chore: add codex app-server event probe"
```

---

## Phase 8: VSCode Bridge Extension

### Task 17: Scaffold VSCode Bridge Extension

**Files:**
- Create: `vscode-codex-pet-bridge/package.json`
- Create: `vscode-codex-pet-bridge/tsconfig.json`
- Create: `vscode-codex-pet-bridge/src/extension.ts`
- Create: `vscode-codex-pet-bridge/src/terminalCommand.ts`
- Create: `vscode-codex-pet-bridge/src/terminalCommand.test.ts`

**Step 1: Create package**

`vscode-codex-pet-bridge/package.json`:

```json
{
  "name": "vscode-codex-pet-bridge",
  "displayName": "Codex Pet Bridge",
  "version": "0.1.0",
  "private": true,
  "publisher": "local",
  "engines": {
    "vscode": "^1.100.0"
  },
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "scripts": {
    "compile": "tsc -p .",
    "test": "vitest run",
    "check": "npm run test && npm run compile"
  },
  "devDependencies": {
    "@types/node": "^24.7.0",
    "@types/vscode": "^1.100.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

Run:

```powershell
npm --prefix vscode-codex-pet-bridge install
```

**Step 2: Add command quoting tests**

Create `vscode-codex-pet-bridge/src/terminalCommand.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildTerminalName, matchesWorkspace } from "./terminalCommand";

describe("VSCode bridge terminal helpers", () => {
  it("uses stable terminal name", () => {
    expect(buildTerminalName("D:/workspace/MMD project")).toBe("Codex Pet");
  });

  it("matches workspace case-insensitively on Windows style paths", () => {
    expect(matchesWorkspace("D:/workspace/MMD project", "d:/workspace/mmd project")).toBe(true);
  });
});
```

**Step 3: Implement terminal helper**

Create `vscode-codex-pet-bridge/src/terminalCommand.ts`:

```ts
import path from "node:path";

export function buildTerminalName(_workspacePath: string): string {
  return "Codex Pet";
}

export function normalizeWorkspacePath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase();
}

export function matchesWorkspace(a: string, b: string): boolean {
  return normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}
```

**Step 4: Implement extension**

Create `vscode-codex-pet-bridge/src/extension.ts`:

```ts
import * as vscode from "vscode";

import { buildTerminalName, matchesWorkspace } from "./terminalCommand";

type RunRequest = {
  workspacePath: string;
  command: string;
  codexHome?: string | null;
};

function currentWorkspaceMatches(workspacePath: string): boolean {
  return (vscode.workspace.workspaceFolders || []).some((folder) =>
    matchesWorkspace(folder.uri.fsPath, workspacePath),
  );
}

async function runInTerminal(request: RunRequest) {
  if (!currentWorkspaceMatches(request.workspacePath)) {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(request.workspacePath), false);
    return { openedFolder: true, ranCommand: false };
  }

  const terminalName = buildTerminalName(request.workspacePath);
  const terminal =
    vscode.window.terminals.find((candidate) => candidate.name === terminalName) ||
    vscode.window.createTerminal({
      name: terminalName,
      cwd: request.workspacePath,
      env: request.codexHome ? { CODEX_HOME: request.codexHome } : undefined,
    });

  terminal.show(true);
  terminal.sendText(request.command, true);
  return { openedFolder: false, ranCommand: true };
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("codexPet.runInTerminal", runInTerminal),
  );
}

export function deactivate() {}
```

This direct command is testable from command palette. Task 18 adds the desktop pet transport that invokes it.

**Step 5: Run checks**

Run:

```powershell
npm --prefix vscode-codex-pet-bridge run check
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add vscode-codex-pet-bridge
git commit -m "feat: scaffold vscode codex pet bridge"
```

### Task 18: Add VSCode Bridge Window Registry And Pet Launcher

**Files:**
- Modify: `vscode-codex-pet-bridge/src/extension.ts`
- Create: `vscode-codex-pet-bridge/src/windowRegistry.ts`
- Create: `vscode-codex-pet-bridge/src/windowRegistry.test.ts`
- Create: `desktop-pet/electron/vscodeBridge.ts`
- Create: `desktop-pet/electron/vscodeBridge.test.ts`
- Modify: `desktop-pet/electron/main.ts`
- Modify: `desktop-pet/electron/preload.ts`

Use a local per-window bridge registry instead of guessing which VSCode window owns a terminal.

**Step 1: Add registry tests**

Create `vscode-codex-pet-bridge/src/windowRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isRegistryEntryForWorkspace } from "./windowRegistry";

describe("window registry", () => {
  it("matches target workspace", () => {
    expect(
      isRegistryEntryForWorkspace(
        { workspaceFolders: ["D:/workspace/MMD project"], port: 46017, updatedAt: "2026-06-03T00:00:00Z" },
        "d:/workspace/mmd project",
      ),
    ).toBe(true);
  });
});
```

**Step 2: Implement extension registry**

Create `vscode-codex-pet-bridge/src/windowRegistry.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { matchesWorkspace } from "./terminalCommand";

export type BridgeRegistryEntry = {
  workspaceFolders: string[];
  port: number;
  updatedAt: string;
};

export function registryDir(): string {
  return path.join(os.homedir(), ".mmd-codex-pet", "vscode-windows");
}

export function writeRegistryEntry(windowId: string, entry: BridgeRegistryEntry): void {
  const dir = registryDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${windowId}.json`), JSON.stringify(entry, null, 2), "utf8");
}

export function readRegistryEntries(): BridgeRegistryEntry[] {
  const dir = registryDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(path.join(dir, name), "utf8")) as BridgeRegistryEntry];
      } catch {
        return [];
      }
    });
}

export function isRegistryEntryForWorkspace(entry: BridgeRegistryEntry, workspacePath: string): boolean {
  return entry.workspaceFolders.some((folder) => matchesWorkspace(folder, workspacePath));
}
```

In `extension.ts`, start a small loopback HTTP server on an ephemeral port. It accepts `POST /run-terminal` with `RunRequest`, calls `runInTerminal`, and returns JSON. Write a registry entry on activation and whenever workspace folders change.

**Step 3: Add desktop launcher tests**

Create `desktop-pet/electron/vscodeBridge.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildCodeOpenArgs, findBridgeEntryForWorkspace } from "./vscodeBridge";

describe("desktop vscode bridge launcher", () => {
  it("opens a workspace without forcing a new window by default", () => {
    expect(buildCodeOpenArgs("D:/workspace/MMD project")).toEqual(["--reuse-window", "D:/workspace/MMD project"]);
  });

  it("selects readable matching registry entry", () => {
    const entry = findBridgeEntryForWorkspace(
      [
        { workspaceFolders: ["D:/other"], port: 1, updatedAt: "2026-06-03T00:00:00Z" },
        { workspaceFolders: ["D:/workspace/MMD project"], port: 2, updatedAt: "2026-06-03T00:00:01Z" },
      ],
      "d:/workspace/mmd project",
    );

    expect(entry?.port).toBe(2);
  });
});
```

**Step 4: Implement desktop launcher**

Create `desktop-pet/electron/vscodeBridge.ts`:

```ts
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type BridgeRegistryEntry = {
  workspaceFolders: string[];
  port: number;
  updatedAt: string;
};

function normalizeWorkspacePath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/").toLowerCase();
}

export function buildCodeOpenArgs(workspacePath: string, forceNewWindow = false): string[] {
  return [forceNewWindow ? "-n" : "--reuse-window", workspacePath];
}

export function registryDir(): string {
  return path.join(os.homedir(), ".mmd-codex-pet", "vscode-windows");
}

export function readBridgeRegistryEntries(): BridgeRegistryEntry[] {
  const dir = registryDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(path.join(dir, name), "utf8")) as BridgeRegistryEntry];
      } catch {
        return [];
      }
    });
}

export function findBridgeEntryForWorkspace(
  entries: BridgeRegistryEntry[],
  workspacePath: string,
): BridgeRegistryEntry | null {
  const target = normalizeWorkspacePath(workspacePath);
  return (
    entries
      .filter((entry) => entry.workspaceFolders.some((folder) => normalizeWorkspacePath(folder) === target))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export async function openWorkspaceInVSCode(workspacePath: string): Promise<void> {
  const codeBin = process.env.MMD_PET_CODE_BIN || "code";
  spawn(codeBin, buildCodeOpenArgs(workspacePath), { windowsHide: true, detached: true });
}
```

Add a `runCodexInVSCode()` helper that:

1. Checks registry for matching workspace.
2. If missing, runs `code --reuse-window "<workspace>"`.
3. Waits up to 10 seconds for a matching registry entry.
4. `fetch("http://127.0.0.1:<port>/run-terminal", { method: "POST", body: JSON.stringify(request) })`.
5. If unavailable, returns fallback command text so UI can show the command to run manually.

**Step 5: Wire IPC**

Expose:

```ts
vscode: {
  runCodex: (request: { workspacePath: string; command: string; codexHome?: string | null }) =>
    ipcRenderer.invoke("pet:vscode:run-codex", request),
}
```

**Step 6: Run checks**

Run:

```powershell
npm --prefix vscode-codex-pet-bridge run check
npm --prefix desktop-pet test -- vscodeBridge
npm --prefix desktop-pet run typecheck
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add vscode-codex-pet-bridge desktop-pet/electron
git commit -m "feat: bridge desktop pet to vscode terminal"
```

---

## Phase 9: Context Menu And Session Restore

### Task 19: Build Readable Session Menu Labels

**Files:**
- Create: `desktop-pet/src/codex/sessionMenu.ts`
- Create: `desktop-pet/src/codex/sessionMenu.test.ts`

**Step 1: Write failing tests**

Create `desktop-pet/src/codex/sessionMenu.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatSessionMenuLabel, shortSessionId } from "./sessionMenu";

describe("session menu labels", () => {
  it("formats readable restore labels without uuid noise", () => {
    const label = formatSessionMenuLabel(
      {
        display_title: "web login layout fix",
        workspace_path: "D:/workspace/MMD project",
        last_status: "waiting_approval",
        last_seen_at: "2026-06-02T15:18:00Z",
        codex_session_id: "11111111-2222-3333-4444-555555555555",
      } as any,
      new Date("2026-06-03T00:00:00+08:00"),
    );

    expect(label).toContain("Continue: web login layout fix");
    expect(label).toContain("waiting approval");
    expect(label).not.toContain("11111111-2222");
  });

  it("shortens ids only for details", () => {
    expect(shortSessionId("11111111-2222-3333-4444-555555555555")).toBe("11111111...55555555");
  });
});
```

**Step 2: Implement formatter**

Create `desktop-pet/src/codex/sessionMenu.ts`:

```ts
const STATUS_LABELS: Record<string, string> = {
  no_session: "no session",
  starting: "starting",
  running: "running",
  command_running: "running command",
  file_changed: "changed files",
  waiting_approval: "waiting approval",
  completed: "completed",
  failed: "failed",
  disconnected: "disconnected",
};

export function shortSessionId(id: string): string {
  const compact = id.replaceAll("-", "");
  if (compact.length <= 16) return compact;
  return `${compact.slice(0, 8)}...${compact.slice(-8)}`;
}

export function formatSessionMenuLabel(session: any, now = new Date()): string {
  const title = String(session.display_title || "Codex session").slice(0, 48);
  const status = STATUS_LABELS[session.last_status] || session.last_status || "unknown";
  const seen = new Date(session.last_seen_at || session.updated_at || now);
  const sameDay = seen.toDateString() === now.toDateString();
  const time = sameDay
    ? seen.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : seen.toLocaleDateString([], { month: "short", day: "numeric" });
  return `Continue: ${title} · ${time} · ${status}`;
}
```

**Step 3: Run tests**

Run:

```powershell
npm --prefix desktop-pet test -- sessionMenu
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add desktop-pet/src/codex/sessionMenu.ts desktop-pet/src/codex/sessionMenu.test.ts
git commit -m "feat: format readable codex session menu labels"
```

### Task 20: Add Native Right-Click Menu

**Files:**
- Modify: `desktop-pet/electron/main.ts`
- Modify: `desktop-pet/electron/preload.ts`
- Modify: `desktop-pet/src/App.tsx`
- Modify: `desktop-pet/src/styles.css`

Menu must include:

- New Codex Session
- Recent sessions, maximum 8-10 visible
- More Sessions...
- Notification Detail: Low / Medium / High
- Focus VSCode Terminal
- Retry API when API unavailable
- Close

**Step 1: Add IPC contract**

In `preload.ts`, expose:

```ts
menu: {
  openContextMenu: () => ipcRenderer.invoke("pet:menu:open-context"),
  onAction: (callback: (action: any) => void) => {
    const listener = (_event: unknown, action: any) => callback(action);
    ipcRenderer.on("pet:menu:action", listener);
    return () => ipcRenderer.removeListener("pet:menu:action", listener);
  },
}
```

**Step 2: Build menu in main**

In `main.ts`, `ipcMain.handle("pet:menu:open-context", ...)` should:

1. Fetch `/desktop-pet/sessions?limit=10`.
2. Read current settings.
3. Build Electron `Menu`.
4. Use readable labels from a main-process equivalent helper or pass labels from renderer. Do not show raw UUID in the main menu.
5. Send selected action to renderer via `webContents.send("pet:menu:action", action)`.

Actions:

```ts
{ type: "new-session" }
{ type: "restore-session", petSessionId: string }
{ type: "notification-detail", profile: "low" | "medium" | "high" }
{ type: "focus-vscode" }
{ type: "close" }
```

**Step 3: Handle actions in renderer**

In `App.tsx`:

- `new-session` starts app-server, creates/updates registry row, builds CLI command, calls VSCode bridge.
- `restore-session` finds selected registry row, starts a new app-server port, builds `codex resume <SESSION_ID> --remote ... --cd "<workspace>"`, calls VSCode bridge.
- `notification-detail` writes pet-local settings and changes policy.
- `focus-vscode` reruns bridge focus with no command if supported; otherwise opens workspace.

**Step 4: Add manual smoke**

Run:

```powershell
npm --prefix desktop-pet run dev
npm --prefix desktop-pet run dev:electron
```

Expected:

- Right-click opens native menu.
- Notification detail can switch Low/Medium/High and persists after restart.
- Session labels are readable.

**Step 5: Run checks**

Run:

```powershell
npm --prefix desktop-pet run typecheck
npm --prefix desktop-pet test
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add desktop-pet
git commit -m "feat: add desktop pet context menu"
```

### Task 21: Implement New And Restore Session Flow

**Files:**
- Modify: `desktop-pet/src/App.tsx`
- Create: `desktop-pet/src/codex/sessionLaunch.ts`
- Create: `desktop-pet/src/codex/sessionLaunch.test.ts`
- Modify: `desktop-pet/electron/main.ts`
- Modify: `desktop-pet/electron/preload.ts`

**Step 1: Write launch tests**

Create `desktop-pet/src/codex/sessionLaunch.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildPetSessionRecord } from "./sessionLaunch";

describe("session launch records", () => {
  it("stores metadata needed for resume without storing transcript", () => {
    const record = buildPetSessionRecord({
      codexSessionId: "11111111-1111-1111-1111-111111111111",
      workspaceId: "mmd-companion",
      workspacePath: "D:/workspace/MMD project",
      codexHome: "C:/Users/KSG/.codex",
      remoteUrl: "ws://127.0.0.1:4517",
      port: 4517,
      pid: 1234,
      launchMode: "workspace-write",
      firstPromptPreview: "fix login",
    });

    expect(record.codex_session_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(record.metadata).not.toHaveProperty("transcript");
  });
});
```

**Step 2: Implement launch helper**

Create `desktop-pet/src/codex/sessionLaunch.ts`:

```ts
export function buildPetSessionRecord(options: {
  codexSessionId: string;
  workspaceId: string | null;
  workspacePath: string;
  codexHome?: string | null;
  remoteUrl: string;
  port: number;
  pid: number | null;
  launchMode: string;
  firstPromptPreview?: string | null;
}) {
  return {
    pet_session_id: crypto.randomUUID(),
    codex_session_id: options.codexSessionId,
    workspace_id: options.workspaceId,
    workspace_path: options.workspacePath,
    codex_home: options.codexHome ?? null,
    display_title: null,
    first_prompt_preview: options.firstPromptPreview ?? null,
    last_summary: null,
    last_status: "starting",
    launch_mode: options.launchMode,
    remote_url: options.remoteUrl,
    app_server_pid: options.pid,
    app_server_port: options.port,
    metadata: {},
  };
}
```

Keep `metadata` transcript-free. Pet registry rows are display and launch metadata only.

**Step 3: Implement new session**

Renderer action flow:

```text
new-session
  -> ipc pet:codex:start-app-server
  -> build command: codex --remote ws://127.0.0.1:<port> --cd "<workspace>"
  -> post /desktop-pet/sessions
  -> ipc pet:vscode:run-codex
  -> connect relay observer
  -> status starting/running
```

Use default workspace from `GET /codex/workspaces`; prefer `mmd-companion` if present, otherwise first workspace.

**Step 4: Implement restore session**

Renderer action flow:

```text
restore-session
  -> selected registry row
  -> ipc pet:codex:start-app-server
  -> build command: codex resume <SESSION_ID> --remote ws://127.0.0.1:<port> --cd "<workspace>"
  -> update registry status starting + new remote_url/app_server_port
  -> ipc pet:vscode:run-codex
  -> connect relay observer
```

Guarantee session storage:

- Do not change `CODEX_HOME` unless the registry row has `codex_home`.
- If `codex_home` is present, set it for both app-server process and VSCode terminal env.
- Never delete Codex transcript/history files from pet UI.
- Registry delete only removes pet metadata row.

**Step 5: Run tests and typecheck**

Run:

```powershell
npm --prefix desktop-pet test -- sessionLaunch
npm --prefix desktop-pet run typecheck
```

Expected: PASS.

**Step 6: Manual smoke**

Install or launch the VSCode bridge extension manually from `vscode-codex-pet-bridge`.

Run desktop pet, right-click:

1. New Codex Session.
2. Verify VSCode opens/reuses `D:\workspace\MMD project`.
3. Verify terminal name is `Codex Pet`.
4. Verify terminal command contains `--remote ws://127.0.0.1:<port>` and `--cd`.
5. Close terminal session.
6. Right-click recent session and restore.
7. Verify command uses `codex resume <SESSION_ID>`.

**Step 7: Commit**

```powershell
git add desktop-pet
git commit -m "feat: launch and restore codex sessions from pet"
```

---

## Phase 10: Architecture Documentation

### Task 22: Update Current System Topology

**Files:**
- Modify: `docs/architecture/current-system-topology.md`

**Step 1: Update overview**

In section 1, extend the topology diagram to include:

```text
Desktop Pet / Electron
  -> FastAPI API
  -> Codex app-server ws://127.0.0.1:<dynamic-port>
  -> VSCode Bridge Extension
    -> VSCode Integrated Terminal
      -> codex --remote / codex resume --remote
```

**Step 2: Update service table**

Add rows:

```markdown
| Desktop MMD Codex Pet | `desktop-pet/`, dev `http://127.0.0.1:5174` + Electron | Transparent always-on-top MMD status/reminder widget, API lifecycle, context menu, Codex session restore | New optional subproject | `npm --prefix desktop-pet run check` |
| VSCode Codex Pet Bridge | `vscode-codex-pet-bridge/` | Reuse/open workspace terminal and run Codex remote/resume commands | Optional local extension | `npm --prefix vscode-codex-pet-bridge run check` |
| Codex Pet App-Server | `codex app-server --listen ws://127.0.0.1:<port>` | Local structured Codex status source for pet-managed sessions | Dynamic local process | `GET /readyz`, event probe |
```

**Step 3: Add API contract notes**

Add a subsection near Codex interactive or config:

```markdown
Desktop pet adds `/desktop-pet/shared-config` for per-user selected MMD model/render pipeline and `/desktop-pet/sessions` for pet-owned Codex session registry metadata. The registry does not store Codex transcripts; Codex resume data remains under the user's `CODEX_HOME`.
```

**Step 4: Add runtime behavior notes**

Document:

- Pet starts FastAPI only if `/healthz` is unavailable.
- Pet stops only API processes it owns.
- App-server WebSocket is loopback-only and experimental.
- First version notifies approvals and focuses VSCode; it does not approve/deny inside pet.
- Pet camera/window/notification detail are stored in Electron userData, not shared companion API.

**Step 5: Commit**

```powershell
git add docs/architecture/current-system-topology.md
git commit -m "docs: update topology for desktop codex pet"
```

---

## Phase 11: Final Verification

### Task 23: Run Focused Automated Checks

**Files:**
- Read only

**Step 1: API checks**

Run:

```powershell
pytest api/tests/test_desktop_pet_store.py api/tests/test_desktop_pet_routes.py -q
pytest api/tests/test_codex_store.py api/tests/test_codex_interactive_routes.py -q
pytest api/tests/test_config_assets_trace_routes.py -q
```

Expected: PASS.

**Step 2: Web checks**

Run:

```powershell
npm --prefix web run check:basic
```

Expected:

```text
basic checks passed
```

**Step 3: Desktop pet checks**

Run:

```powershell
npm --prefix desktop-pet run check
```

Expected: Vitest, typecheck, and Vite/Electron build pass.

**Step 4: VSCode bridge checks**

Run:

```powershell
npm --prefix vscode-codex-pet-bridge run check
```

Expected: Vitest and TypeScript compile pass.

**Step 5: Commit nothing**

If checks require fixes, implement them in the relevant task area and commit the fix. Otherwise do not commit.

### Task 24: Run Manual Desktop Acceptance

**Files:**
- Read only unless a bug is found

**Step 1: Start desktop pet**

Run:

```powershell
npm --prefix desktop-pet run dev
npm --prefix desktop-pet run dev:electron
```

Expected:

- API is reused if already running.
- API is started if not running.
- Transparent always-on-top pet window appears.
- MMD model loads with current shared selected model and render pipeline.
- Pet camera does not change `/companion` camera.

**Step 2: Verify context menu**

Right-click pet.

Expected:

- Notification detail switches among Low, Medium, High.
- Recent sessions are readable and do not expose raw UUID-heavy labels.
- Close exits pet.

**Step 3: Verify new session**

Right-click `New Codex Session`.

Expected:

- VSCode opens or reuses the workspace.
- Integrated terminal named `Codex Pet` appears.
- Command uses:

```text
codex --remote ws://127.0.0.1:<port> --cd "<workspace>"
```

- Pet status changes to starting/running.

**Step 4: Verify restore**

Right-click a recent session.

Expected:

- Terminal command uses:

```text
codex resume <SESSION_ID> --remote ws://127.0.0.1:<port> --cd "<workspace>"
```

- Existing Codex session resumes normally.
- Registry remains readable after pet restart.

**Step 5: Verify approval reminder**

Trigger a command that requires approval.

Expected:

- Low detail: only approval reminder appears.
- Medium detail: command approval stage appears without command detail.
- High detail: short sanitized command detail appears.
- Clicking/focus action brings VSCode terminal forward.
- Pet does not approve or deny the action.

**Step 6: Verify failure and disconnect**

Stop app-server or force a harmless failure.

Expected:

- Pet enters disconnected or failed status.
- MMD action changes.
- Context menu still works.

### Task 25: Final Git Review

**Files:**
- Read only

**Step 1: Inspect history**

Run:

```powershell
git log --oneline --decorate -n 20
git status --short
```

Expected:

- Commits are small and task-oriented.
- `git status --short` is empty.

**Step 2: Inspect high-level diff**

Run:

```powershell
git diff --stat 31061be..HEAD
```

Expected:

- Changes are limited to API desktop pet routes/store/tests, web shared config mirroring, `desktop-pet/`, `vscode-codex-pet-bridge/`, and architecture docs.

**Step 3: Stop background processes**

Stop any dev servers or Electron instances started for manual checks. Do not kill external API or Codex sessions that were not started by the pet.

**Step 4: Completion response**

Report:

- Plan/design implemented.
- Verification commands and whether they passed.
- Manual acceptance results.
- Any remaining app-server event fanout limitation found by Task 16.

---

## Implementation Notes

- Keep `desktop-pet` independently runnable with `npm --prefix desktop-pet ...`.
- Do not put pet camera into API shared config. Pet camera is stored in Electron userData only.
- Do not scan all local Codex history for the first version. Show only sessions that pet created or restored.
- Do not expose pet-side approve/deny in the first version. Approval events only notify and focus VSCode.
- Keep app-server listener on `127.0.0.1` and dynamic ports.
- Keep Codex transcript storage under the user's normal `CODEX_HOME`. The registry is metadata for display and resume commands only.
- If `codex app-server` WebSocket fanout cannot observe CLI-initiated turns, document the precision downgrade and keep the relay probe committed for future protocol work.
