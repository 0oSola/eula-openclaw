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


def _pet_session_payload(**overrides):
    payload = {
        "pet_session_id": "codex:review-route",
        "codex_session_id": "review-route",
        "workspace_id": "mmd-companion",
        "workspace_path": "D:/workspace/MMD project",
        "codex_home": "C:/Users/KSG/.codex",
        "display_title": "Review route",
        "first_prompt_preview": "Implement review routes",
        "last_summary": "Review route summary",
        "last_status": "completed",
        "launch_mode": "workspace-write",
        "remote_url": None,
        "app_server_pid": None,
        "app_server_port": None,
        "metadata": {"facts": {"changed_files": ["api/app/routes/desktop_pet.py"]}},
    }
    payload.update(overrides)
    return payload


def test_desktop_pet_session_upsert_enqueues_review_sync_for_reviewable_status():
    client = _client()

    response = client.post(
        "/desktop-pet/sessions",
        json=_pet_session_payload(),
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    rows = client.app.state.trace_store._conn.execute("SELECT * FROM codex_openclaw_sync_outbox").fetchall()
    assert len(rows) == 1
    assert rows[0]["pet_session_id"] == "codex:review-route"
    assert rows[0]["status"] == "pending"
    assert rows[0]["openclaw_session_key"] == "codex-review:codex:review-route"


def test_desktop_pet_session_upsert_does_not_enqueue_review_sync_for_running_status():
    client = _client()

    response = client.post(
        "/desktop-pet/sessions",
        json=_pet_session_payload(last_status="running"),
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    rows = client.app.state.trace_store._conn.execute("SELECT * FROM codex_openclaw_sync_outbox").fetchall()
    assert rows == []


def test_manual_codex_review_enqueue_returns_outbox_row():
    client = _client()
    created = client.post(
        "/desktop-pet/sessions",
        json=_pet_session_payload(last_status="running"),
        headers={"x-user-id": "admin-1"},
    )
    assert created.status_code == 200

    response = client.post(
        "/codex/reviews/sessions/codex:review-route/enqueue",
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "pending"
    assert payload["pet_session_id"] == "codex:review-route"
    assert payload["openclaw_session_key"] == "codex-review:codex:review-route"

