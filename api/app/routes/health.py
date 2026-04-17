from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request


router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/healthz/openclaw")
async def openclaw_health(request: Request) -> dict[str, Any]:
    client = request.app.state.openclaw_client
    return await client.diagnose()
