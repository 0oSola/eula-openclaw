from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any


class CodexInteractiveProvider:
    """Phase 1 provider seam for read-only Codex turns.

    The real app-server client will plug in behind this interface. Keeping a
    deterministic provider here lets the API/UI lifecycle ship disabled by
    default without spawning a local Codex process in tests.
    """

    async def stream_turn(self, *, turn_id: str, user_message: str, mode: str = "read_only") -> AsyncIterator[dict[str, Any]]:
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
        yield {
            "type": "command_started",
            "turn_id": turn_id,
            "command": "git status --short",
        }
        await asyncio.sleep(0)
        yield {
            "type": "command_output",
            "turn_id": turn_id,
            "stream": "stdout",
            "text": f"Patch mode requested for: {user_message}",
        }
        await asyncio.sleep(0)
        yield {
            "type": "file_changed",
            "turn_id": turn_id,
            "path": "README.md",
            "change_type": "modified",
        }
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
