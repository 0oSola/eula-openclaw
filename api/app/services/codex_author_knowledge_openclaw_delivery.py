from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from app.services.codex_author_knowledge_handoff_store import (
    CodexAuthorKnowledgeHandoffStore,
)


def _delivery_envelope(delivery: dict[str, Any]) -> dict[str, Any]:
    payload = delivery.get("payload") if isinstance(delivery.get("payload"), dict) else {}
    return {
        "kind": "codex_author_knowledge_delivery",
        "schema_version": 1,
        "delivery_id": delivery["delivery_id"],
        "workspace_key": payload.get("workspace_key"),
        "candidate_payload": payload,
        "payload_sha256": delivery.get("payload_hash"),
        "idempotency_key": f"codex-author-knowledge:{delivery['delivery_id']}",
    }


async def push_next_codex_author_knowledge_delivery(app: Any) -> dict[str, Any]:
    store: CodexAuthorKnowledgeHandoffStore = app.state.knowledge_handoff_store
    delivery = store.claim_next_delivery(now=datetime.now(UTC))
    if delivery is None:
        return {"status": "no_pending_deliveries", "submitted": 0}
    envelope = _delivery_envelope(delivery)
    batch = {
        "kind": "codex_author_knowledge_delivery_batch",
        "schema_version": 1,
        "workspace_key": envelope["workspace_key"],
        "items": [envelope],
        "idempotency_key": envelope["idempotency_key"],
    }
    try:
        response = await app.state.openclaw_control_plane_client.post_codex_author_knowledge_deliveries(
            workspace_key=str(envelope["workspace_key"] or ""),
            batch=batch,
        )
        items = response.get("items") if isinstance(response, dict) else None
        ack = next(
            (
                item
                for item in items or []
                if isinstance(item, dict) and item.get("delivery_id") == delivery["delivery_id"]
            ),
            None,
        )
        if str((ack or {}).get("status") or "") not in {"accepted", "duplicate"}:
            raise ValueError(str((ack or {}).get("error") or "OpenClaw did not accept delivery"))
        acknowledged = store.acknowledge_delivery(
            delivery_id=delivery["delivery_id"],
            outcome=str((ack or {}).get("status") or "accepted"),
            ack_id=str((ack or {}).get("ack_id") or "") or None,
        )
        return {
            "status": "accepted",
            "submitted": 1,
            "delivery_id": delivery["delivery_id"],
            "response": response,
            "acknowledged": acknowledged,
        }
    except Exception as error:
        store.release_delivery(delivery_id=delivery["delivery_id"], error=str(error))
        raise


async def run_codex_author_knowledge_openclaw_delivery_worker(app: Any) -> None:
    settings = app.state.settings
    interval = max(1.0, float(settings.codex_author_knowledge_reconciliation_interval_seconds))
    while True:
        try:
            await push_next_codex_author_knowledge_delivery(app)
        except Exception:
            pass
        await asyncio.sleep(interval)
