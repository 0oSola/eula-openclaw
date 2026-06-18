from __future__ import annotations

from datetime import UTC, datetime, timedelta
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


def _seed_pet_session(client: TestClient, *, suffix: str, workspace_id: str = "mmd-companion") -> dict:
    return client.app.state.trace_store.upsert_desktop_pet_session(
        pet_session_id=f"codex:daily-{suffix}",
        codex_session_id=f"daily-{suffix}",
        workspace_id=workspace_id,
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title=f"Daily {suffix}",
        first_prompt_preview="Review daily summary",
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
    suffix: str,
    workspace_id: str = "mmd-companion",
    item_type: str = "pitfall",
    severity: str | None = None,
    status: str = "draft",
) -> dict:
    pet = _seed_pet_session(client, suffix=suffix, workspace_id=workspace_id)
    return client.app.state.trace_store.create_codex_review_item(
        item_id=f"review-daily-{suffix}",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type=item_type,
        title=f"Review {suffix}",
        summary=f"Summary {suffix}",
        details={"evidence_refs": [f"ev_{suffix}"]},
        tags=["codex"],
        severity=severity,
        status=status,
        source="openclaw",
        source_hash=f"daily-hash-{suffix}",
    )


def test_daily_summary_counts_pending_and_reviewed_items_for_workspace():
    client = _client()
    store = client.app.state.trace_store
    today = datetime.now(UTC).date().isoformat()

    _seed_review_item(client, suffix="draft-high", item_type="pitfall", severity="high")
    _seed_review_item(client, suffix="draft-medium", item_type="pitfall", severity="medium")
    _seed_review_item(client, suffix="draft-work", item_type="work_summary")
    _seed_review_item(client, suffix="draft-followup", item_type="followup")
    _seed_review_item(client, suffix="other-workspace", workspace_id="other", item_type="blocker")

    accepted = _seed_review_item(client, suffix="accepted")
    ignored = _seed_review_item(client, suffix="ignored")
    snoozed = _seed_review_item(client, suffix="snoozed")
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    store.update_codex_review_item_status(accepted["id"], status="accepted")
    store.update_codex_review_item_status(ignored["id"], status="ignored")
    store.update_codex_review_item_status(
        snoozed["id"],
        status="snoozed",
        details_patch={"snooze_until": future},
    )

    response = client.get(
        f"/codex/reviews/daily-summary?workspace_id=mmd-companion&date={today}",
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["date"] == today
    assert payload["workspace_id"] == "mmd-companion"
    assert payload["draft_count"] == 4
    assert payload["high_priority_count"] == 2
    assert payload["accepted_today"] == 1
    assert payload["ignored_today"] == 1
    assert payload["snoozed_today"] == 1
    assert payload["recommended_batch_size"] == 3
