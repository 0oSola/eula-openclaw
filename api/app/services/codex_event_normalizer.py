from __future__ import annotations

from typing import Any


def normalize_codex_server_event(event: dict[str, Any]) -> dict[str, Any]:
    event_type = str(event.get("type") or "").strip()
    if not event_type:
        return {"type": "turn_failed", "error": "Codex event missing type."}
    return {"type": event_type, **{key: value for key, value in event.items() if key != "type"}}
