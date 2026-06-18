from pathlib import Path
from uuid import uuid4

from app.db.store import TraceStore


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def _seed_pet_session(store: TraceStore) -> dict:
    return store.upsert_desktop_pet_session(
        pet_session_id="codex:knowledge-memory",
        codex_session_id="knowledge-memory",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Knowledge memory",
        first_prompt_preview="Recover desktop pet window binding after remote launch",
        last_summary="Persist the session-window binding before pet restart.",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )


def test_create_codex_review_memory_from_item_extracts_actionable_knowledge_details():
    store = _store()
    pet = _seed_pet_session(store)
    review = store.create_codex_review_item(
        item_id="review-knowledge-item",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type="pitfall",
        title="Persist pet window binding to disk",
        summary="The window thumbnail stayed in the taskbar because the binding only lived in memory.",
        details={
            "symptom": "The taskbar showed a pet thumbnail, but no actual desktop window could be restored.",
            "root_cause": "The remote window binding was only kept in memory and was lost after restart.",
            "fix": "Persist the pet session to window handle mapping and reload it on startup before restore calls.",
            "prevention": "Add a startup reconciliation step that clears stale handles and verifies the restored hwnd exists.",
            "evidence_refs": ["event_restore_failed_1"],
        },
        tags=["desktop-pet", "window-binding"],
        severity="high",
        status="draft",
        source="openclaw",
        source_hash="review-knowledge-hash",
    )

    memory = store.create_codex_review_memory_from_item(
        review_item_id=review["id"],
        title=review["title"],
        body=None,
        confirmed_by="admin-1",
    )

    assert memory["memory_type"] == "pitfall"
    assert memory["details"] == {
        "knowledge_kind": "pitfall",
        "problem": "The taskbar showed a pet thumbnail, but no actual desktop window could be restored.",
        "root_cause": "The remote window binding was only kept in memory and was lost after restart.",
        "steps": [
            "Persist the pet session to window handle mapping and reload it on startup before restore calls."
        ],
        "verification": [
            "Add a startup reconciliation step that clears stale handles and verifies the restored hwnd exists."
        ],
        "when_to_use": "Use when handling accepted pitfall review items.",
        "source_summary": "The window thumbnail stayed in the taskbar because the binding only lived in memory.",
    }
    assert "## Root Cause" in memory["body"]
    assert "## Steps" in memory["body"]
    assert "reload it on startup before restore calls" in memory["body"]
