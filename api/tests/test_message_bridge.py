from __future__ import annotations

import asyncio
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.db.store import TraceStore
from app.services.message_bridge import ExternalMessage, ExternalSession, MessageBridgeService, OpenClawGatewayProvider


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store() -> TraceStore:
    case_dir = _make_case_dir()
    return TraceStore(db_path=case_dir / "sqlite" / "trace.db", ndjson_dir=case_dir / "logs")


def _client_with_bridge() -> tuple[TestClient, object, FakeBridgeProvider]:
    provider = FakeBridgeProvider()
    app = create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": ["admin-1"]})
    app.state.message_bridge_service = MessageBridgeService(store=app.state.trace_store, provider=provider)
    client = TestClient(app)
    client.__enter__()
    return client, app, provider


def test_bridge_state_defaults_to_enabled_openclaw_feishu():
    store = _store()
    try:
        state = store.get_message_bridge_state("openclaw", "feishu")

        assert state["provider"] == "openclaw"
        assert state["channel"] == "feishu"
        assert state["enabled"] is True
        assert state["realtime_drive_character"] is True
        assert state["websocket_status"] == "disconnected"
        assert state["reconnect_attempts"] == 0
        assert state["last_error"] is None
    finally:
        store.close()


def test_bridge_default_binding_is_scoped_to_owner_workspace():
    store = _store()
    try:
        ctx = store.get_current_workspace_context("admin-1")
        session = store.create_session(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            title="用户746923",
        )

        binding = store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=session["id"],
            provider="openclaw",
            channel="feishu",
            external_session_key="agent:main:feishu:direct:ou_abc",
            external_display_name="用户746923",
            is_default=True,
            status="active",
        )

        fetched = store.get_default_message_bridge_binding(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            provider="openclaw",
            channel="feishu",
        )
        other = store.get_current_workspace_context("other-user")
        denied = store.get_default_message_bridge_binding(
            other["workspace"]["id"],
            other["account"]["id"],
            provider="openclaw",
            channel="feishu",
        )

        assert binding["external_session_key"] == "agent:main:feishu:direct:ou_abc"
        assert fetched["id"] == binding["id"]
        assert fetched["is_default"] is True
        assert denied is None
    finally:
        store.close()


def test_bridge_external_message_id_is_deduped_and_persisted():
    store = _store()
    try:
        ctx = store.get_current_workspace_context("admin-1")
        session = store.create_session(ctx["workspace"]["id"], ctx["account"]["id"])

        first = store.insert_message(
            ctx["workspace"]["id"],
            session["id"],
            ctx["account"]["id"],
            role="assistant",
            content="同步消息",
            openclaw_message_id="openclaw-msg-1",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": "agent:main:feishu:direct:ou_abc",
            },
        )
        duplicate = store.insert_message_if_external_missing(
            ctx["workspace"]["id"],
            session["id"],
            ctx["account"]["id"],
            role="assistant",
            content="同步消息",
            openclaw_message_id="openclaw-msg-1",
            metadata={
                "source": "message_bridge",
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": "agent:main:feishu:direct:ou_abc",
            },
        )

        messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], session["id"])

        assert first["openclaw_message_id"] == "openclaw-msg-1"
        assert duplicate["id"] == first["id"]
        assert len(messages) == 1
        assert messages[0]["metadata"]["source"] == "message_bridge"
    finally:
        store.close()


class FakeBridgeProvider:
    provider = "openclaw"
    channel = "feishu"

    def __init__(self):
        self.sessions = [
            ExternalSession(
                key="agent:main:feishu:direct:old",
                display_name="旧会话",
                provider="feishu",
                channel="feishu",
                updated_at=100,
                raw={},
            ),
            ExternalSession(
                key="agent:main:feishu:direct:new",
                display_name="最新会话",
                provider="feishu",
                channel="feishu",
                updated_at=200,
                raw={},
            ),
        ]
        self.history = {
            "agent:main:feishu:direct:new": [
                ExternalMessage(
                    id="tool-1",
                    role="toolResult",
                    content="internal",
                    timestamp=201,
                    raw={"role": "toolResult"},
                ),
                ExternalMessage(
                    id="user-1",
                    role="user",
                    content="你好",
                    timestamp=202,
                    raw={"role": "user"},
                ),
                ExternalMessage(
                    id="assistant-1",
                    role="assistant",
                    content='{"text":"你好呀","emotion":"happy","action":"wave","motion_plan":{"sequence":[]}}',
                    timestamp=203,
                    raw={"role": "assistant"},
                ),
            ]
        }
        self.subscribed = []
        self.unsubscribed = []
        self.events = asyncio.Queue()

    async def connect(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def list_external_sessions(self):
        return self.sessions

    async def fetch_history(self, session_key: str, limit: int):
        return self.history.get(session_key, [])[-limit:]

    async def subscribe(self, session_key: str) -> None:
        self.subscribed.append(session_key)
        return None

    async def unsubscribe(self, session_key: str) -> None:
        self.unsubscribed.append(session_key)
        return None

    async def receive_event(self):
        return await self.events.get()


def test_bridge_binds_latest_feishu_session_and_syncs_history():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)

        binding = service.sync_default_binding_for_user("admin-1")

        assert binding["external_session_key"] == "agent:main:feishu:direct:new"
        assert binding["external_display_name"] == "最新会话"

        ctx = store.get_current_workspace_context("admin-1")
        messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])

        assert [message["role"] for message in messages] == ["user", "assistant"]
        assert messages[0]["content"] == "你好"
        assert messages[1]["content"] == "你好呀"
        assert messages[1]["emotion"] == "happy"
        assert messages[1]["action"] == "wave"
        assert messages[1]["metadata"]["source"] == "message_bridge"
        assert messages[1]["metadata"]["synced_from"] == "history"
        assert messages[1]["motion_resolution"]["status"] == "fallback_idle"

        events = store.query_events(trace_id=None, requester_user_id="admin-1", is_admin=False)
        stages = {event["stage"] for event in events}
        assert "message_bridge.openclaw.sessions.list" in stages
        assert "message_bridge.openclaw.session.bind" in stages
        assert "message_bridge.openclaw.history.load" in stages
        assert "message_bridge.openclaw.subscribe" in stages
        assert "message_bridge.openclaw.message.received" in stages
    finally:
        store.close()


def test_bridge_realtime_message_uses_idle_defaults_when_no_motion_fields():
    store = _store()
    try:
        provider = FakeBridgeProvider()
        service = MessageBridgeService(store=store, provider=provider)
        binding = service.sync_default_binding_for_user("admin-1")

        message = service.ingest_external_message(
            binding,
            ExternalMessage(
                id="assistant-plain",
                role="assistant",
                content="普通回复",
                timestamp=300,
                raw={"role": "assistant"},
            ),
            source="realtime",
        )

        assert message["content"] == "普通回复"
        assert message["emotion"] == "neutral"
        assert message["action"] == "idle"
        assert message["metadata"]["synced_from"] == "realtime"
        assert message["motion_resolution"]["status"] == "fallback_idle"
    finally:
        store.close()


def test_bridge_admin_status_and_settings_routes_are_admin_only():
    client, app, _ = _client_with_bridge()
    try:
        app.state.message_bridge_service.sync_default_binding_for_user("admin-1")

        denied = client.get("/admin/message-bridge/status", headers={"x-user-id": "u1"})
        status = client.get("/admin/message-bridge/status", headers={"x-user-id": "admin-1"})
        patched = client.patch(
            "/admin/message-bridge/settings",
            headers={"x-user-id": "admin-1"},
            json={"enabled": False, "realtime_drive_character": False},
        )

        assert denied.status_code == 403
        assert status.status_code == 200
        assert status.json()["provider"] == "openclaw"
        assert status.json()["channel"] == "feishu"
        assert status.json()["binding"]["external_display_name"] == "最新会话"
        assert patched.status_code == 200
        assert patched.json()["enabled"] is False
        assert patched.json()["realtime_drive_character"] is False
    finally:
        client.__exit__(None, None, None)


def test_bridge_admin_can_list_feishu_sessions_and_switch_default_binding():
    client, app, provider = _client_with_bridge()
    try:
        app.state.message_bridge_service.sync_default_binding_for_user("admin-1")

        sessions = client.get("/admin/message-bridge/openclaw/feishu/sessions", headers={"x-user-id": "admin-1"})
        switched = client.post(
            "/admin/message-bridge/bindings/default",
            headers={"x-user-id": "admin-1"},
            json={
                "provider": "openclaw",
                "channel": "feishu",
                "external_session_key": "agent:main:feishu:direct:old",
            },
        )

        assert sessions.status_code == 200
        assert [item["external_session_key"] for item in sessions.json()["items"]] == [
            "agent:main:feishu:direct:new",
            "agent:main:feishu:direct:old",
        ]
        assert switched.status_code == 200
        assert switched.json()["binding"]["external_session_key"] == "agent:main:feishu:direct:old"
        assert provider.unsubscribed == ["agent:main:feishu:direct:new"]
    finally:
        client.__exit__(None, None, None)


def test_bridge_consumer_stops_when_bridge_is_disabled():
    async def run_case():
        store = _store()
        try:
            provider = FakeBridgeProvider()
            service = MessageBridgeService(store=store, provider=provider)
            binding = await service.ensure_default_binding_for_user("admin-1")
            store.update_message_bridge_state("openclaw", "feishu", enabled=False)

            await service._consume_events(binding)

            ctx = store.get_current_workspace_context("admin-1")
            messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], binding["local_session_id"])
            assert len(messages) == 2
        finally:
            store.close()

    asyncio.run(run_case())


def test_bridge_consumer_uses_latest_binding_after_switch():
    async def run_case():
        store = _store()
        try:
            provider = FakeBridgeProvider()
            service = MessageBridgeService(store=store, provider=provider)
            old_binding = await service.ensure_default_binding_for_user("admin-1")
            new_binding = await service.bind_external_session_for_user_async("admin-1", "agent:main:feishu:direct:old")

            await provider.events.put(
                {
                    "event": "session.message",
                    "payload": {
                        "message": {
                            "id": "assistant-after-switch",
                            "role": "assistant",
                            "content": "switched",
                            "timestamp": 400,
                        }
                    },
                }
            )
            await provider.events.put({"event": "bridge.test.stop", "payload": {}})
            await service._consume_events(old_binding, max_events=2)

            ctx = store.get_current_workspace_context("admin-1")
            old_messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], old_binding["local_session_id"])
            new_messages = store.list_messages(ctx["workspace"]["id"], ctx["account"]["id"], new_binding["local_session_id"])
            assert all(message["content"] != "switched" for message in old_messages)
            assert any(message["content"] == "switched" for message in new_messages)
        finally:
            store.close()

    asyncio.run(run_case())


def test_openclaw_provider_queues_events_while_waiting_for_rpc_response():
    class FakeWebSocket:
        def __init__(self):
            self.sent = []
            self.messages = asyncio.Queue()

        async def send(self, payload):
            self.sent.append(json.loads(payload))

        async def recv(self):
            return await self.messages.get()

    async def run_case():
        provider = OpenClawGatewayProvider(base_url="http://openclaw.local", token="token")
        ws = FakeWebSocket()
        provider._ws = ws
        await ws.messages.put(json.dumps({"type": "event", "event": "session.message", "payload": {"message": {"id": "m1"}}}))
        await ws.messages.put(json.dumps({"type": "res", "id": "1", "ok": True, "payload": {"sessions": []}}))

        response = await provider._request("sessions.list", {})
        event = await provider.receive_event()

        assert response["ok"] is True
        assert event["event"] == "session.message"

    asyncio.run(run_case())


def test_openclaw_provider_allows_rpc_while_receive_event_is_waiting():
    class FakeWebSocket:
        def __init__(self):
            self.sent = []
            self.messages = asyncio.Queue()

        async def send(self, payload):
            self.sent.append(json.loads(payload))

        async def recv(self):
            return await self.messages.get()

    async def run_case():
        provider = OpenClawGatewayProvider(base_url="http://openclaw.local", token="token")
        ws = FakeWebSocket()
        provider._ws = ws

        receive_task = asyncio.create_task(provider.receive_event())
        await asyncio.sleep(0)
        request_task = asyncio.create_task(provider._request("sessions.list", {}))
        await asyncio.sleep(0)
        await ws.messages.put(json.dumps({"type": "res", "id": "1", "ok": True, "payload": {"sessions": []}}))
        await ws.messages.put(json.dumps({"type": "event", "event": "session.message", "payload": {"message": {"id": "m2"}}}))

        response = await asyncio.wait_for(request_task, timeout=1)
        event = await asyncio.wait_for(receive_task, timeout=1)

        assert response["ok"] is True
        assert event["event"] == "session.message"

    asyncio.run(run_case())


def test_openclaw_provider_parses_feishu_sessions_and_messages():
    provider = OpenClawGatewayProvider(
        base_url="http://openclaw.local",
        token="token",
        channel="feishu",
        timeout_seconds=1,
    )

    sessions = provider.parse_sessions(
        {
            "sessions": [
                {
                    "key": "agent:main:feishu:direct:ou_1",
                    "displayName": "用户1",
                    "updatedAt": 20,
                    "origin": {"provider": "feishu"},
                    "lastChannel": "feishu",
                },
                {
                    "key": "agent:main:other",
                    "displayName": "Other",
                    "updatedAt": 30,
                    "origin": {"provider": "web"},
                },
            ]
        }
    )
    messages = provider.parse_messages(
        {
            "messages": [
                {
                    "role": "assistant",
                    "content": "你好",
                    "timestamp": 123,
                    "responseId": "resp-1",
                    "__openclaw": {"id": "oc-1"},
                }
            ]
        }
    )

    assert len(sessions) == 1
    assert sessions[0].key == "agent:main:feishu:direct:ou_1"
    assert sessions[0].display_name == "用户1"
    assert sessions[0].updated_at == 20
    assert messages == [
        ExternalMessage(
            id="oc-1",
            role="assistant",
            content="你好",
            timestamp=123,
            raw={
                "role": "assistant",
                "content": "你好",
                "timestamp": 123,
                "responseId": "resp-1",
                "__openclaw": {"id": "oc-1"},
            },
        )
    ]
