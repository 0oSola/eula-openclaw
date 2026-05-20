from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_admin_runtime_health_returns_local_bridge_snapshot_without_remote_session_probe():
    case_dir = _make_case_dir()
    app = create_app(
        {
            "data_dir": str(case_dir),
            "admin_user_ids": ["admin-1"],
            "openclaw_base_url": "http://openclaw.local:18789",
            "openclaw_token": "secret-token",
            "openclaw_agent_id": "main",
            "openclaw_model": "custom/gpt-5.5",
            "openclaw_timeout_seconds": 7,
        }
    )
    store = app.state.trace_store
    ctx = store.get_current_workspace_context("admin-1")
    session = store.create_session(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        title="Feishu direct",
        openclaw_session_key="agent:main:feishu:direct:ou_test",
    )
    store.upsert_message_bridge_binding(
        workspace_id=ctx["workspace"]["id"],
        account_id=ctx["account"]["id"],
        local_session_id=session["id"],
        provider="openclaw",
        channel="feishu",
        external_session_key="agent:main:feishu:direct:ou_test",
        external_display_name="Feishu User",
        is_default=True,
        status="active",
    )
    store.update_message_bridge_state(
        "openclaw",
        "feishu",
        websocket_status="connected",
        reconnect_attempts=1,
        last_connected_at="2026-05-16T16:57:47.926511+00:00",
        last_error=None,
    )
    message = store.insert_message(
        ctx["workspace"]["id"],
        session["id"],
        ctx["account"]["id"],
        role="assistant",
        content="bridge message after midnight",
        openclaw_message_id="oc-1",
        metadata={
            "source": "message_bridge",
            "provider": "openclaw",
            "channel": "feishu",
            "external_session_key": "agent:main:feishu:direct:ou_test",
            "synced_from": "realtime",
        },
    )
    store.insert_event(
        trace_id="trace-runtime-health",
        user_id="admin-1",
        session_id=session["id"],
        stage="message_bridge.openclaw.sessions.list",
        status="error",
        latency_ms=7000,
        error_code="TimeoutError",
        payload={"detail": "timed out during opening handshake"},
    )

    client = TestClient(app)
    response = client.get("/admin/runtime-health", headers={"x-user-id": "admin-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["openclaw"]["base_url"] == "http://openclaw.local:18789"
    assert payload["openclaw"]["token_configured"] is True
    assert payload["openclaw"]["model"] == "custom/gpt-5.5"
    assert payload["message_bridge"]["status"]["websocket_status"] == "connected"
    assert payload["message_bridge"]["binding"]["external_session_key"] == "agent:main:feishu:direct:ou_test"
    assert payload["message_bridge"]["latest_message"]["id"] == message["id"]
    assert payload["message_bridge"]["latest_message"]["synced_from"] == "realtime"
    assert payload["database"]["message_count"] == 1
    assert payload["recent_errors"][0]["error_code"] == "TimeoutError"


def test_admin_runtime_health_requires_admin_user():
    case_dir = _make_case_dir()
    app = create_app({"data_dir": str(case_dir), "admin_user_ids": ["admin-1"]})
    client = TestClient(app)

    response = client.get("/admin/runtime-health", headers={"x-user-id": "user-1"})

    assert response.status_code == 403
