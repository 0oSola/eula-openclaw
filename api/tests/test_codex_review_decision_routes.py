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
                "codex_openclaw_review_enabled": True,
                "openclaw_token": "test-token",
            }
        )
    )


def _seed_pet_session(client: TestClient, *, suffix: str = "a", workspace_id: str = "mmd-companion") -> dict:
    return client.app.state.trace_store.upsert_desktop_pet_session(
        pet_session_id=f"codex:decision-{suffix}",
        codex_session_id=f"decision-{suffix}",
        workspace_id=workspace_id,
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title=f"Decision {suffix}",
        first_prompt_preview="Review decisions",
        last_summary="Review summary",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )


def _seed_review_item(
    client: TestClient,
    *,
    suffix: str = "a",
    workspace_id: str = "mmd-companion",
    item_type: str = "pitfall",
    title: str = "Review item",
    summary: str = "Review summary",
    severity: str | None = None,
    status: str = "draft",
) -> dict:
    pet = _seed_pet_session(client, suffix=suffix, workspace_id=workspace_id)
    return client.app.state.trace_store.create_codex_review_item(
        item_id=f"review-decision-{suffix}",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type=item_type,
        title=title,
        summary=summary,
        details={"evidence_refs": [f"ev_{suffix}"]},
        tags=["codex"],
        severity=severity,
        status=status,
        source="openclaw",
        source_hash=f"decision-hash-{suffix}",
    )


def _memory_draft() -> dict:
    return {
        "knowledge_kind": "pitfall",
        "problem": "任务栏有缩略图，但桌面上没有实际可见的 Pet 窗口。",
        "root_cause": "远程窗口绑定只保存在内存里，重启后丢失。",
        "when_to_use": "当 restore 只能命中任务栏缩略图或目标 hwnd 已失效时使用。",
        "prerequisites": ["知道当前 pet session id"],
        "steps": [
            {
                "order": 1,
                "instruction": "在退出前持久化 pet session 到 hwnd 的绑定，并在启动时恢复。",
                "commands": [],
                "file_refs": ["desktop-pet/src/window/sessionWindowBindings.ts"],
                "evidence_refs": ["ev_a"],
            }
        ],
        "verification": [
            {
                "order": 1,
                "instruction": "重启 Pet 后执行 restore，确认恢复的是实际桌面窗口。",
                "commands": ["pytest api/tests/test_desktop_pet_routes.py -q"],
                "expected_signal": "桌面窗口可见且可聚焦。",
                "evidence_refs": ["ev_a"],
            }
        ],
        "cautions": ["不要复用失效 hwnd。"],
        "source_summary": "Persist the window binding before restart.",
        "open_questions": [],
        "confidence": 0.87,
    }


def test_list_drafts_orders_high_priority_and_filters_workspace():
    client = _client()
    _seed_review_item(client, suffix="summary", item_type="work_summary", title="Summary")
    _seed_review_item(client, suffix="pitfall", item_type="pitfall", title="Pitfall", severity="high")
    _seed_review_item(client, suffix="other", workspace_id="other-workspace", item_type="blocker", title="Other")

    response = client.get(
        "/codex/reviews/drafts?workspace_id=mmd-companion&limit=20",
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["title"] for item in payload["items"]] == ["Pitfall", "Summary"]
    assert payload["items"][0]["priority_score"] > payload["items"][1]["priority_score"]
    assert {item["workspace_id"] for item in payload["items"]} == {"mmd-companion"}


def test_accept_review_item_creates_memory_and_marks_accepted():
    client = _client()
    item = _seed_review_item(client, title="Bad schema", summary="JSON was invalid", severity="high")

    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={"action": "accept", "target": "openkb"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["item"]["status"] == "accepted"
    assert payload["memory"]["workspace_id"] == "mmd-companion"
    assert payload["memory"]["title"] == "Bad schema"
    assert "## Problem" in payload["memory"]["body"]
    assert "JSON was invalid" in payload["memory"]["body"]
    assert payload["memory"]["details"]["problem"] == "JSON was invalid"
    assert payload["memory"]["details"]["knowledge_kind"] == "pitfall"


def test_edit_accept_review_item_uses_edited_content():
    client = _client()
    item = _seed_review_item(client, title="Original", summary="Original summary")

    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={
            "action": "edit_accept",
            "edited_title": "Edited title",
            "edited_summary": "Edited summary",
            "target": "openkb",
        },
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["item"]["status"] == "edited_accepted"
    assert payload["memory"]["title"] == "Edited title"
    assert "Edited summary" in payload["memory"]["body"]
    assert payload["memory"]["details"]["problem"] == "Edited summary"


def test_accept_review_item_prefers_memory_draft_for_persistence_and_rendering():
    client = _client()
    item = _seed_review_item(client, title="Pet restore", summary="legacy summary")

    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={
            "action": "accept",
            "edited_summary": "should not become canonical body",
            "memory_draft": _memory_draft(),
            "target": "openclaw_wiki",
        },
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["item"]["status"] == "accepted"
    assert payload["memory"]["title"] == "Pet restore"
    assert payload["memory"]["details"]["problem"] == "任务栏有缩略图，但桌面上没有实际可见的 Pet 窗口。"
    assert payload["memory"]["details"]["steps"][0]["instruction"].startswith("在退出前持久化")
    assert "## Prerequisites" in payload["memory"]["body"]
    assert "## Cautions" in payload["memory"]["body"]
    assert "should not become canonical body" not in payload["memory"]["body"]


def test_edit_accept_review_item_allows_memory_draft_without_legacy_edits():
    client = _client()
    item = _seed_review_item(client, title="Original", summary="Original summary")

    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={
            "action": "edit_accept",
            "memory_draft": _memory_draft(),
            "target": "openclaw_wiki",
        },
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["item"]["status"] == "edited_accepted"
    assert payload["memory"]["title"] == "Original"
    assert payload["memory"]["details"]["source_summary"] == "Persist the window binding before restart."


def test_memory_draft_validation_rejects_invalid_structured_accept_payload():
    client = _client()
    item = _seed_review_item(client, suffix="invalid")

    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={
            "action": "accept",
            "memory_draft": {
                "knowledge_kind": "pitfall",
                "problem": "missing procedure",
                "when_to_use": "when needed",
                "steps": [],
                "verification": [],
                "source_summary": "summary",
            },
        },
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422


def test_ignore_and_snooze_reject_memory_draft():
    client = _client()
    ignored = _seed_review_item(client, suffix="ignored-draft")
    snoozed = _seed_review_item(client, suffix="snoozed-draft")

    ignore_response = client.post(
        f"/codex/reviews/items/{ignored['id']}/decision",
        json={"action": "ignore", "memory_draft": _memory_draft()},
        headers={"x-user-id": "admin-1"},
    )
    snooze_response = client.post(
        f"/codex/reviews/items/{snoozed['id']}/decision",
        json={
            "action": "snooze",
            "snooze_until": "2026-06-10T09:30:00+08:00",
            "memory_draft": _memory_draft(),
        },
        headers={"x-user-id": "admin-1"},
    )

    assert ignore_response.status_code == 422
    assert snooze_response.status_code == 422


def test_ignore_and_snooze_do_not_create_memory():
    client = _client()
    ignored = _seed_review_item(client, suffix="ignored")
    snoozed = _seed_review_item(client, suffix="snoozed")

    ignore_response = client.post(
        f"/codex/reviews/items/{ignored['id']}/decision",
        json={"action": "ignore", "notes": "noise"},
        headers={"x-user-id": "admin-1"},
    )
    snooze_response = client.post(
        f"/codex/reviews/items/{snoozed['id']}/decision",
        json={"action": "snooze", "snooze_until": "2026-06-10T09:30:00+08:00"},
        headers={"x-user-id": "admin-1"},
    )

    assert ignore_response.status_code == 200
    assert ignore_response.json()["item"]["status"] == "ignored"
    assert ignore_response.json()["memory"] is None
    assert snooze_response.status_code == 200
    assert snooze_response.json()["item"]["status"] == "snoozed"
    assert snooze_response.json()["memory"] is None
