from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class _CodexRuntime:
    client: Any
    thread_id: str
    cwd: Path
    sandbox: str
    codex_version: str | None
    active_turn_ids: dict[str, str]


class DeterministicCodexInteractiveProvider:
    """Deterministic provider used by tests and disabled local environments."""

    async def prepare_session(self, session: dict[str, Any]) -> dict[str, Any]:
        return {"codex_thread_id": None, "codex_version": None, "process_id": None}

    async def stream_turn(
        self,
        *,
        session: dict[str, Any] | None = None,
        turn_id: str,
        user_message: str,
        mode: str = "read_only",
    ) -> AsyncIterator[dict[str, Any]]:
        if mode == "patch":
            async for event in self.stream_patch_turn(turn_id=turn_id, user_message=user_message):
                yield event
            return
        async for event in self.stream_read_only_turn(turn_id=turn_id, user_message=user_message):
            yield event

    async def stream_read_only_turn(self, *, turn_id: str, user_message: str) -> AsyncIterator[dict[str, Any]]:
        await asyncio.sleep(0.05)
        yield {
            "type": "text_delta",
            "turn_id": turn_id,
            "text": f"Codex read-only analysis queued for: {user_message}",
        }
        await asyncio.sleep(0)
        yield {
            "type": "turn_completed",
            "turn_id": turn_id,
            "final_text": "Read-only Codex turn completed.",
        }

    async def stream_patch_turn(self, *, turn_id: str, user_message: str) -> AsyncIterator[dict[str, Any]]:
        await asyncio.sleep(0)
        yield {"type": "command_started", "turn_id": turn_id, "command": "git status --short"}
        await asyncio.sleep(0)
        yield {
            "type": "command_output",
            "turn_id": turn_id,
            "stream": "stdout",
            "text": f"Patch mode requested for: {user_message}",
        }
        await asyncio.sleep(0)
        yield {"type": "file_changed", "turn_id": turn_id, "path": "README.md", "change_type": "modified"}
        await asyncio.sleep(0)
        yield {
            "type": "approval_required",
            "turn_id": turn_id,
            "approval_id": f"approval_{turn_id}",
            "action_type": "command",
            "title": "Approve workspace-write command",
            "detail": {"command": "git status --short", "reason": "Patch mode command requires review."},
        }
        await asyncio.sleep(0)
        yield {
            "type": "turn_completed",
            "turn_id": turn_id,
            "final_text": "Patch-mode Codex turn completed with reviewable events.",
        }

    async def cancel_turn(self, session_id: str, turn_id: str) -> None:
        return None

    async def decide_approval(self, session_id: str, approval_id: str, decision: str) -> None:
        return None

    async def close_session(self, session_id: str) -> None:
        return None


class CodexInteractiveProvider:
    def __init__(self, *, client_factory: Callable[[], Any]):
        self._client_factory = client_factory
        self._runtimes: dict[str, _CodexRuntime] = {}

    async def prepare_session(self, session: dict[str, Any]) -> dict[str, Any]:
        session_id = str(session["id"])
        runtime = self._runtimes.get(session_id)
        if runtime is not None:
            return {
                "codex_thread_id": runtime.thread_id,
                "codex_version": runtime.codex_version,
                "process_id": getattr(getattr(runtime.client, "process", None), "pid", None),
            }

        cwd = self._session_cwd(session)
        sandbox = str(session.get("sandbox_mode") or "read-only")
        client = self._client_factory()
        await client.start()
        initialize_response = await client.initialize()
        thread_response = await client.start_thread(cwd=cwd, sandbox=sandbox, approval_policy="on-request")
        thread = thread_response.get("thread") if isinstance(thread_response.get("thread"), dict) else {}
        thread_id = str(thread.get("id") or getattr(client, "thread_id", "") or "")
        runtime = _CodexRuntime(
            client=client,
            thread_id=thread_id,
            cwd=cwd,
            sandbox=sandbox,
            codex_version=str(initialize_response.get("userAgent") or "") or None,
            active_turn_ids={},
        )
        self._runtimes[session_id] = runtime
        return {
            "codex_thread_id": runtime.thread_id,
            "codex_version": runtime.codex_version,
            "process_id": getattr(getattr(client, "process", None), "pid", None),
        }

    async def stream_turn(
        self,
        *,
        session: dict[str, Any],
        turn_id: str,
        user_message: str,
        mode: str = "read_only",
    ) -> AsyncIterator[dict[str, Any]]:
        runtime = await self._runtime_for_session(session)
        turn_response = await runtime.client.start_turn(
            thread_id=runtime.thread_id,
            user_message=user_message,
            cwd=runtime.cwd,
            sandbox_policy=self._sandbox_policy(runtime.sandbox, runtime.cwd),
        )
        turn = turn_response.get("turn") if isinstance(turn_response.get("turn"), dict) else {}
        codex_turn_id = str(turn.get("id") or "")
        if codex_turn_id:
            runtime.active_turn_ids[turn_id] = codex_turn_id
        completed = False
        try:
            async for event in runtime.client.events_until_turn_complete():
                localized = self._localize_turn_id(event, turn_id, codex_turn_id=codex_turn_id)
                if localized.get("type") == "turn_completed":
                    completed = True
                if localized.get("type") == "session_closed" and not completed:
                    yield {
                        "type": "turn_failed",
                        "turn_id": turn_id,
                        "error": "Codex app-server session closed before the turn completed.",
                    }
                yield localized
        finally:
            runtime.active_turn_ids.pop(turn_id, None)

    async def cancel_turn(self, session_id: str, turn_id: str) -> None:
        runtime = self._runtimes.get(session_id)
        if runtime is None:
            return
        codex_turn_id = runtime.active_turn_ids.get(turn_id, turn_id)
        await runtime.client.interrupt_turn(thread_id=runtime.thread_id, turn_id=codex_turn_id)

    async def decide_approval(self, session_id: str, approval_id: str, decision: str) -> None:
        runtime = self._runtimes.get(session_id)
        if runtime is None:
            return
        await runtime.client.decide_approval(approval_id, decision)

    async def close_session(self, session_id: str) -> None:
        runtime = self._runtimes.pop(session_id, None)
        if runtime is not None:
            await runtime.client.close()

    async def _runtime_for_session(self, session: dict[str, Any]) -> _CodexRuntime:
        session_id = str(session["id"])
        runtime = self._runtimes.get(session_id)
        if runtime is None:
            await self.prepare_session(session)
            runtime = self._runtimes[session_id]
        return runtime

    def _session_cwd(self, session: dict[str, Any]) -> Path:
        if session.get("worktree_path"):
            return Path(str(session["worktree_path"]))
        return Path(str(session["workspace_path"]))

    def _sandbox_policy(self, sandbox: str, cwd: Path) -> dict[str, Any]:
        if sandbox == "read-only":
            return {"type": "readOnly", "networkAccess": False}
        if sandbox == "workspace-write":
            return {
                "type": "workspaceWrite",
                "writableRoots": [str(cwd)],
                "networkAccess": False,
                "excludeTmpdirEnvVar": False,
                "excludeSlashTmp": False,
            }
        raise ValueError("Unsupported Codex sandbox mode")

    def _localize_turn_id(self, event: dict[str, Any], local_turn_id: str, *, codex_turn_id: str = "") -> dict[str, Any]:
        original_turn_id = str(event.get("turn_id") or "")
        localized = {**event, "turn_id": local_turn_id}
        external_turn_id = original_turn_id or codex_turn_id
        if external_turn_id and external_turn_id != local_turn_id:
            localized["codex_turn_id"] = external_turn_id
        return localized
