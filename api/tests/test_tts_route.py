from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsAudio, VoiceWorkflowTtsError


def _make_case_dir() -> Path:
    path = Path("D:/workspace/MMD project/api/tests_runtime") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_tts_endpoint_returns_not_configured_when_disabled():
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": False})
    client = TestClient(app)
    response = client.post(
        "/tts/speak",
        json={"text": "hello", "voice": "default"},
        headers={"x-user-id": "u1"},
    )
    assert response.status_code == 501
    assert response.json()["configured"] is False


class FakeVoiceWorkflowTtsClient:
    def __init__(self):
        self.calls = []
        self.error: Exception | None = None

    async def synthesize(self, *, text: str, emotion_label: str | None = None, pause_profile: str = "podcast"):
        self.calls.append({"text": text, "emotion_label": emotion_label, "pause_profile": pause_profile})
        if self.error:
            raise self.error
        return VoiceWorkflowTtsAudio(
            audio=b"fake-wav-bytes",
            media_type="audio/wav",
            task_id="task-1",
            audio_url="/api/v1/audio/2026/04/30/tts_task-1.wav",
        )


def test_tts_endpoint_returns_voice_workflow_audio_when_enabled():
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": True})
    fake_client = FakeVoiceWorkflowTtsClient()
    app.state.tts_client = fake_client
    client = TestClient(app)

    response = client.post(
        "/tts/speak",
        json={"text": "hello", "voice": "关心温柔", "session_id": "s1"},
        headers={"x-user-id": "u1"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["x-tts-task-id"] == "task-1"
    assert response.headers["x-tts-audio-url"] == "/api/v1/audio/2026/04/30/tts_task-1.wav"
    assert response.content == b"fake-wav-bytes"
    assert fake_client.calls == [{"text": "hello", "emotion_label": "关心温柔", "pause_profile": "podcast"}]


def test_tts_endpoint_returns_bad_gateway_when_voice_workflow_fails():
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": True})
    fake_client = FakeVoiceWorkflowTtsClient()
    fake_client.error = VoiceWorkflowTtsError("model failed")
    app.state.tts_client = fake_client
    client = TestClient(app)

    response = client.post(
        "/tts/speak",
        json={"text": "hello", "voice": "default"},
        headers={"x-user-id": "u1"},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "model failed"
