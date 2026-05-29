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
