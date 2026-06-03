from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.security import resolve_requester


router = APIRouter(prefix="/desktop-pet", tags=["desktop-pet"])


class CompanionSharedConfigPayload(BaseModel):
    selected_model_path: str | None = Field(default=None, max_length=1000)
    render_pipeline: Literal["classic", "hero-shot", "genshin", "mio-reference", "reze-npr"] = "classic"


@router.get("/shared-config")
def get_shared_config(request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    return request.app.state.trace_store.get_companion_shared_config(requester.user_id)


@router.put("/shared-config")
def put_shared_config(
    payload: CompanionSharedConfigPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    try:
        return request.app.state.trace_store.upsert_companion_shared_config(
            user_id=requester.user_id,
            selected_model_path=payload.selected_model_path,
            render_pipeline=payload.render_pipeline,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
