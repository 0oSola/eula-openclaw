from pathlib import Path
from uuid import uuid4

from app.db.store import TraceStore


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def _seed_pet_session(store: TraceStore, *, workspace_id: str = "mmd-companion") -> dict:
    return store.upsert_desktop_pet_session(
        pet_session_id="codex:memory-session",
        codex_session_id="memory-session",
        workspace_id=workspace_id,
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Memory session",
        first_prompt_preview="Implement memory",
        last_summary="Built review memory",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )


def _seed_review_item(store: TraceStore, *, workspace_id: str | None = "mmd-companion") -> dict:
    pet = _seed_pet_session(store, workspace_id=workspace_id)
    return store.create_codex_review_item(
        item_id="review-memory-item",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type="pitfall",
        title="OpenClaw response must be JSON",
        summary="Non-JSON review output should not enter memory.",
        details={"evidence_refs": ["event_turn_failed_1"]},
        tags=["codex", "openclaw"],
        severity="high",
        status="draft",
        source="openclaw",
        source_hash="review-memory-hash",
    )


def _memory_draft() -> dict:
    return {
        "knowledge_kind": "pitfall",
        "problem": "任务栏有缩略图，但 Pet 实际窗口没有出现在桌面上。",
        "root_cause": "session-hwnd 映射只存在内存中。",
        "when_to_use": "restore 命中缩略图但桌面没有实际窗口时使用。",
        "prerequisites": ["定位当前 pet session id"],
        "steps": [
            {
                "order": 1,
                "instruction": "在退出前保存 session-hwnd 绑定。",
                "commands": [],
                "file_refs": ["desktop-pet/src/window/sessionWindowBindings.ts"],
                "evidence_refs": ["event_turn_failed_1"],
            }
        ],
        "verification": [
            {
                "order": 1,
                "instruction": "重启后执行 restore。",
                "commands": ["pytest api/tests/test_desktop_pet_routes.py -q"],
                "expected_signal": "实际窗口重新可见且可聚焦。",
                "evidence_refs": ["event_turn_failed_1"],
            }
        ],
        "cautions": ["不要复用失效 hwnd。"],
        "source_summary": "Persist window binding before restart.",
        "open_questions": [],
        "confidence": 0.9,
    }


def test_accepting_review_item_creates_workspace_scoped_memory_once():
    store = _store()
    review = _seed_review_item(store)

    memory = store.create_codex_review_memory_from_item(
        review_item_id=review["id"],
        title=review["title"],
        body=review["summary"],
        confirmed_by="admin-1",
    )
    again = store.create_codex_review_memory_from_item(
        review_item_id=review["id"],
        title=review["title"],
        body=review["summary"],
        confirmed_by="admin-1",
    )

    assert memory["id"] == again["id"]
    assert memory["workspace_id"] == "mmd-companion"
    assert memory["source_review_item_id"] == review["id"]
    assert memory["memory_type"] == "pitfall"
    assert memory["title"] == "OpenClaw response must be JSON"
    assert "## Problem" in memory["body"]
    assert "## Steps" in memory["body"]
    assert "## Verification" in memory["body"]
    assert memory["tags"] == ["codex", "openclaw"]
    assert memory["evidence_refs"] == ["event_turn_failed_1"]
    assert memory["details"]["problem"] == "Non-JSON review output should not enter memory."
    assert memory["details"]["root_cause"] == ""
    assert memory["details"]["steps"] == ["Turn the accepted review item into an explicit procedure before exporting it."]
    assert memory["details"]["verification"] == ["Verify the procedure against the attached evidence before publishing it."]
    assert memory["details"]["knowledge_kind"] == "pitfall"
    assert memory["current_version"] == 1
    assert memory["export_status"] == "pending"


def test_accepting_legacy_unscoped_review_item_uses_default_workspace():
    store = _store()
    review = _seed_review_item(store, workspace_id=None)

    memory = store.create_codex_review_memory_from_item(
        review_item_id=review["id"],
        title=review["title"],
        body=review["summary"],
        confirmed_by="admin-1",
        default_workspace_id="mmd-companion",
    )

    assert memory["workspace_id"] == "mmd-companion"


def test_review_memory_edits_append_versions_without_overwriting_history():
    store = _store()
    review = _seed_review_item(store)
    memory = store.create_codex_review_memory_from_item(
        review_item_id=review["id"],
        title=review["title"],
        body=review["summary"],
        confirmed_by="admin-1",
    )

    updated = store.append_codex_review_memory_version(
        memory["id"],
        title="Require strict review JSON",
        body="## Problem\n\nAccepted memory was edited after export.\n",
        edited_by="admin-1",
    )

    assert updated["current_version"] == 2
    assert updated["title"] == "Require strict review JSON"
    versions = store.list_codex_review_memory_versions(memory["id"])
    assert [(item["version"], item["title"]) for item in versions] == [
        (1, "OpenClaw response must be JSON"),
        (2, "Require strict review JSON"),
    ]


def test_structured_memory_draft_persists_details_and_renders_actionable_sections():
    store = _store()
    review = _seed_review_item(store)

    memory = store.create_codex_review_memory_from_item(
        review_item_id=review["id"],
        title=review["title"],
        body=review["summary"],
        memory_draft=_memory_draft(),
        confirmed_by="admin-1",
    )

    assert memory["details"]["problem"] == "任务栏有缩略图，但 Pet 实际窗口没有出现在桌面上。"
    assert memory["details"]["steps"][0]["instruction"] == "在退出前保存 session-hwnd 绑定。"
    assert memory["details"]["verification"][0]["expected_signal"] == "实际窗口重新可见且可聚焦。"
    assert "## Prerequisites" in memory["body"]
    assert "## Steps" in memory["body"]
    assert "desktop-pet/src/window/sessionWindowBindings.ts" in memory["body"]
    assert "## Verification" in memory["body"]
    assert "pytest api/tests/test_desktop_pet_routes.py -q" in memory["body"]
    versions = store.list_codex_review_memory_versions(memory["id"])
    assert versions[0]["details"]["cautions"] == ["不要复用失效 hwnd。"]
