import asyncio
from dataclasses import dataclass

import httpx

from app.services.daily_podcast import DailyPodcastService


@dataclass(slots=True)
class FakeVoiceWorkflowClient:
    http_client: httpx.AsyncClient
    timeout_seconds: int = 5
    base_url: str = "http://voice.local"

    def eula_storage_url(self, path: str) -> str:
        return f"{self.base_url}/api/v1/eula-storage-audio/{path.lstrip('/')}"


def _latest_payload(date: str = "2026-05-18") -> dict:
    compact = date.replace("-", "")
    return {
        "date": date,
        "metaPath": f"podcast/{date[0:4]}/{date[5:7]}/{date[8:10]}/podcast_{compact}.meta.json",
    }


def _meta_payload(date: str = "2026-05-18", *, doc_url: str | None = "https://docs.local/daily") -> dict:
    compact = date.replace("-", "")
    base_path = f"podcast/{date[0:4]}/{date[5:7]}/{date[8:10]}/podcast_{compact}"
    return {
        "ok": True,
        "date": date,
        "docUrl": doc_url,
        "docLinks": {"main": "https://docs.local/daily"},
        "counts": {"headlines": 3, "segments": 8},
        "scriptChars": 3456,
        "updatedAt": "2026-05-18T09:00:00Z",
        "audio": {
            "oggPath": f"{base_path}.ogg",
            "wavPath": f"{base_path}.wav",
        },
    }


def _run_with_transport(handler, operation):
    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            service = DailyPodcastService(tts_client=FakeVoiceWorkflowClient(http_client=http_client))
            return await operation(service)

    return asyncio.run(run_case())


def test_latest_podcast_prefers_ogg_when_probe_succeeds():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/eula-storage-audio/podcast/latest.json":
            return httpx.Response(status_code=200, json=_latest_payload())
        if request.url.path.endswith("podcast_20260518.meta.json"):
            return httpx.Response(status_code=200, json=_meta_payload())
        if request.url.path.endswith("podcast_20260518.ogg"):
            assert request.headers["range"] == "bytes=0-1023"
            return httpx.Response(
                status_code=206,
                content=b"ogg-range",
                headers={"content-type": "audio/ogg", "content-range": "bytes 0-1023/1388346"},
            )
        return httpx.Response(status_code=404)

    result = _run_with_transport(handler, lambda service: service.latest())

    assert result.status == "ready"
    assert result.audio.source == "ogg"
    assert result.audio.format == "audio/ogg"
    assert result.audio.bytes == 1388346
    assert result.audio.url == "/podcasts/daily/2026-05-18/audio?format=preferred"


def test_latest_podcast_falls_back_to_wav_when_ogg_missing():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/eula-storage-audio/podcast/latest.json":
            return httpx.Response(status_code=200, json=_latest_payload())
        if request.url.path.endswith("podcast_20260518.meta.json"):
            return httpx.Response(status_code=200, json=_meta_payload())
        if request.url.path.endswith("podcast_20260518.ogg"):
            return httpx.Response(status_code=404)
        if request.url.path.endswith("podcast_20260518.wav"):
            return httpx.Response(
                status_code=206,
                content=b"wav-range",
                headers={"content-type": "audio/wav", "content-range": "bytes 0-1023/2388346"},
            )
        return httpx.Response(status_code=404)

    result = _run_with_transport(handler, lambda service: service.latest())

    assert result.audio.source == "wav"
    assert result.audio.format == "audio/wav"


def test_meta_with_doc_but_no_audio_maps_partial():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/eula-storage-audio/podcast/latest.json":
            return httpx.Response(status_code=200, json=_latest_payload())
        if request.url.path.endswith("podcast_20260518.meta.json"):
            return httpx.Response(status_code=200, json=_meta_payload())
        return httpx.Response(status_code=404)

    result = _run_with_transport(handler, lambda service: service.latest())

    assert result.status == "partial"
    assert result.doc_url == "https://docs.local/daily"
    assert result.audio.url is None


def test_missing_meta_maps_missing():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/eula-storage-audio/podcast/latest.json":
            return httpx.Response(status_code=200, json=_latest_payload())
        return httpx.Response(status_code=404)

    result = _run_with_transport(handler, lambda service: service.latest())

    assert result.status == "missing"


def test_latest_podcast_maps_voice_request_error_to_failed():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.RemoteProtocolError("Server disconnected without sending a response.")

    result = _run_with_transport(handler, lambda service: service.latest())

    assert result.status == "failed"
    assert result.audio_error == "Voice Workflow request failed: Server disconnected without sending a response."


def test_recent_list_returns_empty_when_latest_pointer_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.RemoteProtocolError("Server disconnected without sending a response.")

    result = _run_with_transport(handler, lambda service: service.list_recent(days=3))

    assert result == []


def test_recent_list_scans_from_latest_date_and_omits_missing_dates():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/eula-storage-audio/podcast/latest.json":
            return httpx.Response(status_code=200, json=_latest_payload())
        if request.url.path.endswith("podcast_20260518.meta.json"):
            return httpx.Response(status_code=200, json=_meta_payload("2026-05-18"))
        if request.url.path.endswith("podcast_20260516.meta.json"):
            return httpx.Response(status_code=200, json=_meta_payload("2026-05-16"))
        if request.url.path.endswith(".ogg"):
            return httpx.Response(
                status_code=206,
                content=b"ogg-range",
                headers={"content-type": "audio/ogg", "content-range": "bytes 0-1023/1000"},
            )
        return httpx.Response(status_code=404)

    result = _run_with_transport(handler, lambda service: service.list_recent(days=3))

    assert [item.date for item in result] == ["2026-05-18", "2026-05-16"]
