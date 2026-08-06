from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace

from app.services.codex_author_knowledge_handoff_store import (
    CodexAuthorKnowledgeHandoffStore,
)
from app.services.codex_author_knowledge_openclaw_delivery import (
    push_next_codex_author_knowledge_delivery,
)


class FakeControlPlane:
    def __init__(self):
        self.batches: list[dict] = []

    async def post_codex_author_knowledge_deliveries(self, *, workspace_key: str, batch: dict):
        self.batches.append({"workspace_key": workspace_key, "batch": batch})
        delivery = batch["items"][0]
        return {
            "status": "delivery_batch_received",
            "items": [
                {
                    "delivery_id": delivery["delivery_id"],
                    "status": "accepted",
                    "ack_id": "openclaw-ack-1",
                }
            ],
        }


def test_pending_delivery_is_pushed_as_bounded_openclaw_envelope():
    root = Path(tempfile.mkdtemp(prefix="kh04-delivery-"))
    try:
        store = CodexAuthorKnowledgeHandoffStore(root / "knowledge.db")
        store.create_delivery(
            candidate_id="candidate-1",
            candidate_revision=1,
            evidence_revision=1,
            payload={
                "kind": "codex_knowledge_candidate_review",
                "schema_version": 1,
                "workspace_key": "mmd-project",
                "candidate_id": "candidate-1",
                "candidate_revision": 1,
                "evidence_revision": 1,
                "candidate": {"title": "Pet 输入路由", "content": "# bounded"},
            },
        )
        control_plane = FakeControlPlane()
        app = SimpleNamespace(
            state=SimpleNamespace(
                knowledge_handoff_store=store,
                openclaw_control_plane_client=control_plane,
            )
        )

        result = asyncio.run(push_next_codex_author_knowledge_delivery(app))

        assert result["status"] == "accepted"
        assert control_plane.batches[0]["workspace_key"] == "mmd-project"
        envelope = control_plane.batches[0]["batch"]["items"][0]
        assert envelope["kind"] == "codex_author_knowledge_delivery"
        assert envelope["candidate_payload"]["candidate_id"] == "candidate-1"
        assert store.list_deliveries(limit=10)[0]["status"] == "delivered"
        store.close()
    finally:
        shutil.rmtree(root, ignore_errors=True)
