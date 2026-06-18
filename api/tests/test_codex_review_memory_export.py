from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db.store import TraceStore
from app.main import create_app
from app.services.codex_review_memory_export import export_codex_review_memory_markdown


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def _seed_memory(store: TraceStore) -> dict:
    pet = store.upsert_desktop_pet_session(
        pet_session_id="codex:export-session",
        codex_session_id="export-session",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Export session",
        first_prompt_preview="Export memory",
        last_summary="Exported memory",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )
    review = store.create_codex_review_item(
        item_id="review-export-item",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type="pitfall",
        title="OpenClaw JSON contract",
        summary="Review output must be JSON.",
        details={"evidence_refs": ["ev_export"]},
        tags=["codex", "review"],
        severity="high",
        status="accepted",
        source="openclaw",
        source_hash="export-hash",
    )
    return store.create_codex_review_memory_from_item(
        review_item_id=review["id"],
        title=review["title"],
        body=review["summary"],
        confirmed_by="admin-1",
    )


def test_export_memory_writes_markdown_with_frontmatter():
    store = _store()
    memory = _seed_memory(store)
    export_root = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex / "openkb"

    result = export_codex_review_memory_markdown(memory, export_root)

    assert result.status == "synced_markdown"
    assert result.document_ref.endswith(".md")
    text = result.path.read_text(encoding="utf-8")
    assert "source_review_item_id: review-export-item" in text
    assert "workspace_id: mmd-companion" in text
    assert "version: 1" in text
    assert "# OpenClaw JSON contract" in text
    assert "## Problem" in text
    assert "## Steps" in text
    assert "## Verification" in text
    assert "Review output must be JSON." in text


def test_memory_export_route_writes_markdown_and_updates_export_status():
    root = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    client = TestClient(
        create_app(
            {
                "data_dir": str(root),
                "admin_user_ids": ["admin-1"],
                "codex_review_memory_export_root": str(root / "openkb" / "codex-review"),
            }
        )
    )
    memory = _seed_memory(client.app.state.trace_store)

    response = client.post(
        "/codex/reviews/memory/export",
        json={"memory_ids": [memory["id"]], "target": "markdown", "force": False},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["exported"] == 1
    assert payload["failed"] == 0
    exported = client.app.state.trace_store.get_codex_review_memory(memory["id"])
    assert exported["export_status"] == "synced"
    assert exported["openkb_document_id"].endswith(".md")


def test_memory_export_route_syncs_enabled_openkb_after_markdown_export():
    class FakeOpenKbClient:
        def __init__(self):
            self.calls = []

        async def upsert_document(self, *, document_id: str, title: str, markdown: str, metadata: dict):
            self.calls.append(
                {
                    "document_id": document_id,
                    "title": title,
                    "markdown": markdown,
                    "metadata": metadata,
                }
            )

            class Result:
                status = "synced"
                document_id = "openkb-doc-1"

            return Result()

    root = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    client = TestClient(
        create_app(
            {
                "data_dir": str(root),
                "admin_user_ids": ["admin-1"],
                "codex_review_memory_export_root": str(root / "openkb" / "codex-review"),
                "openkb_sync_enabled": True,
                "openkb_base_url": "http://openkb.local",
            }
        )
    )
    fake_client = FakeOpenKbClient()
    client.app.state.openkb_client = fake_client
    memory = _seed_memory(client.app.state.trace_store)

    response = client.post(
        "/codex/reviews/memory/export",
        json={"memory_ids": [memory["id"]], "target": "openkb", "force": False},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["exported"] == 1
    assert payload["failed"] == 0
    assert payload["items"][0]["status"] == "synced_openkb"
    assert fake_client.calls[0]["document_id"] == memory["id"]
    assert "# OpenClaw JSON contract" in fake_client.calls[0]["markdown"]
    assert "## Steps" in fake_client.calls[0]["markdown"]
    assert fake_client.calls[0]["metadata"]["workspace_id"] == "mmd-companion"
    assert fake_client.calls[0]["metadata"]["source_review_item_id"] == "review-export-item"
    exported = client.app.state.trace_store.get_codex_review_memory(memory["id"])
    assert exported["export_status"] == "synced"
    assert exported["openkb_document_id"] == "openkb-doc-1"
