import asyncio
import json

import httpx

from app.services.openkb_client import OpenKbClient


def test_openkb_client_upsert_document_posts_markdown_payload():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "path": request.url.path,
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(status_code=200, json={"document_id": "doc-1", "status": "synced"})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenKbClient(
                base_url="http://openkb.local",
                token="test-token",
                http_client=http_client,
            )
            return await client.upsert_document(
                document_id="memory-1",
                title="Memory",
                markdown="# Memory",
                metadata={"workspace_id": "mmd-companion"},
            )

    result = asyncio.run(run_case())

    assert result.document_id == "doc-1"
    assert result.status == "synced"
    assert calls[0]["path"] == "/documents/memory-1"
    assert calls[0]["headers"]["authorization"] == "Bearer test-token"
    assert calls[0]["body"] == {
        "title": "Memory",
        "markdown": "# Memory",
        "metadata": {"workspace_id": "mmd-companion"},
    }
