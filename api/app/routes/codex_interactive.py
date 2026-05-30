from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path
import subprocess
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Header, HTTPException, Request, WebSocket
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketDisconnect

from app.services.codex_event_normalizer import normalize_codex_server_event
from app.services.codex_worktree_manager import CodexWorktreeError


router = APIRouter(tags=["codex-interactive"])


class CodexSessionCreateRequest(BaseModel):
    local_chat_session_id: str | None = Field(default=None, max_length=200)
    workspace_id: str = Field(min_length=1, max_length=120)
    mode: str = Field(default="read_only", max_length=40)
    sandbox: str | None = Field(default=None, max_length=80)


class CodexApprovalDecisionRequest(BaseModel):
    decision: str = Field(max_length=40)


class CodexChecksRequest(BaseModel):
    checks: list[str] = Field(default_factory=lambda: ["api", "web_basic"])


class CodexApplyRequest(BaseModel):
    strategy: str = Field(default="patch_to_main_workspace", max_length=80)
    confirm: bool = False


class CodexDiscardRequest(BaseModel):
    remove_worktree: bool = True


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


def _require_session(request: Request, session_id: str, user_id: str) -> dict[str, Any]:
    session = request.app.state.trace_store.get_codex_interactive_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Codex session not found")
    if session["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Codex session belongs to another user")
    return session


def _pending_approvals(request: Request, session_id: str) -> list[dict[str, Any]]:
    return request.app.state.trace_store.list_pending_codex_approvals(session_id)


def _block_pending_approvals(request: Request, session_id: str) -> None:
    if _pending_approvals(request, session_id):
        raise HTTPException(status_code=409, detail="Codex session has unresolved approvals")


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
    if mode not in {"read_only", "review", "test", "patch"}:
        raise HTTPException(status_code=400, detail="Unsupported Codex mode")

    if mode == "patch":
        sandbox = (payload.sandbox or request.app.state.settings.codex_patch_sandbox).strip() or "workspace-write"
        if sandbox != "workspace-write":
            raise HTTPException(status_code=400, detail="Patch mode requires workspace-write sandbox")
    else:
        sandbox = (payload.sandbox or request.app.state.settings.codex_default_sandbox).strip() or "read-only"
        if sandbox != "read-only":
            raise HTTPException(status_code=400, detail="Read-only Codex modes require read-only sandbox")

    session_id = f"codex_sess_{uuid4().hex}"
    worktree_path: str | None = None
    branch_name: str | None = None
    if mode == "patch":
        if not request.app.state.settings.codex_use_worktree:
            raise HTTPException(status_code=400, detail="Patch mode requires Codex worktrees")
        try:
            created = request.app.state.codex_worktree_manager.create_worktree(workspace_path, session_id)
        except CodexWorktreeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        worktree_path = str(created.worktree_path)
        branch_name = created.branch_name

    session = request.app.state.trace_store.create_codex_interactive_session(
        session_id=session_id,
        local_chat_session_id=payload.local_chat_session_id,
        workspace_id=payload.workspace_id,
        user_id=user_id,
        workspace_path=str(workspace_path),
        worktree_path=worktree_path,
        branch_name=branch_name,
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


@router.get("/codex/interactive/{codex_session_id}/diff")
async def get_codex_interactive_diff(
    codex_session_id: str,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    session = _require_session(request, codex_session_id, user_id)
    if not session.get("worktree_path"):
        raise HTTPException(status_code=400, detail="Codex session has no worktree diff")

    try:
        diff = request.app.state.codex_worktree_manager.diff(Path(session["worktree_path"]))
    except CodexWorktreeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    artifact_id = f"codex_artifact_{uuid4().hex}"
    artifact = request.app.state.trace_store.create_codex_artifact(
        artifact_id=artifact_id,
        codex_session_id=codex_session_id,
        turn_id=None,
        kind="diff",
        path=None,
        content_ref=None,
        summary=diff.stat,
        metadata={"changed_files": diff.changed_files},
    )
    event = {
        "type": "diff_ready",
        "artifact_id": artifact["id"],
        "changed_files": diff.changed_files,
    }
    request.app.state.trace_store.append_codex_event(codex_session_id, None, "diff_ready", event)
    return {
        "session_id": codex_session_id,
        "base_workspace": session["workspace_path"],
        "worktree_path": session["worktree_path"],
        "changed_files": diff.changed_files,
        "stat": diff.stat,
        "patch": diff.patch,
        "artifact_id": artifact["id"],
    }


@router.post("/codex/interactive/{codex_session_id}/approvals/{approval_id}")
async def decide_codex_interactive_approval(
    codex_session_id: str,
    approval_id: str,
    payload: CodexApprovalDecisionRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    _require_session(request, codex_session_id, user_id)
    decision = payload.decision.strip()
    if decision not in {"approve_once", "deny"}:
        raise HTTPException(status_code=400, detail="Unsupported Codex approval decision")
    approval = request.app.state.trace_store.get_codex_approval(approval_id)
    if approval is None or approval["codex_session_id"] != codex_session_id:
        raise HTTPException(status_code=404, detail="Codex approval not found")

    decided = request.app.state.trace_store.decide_codex_approval(
        approval_id,
        decision=decision,
        decided_by=user_id,
    )
    event = {
        "type": "approval_decided",
        "approval_id": approval_id,
        "decision": decision,
        "decided_by": user_id,
    }
    request.app.state.trace_store.append_codex_event(codex_session_id, approval.get("turn_id"), "approval_decided", event)
    return decided  # type: ignore[return-value]


@router.post("/codex/interactive/{codex_session_id}/checks")
async def run_codex_interactive_checks(
    codex_session_id: str,
    payload: CodexChecksRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    session = _require_session(request, codex_session_id, user_id)
    _block_pending_approvals(request, codex_session_id)
    worktree_path = Path(session.get("worktree_path") or session["workspace_path"])
    requested_checks = payload.checks or ["api", "web_basic"]
    commands_by_check: dict[str, list[list[str]]] = getattr(request.app.state, "codex_check_commands", {})

    request.app.state.trace_store.append_codex_event(
        codex_session_id,
        None,
        "checks_started",
        {"type": "checks_started", "checks": requested_checks},
    )
    results: list[dict[str, Any]] = []
    for check_name in requested_checks:
        commands = commands_by_check.get(check_name)
        if not commands:
            raise HTTPException(status_code=400, detail=f"Unknown Codex check: {check_name}")
        for command in commands:
            completed = subprocess.run(
                command,
                cwd=worktree_path,
                capture_output=True,
                text=True,
            )
            results.append(
                {
                    "check": check_name,
                    "command": command,
                    "exit_code": completed.returncode,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                }
            )

    artifact = request.app.state.trace_store.create_codex_artifact(
        artifact_id=f"codex_artifact_{uuid4().hex}",
        codex_session_id=codex_session_id,
        turn_id=None,
        kind="checks",
        path=None,
        content_ref=None,
        summary=f"{len(results)} command(s) completed",
        metadata={"results": results},
    )
    event = {"type": "checks_completed", "artifact_id": artifact["id"], "results": results}
    request.app.state.trace_store.append_codex_event(codex_session_id, None, "checks_completed", event)
    return {"session_id": codex_session_id, "artifact_id": artifact["id"], "results": results}


@router.post("/codex/interactive/{codex_session_id}/apply")
async def apply_codex_interactive_session(
    codex_session_id: str,
    payload: CodexApplyRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    session = _require_session(request, codex_session_id, user_id)
    _block_pending_approvals(request, codex_session_id)
    if payload.strategy != "patch_to_main_workspace":
        raise HTTPException(status_code=400, detail="Unsupported Codex apply strategy")
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Codex apply requires explicit confirmation")
    if not session.get("worktree_path"):
        raise HTTPException(status_code=400, detail="Codex session has no worktree to apply")

    request.app.state.trace_store.append_codex_event(
        codex_session_id,
        None,
        "apply_started",
        {"type": "apply_started", "strategy": payload.strategy},
    )
    try:
        applied = request.app.state.codex_worktree_manager.apply_patch_to_workspace(
            Path(session["worktree_path"]),
            Path(session["workspace_path"]),
            confirm=True,
        )
    except CodexWorktreeError as exc:
        request.app.state.trace_store.append_codex_event(
            codex_session_id,
            None,
            "apply_failed",
            {"type": "apply_failed", "error": str(exc)},
        )
        status_code = 409 if "uncommitted changes" in str(exc) or "patch" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    artifact = request.app.state.trace_store.create_codex_artifact(
        artifact_id=f"codex_artifact_{uuid4().hex}",
        codex_session_id=codex_session_id,
        turn_id=None,
        kind="apply",
        path=None,
        content_ref=None,
        summary=f"Applied {len(applied.changed_files)} file(s)",
        metadata={"changed_files": applied.changed_files},
    )
    event = {
        "type": "apply_completed",
        "artifact_id": artifact["id"],
        "changed_files": applied.changed_files,
    }
    request.app.state.trace_store.append_codex_event(codex_session_id, None, "apply_completed", event)
    return {"session_id": codex_session_id, "artifact_id": artifact["id"], "applied": True, "changed_files": applied.changed_files}


@router.post("/codex/interactive/{codex_session_id}/discard")
async def discard_codex_interactive_session(
    codex_session_id: str,
    payload: CodexDiscardRequest,
    request: Request,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    _not_found_if_disabled(request)
    user_id = _require_codex_user(request, x_user_id or "")
    session = _require_session(request, codex_session_id, user_id)
    if payload.remove_worktree and session.get("worktree_path"):
        try:
            request.app.state.codex_worktree_manager.discard_worktree(
                Path(session["workspace_path"]),
                Path(session["worktree_path"]),
            )
        except CodexWorktreeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    closed = request.app.state.trace_store.update_codex_interactive_session(codex_session_id, status="closed", closed=True)
    request.app.state.trace_store.append_codex_event(
        codex_session_id,
        None,
        "session_closed",
        {"type": "session_closed", "reason": "discarded"},
    )
    return {"session_id": codex_session_id, "status": closed["status"] if closed else "closed"}


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
        if normalized.get("type") == "approval_required" and normalized.get("approval_id"):
            approval_id = str(normalized["approval_id"])
            if store.get_codex_approval(approval_id) is None:
                store.create_codex_approval(
                    approval_id=approval_id,
                    codex_session_id=codex_session_id,
                    turn_id=turn_id or normalized.get("turn_id"),
                    external_approval_id=None,
                    action_type=str(normalized.get("action_type") or "unknown"),
                    title=str(normalized.get("title") or "Approval required"),
                    detail=normalized.get("detail") if isinstance(normalized.get("detail"), dict) else {},
                )
            store.update_codex_interactive_session(codex_session_id, status="waiting_approval")
        store.append_codex_event(codex_session_id, turn_id, _event_type(normalized), normalized)
        await websocket.send_json(normalized)

    async def run_turn(turn_id: str, user_message: str, mode: str) -> None:
        try:
            async for event in websocket.app.state.codex_interactive_provider.stream_turn(
                turn_id=turn_id,
                user_message=user_message,
                mode=mode,
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
            mode = str(payload.get("mode") or session.get("metadata", {}).get("mode") or "read_only")
            store.create_codex_turn(
                turn_id=turn_id,
                codex_session_id=codex_session_id,
                codex_turn_id=None,
                user_message=text,
                status="running",
                metadata={"mode": mode},
            )
            store.update_codex_interactive_session(codex_session_id, status="running")
            await send_and_store({"type": "turn_started", "turn_id": turn_id, "mode": mode}, turn_id)
            active_task = asyncio.create_task(run_turn(turn_id, text, mode))
    except WebSocketDisconnect:
        if active_task and not active_task.done():
            active_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await active_task
