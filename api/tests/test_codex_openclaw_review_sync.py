from pathlib import Path
import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

from app.db.store import TraceStore
from app.services.codex_openclaw_review_sync import process_next_codex_review_sync


def _store() -> TraceStore:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    return TraceStore(db_path=path / "sqlite" / "trace.db", ndjson_dir=path / "logs")


def _seed_pet_session(store: TraceStore) -> dict:
    return store.upsert_desktop_pet_session(
        pet_session_id="codex:review-session",
        codex_session_id="review-session",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Review sync",
        first_prompt_preview="Implement review sync",
        last_summary="Built the sync service.",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )


class FakeOpenClawReviewClient:
    def __init__(self, text: str):
        self.text = text
        self.calls = []

    async def generate_codex_review(self, **kwargs):
        self.calls.append(kwargs)
        return self.text


def _app(
    store: TraceStore,
    client: FakeOpenClawReviewClient,
    *,
    max_payload_chars: int | None = None,
    dump_debug_files: bool = False,
):
    return SimpleNamespace(
        state=SimpleNamespace(
            trace_store=store,
            openclaw_client=client,
            settings=SimpleNamespace(
                admin_user_ids=["admin-1"],
                codex_openclaw_review_agent_id="codex-manager",
                codex_openclaw_review_channel="codex-pet",
                codex_openclaw_review_max_payload_chars=max_payload_chars,
                codex_openclaw_review_dump_debug_files=dump_debug_files,
                data_dir=Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex,
            ),
        )
    )


def test_process_next_codex_review_sync_saves_openclaw_items_as_draft_reviews():
    store = _store()
    pet = _seed_pet_session(store)
    outbox = store.enqueue_codex_openclaw_sync(
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        payload_hash="hash-1",
        payload={"kind": "codex_review_evidence_pack", "evidence": []},
        openclaw_session_key="codex-review:codex:review-session",
    )
    client = FakeOpenClawReviewClient(
        """
        ```json
        {
          "schema_version": 1,
          "work_summary": {
            "title": "Review sync",
            "summary": "Implemented draft review sync.",
            "goal": "Implement review sync",
            "work_done": ["added outbox"],
            "result": "draft reviews saved",
            "evidence_refs": [],
            "confidence": 0.9
          },
          "pitfalls": [
            {
              "title": "Do not sync raw transcript",
              "symptom": "Raw transcript may contain secrets.",
              "root_cause": "Codex logs include command output.",
              "fix": "Send evidence packs only.",
              "prevention": "Keep full transcript disabled.",
              "severity": "high",
              "tags": ["security"],
              "evidence_refs": [],
              "confidence": 0.8
            }
          ],
          "decisions": [],
          "followups": [],
          "blockers": [],
          "management": {
            "importance": "high",
            "review_status": "draft",
            "needs_human_review": true,
            "suggested_next_action": "review draft",
            "tags": ["codex-review"]
          }
        }
        ```
        """
    )

    processed = asyncio.run(process_next_codex_review_sync(_app(store, client)))

    assert processed is True
    assert client.calls[0]["session_key"] == "codex-review:codex:review-session"
    assert client.calls[0]["agent_id"] == "codex-manager"
    assert client.calls[0]["channel"] == "codex-pet"
    assert store.get_codex_openclaw_sync_outbox(outbox["id"])["status"] == "sent"
    reviews = store.list_codex_review_items(pet_session_id=pet["pet_session_id"])
    assert [(item["item_type"], item["title"], item["status"]) for item in reviews] == [
        ("work_summary", "Review sync", "draft"),
        ("pitfall", "Do not sync raw transcript", "draft"),
    ]
    assert reviews[1]["severity"] == "high"
    assert reviews[1]["tags"] == ["security"]


def test_process_next_codex_review_sync_marks_non_json_response_failed():
    store = _store()
    pet = _seed_pet_session(store)
    outbox = store.enqueue_codex_openclaw_sync(
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        payload_hash="hash-1",
        payload={"kind": "codex_review_evidence_pack", "evidence": []},
        openclaw_session_key="codex-review:codex:review-session",
    )
    client = FakeOpenClawReviewClient("not json")

    processed = asyncio.run(process_next_codex_review_sync(_app(store, client)))

    assert processed is False
    failed = store.get_codex_openclaw_sync_outbox(outbox["id"])
    assert failed["status"] == "failed"
    assert "JSON" in failed["last_error"]
    assert store.list_codex_review_items(pet_session_id=pet["pet_session_id"]) == []


def test_process_next_codex_review_sync_accepts_scalar_work_summary_response():
    store = _store()
    pet = _seed_pet_session(store)
    outbox = store.enqueue_codex_openclaw_sync(
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        payload_hash="hash-1",
        payload={"kind": "codex_review_evidence_pack", "evidence": []},
        openclaw_session_key="codex-review:codex:review-session",
    )
    client = FakeOpenClawReviewClient(
        """
        {
          "schema_version": 1,
          "work_summary": "Implemented draft review sync with OpenClaw.",
          "pitfalls": [],
          "decisions": [],
          "followups": [],
          "blockers": [],
          "management": null
        }
        """
    )

    processed = asyncio.run(process_next_codex_review_sync(_app(store, client)))

    assert processed is True
    assert store.get_codex_openclaw_sync_outbox(outbox["id"])["status"] == "sent"
    reviews = store.list_codex_review_items(pet_session_id=pet["pet_session_id"])
    assert [(item["item_type"], item["title"], item["summary"], item["status"]) for item in reviews] == [
        ("work_summary", "Work Summary", "Implemented draft review sync with OpenClaw.", "draft"),
    ]


def test_process_next_codex_review_sync_truncates_large_openclaw_payload():
    store = _store()
    pet = _seed_pet_session(store)
    store.enqueue_codex_openclaw_sync(
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        payload_hash="hash-1",
        payload={
            "kind": "codex_review_evidence_pack",
            "schema_version": 1,
            "session": {
                "pet_session_id": pet["pet_session_id"],
                "codex_session_id": pet["codex_session_id"],
                "status": "completed",
                "first_goal": "Implement review sync",
            },
            "facts": {
                "changed_files": [f"file_{index}.py" for index in range(80)],
                "failed_commands": [{"command": "pytest", "exit_code": 1, "excerpt": "x" * 1000}],
                "errors": [{"type": "turn_failed", "excerpt": "y" * 1000}],
            },
            "evidence": [{"id": f"ev_{index}", "excerpt": "z" * 1000} for index in range(20)],
        },
        openclaw_session_key="codex-review:codex:review-session",
    )
    client = FakeOpenClawReviewClient(
        """
        {
          "schema_version": 1,
          "work_summary": {"title": "Review sync", "summary": "ok"},
          "pitfalls": [],
          "decisions": [],
          "followups": [],
          "blockers": [],
          "management": {}
        }
        """
    )

    processed = asyncio.run(process_next_codex_review_sync(_app(store, client, max_payload_chars=1200)))

    assert processed is True
    sent_pack = client.calls[0]["evidence_pack"]
    assert sent_pack["transport"]["truncated_for_openclaw"] is True
    assert len(json.dumps(sent_pack, ensure_ascii=False).encode("utf-8")) <= 1200
