from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app


def _case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _client() -> TestClient:
    return TestClient(
        create_app(
            {
                "data_dir": str(_case_dir()),
                "admin_user_ids": ["admin-1"],
                "codex_openclaw_review_enabled": True,
                "openclaw_token": "test-token",
            }
        )
    )


def _seed_review_item(client: TestClient) -> dict:
    pet = client.app.state.trace_store.upsert_desktop_pet_session(
        pet_session_id="codex:wiki-session",
        codex_session_id="wiki-session",
        workspace_id="mmd-companion",
        workspace_path="D:/workspace/MMD project",
        codex_home=None,
        display_title="Wiki session",
        first_prompt_preview="Publish accepted memory to OpenClaw wiki",
        last_summary="Review output must be strict JSON.",
        last_status="completed",
        launch_mode="workspace-write",
        remote_url=None,
        app_server_pid=None,
        app_server_port=None,
        metadata={},
    )
    return client.app.state.trace_store.create_codex_review_item(
        item_id="review-wiki-item",
        pet_session_id=pet["pet_session_id"],
        codex_session_id=pet["codex_session_id"],
        item_type="pitfall",
        title="OpenClaw JSON contract",
        summary="Review output must stay valid JSON before FastAPI stores drafts.",
        details={
            "evidence_refs": ["event_turn_failed_1"],
            "evidence": [
                {
                    "id": "event_turn_failed_1",
                    "source": "codex_events",
                    "type": "turn_failed",
                    "excerpt": "OPENCLAW_TOKEN=super-secret caused invalid JSON output.",
                }
            ],
        },
        tags=["codex", "review"],
        severity="high",
        status="draft",
        source="openclaw",
        source_hash="wiki-source-hash",
    )


def test_accept_decision_allows_openclaw_wiki_target():
    client = _client()
    item = _seed_review_item(client)

    response = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={"action": "accept", "target": "openclaw_wiki"},
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["item"]["details"]["decision_target"] == "openclaw_wiki"
    assert payload["memory"]["title"] == "OpenClaw JSON contract"


def test_wiki_payload_returns_bounded_obsidian_contract_for_confirmed_memory():
    client = _client()
    item = _seed_review_item(client)
    decision = client.post(
        f"/codex/reviews/items/{item['id']}/decision",
        json={"action": "accept", "target": "openclaw_wiki"},
        headers={"x-user-id": "admin-1"},
    ).json()
    memory_id = decision["memory"]["id"]

    response = client.get(
        f"/codex/reviews/memory/{memory_id}/wiki-payload",
        headers={"x-user-id": "admin-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["kind"] == "codex_review_memory_wiki_payload"
    assert payload["schema_version"] == 1
    assert payload["memory"]["id"] == memory_id
    assert payload["memory"]["title"] == "OpenClaw JSON contract"
    assert payload["wiki"]["path"].startswith("sources/codex-review/mmd-companion/")
    assert payload["wiki"]["path"].endswith(f"/{memory_id}.md")
    assert payload["wiki"]["frontmatter"]["source_review_item_id"] == "review-wiki-item"
    assert payload["wiki"]["frontmatter"]["status"] == "accepted"
    assert "# OpenClaw JSON contract" in payload["wiki"]["markdown"]
    assert "## Problem" in payload["wiki"]["markdown"]
    assert "## Steps" in payload["wiki"]["markdown"]
    assert "super-secret" not in payload["wiki"]["markdown"]
    assert "[redacted]" in payload["wiki"]["markdown"]
    assert payload["memory"]["details"]["knowledge_kind"] == "pitfall"
    assert payload["evidence"] == [
        {
            "id": "event_turn_failed_1",
            "source": "codex_events",
            "type": "turn_failed",
            "excerpt": "OPENCLAW_TOKEN=[redacted] caused invalid JSON output.",
        }
    ]


def test_wiki_payload_requires_admin():
    client = _client()
    item = _seed_review_item(client)
    memory = client.app.state.trace_store.create_codex_review_memory_from_item(
        review_item_id=item["id"],
        title=item["title"],
        body=item["summary"],
        confirmed_by="admin-1",
    )

    response = client.get(f"/codex/reviews/memory/{memory['id']}/wiki-payload")

    assert response.status_code == 401


def test_review_memory_default_target_is_openclaw_wiki():
    client = _client()

    assert client.app.state.settings.codex_review_memory_target == "openclaw_wiki"
