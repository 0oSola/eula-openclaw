from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.models.chat import OpenClawSpeech


def _make_case_dir() -> Path:
    path = Path("D:/workspace/MMD project/api/tests_runtime") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_tts_endpoint_returns_not_configured_when_disabled():
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": False})
    client = TestClient(app)
    response = client.post(
        "/tts/speak",
        json={"text": "你好", "voice": "default"},
        headers={"x-user-id": "u1"},
    )
    assert response.status_code == 501
    assert response.json()["configured"] is False


class FakeOpenClawTtsClient:
    def __init__(self):
        self.calls = []

    async def generate_speech(self, *, user_id: str, session_id: str | None, text: str, voice: str):
        self.calls.append({"user_id": user_id, "session_id": session_id, "text": text, "voice": voice})
        return OpenClawSpeech(
            audio=b"fake-mp3-bytes",
            media_type="audio/mpeg",
            endpoint_used="/v1/audio/speech",
            status_code=200,
        )


def test_tts_endpoint_returns_openclaw_audio_when_enabled():
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": True})
    fake_client = FakeOpenClawTtsClient()
    app.state.openclaw_client = fake_client
    client = TestClient(app)

    response = client.post(
        "/tts/speak",
        json={"text": "你好", "voice": "default", "session_id": "s1"},
        headers={"x-user-id": "u1"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["x-openclaw-endpoint"] == "/v1/audio/speech"
    assert response.content == b"fake-mp3-bytes"
    assert fake_client.calls == [{"user_id": "u1", "session_id": "s1", "text": "你好", "voice": "default"}]
