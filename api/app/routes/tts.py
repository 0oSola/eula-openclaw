from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse

from app.security import resolve_requester


router = APIRouter(prefix="/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str = Field(default="default", max_length=120)


@router.post("/speak")
def tts_speak(payload: TTSRequest, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    if not settings.tts_service_enabled:
        return JSONResponse(
            status_code=501,
            content={
                "configured": False,
                "message": "Server-side TTS is not configured. Use browser TTS or enable TTS_SERVICE_ENABLED.",
            },
        )

    # Placeholder for pluggable TTS provider. Keep response explicit for frontend fallback.
    return {
        "configured": True,
        "accepted": True,
        "mode": "server",
        "voice": payload.voice,
        "message": "TTS request accepted by server mode.",
    }

