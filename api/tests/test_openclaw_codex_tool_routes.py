from __future__ import annotations

from pathlib import Path
import subprocess
from uuid import uuid4

from fastapi.testclient import TestClient

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


def _client() -> TestClient:
    case_dir = _make_case_dir()
    workspace_path = case_dir / "repo"
    workspace_path.mkdir()
    _make_git_repo(workspace_path)
    return TestClient(
        create_app(
            {
                "data_dir": str(case_dir / "data"),
                "admin_user_ids": ["admin-1"],
                "codex_interactive_enabled": True,
                "codex_allowed_users": ["admin-1"],
                "codex_allowed_workspaces": ["mmd-companion"],
                "codex_workspace_paths": {"mmd-companion": str(workspace_path)},
                "codex_use_deterministic_provider": True,
                "codex_turn_timeout_seconds": 5,
                "codex_max_prompt_chars": 2000,
            }
        )
    )


def test_openclaw_codex_tool_requires_admin_header():
    client = _client()

    missing = client.post(
        "/openclaw/tools/codex/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
    )
    non_admin = client.post(
        "/openclaw/tools/codex/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "user-1"},
    )

    assert missing.status_code == 401
    assert non_admin.status_code == 403


def test_openclaw_codex_tool_creates_session_through_fastapi_codex_guardrails():
    client = _client()

    response = client.post(
        "/openclaw/tools/codex/sessions",
        json={"workspace_id": "mmd-companion", "mode": "read_only"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"].startswith("codex_sess_")
    assert payload["workspace_id"] == "mmd-companion"
    assert payload["status"] == "ready"
    assert payload["sandbox"] == "read-only"
    stored = client.app.state.trace_store.get_codex_interactive_session(payload["session_id"])
    assert stored["user_id"] == "admin-1"


def test_openclaw_codex_status_returns_bounded_snapshot_without_full_transcript():
    client = _client()
    store = client.app.state.trace_store
    session = store.create_codex_interactive_session(
        session_id="codex-status-session",
        local_chat_session_id=None,
        workspace_id="mmd-companion",
        user_id="admin-1",
        workspace_path="D:/workspace/MMD project",
        worktree_path=None,
        branch_name=None,
        codex_thread_id="thread-1",
        codex_version="codex-test/1.0",
        transport="stdio",
        sandbox_mode="read-only",
        status="waiting_approval",
        process_id=123,
        metadata={"mode": "read_only"},
    )
    long_output = "A" * 400
    store.append_codex_event(session["id"], None, "command_output", {"type": "command_output", "text": long_output})
    store.create_codex_approval(
        approval_id="approval-status",
        codex_session_id=session["id"],
        turn_id=None,
        external_approval_id=None,
        action_type="command",
        title="Run command",
        detail={"command": "git status --short"},
    )
    store.create_codex_artifact(
        artifact_id="artifact-status",
        codex_session_id=session["id"],
        turn_id=None,
        kind="checks",
        path="D:/workspace/MMD project/private.log",
        content_ref=None,
        summary="Checks completed",
        metadata={"stdout": long_output},
    )

    response = client.get(
        f"/openclaw/tools/codex/sessions/{session['id']}/status",
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == session["id"]
    assert payload["status"] == "waiting_approval"
    assert payload["last_output_preview"] == f"{'A' * 240}..."
    assert payload["pending_approvals"] == [
        {
            "id": "approval-status",
            "action_type": "command",
            "title": "Run command",
            "created_at": payload["pending_approvals"][0]["created_at"],
        }
    ]
    assert payload["latest_artifacts"] == [
        {
            "id": "artifact-status",
            "kind": "checks",
            "summary": "Checks completed",
            "content_ref": None,
            "created_at": payload["latest_artifacts"][0]["created_at"],
        }
    ]
    assert "private.log" not in str(payload)
    assert long_output not in str(payload)


def test_openclaw_codex_approval_decision_uses_existing_codex_gate():
    client = _client()
    store = client.app.state.trace_store
    session = store.create_codex_interactive_session(
        session_id="codex-approval-session",
        local_chat_session_id=None,
        workspace_id="mmd-companion",
        user_id="admin-1",
        workspace_path="D:/workspace/MMD project",
        worktree_path=None,
        branch_name=None,
        codex_thread_id="thread-approval",
        codex_version="codex-test/1.0",
        transport="stdio",
        sandbox_mode="workspace-write",
        status="waiting_approval",
        process_id=123,
        metadata={"mode": "patch"},
    )
    store.create_codex_approval(
        approval_id="approval-openclaw",
        codex_session_id=session["id"],
        turn_id=None,
        external_approval_id=None,
        action_type="command",
        title="Run command",
        detail={"command": "git status"},
    )

    response = client.post(
        "/openclaw/tools/codex/approvals/approval-openclaw/decision",
        json={"decision": "deny"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    assert response.json()["decision"] == "deny"
    assert store.get_codex_approval("approval-openclaw")["decided_by"] == "admin-1"
    assert store.list_codex_events(session["id"])[-1]["event_type"] == "approval_decided"
