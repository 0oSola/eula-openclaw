from pathlib import Path
import sqlite3
from uuid import uuid4

from app.db.store import TraceStore


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store() -> TraceStore:
    path = _case_dir()
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def test_shared_companion_config_defaults_and_updates():
    store = _store()

    default = store.get_companion_shared_config("admin-1")

    assert default["user_id"] == "admin-1"
    assert default["selected_model_path"] is None
    assert default["render_pipeline"] == "classic"
    assert default["updated_at"] is None

    updated = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline="genshin",
    )

    assert updated["selected_model_path"] == "Eula/Eula.pmx"
    assert updated["render_pipeline"] == "genshin"
    assert updated["updated_at"]
    assert store.get_companion_shared_config("admin-1") == updated


def test_shared_companion_config_rejects_unknown_render_pipeline():
    store = _store()

    try:
        store.upsert_companion_shared_config(
            user_id="admin-1",
            selected_model_path=None,
            render_pipeline="toon-unknown",
        )
    except ValueError as error:
        assert "render_pipeline" in str(error)
    else:
        raise AssertionError("expected invalid render pipeline to fail")


def test_shared_companion_config_normalizes_render_pipeline():
    store = _store()

    mio = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" mio-reference ",
    )

    assert mio["render_pipeline"] == "mio-reference"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "mio-reference"

    reze = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" REZE-NPR ",
    )

    assert reze["render_pipeline"] == "reze-npr"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "reze-npr"


def test_shared_companion_config_migrates_old_render_pipeline_check_constraint():
    path = _case_dir()
    db_path = path / "sqlite" / "trace.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE companion_shared_config (
                user_id TEXT PRIMARY KEY,
                selected_model_path TEXT,
                render_pipeline TEXT NOT NULL DEFAULT 'classic'
                    CHECK (render_pipeline IN ('classic', 'genshin')),
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT INTO companion_shared_config (
                user_id, selected_model_path, render_pipeline, updated_at
            ) VALUES ('admin-1', 'Eula/Eula.pmx', 'genshin', '2026-01-01T00:00:00+00:00')
            """
        )
        conn.commit()
    finally:
        conn.close()

    store = TraceStore(db_path=db_path, ndjson_dir=path / "logs")

    updated = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline="mio-reference",
    )

    assert updated["render_pipeline"] == "mio-reference"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "mio-reference"


def test_shared_companion_config_rejects_blank_render_pipeline_values():
    store = _store()

    for render_pipeline in [None, "", "   "]:
        try:
            store.upsert_companion_shared_config(
                user_id="admin-1",
                selected_model_path=None,
                render_pipeline=render_pipeline,  # type: ignore[arg-type]
            )
        except ValueError as error:
            assert "render_pipeline" in str(error)
        else:
            raise AssertionError(f"expected {render_pipeline!r} render pipeline to fail")


def test_desktop_pet_session_registry_round_trip_and_sorting():
    store = _store()

    first = store.upsert_desktop_pet_session(
        pet_session_id="pet-1",
        codex_session_id="11111111-1111-1111-1111-111111111111",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home="C:/Users/KSG/.codex",
        display_title=None,
        first_prompt_preview="fix login layout and run checks",
        last_summary=None,
        last_status="running",
        launch_mode="workspace-write",
        remote_url="ws://127.0.0.1:4501",
        app_server_pid=1234,
        app_server_port=4501,
        metadata={"approval_count": 0},
    )
    second = store.upsert_desktop_pet_session(
        pet_session_id="pet-2",
        codex_session_id="22222222-2222-2222-2222-222222222222",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home="C:/Users/KSG/.codex",
        display_title="Codex Console integration",
        first_prompt_preview=None,
        last_summary="Added status bridge.",
        last_status="completed",
        launch_mode="read-only",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )

    assert first["display_title"] == "fix login layout and run checks"
    assert second["display_title"] == "Codex Console integration"
    sessions = store.list_desktop_pet_sessions(limit=10)
    assert [item["pet_session_id"] for item in sessions] == ["pet-2", "pet-1"]
    assert sessions[0]["metadata"] == {}


def test_desktop_pet_session_registry_delete_only_removes_registry_row():
    store = _store()
    store.upsert_desktop_pet_session(
        pet_session_id="pet-1",
        codex_session_id="11111111-1111-1111-1111-111111111111",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Readable title",
        first_prompt_preview=None,
        last_summary=None,
        last_status="failed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )

    assert store.delete_desktop_pet_session("pet-1") is True
    assert store.get_desktop_pet_session("pet-1") is None
    assert store.delete_desktop_pet_session("pet-1") is False
