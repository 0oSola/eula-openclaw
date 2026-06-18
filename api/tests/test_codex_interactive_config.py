from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_codex_settings_parse_env(monkeypatch):
    case_dir = _make_case_dir()
    workspace_path = case_dir / "repo"
    workspace_path.mkdir()
    codex_home = case_dir / "codex-home"
    worktree_root = case_dir / "worktrees"

    monkeypatch.setenv("API_DATA_DIR", str(case_dir / "data"))
    monkeypatch.setenv("CODEX_INTERACTIVE_ENABLED", "true")
    monkeypatch.setenv("CODEX_BIN", "codex-test")
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    monkeypatch.setenv("CODEX_TRANSPORT", "stdio")
    monkeypatch.setenv("CODEX_ALLOWED_USERS", "admin-1, sola")
    monkeypatch.setenv("CODEX_ALLOWED_WORKSPACES", "mmd-companion")
    monkeypatch.setenv("CODEX_WORKSPACE_MMD_COMPANION", str(workspace_path))
    monkeypatch.setenv("CODEX_DEFAULT_SANDBOX", "read-only")
    monkeypatch.setenv("CODEX_PATCH_SANDBOX", "workspace-write")
    monkeypatch.setenv("CODEX_WORKTREE_ROOT", str(worktree_root))
    monkeypatch.setenv("CODEX_MAX_PROMPT_CHARS", "4096")
    monkeypatch.setenv("CODEX_SESSION_IDLE_TIMEOUT_SECONDS", "300")

    settings = Settings.from_env()

    assert settings.codex_interactive_enabled is True
    assert settings.codex_bin == "codex-test"
    assert settings.codex_home == codex_home.resolve()
    assert settings.codex_transport == "stdio"
    assert settings.codex_allowed_users == ["admin-1", "sola"]
    assert settings.codex_allowed_workspaces == ["mmd-companion"]
    assert settings.codex_workspace_paths["mmd-companion"] == workspace_path.resolve()
    assert settings.codex_default_sandbox == "read-only"
    assert settings.codex_patch_sandbox == "workspace-write"
    assert settings.codex_worktree_root == worktree_root.resolve()
    assert settings.codex_max_prompt_chars == 4096
    assert settings.codex_session_idle_timeout_seconds == 300


def test_runtime_health_includes_codex_snapshot():
    case_dir = _make_case_dir()
    workspace_path = case_dir / "repo"
    workspace_path.mkdir()
    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": ["admin-1"],
            "codex_interactive_enabled": True,
            "codex_bin": "codex-test",
            "codex_allowed_users": ["admin-1"],
            "codex_allowed_workspaces": ["mmd-companion"],
            "codex_workspace_paths": {"mmd-companion": str(workspace_path)},
            "codex_transport": "stdio",
        }
    )
    client = TestClient(app)
    app.state.trace_store.create_codex_interactive_session(
        session_id="codex_sess_health",
        local_chat_session_id=None,
        workspace_id="mmd-companion",
        user_id="admin-1",
        workspace_path=str(workspace_path),
        worktree_path=None,
        branch_name=None,
        codex_thread_id="thread-health",
        codex_version="codex-cli 0.137.0",
        transport="stdio",
        sandbox_mode="read-only",
        status="failed",
        process_id=123,
        metadata={"mode": "read_only"},
    )
    app.state.trace_store.update_codex_interactive_session(
        "codex_sess_health",
        status="failed",
        error="last app-server error",
    )
    app.state.trace_store.upsert_codex_workspace(
        workspace_id="ui-mounted",
        path=str(case_dir / "external-ui-repo"),
        source="ui",
        created_by="admin-1",
    )

    response = client.get("/admin/runtime-health", headers={"x-user-id": "admin-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["codex"]["enabled"] is True
    assert payload["codex"]["codex_bin"] == "codex-test"
    assert payload["codex"]["codex_version"] == "codex-cli 0.137.0"
    assert payload["codex"]["transport"] == "stdio"
    assert payload["codex"]["active_sessions"] == 0
    assert payload["codex"]["allowed_workspaces"] == ["mmd-companion"]
    assert payload["codex"]["last_error"] == "last app-server error"
    assert payload["codex"]["workspaces"] == [
        {"id": "mmd-companion", "path": str(workspace_path.resolve()), "source": "env"},
        {"id": "ui-mounted", "path": str((case_dir / "external-ui-repo").resolve()), "source": "ui"},
    ]
