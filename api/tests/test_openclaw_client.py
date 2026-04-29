import asyncio
import json

import httpx
import pytest

from app.services.openclaw_client import OpenClawClient, OpenClawInvocationError


def test_openclaw_chat_uses_responses_only():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/v1/responses"):
            return httpx.Response(
                status_code=200,
                json={
                    "output_text": '{"text":"\\u6536\\u5230","emotion":"neutral","action":"nod","memory_ops":[]}'
                },
            )
        return httpx.Response(status_code=404, json={"error": "not found"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw/default",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[{"role": "user", "content": "\u4f60\u597d"}],
            )

    result = asyncio.run(run_case())

    assert calls == ["/v1/responses"]
    assert result.endpoint_used == "/v1/responses"
    parsed = json.loads(result.raw_text)
    assert parsed["text"] == "\u6536\u5230"


def test_openclaw_chat_surfaces_responses_failure_without_chat_completions_fallback():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(status_code=500, json={"error": "temporary failure"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw/default",
                timeout_seconds=15,
                http_client=http_client,
            )
            await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[{"role": "user", "content": "\u4f60\u597d"}],
            )

    with pytest.raises(OpenClawInvocationError) as error:
        asyncio.run(run_case())

    assert calls == ["/v1/responses", "/v1/responses"]
    assert "Server status 500" in str(error.value)


def test_openclaw_uses_gateway_model_without_backend_model_header():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "path": request.url.path,
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(
            status_code=200,
            json={
                "output_text": '{"text":"\\u6536\\u5230","emotion":"neutral","action":"nod","memory_ops":[]}'
            },
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="minimax-portal/MiniMax-M2.7",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[],
            )

    result = asyncio.run(run_case())

    assert result.endpoint_used == "/v1/responses"
    assert len(calls) == 1
    request = calls[0]
    assert request["path"].endswith("/v1/responses")
    assert request["body"]["model"] == "openclaw"
    assert request["headers"]["authorization"] == "Bearer secret-token"
    assert request["headers"]["x-openclaw-agent-id"] == "main"
    assert "x-openclaw-model" not in request["headers"]
    assert (
        request["headers"]["x-openclaw-scopes"]
        == "operator.admin,operator.read,operator.write,operator.approvals,operator.pairing"
    )
    assert request["headers"]["x-openclaw-session-key"] == "s1"


def test_openclaw_sends_feishu_message_channel_header():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append({"headers": dict(request.headers)})
        return httpx.Response(
            status_code=200,
            json={
                "output_text": '{"text":"ok","emotion":"neutral","action":"nod","memory_ops":[]}'
            },
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                agent_id="main",
                message_channel="feishu",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[],
            )

    result = asyncio.run(run_case())

    assert result.endpoint_used == "/v1/responses"
    assert calls[0]["headers"]["x-openclaw-message-channel"] == "feishu"


def test_openclaw_generates_speech_from_audio_speech_endpoint():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "path": request.url.path,
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(
            status_code=200,
            content=b"fake-mp3-bytes",
            headers={"content-type": "audio/mpeg"},
        )

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="minimax-portal/MiniMax-M2.7",
                agent_id="main",
                message_channel="feishu",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.generate_speech(
                user_id="u1",
                session_id="s1",
                text="\u4f60\u597d",
                voice="default",
            )

    result = asyncio.run(run_case())

    assert result.endpoint_used == "/v1/audio/speech"
    assert result.audio == b"fake-mp3-bytes"
    assert result.media_type == "audio/mpeg"
    request = calls[0]
    assert request["path"].endswith("/v1/audio/speech")
    assert request["body"] == {
        "model": "openclaw",
        "input": "\u4f60\u597d",
        "voice": "default",
        "response_format": "mp3",
        "user": "u1",
    }
    assert request["headers"]["x-openclaw-agent-id"] == "main"
    assert request["headers"]["x-openclaw-message-channel"] == "feishu"
    assert request["headers"]["x-openclaw-session-key"] == "s1"


def test_openclaw_404_returns_gateway_enablement_hint():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=404, text="Not Found")

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="",
                model="openclaw",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            await client.generate_reply(
                user_id="u1",
                session_id="s1",
                message="\u4f60\u597d",
                history=[],
            )

    with pytest.raises(OpenClawInvocationError) as error:
        asyncio.run(run_case())

    message = str(error.value)
    assert "404" in message
    assert "gateway.http.endpoints.responses.enabled" in message


def test_openclaw_diagnose_reports_scope_probe_results():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "path": request.url.path,
                "headers": dict(request.headers),
            }
        )
        if request.method == "GET" and request.url.path.endswith("/v1/models"):
            return httpx.Response(status_code=200, json={"object": "list", "data": []})
        if request.method == "POST" and request.url.path.endswith("/v1/responses"):
            return httpx.Response(
                status_code=200,
                json={"output_text": '{"text":"ok","emotion":"neutral","action":"idle","memory_ops":[]}'},
            )
        return httpx.Response(status_code=404, json={"error": "not found"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawClient(
                base_url="http://openclaw.local",
                token="secret-token",
                model="minimax-portal/MiniMax-M2.7",
                agent_id="main",
                timeout_seconds=15,
                http_client=http_client,
            )
            return await client.diagnose()

    result = asyncio.run(run_case())

    assert result["ok"] is True
    assert result["scope_header_enabled"] is True
    assert result["proxy_configured"] is False
    assert result["probes"]["models"]["ok"] is True
    assert result["probes"]["responses"]["ok"] is True
    assert "chat_completions" not in result["probes"]
    assert result["recommendations"] == []
    assert calls[0]["headers"]["x-openclaw-scopes"] == (
        "operator.admin,operator.read,operator.write,operator.approvals,operator.pairing"
    )
