import asyncio
import json

import httpx
import pytest

from app.services.voice_workflow_tts_client import VoiceWorkflowTtsClient, VoiceWorkflowTtsError


def test_voice_workflow_tts_submits_polls_and_downloads_audio():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "path": request.url.path,
                "body": json.loads(request.content.decode("utf-8")) if request.content else None,
            }
        )
        if request.method == "POST" and request.url.path == "/api/v1/tts":
            return httpx.Response(status_code=202, json={"task_id": "task-1", "status": "pending"})
        if request.method == "GET" and request.url.path == "/api/v1/tasks/task-1":
            return httpx.Response(
                status_code=200,
                json={
                    "task_id": "task-1",
                    "status": "completed",
                    "emotion_label": "关心温柔",
                    "audio_url": "/api/v1/audio/2026/04/30/tts_task-1.wav",
                    "duration_seconds": 1.2,
                    "chunks_count": 1,
                    "created_at": "2026-04-30T02:15:00Z",
                    "completed_at": "2026-04-30T02:15:02Z",
                    "error": None,
                },
            )
        if request.method == "GET" and request.url.path == "/api/v1/audio/2026/04/30/tts_task-1.wav":
            return httpx.Response(status_code=200, content=b"fake-wav", headers={"content-type": "audio/wav"})
        return httpx.Response(status_code=404)

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = VoiceWorkflowTtsClient(
                base_url="http://tts.local",
                timeout_seconds=5,
                poll_interval_seconds=0,
                max_poll_attempts=3,
                http_client=http_client,
            )
            return await client.synthesize(
                text="辛苦了",
                emotion_label="关心温柔",
                pause_profile="podcast",
            )

    result = asyncio.run(run_case())

    assert result.audio == b"fake-wav"
    assert result.media_type == "audio/wav"
    assert result.task_id == "task-1"
    assert result.audio_url == "http://tts.local/api/v1/audio/2026/04/30/tts_task-1.wav"
    assert calls == [
        {
            "method": "POST",
            "path": "/api/v1/tts",
            "body": {"text": "辛苦了", "pause_profile": "podcast", "emotion_label": "关心温柔"},
        },
        {"method": "GET", "path": "/api/v1/tasks/task-1", "body": None},
        {"method": "GET", "path": "/api/v1/audio/2026/04/30/tts_task-1.wav", "body": None},
    ]


def test_voice_workflow_tts_reference_does_not_download_audio():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append({"method": request.method, "path": request.url.path})
        if request.method == "POST" and request.url.path == "/api/v1/tts":
            return httpx.Response(status_code=202, json={"task_id": "task-1"})
        if request.method == "GET" and request.url.path == "/api/v1/tasks/task-1":
            return httpx.Response(
                status_code=200,
                json={
                    "task_id": "task-1",
                    "status": "completed",
                    "audio_url": "/api/v1/audio/tts_task-1.wav",
                    "media_type": "audio/wav",
                    "duration_seconds": 2.5,
                    "chunks_count": 2,
                },
            )
        return httpx.Response(status_code=500)

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = VoiceWorkflowTtsClient(
                base_url="http://tts.local",
                timeout_seconds=5,
                poll_interval_seconds=0,
                max_poll_attempts=1,
                http_client=http_client,
            )
            return await client.synthesize_reference(text="hello", emotion_label="关心温柔", pause_profile="none")

    result = asyncio.run(run_case())

    assert result.media_type == "audio/wav"
    assert result.task_id == "task-1"
    assert result.audio_url == "http://tts.local/api/v1/audio/tts_task-1.wav"
    assert result.duration_seconds == 2.5
    assert result.chunks_count == 2
    assert calls == [
        {"method": "POST", "path": "/api/v1/tts"},
        {"method": "GET", "path": "/api/v1/tasks/task-1"},
    ]


def test_voice_workflow_tts_chunk_returns_reference():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "path": request.url.path,
                "body": json.loads(request.content.decode("utf-8")) if request.content else None,
            }
        )
        if request.method == "POST" and request.url.path == "/api/v1/tts/chunk":
            return httpx.Response(
                status_code=200,
                json={
                    "session_id": "tts-session",
                    "sequence": 1,
                    "status": "ready",
                    "audio_url": "/api/v1/audio/realtime/tts-session/0001.wav",
                    "duration": 1.6,
                    "elapsed_seconds": 15.817,
                },
            )
        return httpx.Response(status_code=404)

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = VoiceWorkflowTtsClient(
                base_url="http://tts.local",
                timeout_seconds=5,
                http_client=http_client,
            )
            return await client.synthesize_chunk(
                text="hello",
                emotion_label="daily",
                pause_profile="podcast",
                session_id="tts-session",
                sequence=1,
            )

    result = asyncio.run(run_case())

    assert result.session_id == "tts-session"
    assert result.sequence == 1
    assert result.status == "ready"
    assert result.audio_url == "http://tts.local/api/v1/audio/realtime/tts-session/0001.wav"
    assert result.duration_seconds == 1.6
    assert result.elapsed_seconds == 15.817
    assert calls == [
        {
            "method": "POST",
            "path": "/api/v1/tts/chunk",
            "body": {
                "text": "hello",
                "pause_profile": "podcast",
                "emotion_label": "daily",
                "session_id": "tts-session",
                "sequence": 1,
            },
        }
    ]


def test_voice_workflow_tts_chunk_rejects_missing_audio_url():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=200,
            json={"session_id": "tts-session", "sequence": 1, "status": "ready"},
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = VoiceWorkflowTtsClient(base_url="http://tts.local", http_client=http_client)
            await client.synthesize_chunk(text="hello")

    with pytest.raises(VoiceWorkflowTtsError, match="audio_url"):
        asyncio.run(run_case())


def test_voice_workflow_tts_cancel_realtime_posts_session_cancel():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append({"method": request.method, "path": request.url.path})
        if request.method == "POST" and request.url.path == "/api/v1/tts/realtime/session-1/cancel":
            return httpx.Response(status_code=200, json={"cancelled": True})
        return httpx.Response(status_code=404)

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = VoiceWorkflowTtsClient(base_url="http://tts.local", http_client=http_client)
            return await client.cancel_realtime("session-1")

    assert asyncio.run(run_case()) is True
    assert calls == [{"method": "POST", "path": "/api/v1/tts/realtime/session-1/cancel"}]


def test_voice_workflow_refresh_daily_podcast_posts_refresh_endpoint():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "path": request.url.path,
                "body": request.content,
            }
        )
        if request.method == "POST" and request.url.path == "/api/v1/podcast/daily/refresh":
            return httpx.Response(status_code=202, json={"status": "accepted", "date": "2026-05-21"})
        return httpx.Response(status_code=404)

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = VoiceWorkflowTtsClient(base_url="http://tts.local", http_client=http_client)
            return await client.refresh_daily_podcast()

    assert asyncio.run(run_case()) == {"status": "accepted", "date": "2026-05-21"}
    assert calls == [{"method": "POST", "path": "/api/v1/podcast/daily/refresh", "body": b""}]


def test_voice_workflow_builds_eula_storage_audio_url_for_interface_5():
    client = VoiceWorkflowTtsClient(base_url="http://tts.local")

    try:
        url = client.eula_storage_url(
            "/Users/sola/Desktop/kscc/Qwen3-TTS/eula_emotion_revelation/关心温柔/goodnight_20260517_2200.wav"
        )
    finally:
        asyncio.run(client.close())

    assert (
        url
        == "http://tts.local/api/v1/eula-storage-audio/%E5%85%B3%E5%BF%83%E6%B8%A9%E6%9F%94/goodnight_20260517_2200.wav"
    )


def test_voice_workflow_tts_omits_default_voice_as_emotion_label():
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            bodies.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(status_code=202, json={"task_id": "task-1", "status": "pending"})
        if request.url.path == "/api/v1/tasks/task-1":
            return httpx.Response(status_code=200, json={"task_id": "task-1", "status": "completed", "audio_url": "/a.wav"})
        return httpx.Response(status_code=200, content=b"wav")

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = VoiceWorkflowTtsClient(
                base_url="http://tts.local",
                timeout_seconds=5,
                poll_interval_seconds=0,
                http_client=http_client,
            )
            await client.synthesize(text="hello", emotion_label="default")

    asyncio.run(run_case())

    assert bodies == [{"text": "hello", "pause_profile": "podcast"}]


def test_voice_workflow_tts_raises_when_task_fails():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(status_code=202, json={"task_id": "task-1", "status": "pending"})
        return httpx.Response(
            status_code=200,
            json={"task_id": "task-1", "status": "failed", "error": "model failed"},
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = VoiceWorkflowTtsClient(
                base_url="http://tts.local",
                timeout_seconds=5,
                poll_interval_seconds=0,
                max_poll_attempts=1,
                http_client=http_client,
            )
            await client.synthesize(text="hello")

    with pytest.raises(VoiceWorkflowTtsError, match="model failed"):
        asyncio.run(run_case())
