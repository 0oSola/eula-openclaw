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
            }
        )
    )


def test_shared_config_round_trip():
    client = _client()

    default = client.get("/desktop-pet/shared-config", headers={"x-user-id": "admin-1"})

    assert default.status_code == 200
    assert default.json() == {
        "user_id": "admin-1",
        "selected_model_path": None,
        "render_pipeline": "classic",
        "updated_at": None,
    }

    updated = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": "genshin"},
        headers={"x-user-id": "admin-1"},
    )

    assert updated.status_code == 200
    assert updated.json()["selected_model_path"] == "Eula/Eula.pmx"
    assert updated.json()["render_pipeline"] == "genshin"
    assert updated.json()["updated_at"]


def test_shared_config_accepts_full_render_pipeline_contract():
    client = _client()

    for render_pipeline in ["mio-reference", "reze-npr"]:
        response = client.put(
            "/desktop-pet/shared-config",
            json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": render_pipeline},
            headers={"x-user-id": "admin-1"},
        )

        assert response.status_code == 200
        assert response.json()["render_pipeline"] == render_pipeline
        assert response.json()["selected_model_path"] == "Eula/Eula.pmx"


def test_shared_config_uses_requester_not_payload_user():
    client = _client()

    response = client.put(
        "/desktop-pet/shared-config",
        json={
            "user_id": "admin-1",
            "selected_model_path": "Ayaka/Ayaka.pmx",
            "render_pipeline": "classic",
        },
        headers={"x-user-id": "user-2"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == "user-2"


def test_shared_config_store_value_error_returns_422(monkeypatch):
    client = _client()

    def fail_upsert_companion_shared_config(**_: object):
        raise ValueError("render_pipeline store failure")

    monkeypatch.setattr(
        client.app.state.trace_store,
        "upsert_companion_shared_config",
        fail_upsert_companion_shared_config,
    )

    response = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": "classic"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422
    assert "render_pipeline store failure" in response.json()["detail"]


def test_shared_config_get_isolated_by_requester():
    client = _client()

    updated = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": "Eula/Eula.pmx", "render_pipeline": "genshin"},
        headers={"x-user-id": "user-1"},
    )
    assert updated.status_code == 200

    other_user = client.get("/desktop-pet/shared-config", headers={"x-user-id": "user-2"})

    assert other_user.status_code == 200
    assert other_user.json() == {
        "user_id": "user-2",
        "selected_model_path": None,
        "render_pipeline": "classic",
        "updated_at": None,
    }


def test_shared_config_rejects_invalid_pipeline():
    client = _client()

    response = client.put(
        "/desktop-pet/shared-config",
        json={"selected_model_path": None, "render_pipeline": "unknown"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 422
