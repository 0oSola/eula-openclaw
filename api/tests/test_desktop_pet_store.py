from pathlib import Path
from uuid import uuid4

from app.db.store import TraceStore


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
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

    updated = store.upsert_companion_shared_config(
        user_id="admin-1",
        selected_model_path="Eula/Eula.pmx",
        render_pipeline=" Genshin ",
    )

    assert updated["render_pipeline"] == "genshin"
    assert store.get_companion_shared_config("admin-1")["render_pipeline"] == "genshin"


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
