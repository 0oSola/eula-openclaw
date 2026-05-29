from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request, WebSocket
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketDisconnect

from app.services.codex_event_normalizer import normalize_codex_server_event


router = APIRouter(tags=["codex-interactive"])


class CodexSessionCreateRequest(BaseModel):
    local_chat_session_id: str | None = Field(default=None, max_length=200)
    workspace_id: str = Field(min_length=1, max_length=120)
    mode: str = Field(default="read_only", max_length=40)
    sandbox: str | None = Field(default=None, max_length=80)


def _not_found_if_disabled(request: Request | WebSocket) -> None:
    if not request.app.state.settings.codex_interactive_enabled:
        raise HTTPException(status_code=404, detail="Codex interactive is disabled")


def _require_codex_user(request: Request | WebSocket, user_id: str) -> str:
    resolved_user_id = user_id.strip()
    settings = request.app.state.settings
    if not resolved_user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    if resolved_user_id not in settings.admin_user_ids:
        raise HTTPException(status_code=403, detail="Admin permission required")
    if not settings.codex_allowed_users or resolved_user_id not in settings.codex_allowed_users:
        raise HTTPException(status_code=403, detail="Codex interactive user is not allowlisted")
    return resolved_user_id


def _workspace_path(request: Request | WebSocket, workspace_id: str) -> Path:
    settings = request.app.state.settings
    if workspace_id not in settings.codex_allowed_workspaces:
        raise HTTPException(status_code=403, detail="Codex workspace is not allowlisted")
    path = settings.codex_workspace_paths.get(workspace_id)
    if path is None:
        raise HTTPException(status_code=400, detail="Codex workspace path is not configured")
    return path.resolve()


def _event_type(event: dict[str, Any]) -> str:
    return str(event.get("type") or "unknown")


async def _close_unauthorized(websocket: WebSocket) -> None:
    await websocket.close(code=1008)


@router.post("/codex/interactive/sessions")
async def create_codex_interactive_session(
    payload: CodexSessionCreateRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    workspace_path = _workspace_path(request, payload.workspace_id)
    mode = (payload.mode or "read_only").strip()
    if mode not in {"read_only", "review", "test"}:
        raise HTTPException(status_code=400, detail="Phase 1 only supports read-only Codex modes")

    sandbox = (payload.sandbox or request.app.state.settings.codex_default_sandbox).strip() or "read-only"
    if sandbox != "read-only":
        raise HTTPException(status_code=400, detail="Phase 1 only supports read-only sandbox")

    session_id = f"codex_sess_{uuid4().hex}"
    session = request.app.state.trace_store.create_codex_interactive_session(
        session_id=session_id,
        local_chat_session_id=payload.local_chat_session_id,
        workspace_id=payload.workspace_id,
        user_id=user_id,
        workspace_path=str(workspace_path),
        worktree_path=None,
        branch_name=None,
        codex_thread_id=None,
        codex_version=None,
        transport=request.app.state.settings.codex_transport,
        sandbox_mode=sandbox,
        status="ready",
        process_id=None,
        metadata={"mode": mode},
    )
    return {
        "id": session["id"],
        "workspace_id": session["workspace_id"],
        "worktree_path": session.get("worktree_path"),
        "branch_name": session.get("branch_name"),
        "status": session["status"],
        "sandbox": session["sandbox_mode"],
        "ws_url": f"/api/backend/ws/codex/interactive/{session['id']}?user_id={user_id}",
    }


@router.websocket("/ws/codex/interactive/{codex_session_id}")
async def codex_interactive_websocket(websocket: WebSocket, codex_session_id: str):
    try:
        _not_found_if_disabled(websocket)
        user_id = _require_codex_user(websocket, websocket.query_params.get("user_id") or "")
    except HTTPException:
        await _close_unauthorized(websocket)
        return

    store = websocket.app.state.trace_store
    session = store.get_codex_interactive_session(codex_session_id)
    if session is None or session["user_id"] != user_id:
        await _close_unauthorized(websocket)
        return

    await websocket.accept()
    active_task: asyncio.Task | None = None
    active_turn_id: str | None = None

    async def send_and_store(event: dict[str, Any], turn_id: str | None = None) -> None:
        normalized = normalize_codex_server_event(event)
        store.append_codex_event(codex_session_id, turn_id, _event_type(normalized), normalized)
        await websocket.send_json(normalized)

    async def run_turn(turn_id: str, user_message: str) -> None:
        try:
            async for event in websocket.app.state.codex_interactive_provider.stream_read_only_turn(
                turn_id=turn_id,
                user_message=user_message,
            ):
                await send_and_store(event, turn_id)
                if event.get("type") == "turn_completed":
                    store.update_codex_turn(turn_id, status="completed", final_text=str(event.get("final_text") or ""))
                    store.update_codex_interactive_session(codex_session_id, status="ready")
        except asyncio.CancelledError:
            store.update_codex_turn(turn_id, status="cancelled", error="Turn cancelled.")
            store.update_codex_interactive_session(codex_session_id, status="ready")
            await send_and_store({"type": "turn_failed", "turn_id": turn_id, "error": "Turn cancelled."}, turn_id)

    await send_and_store({"type": "session_ready", "session_id": codex_session_id, "thread_id": session.get("codex_thread_id")})

    try:
        while True:
            payload = await websocket.receive_json()
            event_type = str(payload.get("type") or "").strip()
            if event_type == "close_session":
                if active_task and not active_task.done():
                    active_task.cancel()
                    await active_task
                store.update_codex_interactive_session(codex_session_id, status="closed", closed=True)
                await send_and_store({"type": "session_closed", "reason": "client_closed"})
                await websocket.close()
                return

            if event_type == "cancel_turn":
                if active_task and not active_task.done():
                    active_task.cancel()
                    await active_task
                elif active_turn_id:
                    await send_and_store({"type": "turn_failed", "turn_id": active_turn_id, "error": "Turn cancelled."}, active_turn_id)
                continue

            if event_type != "user_message":
                await send_and_store({"type": "turn_failed", "error": "Unsupported Codex websocket event."})
                continue

            if active_task and not active_task.done():
                await send_and_store({"type": "turn_failed", "error": "A Codex turn is already running."})
                continue

            text = str(payload.get("text") or "").strip()
            if not text:
                await send_and_store({"type": "turn_failed", "error": "Codex message text is required."})
                continue
            if len(text) > websocket.app.state.settings.codex_max_prompt_chars:
                await send_and_store({"type": "turn_failed", "error": "Codex message is too long."})
                continue

            turn_id = f"codex_turn_{uuid4().hex}"
            active_turn_id = turn_id
            store.create_codex_turn(
                turn_id=turn_id,
                codex_session_id=codex_session_id,
                codex_turn_id=None,
                user_message=text,
                status="running",
                metadata={"mode": str(payload.get("mode") or "read_only")},
            )
            store.update_codex_interactive_session(codex_session_id, status="running")
            await send_and_store({"type": "turn_started", "turn_id": turn_id}, turn_id)
            active_task = asyncio.create_task(run_turn(turn_id, text))
    except WebSocketDisconnect:
        if active_task and not active_task.done():
            active_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await active_task
