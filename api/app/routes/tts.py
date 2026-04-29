from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse, Response

from app.security import resolve_requester
from app.services.openclaw_client import OpenClawInvocationError


router = APIRouter(prefix="/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str = Field(default="default", max_length=120)
    session_id: str | None = Field(default=None, max_length=120)


@router.post("/speak")
async def tts_speak(payload: TTSRequest, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not settings.tts_service_enabled:
        return JSONResponse(
            status_code=501,
            content={
                "configured": False,
                "message": "Server-side TTS is not configured. Use browser TTS or enable TTS_SERVICE_ENABLED.",
            },
        )

    try:
        speech = await request.app.state.openclaw_client.generate_speech(
            user_id=requester.user_id,
            session_id=payload.session_id,
            text=payload.text,
            voice=payload.voice,
        )
    except OpenClawInvocationError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    return Response(
        content=speech.audio,
        media_type=speech.media_type,
        headers={
            "x-openclaw-endpoint": speech.endpoint_used,
            "x-openclaw-status": str(speech.status_code),
        },
    )
