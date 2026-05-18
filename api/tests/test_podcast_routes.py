from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app.main import create_app


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass(slots=True)
class FakePodcastTtsClient:
    http_client: httpx.AsyncClient
    timeout_seconds: int = 5
    base_url: str = "http://voice.local"

    def eula_storage_url(self, path: str) -> str:
        return f"{self.base_url}/api/v1/eula-storage-audio/{path.lstrip('/')}"

    async def close(self) -> None:
        await self.http_client.aclose()


def _latest_payload(date: str = "2026-05-18") -> dict:
    compact = date.replace("-", "")
    return {
        "date": date,
        "metaPath": f"podcast/{date[0:4]}/{date[5:7]}/{date[8:10]}/podcast_{compact}.meta.json",
    }


def _meta_payload(date: str = "2026-05-18", *, with_audio: bool = True) -> dict:
    compact = date.replace("-", "")
    base_path = f"podcast/{date[0:4]}/{date[5:7]}/{date[8:10]}/podcast_{compact}"
    return {
        "ok": True,
        "date": date,
        "docUrl": "https://docs.local/daily",
        "docLinks": {"main": "https://docs.local/daily"},
        "counts": {"headlines": 3},
        "scriptChars": 1200,
        "updatedAt": "2026-05-18T09:00:00Z",
        "audio": {
            "oggPath": f"{base_path}.ogg" if with_audio else None,
            "wavPath": f"{base_path}.wav" if with_audio else None,
        },
    }


def _client(handler) -> TestClient:
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": True})
    transport = httpx.MockTransport(handler)
    app.state.tts_client = FakePodcastTtsClient(http_client=httpx.AsyncClient(transport=transport))
    return TestClient(app)


def _handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/v1/eula-storage-audio/podcast/latest.json":
        return httpx.Response(status_code=200, json=_latest_payload())
    if request.url.path.endswith("podcast_20260518.meta.json"):
        return httpx.Response(status_code=200, json=_meta_payload("2026-05-18"))
    if request.url.path.endswith("podcast_20260518.ogg"):
        return httpx.Response(
            status_code=206,
            content=b"ogg-range",
            headers={
                "content-type": "audio/ogg",
                "accept-ranges": "bytes",
                "content-range": "bytes 0-1023/1388346",
                "content-length": "9",
                "etag": '"podcast-ogg"',
            },
        )
    return httpx.Response(status_code=404)


def test_get_latest_podcast_returns_normalized_payload():
    client = _client(_handler)

    response = client.get("/podcasts/daily/latest", headers={"x-user-id": "u1"})

    assert response.status_code == 200
    assert response.json()["podcast"]["date"] == "2026-05-18"
    assert response.json()["podcast"]["audio"]["url"] == "/podcasts/daily/2026-05-18/audio?format=preferred"


def test_list_podcasts_defaults_to_30_days():
    client = _client(_handler)

    response = client.get("/podcasts/daily", headers={"x-user-id": "u1"})

    assert response.status_code == 200
    assert response.json()["days"] == 30
    assert [item["date"] for item in response.json()["items"]] == ["2026-05-18"]


def test_podcast_audio_proxy_preserves_audio_headers_and_range():
    client = _client(_handler)

    response = client.get(
        "/podcasts/daily/2026-05-18/audio?format=preferred",
        headers={"x-user-id": "u1", "Range": "bytes=0-1023"},
    )

    assert response.status_code == 206
    assert response.headers["content-type"] == "audio/ogg"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-range"] == "bytes 0-1023/1388346"
    assert response.content == b"ogg-range"


def test_podcast_audio_proxy_returns_404_when_no_audio():
    client = _client(_handler)

    response = client.get("/podcasts/daily/2026-05-17/audio?format=preferred", headers={"x-user-id": "u1"})

    assert response.status_code == 404
