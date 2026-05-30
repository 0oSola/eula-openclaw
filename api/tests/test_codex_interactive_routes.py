from pathlib import Path
import subprocess
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.rstrip("\n")


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _make_git_repo(workspace_path: Path) -> None:
    _git(workspace_path, "init")
    _git(workspace_path, "config", "user.email", "codex@example.test")
    _git(workspace_path, "config", "user.name", "Codex Test")
    (workspace_path / "README.md").write_text("hello\n", encoding="utf-8")
    _git(workspace_path, "add", "README.md")
    _git(workspace_path, "commit", "-m", "initial")


def _client(enabled: bool = True, allowed_users: list[str] | None = None) -> tuple[TestClient, object]:
    case_dir = _make_case_dir()
    workspace_path = case_dir / "repo"
    workspace_path.mkdir()
    _make_git_repo(workspace_path)
    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": ["admin-1"],
            "codex_interactive_enabled": enabled,
            "codex_allowed_users": allowed_users if allowed_users is not None else ["admin-1"],
            "codex_allowed_workspaces": ["mmd-companion"],
            "codex_workspace_paths": {"mmd-companion": str(workspace_path)},
            "codex_worktree_root": str(case_dir / "worktrees"),
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


def test_create_patch_session_creates_workspace_write_worktree():
    client, _ = _client()

    response = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sandbox"] == "workspace-write"
    assert payload["branch_name"].startswith("codex/codex_sess_")
    assert Path(payload["worktree_path"]).exists()
    assert _git(Path(payload["worktree_path"]), "branch", "--show-current") == payload["branch_name"]


def test_codex_diff_endpoint_returns_patch_and_persists_artifact():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    worktree_path = Path(session["worktree_path"])
    (worktree_path / "README.md").write_text("hello\ncodex\n", encoding="utf-8")

    response = client.get(f"/codex/interactive/{session['id']}/diff", headers={"x-user-id": "admin-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["changed_files"] == ["README.md"]
    assert "diff --git a/README.md b/README.md" in payload["patch"]
    artifacts = app.state.trace_store.list_codex_artifacts(session["id"], kind="diff")
    assert artifacts[0]["metadata"]["changed_files"] == ["README.md"]


def test_codex_approval_decision_endpoint_persists_decision_event():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    approval = app.state.trace_store.create_codex_approval(
        approval_id="approval-1",
        codex_session_id=session["id"],
        turn_id=None,
        external_approval_id=None,
        action_type="command",
        title="Run command",
        detail={"command": "git status"},
    )

    response = client.post(
        f"/codex/interactive/{session['id']}/approvals/{approval['id']}",
        json={"decision": "deny"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["decision"] == "deny"
    assert app.state.trace_store.get_codex_approval("approval-1")["decided_by"] == "admin-1"
    assert app.state.trace_store.list_codex_events(session["id"])[-1]["event_type"] == "approval_decided"


def test_codex_checks_are_blocked_by_pending_approval_and_record_artifact():
    client, app = _client()
    app.state.codex_check_commands = {"api": [["git", "status", "--short"]]}
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    app.state.trace_store.create_codex_approval(
        approval_id="approval-pending",
        codex_session_id=session["id"],
        turn_id=None,
        external_approval_id=None,
        action_type="command",
        title="Run command",
        detail={},
    )

    blocked = client.post(
        f"/codex/interactive/{session['id']}/checks",
        json={"checks": ["api"]},
        headers={"x-user-id": "admin-1"},
    )
    assert blocked.status_code == 409

    app.state.trace_store.decide_codex_approval("approval-pending", decision="approve_once", decided_by="admin-1")
    response = client.post(
        f"/codex/interactive/{session['id']}/checks",
        json={"checks": ["api"]},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["results"][0]["check"] == "api"
    assert payload["results"][0]["exit_code"] == 0
    assert app.state.trace_store.list_codex_artifacts(session["id"], kind="checks")


def test_codex_apply_requires_confirm_clean_workspace_and_applies_patch():
    client, app = _client()
    app.state.codex_check_commands = {"api": [["git", "status", "--short"]]}
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    worktree_path = Path(session["worktree_path"])
    workspace_path = Path(app.state.trace_store.get_codex_interactive_session(session["id"])["workspace_path"])
    (worktree_path / "README.md").write_text("hello\napplied\n", encoding="utf-8")

    unconfirmed = client.post(
        f"/codex/interactive/{session['id']}/apply",
        json={"strategy": "patch_to_main_workspace", "confirm": False},
        headers={"x-user-id": "admin-1"},
    )
    assert unconfirmed.status_code == 400

    (workspace_path / "dirty.txt").write_text("dirty\n", encoding="utf-8")
    dirty = client.post(
        f"/codex/interactive/{session['id']}/apply",
        json={"strategy": "patch_to_main_workspace", "confirm": True},
        headers={"x-user-id": "admin-1"},
    )
    assert dirty.status_code == 409
    (workspace_path / "dirty.txt").unlink()

    response = client.post(
        f"/codex/interactive/{session['id']}/apply",
        json={"strategy": "patch_to_main_workspace", "confirm": True},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["applied"] is True
    assert (workspace_path / "README.md").read_text(encoding="utf-8") == "hello\napplied\n"
    assert app.state.trace_store.list_codex_artifacts(session["id"], kind="apply")


def test_codex_discard_closes_session_and_removes_worktree():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()
    worktree_path = Path(session["worktree_path"])

    response = client.post(
        f"/codex/interactive/{session['id']}/discard",
        json={"remove_worktree": True},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert not worktree_path.exists()
    assert app.state.trace_store.get_codex_interactive_session(session["id"])["status"] == "closed"


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


def test_codex_patch_websocket_persists_approval_required_event():
    client, app = _client()
    session = client.post(
        "/codex/interactive/sessions",
        json={"workspace_id": "mmd-companion", "mode": "patch"},
        headers={"x-user-id": "admin-1"},
    ).json()

    with client.websocket_connect(f"/ws/codex/interactive/{session['id']}?user_id=admin-1") as websocket:
        assert websocket.receive_json()["type"] == "session_ready"
        websocket.send_json({"type": "user_message", "text": "modify README", "mode": "patch"})
        turn_started = websocket.receive_json()
        command_started = websocket.receive_json()
        command_output = websocket.receive_json()
        file_changed = websocket.receive_json()
        approval_required = websocket.receive_json()

    assert turn_started["type"] == "turn_started"
    assert command_started["type"] == "command_started"
    assert command_output["type"] == "command_output"
    assert file_changed == {
        "type": "file_changed",
        "turn_id": turn_started["turn_id"],
        "path": "README.md",
        "change_type": "modified",
    }
    assert approval_required["type"] == "approval_required"
    approvals = app.state.trace_store.list_pending_codex_approvals(session["id"])
    assert approvals[0]["id"] == approval_required["approval_id"]
    assert approvals[0]["action_type"] == "command"


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
