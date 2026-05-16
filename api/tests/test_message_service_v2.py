from pathlib import Path
import time
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.chat import OpenClawReply
from app.services.openclaw_client import OpenClawInvocationError
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsReference


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


class FakeOpenClawClient:
    def __init__(
        self,
        raw_text: str | None = None,
        error: Exception | None = None,
        stream_error_after_chunks: bool = False,
        on_stream_call=None,
    ):
        self.raw_text = raw_text or (
            '{"text":"Hello from v2","emotion":"happy","action":"wave",'
            '"motion_plan":{"sequence":[{"template":"greet_wave","duration_ms":1200,"intensity":0.7}]},'
            '"memory_ops":[{"type":"remember","value":"likes tea"}],'
            '"tts_emotion_label":"关心温柔","tts_pause_profile":"none"}'
        )
        self.error = error
        self.stream_error_after_chunks = stream_error_after_chunks
        self.on_stream_call = on_stream_call
        self.calls = []
        self.stream_calls = []

    async def generate_reply(self, user_id, session_id, message, history):
        self.calls.append({"user_id": user_id, "session_id": session_id, "message": message, "history": history})
        if self.error:
            raise self.error
        return OpenClawReply(raw_text=self.raw_text, endpoint_used="/v1/responses", status_code=200)

    async def stream_reply(self, user_id, session_id, message, history):
        self.stream_calls.append({"user_id": user_id, "session_id": session_id, "message": message, "history": history})
        if self.error:
            raise self.error
        if self.on_stream_call:
            self.on_stream_call(self.stream_calls[-1])
        midpoint = max(1, len(self.raw_text) // 2)
        yield self.raw_text[:midpoint]
        yield self.raw_text[midpoint:]
        if self.stream_error_after_chunks:
            raise OpenClawInvocationError("ReadTimeout")


class FakeTtsClient:
    def __init__(self, *, complete_after_polls: int = 0, fail_status: bool = False):
        self.calls = []
        self.submit_calls = []
        self.status_calls = []
        self.complete_after_polls = complete_after_polls
        self.fail_status = fail_status
        self.tasks: dict[str, dict[str, int]] = {}
        self.http_client = httpx.AsyncClient(transport=httpx.MockTransport(self._handle_proxy))

    async def submit_task(self, *, text: str, emotion_label: str | None = None, pause_profile: str = "podcast"):
        payload = {"text": text, "emotion_label": emotion_label, "pause_profile": pause_profile}
        self.calls.append(payload)
        self.submit_calls.append(payload)
        task_id = f"tts-task-{len(self.tasks) + 1}"
        self.tasks[task_id] = {"polls": 0}
        return task_id

    async def wait_for_reference(self, task_id: str, *, max_wait_seconds: float | None = None):
        if self.fail_status:
            raise RuntimeError("tts task failed")
        if self.complete_after_polls == 0:
            return VoiceWorkflowTtsReference(
                media_type="audio/wav",
                task_id=task_id,
                audio_url=f"http://tts.example/audio/{task_id}.wav",
                duration_seconds=1.5,
                chunks_count=1,
            )
        return None

    async def get_task_status(self, task_id: str):
        self.status_calls.append(task_id)
        state = self.tasks[task_id]
        state["polls"] += 1
        if self.fail_status:
            return {"task_id": task_id, "status": "failed", "error": "tts task failed"}
        if state["polls"] > self.complete_after_polls:
            return {
                "task_id": task_id,
                "status": "completed",
                "audio_url": f"/audio/{task_id}.wav",
                "media_type": "audio/wav",
                "duration_seconds": 1.5,
                "chunks_count": 1,
            }
        return {"task_id": task_id, "status": "pending"}

    def build_reference(self, task_id: str, task: dict):
        return VoiceWorkflowTtsReference(
            media_type=str(task.get("media_type") or "audio/wav"),
            task_id=task_id,
            audio_url=f"http://tts.example{task['audio_url']}",
            duration_seconds=task.get("duration_seconds"),
            chunks_count=task.get("chunks_count"),
        )

    def _handle_proxy(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/audio/tts-task-") or request.url.path.endswith("/audio/tts-task-1.wav"):
            return httpx.Response(status_code=200, content=b"remote-audio", headers={"content-type": "audio/wav"})
        return httpx.Response(status_code=404)


def _client(*, app_overrides: dict | None = None, tts_client: FakeTtsClient | None = None) -> tuple[TestClient, object]:
    overrides = {"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": True}
    if app_overrides:
        overrides.update(app_overrides)
    app = create_app(overrides)
    app.state.openclaw_client = FakeOpenClawClient()
    app.state.tts_client = tts_client or FakeTtsClient()
    client = TestClient(app)
    client.__enter__()
    return client, app


def _write_model_stub(app, relative_path: str) -> None:
    full_path = app.state.settings.mmd_root_dir / relative_path
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(b"pmx")


def test_current_workspace_is_created_per_user_and_isolated():
    client, _ = _client()

    first = client.get("/workspaces/current", headers={"x-user-id": "u1"})
    second = client.get("/workspaces/current", headers={"x-user-id": "u2"})
    again = client.get("/workspaces/current", headers={"x-user-id": "u1"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["workspace"]["id"] == again.json()["workspace"]["id"]
    assert first.json()["workspace"]["id"] != second.json()["workspace"]["id"]
    assert first.json()["account"]["external_user_id"] == "u1"


def test_session_crud_and_soft_delete_are_scoped_to_current_user():
    client, _ = _client()

    created = client.post("/sessions", json={"title": "First chat"}, headers={"x-user-id": "u1"})
    assert created.status_code == 200
    session_id = created.json()["session"]["id"]

    listed = client.get("/sessions", headers={"x-user-id": "u1"})
    assert [item["id"] for item in listed.json()["items"]] == [session_id]

    renamed = client.patch(f"/sessions/{session_id}", json={"title": "Renamed"}, headers={"x-user-id": "u1"})
    assert renamed.status_code == 200
    assert renamed.json()["session"]["title"] == "Renamed"
    assert renamed.json()["session"]["title_source"] == "manual"

    denied = client.get(f"/sessions/{session_id}", headers={"x-user-id": "u2"})
    assert denied.status_code == 404

    deleted = client.delete(f"/sessions/{session_id}", headers={"x-user-id": "u1"})
    assert deleted.status_code == 200
    assert deleted.json()["session"]["deleted_at"] is not None
    assert client.get("/sessions", headers={"x-user-id": "u1"}).json()["items"] == []


def test_send_message_persists_user_and_assistant_messages_with_openclaw_metadata():
    client, app = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hello", "tts_enabled": False, "selected_model_path": "models/eula.pmx"},
        headers={"x-user-id": "u1", "x-trace-id": "trace-v2"},
    )

    assert sent.status_code == 200
    payload = sent.json()
    assert payload["user_message"]["content"] == "hello"
    assert payload["assistant_message"]["content"] == "Hello from v2"
    assert payload["assistant_message"]["emotion"] == "happy"
    assert payload["assistant_message"]["action"] == "wave"
    assert payload["assistant_message"]["tts"] is None
    assert payload["assistant_message"]["tts_emotion_label"] == "关心温柔"
    assert payload["assistant_message"]["tts_pause_profile"] == "none"
    assert app.state.openclaw_client.calls == []
    assert app.state.openclaw_client.stream_calls[0]["session_id"] == payload["session"]["openclaw_session_key"]

    listed = client.get(f"/sessions/{session_id}/messages", headers={"x-user-id": "u1"})
    assert [item["role"] for item in listed.json()["items"]] == ["user", "assistant"]
    assert listed.json()["items"][1]["content"] == "Hello from v2"


def test_send_message_prunes_bridge_echoes_for_same_openclaw_session():
    client, app = _client(app_overrides={"openclaw_stream_mode": "http_sse"})
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    ctx = app.state.trace_store.get_current_workspace_context("u1")
    app.state.trace_store.update_session_openclaw_session_key(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        session_id,
        "agent:main:feishu:direct:test-user",
    )

    def insert_bridge_echoes(call):
        app.state.trace_store.insert_message(
            ctx["workspace"]["id"],
            session_id,
            ctx["account"]["id"],
            role="user",
            content=call["message"],
            openclaw_message_id="bridge-user-echo",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": call["session_id"],
                "external_message_id": "bridge-user-echo",
                "synced_from": "realtime",
            },
        )
        app.state.trace_store.insert_message(
            ctx["workspace"]["id"],
            session_id,
            ctx["account"]["id"],
            role="assistant",
            content="Hello from v2",
            openclaw_message_id="bridge-assistant-echo",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": call["session_id"],
                "external_message_id": "bridge-assistant-echo",
                "synced_from": "realtime",
            },
        )

    app.state.openclaw_client = FakeOpenClawClient(on_stream_call=insert_bridge_echoes)

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hi", "tts_enabled": False},
        headers={"x-user-id": "u1", "x-trace-id": "trace-local"},
    )

    assert sent.status_code == 200
    listed = client.get(f"/sessions/{session_id}/messages", headers={"x-user-id": "u1"})
    messages = listed.json()["items"]

    assert [item["role"] for item in messages] == ["user", "assistant"]
    assert [item["content"] for item in messages] == ["hi", "Hello from v2"]
    assert [item["trace_id"] for item in messages] == ["trace-local", "trace-local"]
    assert all(item["metadata"].get("source") != "message_bridge" for item in messages)


def test_list_messages_suppresses_delayed_and_early_bridge_echoes():
    client, app = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    ctx = app.state.trace_store.get_current_workspace_context("u1")
    external_session_key = "agent:main:feishu:direct:test-user"
    app.state.trace_store.update_session_openclaw_session_key(
        ctx["workspace"]["id"],
        ctx["account"]["id"],
        session_id,
        external_session_key,
    )

    app.state.trace_store.insert_message(
        ctx["workspace"]["id"],
        session_id,
        ctx["account"]["id"],
        role="user",
        content="查一下",
        trace_id="trace-local-user",
    )
    app.state.trace_store.insert_message(
        ctx["workspace"]["id"],
        session_id,
        ctx["account"]["id"],
        role="user",
        content="查一下",
        openclaw_message_id="bridge-user-late",
        metadata={
            "source": "message_bridge",
            "provider": "openclaw",
            "channel": "feishu",
            "external_session_key": external_session_key,
            "external_message_id": "bridge-user-late",
            "synced_from": "realtime",
        },
    )
    app.state.trace_store.insert_message(
        ctx["workspace"]["id"],
        session_id,
        ctx["account"]["id"],
        role="assistant",
        content="这是同一条回复",
        openclaw_message_id="bridge-assistant-early",
        metadata={
            "source": "message_bridge",
            "provider": "openclaw",
            "channel": "feishu",
            "external_session_key": external_session_key,
            "external_message_id": "bridge-assistant-early",
            "synced_from": "realtime",
        },
    )
    app.state.trace_store.insert_message(
        ctx["workspace"]["id"],
        session_id,
        ctx["account"]["id"],
        role="assistant",
        content="这是同一条回复",
        trace_id="trace-local-assistant",
    )
    app.state.trace_store.insert_message(
        ctx["workspace"]["id"],
        session_id,
        ctx["account"]["id"],
        role="assistant",
        content="这是一条不同的远端回复",
        openclaw_message_id="bridge-assistant-remote-only",
        metadata={
            "source": "message_bridge",
            "provider": "openclaw",
            "channel": "feishu",
            "external_session_key": external_session_key,
            "external_message_id": "bridge-assistant-remote-only",
            "synced_from": "realtime",
        },
    )

    listed = client.get(f"/sessions/{session_id}/messages", headers={"x-user-id": "u1"})

    assert listed.status_code == 200
    messages = listed.json()["items"]
    assert [(item["role"], item["content"], item["trace_id"]) for item in messages] == [
        ("user", "查一下", "trace-local-user"),
        ("assistant", "这是同一条回复", "trace-local-assistant"),
        ("assistant", "这是一条不同的远端回复", None),
    ]


def test_send_message_uses_openclaw_stream_when_http_sse_mode_is_enabled():
    client, app = _client(app_overrides={"openclaw_stream_mode": "http_sse"})
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hello", "tts_enabled": False},
        headers={"x-user-id": "u1"},
    )

    assert sent.status_code == 200
    payload = sent.json()
    assert payload["assistant_message"]["content"] == "Hello from v2"
    assert payload["assistant_message"]["metadata"]["endpoint_used"] == "/v1/responses?stream=true"
    assert app.state.openclaw_client.calls == []
    assert app.state.openclaw_client.stream_calls[0]["session_id"] == payload["session"]["openclaw_session_key"]


def test_send_message_returns_complete_stream_json_before_late_stream_timeout():
    client, app = _client(app_overrides={"openclaw_stream_mode": "http_sse"})
    app.state.openclaw_client = FakeOpenClawClient(stream_error_after_chunks=True)
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hello", "tts_enabled": False},
        headers={"x-user-id": "u1"},
    )

    assert sent.status_code == 200
    payload = sent.json()
    assert payload["assistant_message"]["content"] == "Hello from v2"
    assert payload["assistant_message"]["metadata"]["endpoint_used"] == "/v1/responses?stream=true"
    assert payload["assistant_message"]["metadata"]["degraded"] is False


def test_send_message_with_tts_enabled_persists_remote_audio_reference_without_audio_file():
    client, app = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )

    assert sent.status_code == 200
    tts = sent.json()["assistant_message"]["tts"]
    assert tts["status"] == "ready"
    assert tts["provider"] == "voice-workflow"
    assert tts["task_id"] == "tts-task-1"
    assert tts["remote_audio_url"] == "http://tts.example/audio/tts-task-1.wav"
    assert tts["proxy_audio_url"].startswith("/tts/proxy/")
    assert "audio" not in tts
    assert app.state.tts_client.calls == [
        {"text": "Hello from v2", "emotion_label": "关心温柔", "pause_profile": "none"}
    ]

    message_id = sent.json()["assistant_message"]["id"]
    fetched = client.get(f"/messages/{message_id}", headers={"x-user-id": "u1"})
    assert fetched.status_code == 200
    assert fetched.json()["message"]["tts"]["remote_audio_url"] == "http://tts.example/audio/tts-task-1.wav"

    trace_id = sent.json()["assistant_message"]["trace_id"]
    trace_events = client.get(f"/trace/events?trace_id={trace_id}", headers={"x-user-id": "u1"})
    assert trace_events.status_code == 200
    stages = [item["stage"] for item in trace_events.json()["items"]]
    assert "message_service.ingress" in stages
    assert "message_service.openclaw.request" in stages
    assert "message_service.openclaw.response" in stages
    assert "message_service.tts.submit" in stages
    assert "message_service.tts.reference" in stages
    assert "message_service.egress" in stages

    trace_mirrors = client.get(f"/trace/mirrors?trace_id={trace_id}", headers={"x-user-id": "u1"})
    assert trace_mirrors.status_code == 200
    assert trace_mirrors.json()["items"][0]["status"] == "ok"


def test_send_message_with_tts_sync_timeout_returns_pending_then_worker_completes():
    tts_client = FakeTtsClient(complete_after_polls=1)
    client, _ = _client(
        app_overrides={
            "tts_sync_wait_seconds": 0,
            "tts_job_worker_interval_seconds": 0.05,
            "tts_service_max_poll_attempts": 4,
        },
        tts_client=tts_client,
    )
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )

    assert sent.status_code == 200
    message_id = sent.json()["assistant_message"]["id"]
    assert sent.json()["assistant_message"]["tts"]["status"] == "pending"
    assert sent.json()["assistant_message"]["tts"]["remote_audio_url"] is None

    time.sleep(0.25)
    fetched = client.get(f"/messages/{message_id}", headers={"x-user-id": "u1"})
    assert fetched.status_code == 200
    assert fetched.json()["message"]["tts"]["status"] == "ready"
    assert fetched.json()["message"]["tts"]["remote_audio_url"] == "http://tts.example/audio/tts-task-1.wav"

    trace_id = sent.json()["assistant_message"]["trace_id"]
    trace_events = client.get(f"/trace/events?trace_id={trace_id}", headers={"x-user-id": "u1"})
    assert trace_events.status_code == 200
    stages = [(item["stage"], item["status"]) for item in trace_events.json()["items"]]
    assert ("message_service.tts.reference", "pending") in stages
    assert ("message_service.tts.worker", "pending") in stages
    assert ("message_service.tts.reference", "ok") in stages


def test_tts_worker_keeps_processing_task_pending_after_local_poll_attempt_cap():
    tts_client = FakeTtsClient(complete_after_polls=999)
    client, _ = _client(
        app_overrides={
            "tts_sync_wait_seconds": 0,
            "tts_job_worker_interval_seconds": 0.01,
            "tts_service_max_poll_attempts": 2,
        },
        tts_client=tts_client,
    )
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )

    assert sent.status_code == 200
    message_id = sent.json()["assistant_message"]["id"]
    assert sent.json()["assistant_message"]["tts"]["status"] == "pending"

    time.sleep(0.12)
    fetched = client.get(f"/messages/{message_id}", headers={"x-user-id": "u1"})

    assert fetched.status_code == 200
    assert fetched.json()["message"]["tts"]["status"] == "pending"
    assert fetched.json()["message"]["tts"]["error"] is None
    assert len(tts_client.status_calls) > 2


def test_tts_regenerate_replaces_active_reference_with_next_version():
    client, app = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )
    message_id = sent.json()["assistant_message"]["id"]

    regenerated = client.post(f"/messages/{message_id}/tts/regenerate", json={}, headers={"x-user-id": "u1"})

    assert regenerated.status_code == 200
    tts = regenerated.json()["message"]["tts"]
    assert tts["status"] == "ready"
    assert tts["version"] == 2
    assert tts["remote_audio_url"] == "http://tts.example/audio/tts-task-2.wav"
    assert len(app.state.tts_client.calls) == 2


def test_tts_mark_expired_updates_active_reference():
    client, _ = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )
    tts_id = sent.json()["assistant_message"]["tts"]["id"]
    message_id = sent.json()["assistant_message"]["id"]

    expired = client.post(f"/message-tts/{tts_id}/mark-expired", json={}, headers={"x-user-id": "u1"})

    assert expired.status_code == 200
    assert expired.json()["tts"]["status"] == "expired"
    fetched = client.get(f"/messages/{message_id}", headers={"x-user-id": "u1"})
    assert fetched.json()["message"]["tts"]["status"] == "expired"


def test_tts_proxy_streams_remote_audio_reference():
    client, _ = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )
    tts_id = sent.json()["assistant_message"]["tts"]["id"]

    proxied = client.get(f"/tts/proxy/{tts_id}", headers={"x-user-id": "u1"})

    assert proxied.status_code == 200
    assert proxied.headers["content-type"] == "audio/wav"
    assert proxied.content == b"remote-audio"


def test_tts_proxy_accepts_query_user_id_for_audio_elements():
    client, _ = _client()
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )
    tts_id = sent.json()["assistant_message"]["tts"]["id"]

    proxied = client.get(f"/tts/proxy/{tts_id}?user_id=u1")

    assert proxied.status_code == 200
    assert proxied.headers["content-type"] == "audio/wav"
    assert proxied.content == b"remote-audio"


def test_tts_proxy_marks_expired_when_remote_audio_is_gone():
    client, app = _client()

    async def missing_audio(_url: str, **_kwargs):
        return httpx.Response(status_code=404, content=b"")

    app.state.tts_client.http_client.get = missing_audio
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )
    tts_id = sent.json()["assistant_message"]["tts"]["id"]
    message_id = sent.json()["assistant_message"]["id"]

    proxied = client.get(f"/tts/proxy/{tts_id}", headers={"x-user-id": "u1"})

    assert proxied.status_code == 404
    fetched = client.get(f"/messages/{message_id}", headers={"x-user-id": "u1"})
    assert fetched.json()["message"]["tts"]["status"] == "expired"


def test_motion_context_export_returns_current_model_favorites_snapshot():
    client, app = _client()
    model_path = "Eula/Eula.pmx"
    _write_model_stub(app, model_path)
    usage_path = "usage/vmd/Eula[动作]/打招呼1.vmd"
    upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        files={"file": ("wave.vmd", b"Vocaloid Motion Data 0002".ljust(64, b"\x00"), "application/octet-stream")},
        data={"user_id": "u1", "slot": "happy", "source_relative_path": usage_path},
    )
    asset_id = upload.json()["asset_id"]
    favorite = client.patch(
        f"/assets/vmd/{asset_id}",
        headers={"x-user-id": "u1"},
        json={"favorite": True, "model_relative_path": model_path, "display_name": "打招呼1.vmd"},
    )
    assert favorite.status_code == 200

    exported = client.post(
        "/motion-context/exports",
        headers={"x-user-id": "u1"},
        json={"selected_model_path": model_path},
    )

    assert exported.status_code == 200
    payload = exported.json()
    assert payload["model_key"] == model_path
    assert payload["motion_count"] == 1
    motion = payload["export_json"]["motions"][0]
    assert motion["motion_key"] == asset_id
    assert motion["asset_id"] == asset_id
    assert motion["action"] == asset_id
    assert motion["emotion"] == "happy"
    assert motion["match_names"] == [asset_id, "打招呼1", "打招呼1.vmd", "wave.vmd"]


def test_message_send_resolves_motion_key_to_favorite_vmd_asset():
    client, app = _client()
    model_path = "Eula/Eula.pmx"
    _write_model_stub(app, model_path)
    usage_path = "usage/vmd/Eula[动作]/打招呼1.vmd"
    upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        files={"file": ("wave.vmd", b"Vocaloid Motion Data 0002".ljust(64, b"\x00"), "application/octet-stream")},
        data={"user_id": "u1", "slot": "happy", "source_relative_path": usage_path},
    )
    asset_id = upload.json()["asset_id"]
    client.patch(
        f"/assets/vmd/{asset_id}",
        headers={"x-user-id": "u1"},
        json={"favorite": True, "model_relative_path": model_path, "display_name": "打招呼1.vmd"},
    )
    app.state.openclaw_client = FakeOpenClawClient(
        raw_text=(
            '{"text":"Hello from v2","emotion":"happy","action":"'
            + asset_id
            + '","motion_plan":{"sequence":[{"template":"greet_wave","duration_ms":1200,"intensity":0.7}]},'
              '"memory_ops":[],"tts_emotion_label":"关心温柔","tts_pause_profile":"none"}'
        )
    )
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hello", "tts_enabled": False, "selected_model_path": model_path},
        headers={"x-user-id": "u1"},
    )

    assert sent.status_code == 200
    resolution = sent.json()["assistant_message"]["motion_resolution"]
    assert resolution["status"] == "matched"
    assert resolution["resolved_asset_id"] == asset_id
    assert resolution["resolved_asset_url"] == f"/assets/vmd/file/{asset_id}"
    assert resolution["resolved_display_name"] == "打招呼1.vmd"


def test_message_send_falls_back_to_idle_when_no_favorite_motion_matches():
    client, app = _client()
    app.state.openclaw_client = FakeOpenClawClient(
        raw_text='{"text":"Hello from v2","emotion":"happy","action":"missing-motion","memory_ops":[]}'
    )
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hello", "tts_enabled": False, "selected_model_path": "Eula/Eula.pmx"},
        headers={"x-user-id": "u1"},
    )

    assert sent.status_code == 200
    resolution = sent.json()["assistant_message"]["motion_resolution"]
    assert resolution["status"] == "fallback_idle"
    assert resolution["resolved_asset_id"] is None


def test_message_send_uses_later_motion_plan_template_when_action_and_first_template_do_not_match():
    client, app = _client()
    model_path = "Eula/Eula.pmx"
    _write_model_stub(app, model_path)
    upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        files={"file": ("listen_lean.vmd", b"Vocaloid Motion Data 0002".ljust(64, b"\x00"), "application/octet-stream")},
        data={"user_id": "u1", "slot": "thinking", "source_relative_path": "usage/vmd/Eula/listen_lean.vmd"},
    )
    asset_id = upload.json()["asset_id"]
    client.patch(
        f"/assets/vmd/{asset_id}",
        headers={"x-user-id": "u1"},
        json={"favorite": True, "model_relative_path": model_path, "display_name": "listen_lean.vmd"},
    )
    app.state.openclaw_client = FakeOpenClawClient(
        raw_text=(
            '{"text":"Hello from v2","emotion":"thinking","action":"missing-motion",'
            '"motion_plan":{"sequence":['
            '{"template":"greet_wave","duration_ms":600,"intensity":0.4},'
            '{"template":"listen_lean","duration_ms":1200,"intensity":0.7}'
            ']},"memory_ops":[]}'
        )
    )
    session_id = client.post("/sessions", json={}, headers={"x-user-id": "u1"}).json()["session"]["id"]

    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "hello", "tts_enabled": False, "selected_model_path": model_path},
        headers={"x-user-id": "u1"},
    )

    assert sent.status_code == 200
    resolution = sent.json()["assistant_message"]["motion_resolution"]
    assert resolution["status"] == "matched"
    assert resolution["source_action"] == "missing-motion"
    assert resolution["source_template"] == "greet_wave"
    assert resolution["resolved_asset_id"] == asset_id
    assert resolution["resolved_asset_url"] == f"/assets/vmd/file/{asset_id}"


def test_latest_motion_context_export_returns_most_recent_snapshot_for_model():
    client, app = _client()
    model_path = "Eula/Eula.pmx"
    _write_model_stub(app, model_path)

    first_upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        files={"file": ("wave.vmd", b"Vocaloid Motion Data 0002".ljust(64, b"\x00"), "application/octet-stream")},
        data={"user_id": "u1", "slot": "happy", "source_relative_path": "usage/vmd/Eula/wave.vmd"},
    )
    first_asset_id = first_upload.json()["asset_id"]
    client.patch(
        f"/assets/vmd/{first_asset_id}",
        headers={"x-user-id": "u1"},
        json={"favorite": True, "model_relative_path": model_path, "display_name": "wave.vmd"},
    )

    first_export = client.post(
        "/motion-context/exports",
        headers={"x-user-id": "u1"},
        json={"selected_model_path": model_path},
    )
    assert first_export.status_code == 200
    assert first_export.json()["motion_count"] == 1

    second_upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        files={"file": ("cheer.vmd", b"Vocaloid Motion Data 0002".ljust(64, b"\x00"), "application/octet-stream")},
        data={"user_id": "u1", "slot": "excited", "source_relative_path": "usage/vmd/Eula/cheer.vmd"},
    )
    second_asset_id = second_upload.json()["asset_id"]
    client.patch(
        f"/assets/vmd/{second_asset_id}",
        headers={"x-user-id": "u1"},
        json={"favorite": True, "model_relative_path": model_path, "display_name": "cheer.vmd"},
    )

    second_export = client.post(
        "/motion-context/exports",
        headers={"x-user-id": "u1"},
        json={"selected_model_path": model_path},
    )
    assert second_export.status_code == 200
    assert second_export.json()["motion_count"] == 2

    latest = client.get(
        f"/motion-context/exports/latest?model_key={model_path}",
        headers={"x-user-id": "u1"},
    )

    assert latest.status_code == 200
    assert latest.json()["id"] == second_export.json()["id"]
    assert latest.json()["motion_count"] == 2
    assert [item["asset_id"] for item in latest.json()["export_json"]["motions"]] == [second_asset_id, first_asset_id]


def test_admin_cleanup_route_removes_deleted_session_records_and_old_failed_tts():
    client, app = _client(app_overrides={"admin_user_ids": ["admin"], "message_service_tts_retention_days": 0})
    session_id = client.post("/sessions", json={"title": "cleanup"}, headers={"x-user-id": "u1"}).json()["session"]["id"]
    sent = client.post(
        f"/sessions/{session_id}/messages",
        json={"content": "voice please", "tts_enabled": True},
        headers={"x-user-id": "u1"},
    )
    message_id = sent.json()["assistant_message"]["id"]
    tts_id = sent.json()["assistant_message"]["tts"]["id"]
    workspace_id = sent.json()["assistant_message"]["workspace_id"]
    app.state.trace_store.update_tts_status(workspace_id, tts_id, status="failed", error="old")
    client.delete(f"/sessions/{session_id}", headers={"x-user-id": "u1"})

    denied = client.post("/admin/message-service/cleanup", headers={"x-user-id": "u1"})
    assert denied.status_code == 403

    cleaned = client.post("/admin/message-service/cleanup", headers={"x-user-id": "admin"})
    assert cleaned.status_code == 200
    assert cleaned.json()["counts"]["deleted_soft_deleted_messages"] >= 2
    assert cleaned.json()["counts"]["deleted_soft_deleted_tts"] >= 1
    assert client.get(f"/messages/{message_id}", headers={"x-user-id": "u1"}).status_code == 404
