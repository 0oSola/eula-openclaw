from __future__ import annotations

import asyncio
import json

import httpx

from app.services.openclaw_control_plane import OpenClawReviewControlPlaneClient


def test_author_knowledge_delivery_client_uses_strict_openclaw_forward_route():
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(
            {
                "method": request.method,
                "url": str(request.url),
                "authorization": request.headers.get("authorization"),
                "body": json.loads(request.content.decode("utf-8")),
            }
        )
        return httpx.Response(status_code=200, json={"status": "delivery_batch_received", "items": []})

    async def run_case():
        transport = httpx.MockTransport(handler)
        async with httpx.AsyncClient(transport=transport) as http_client:
            client = OpenClawReviewControlPlaneClient(
                base_url="http://openclaw.local:8765",
                token="service-token",
                http_client=http_client,
            )
            return await client.post_codex_author_knowledge_deliveries(
                workspace_key="mmd-project",
                batch={
                    "kind": "codex_author_knowledge_delivery_batch",
                    "schema_version": 1,
                    "items": [],
                },
            )

    result = asyncio.run(run_case())

    assert result["status"] == "delivery_batch_received"
    assert calls == [
        {
            "method": "POST",
            "url": "http://openclaw.local:8765/v1/apps/mmd/codex-author-knowledge/workspaces/mmd-project/deliveries",
            "authorization": "Bearer service-token",
            "body": {
                "kind": "codex_author_knowledge_delivery_batch",
                "schema_version": 1,
                "items": [],
            },
        }
    ]
