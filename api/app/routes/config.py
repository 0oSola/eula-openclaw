from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.security import resolve_requester


router = APIRouter(prefix="/config", tags=["config"])


class MappingPayload(BaseModel):
    mappings: dict[str, dict[str, Any]] = Field(default_factory=dict)


@router.get("/mapping/default")
def get_default_mappings(request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    return {"mappings": store.get_default_mappings()}


@router.put("/mapping/default")
def put_default_mappings(
    payload: MappingPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can modify default mappings.")
    store = request.app.state.trace_store
    store.set_default_mappings(payload.mappings)
    return {"mappings": store.get_default_mappings()}


@router.get("/mapping/user/{user_id}")
def get_user_mappings(user_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin and requester.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot read mappings for another user.")
    store = request.app.state.trace_store
    return {"mappings": store.get_user_mappings(user_id)}


@router.put("/mapping/user/{user_id}")
def put_user_mappings(
    user_id: str,
    payload: MappingPayload,
    request: Request,
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin and requester.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot modify mappings for another user.")
    store = request.app.state.trace_store
    store.set_user_mappings(user_id, payload.mappings)
    return {"mappings": store.get_user_mappings(user_id)}


@router.get("/mapping/resolved/{user_id}")
def get_resolved_mappings(user_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin and requester.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot read resolved mappings for another user.")
    store = request.app.state.trace_store
    merged = store.get_default_mappings()
    merged.update(store.get_user_mappings(user_id))
    return {"mappings": merged}

