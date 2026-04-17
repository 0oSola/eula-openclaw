from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app


def _make_case_dir() -> Path:
    path = Path("D:/workspace/MMD project/api/tests_runtime") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_tts_endpoint_returns_not_configured_by_default():
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": []})
    client = TestClient(app)
    response = client.post(
        "/tts/speak",
        json={"text": "你好", "voice": "default"},
        headers={"x-user-id": "u1"},
    )
    assert response.status_code == 501
    assert response.json()["configured"] is False
