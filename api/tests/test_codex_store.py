from pathlib import Path
from uuid import uuid4

from app.db.store import TraceStore


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def test_codex_store_persists_session_turn_events_and_approval():
    store = _store()

    session = store.create_codex_interactive_session(
        session_id="codex_sess_1",
        local_chat_session_id="chat-1",
        workspace_id="mmd-companion",
        user_id="admin-1",
        workspace_path="D:/repo",
        worktree_path=None,
        branch_name=None,
        codex_thread_id=None,
        codex_version=None,
        transport="stdio",
        sandbox_mode="read-only",
        status="ready",
        process_id=None,
        metadata={"mode": "read_only"},
    )
    turn = store.create_codex_turn(
        turn_id="turn-1",
        codex_session_id=session["id"],
        codex_turn_id=None,
        user_message="explain the message service",
        status="running",
        metadata={"mode": "read_only"},
    )

    first = store.append_codex_event(session["id"], turn["id"], "turn_started", {"turn_id": turn["id"]})
    second = store.append_codex_event(session["id"], turn["id"], "text_delta", {"text": "hello"})
    approval = store.create_codex_approval(
        approval_id="approval-1",
        codex_session_id=session["id"],
        turn_id=turn["id"],
        external_approval_id="external-1",
        action_type="command",
        title="Run command",
        detail={"command": "git status"},
    )
    decided = store.decide_codex_approval("approval-1", decision="deny", decided_by="admin-1")

    assert store.get_codex_interactive_session(session["id"])["status"] == "ready"
    assert first["sequence"] == 1
    assert second["sequence"] == 2
    assert [event["event_type"] for event in store.list_codex_events(session["id"])] == [
        "turn_started",
        "text_delta",
    ]
    assert approval["decision"] is None
    assert decided["decision"] == "deny"
    assert decided["decided_by"] == "admin-1"


def test_codex_store_tracks_artifacts_and_pending_approvals():
    store = _store()
    session = store.create_codex_interactive_session(
        session_id="codex_sess_artifacts",
        local_chat_session_id=None,
        workspace_id="mmd-companion",
        user_id="admin-1",
        workspace_path="D:/repo",
        worktree_path="D:/worktrees/codex_sess_artifacts",
        branch_name="codex/codex_sess_artifacts",
        codex_thread_id=None,
        codex_version=None,
        transport="stdio",
        sandbox_mode="workspace-write",
        status="ready",
        process_id=None,
        metadata={"mode": "patch"},
    )
    store.create_codex_approval(
        approval_id="approval-pending",
        codex_session_id=session["id"],
        turn_id=None,
        external_approval_id=None,
        action_type="command",
        title="Run check",
        detail={"command": "pytest api/tests"},
    )

    artifact = store.create_codex_artifact(
        artifact_id="artifact-diff",
        codex_session_id=session["id"],
        turn_id=None,
        kind="diff",
        path=None,
        content_ref=None,
        summary="1 file changed",
        metadata={"changed_files": ["README.md"]},
    )

    assert artifact["metadata"] == {"changed_files": ["README.md"]}
    assert store.list_pending_codex_approvals(session["id"])[0]["id"] == "approval-pending"
    assert store.list_codex_artifacts(session["id"], kind="diff")[0]["id"] == "artifact-diff"


def test_latest_codex_error_ignores_older_failures_after_newer_success():
    store = _store()

    store.create_codex_interactive_session(
        session_id="codex_sess_failed",
        local_chat_session_id=None,
        workspace_id="mmd-companion",
        user_id="admin-1",
        workspace_path="D:/repo",
        worktree_path=None,
        branch_name=None,
        codex_thread_id=None,
        codex_version=None,
        transport="stdio",
        sandbox_mode="read-only",
        status="failed",
        process_id=None,
        metadata={"mode": "read_only"},
    )
    store.update_codex_interactive_session("codex_sess_failed", status="failed", error="old provider failure")

    assert store.latest_codex_error() == "old provider failure"

    store.create_codex_interactive_session(
        session_id="codex_sess_success",
        local_chat_session_id=None,
        workspace_id="mmd-companion",
        user_id="admin-1",
        workspace_path="D:/repo",
        worktree_path=None,
        branch_name=None,
        codex_thread_id=None,
        codex_version=None,
        transport="stdio",
        sandbox_mode="read-only",
        status="closed",
        process_id=None,
        metadata={"mode": "read_only"},
    )

    assert store.latest_codex_error() is None
