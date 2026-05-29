from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _client(enabled: bool = True, allowed_users: list[str] | None = None) -> tuple[TestClient, object]:
    case_dir = _make_case_dir()
    workspace_path = case_dir / "repo"
    workspace_path.mkdir()
    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": ["admin-1"],
            "codex_interactive_enabled": enabled,
            "codex_allowed_users": allowed_users if allowed_users is not None else ["admin-1"],
            "codex_allowed_workspaces": ["mmd-companion"],
            "codex_workspace_paths": {"mmd-companion": str(workspace_path)},
            "codex_turn_timeout_seconds": 5,
            "codex_max_prompt_chars": 2000,
        }
    )
    client = TestClient(app)
    client.__enter__()
    return client, app


def test_create_codex_session_rejects_when_disabled():
    client, _ = _client(enabled=False)

    response = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only", "sandbox": "read-only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 404


def test_create_codex_session_requires_allowlisted_admin():
    client, _ = _client(enabled=True, allowed_users=["sola"])

    response = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only", "sandbox": "read-only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 403


def test_create_codex_session_returns_ready_read_only_session():
    client, _ = _client()

    response = client.post(
        "/codex/interactive/sessions",
        json={"local_chat_session_id": "chat-1", "workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"].startswith("codex_sess_")
    assert payload["workspace_id"] == "mmd-companion"
    assert payload["status"] == "ready"
    assert payload["sandbox"] == "read-only"
    assert payload["ws_url"].startswith(f"/api/backend/ws/codex/interactive/{payload['id']}?user_id=admin-1")


def test_codex_websocket_streams_turn_and_persists_events():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json() == {"type": "session_ready", "session_id": session["id"], "thread_id": None}
        websocket.send_json({"type": "user_message", "text": "explain message service", "mode": "read_only"})
        turn_started = websocket.receive_json()
        text_delta = websocket.receive_json()
        completed = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert text_delta == {
        "type": "text_delta",
        "turn_id": turn_started["turn_id"],
        "text": "Codex read-only analysis queued for: explain message service",
    }
    assert completed == {
        "type": "turn_completed",
        "turn_id": turn_started["turn_id"],
        "final_text": "Read-only Codex turn completed.",
    }
    events = app.state.trace_store.list_codex_events(session["id"])
    assert [event["event_type"] for event in events] == [
        "session_ready",
        "turn_started",
        "text_delta",
        "turn_completed",
    ]


def test_codex_websocket_can_cancel_running_turn():
    client, _ = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["type"] == "session_ready"
        websocket.send_json({"type": "user_message", "text": "slow analysis", "mode": "read_only"})
        turn_started = websocket.receive_json()
        websocket.send_json({"type": "cancel_turn"})
        cancelled = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert cancelled == {
        "type": "turn_failed",
        "turn_id": turn_started["turn_id"],
        "error": "Turn cancelled.",
    }


def test_codex_websocket_rejects_wrong_user():
    client, _ = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=sola"):
            pass
