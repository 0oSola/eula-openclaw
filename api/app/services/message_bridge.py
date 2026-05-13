from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Any, Protocol
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

import websockets

from app.services.response_parser import normalize_assistant_reply


@dataclass(frozen=True)
class ExternalSession:
    key: str
    display_name: str
    provider: str
    channel: str
    updated_at: int
    raw: dict[str, Any]


@dataclass(frozen=True)
class ExternalMessage:
    id: str | None
    role: str
    content: str
    timestamp: int | None
    raw: dict[str, Any]


class MessageBridgeProvider(Protocol):
    provider: str
    channel: str

    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    async def list_external_sessions(self) -> list[ExternalSession]: ...

    async def fetch_history(self, session_key: str, limit: int) -> list[ExternalMessage]: ...

    async def subscribe(self, session_key: str) -> None: ...

    async def unsubscribe(self, session_key: str) -> None: ...


class OpenClawGatewayProvider:
    provider = "openclaw"

    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        channel: str = "feishu",
        timeout_seconds: int = 15,
        origin: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.channel = channel
        self.timeout_seconds = timeout_seconds
        self.origin = origin or self.base_url
        self._ws = None
        self._next_id = 1
        self._event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._reader_task: asyncio.Task | None = None

    @property
    def websocket_url(self) -> str:
        parsed = urlparse(self.base_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return urlunparse((scheme, parsed.netloc, parsed.path or "", "", "", ""))

    async def connect(self) -> None:
        if self._ws is None:
            self._ws = await websockets.connect(
                self.websocket_url,
                origin=self.origin,
                open_timeout=self.timeout_seconds,
                ping_interval=20,
                ping_timeout=20,
            )
        self._ensure_reader_task()
        response = await self._request(
            "connect",
            {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "openclaw-control-ui",
                    "version": "mmd-companion",
                    "platform": "python",
                    "mode": "ui",
                    "instanceId": "mmd-companion-api",
                },
                "role": "operator",
                "scopes": [
                    "operator.admin",
                    "operator.read",
                    "operator.write",
                    "operator.approvals",
                    "operator.pairing",
                ],
                "caps": ["tool-events"],
                "auth": {"token": self.token},
                "userAgent": "mmd-companion-api",
                "locale": "zh-CN",
            },
        )
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))

    async def close(self) -> None:
        if self._reader_task is not None:
            self._reader_task.cancel()
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await self._reader_task
            self._reader_task = None
        for future in self._pending.values():
            if not future.done():
                future.cancel()
        self._pending.clear()
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def list_external_sessions(self) -> list[ExternalSession]:
        response = await self._request("sessions.list", {"includeGlobal": True, "includeUnknown": True, "limit": 200})
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))
        return self.parse_sessions(response.get("payload") or {})

    async def fetch_history(self, session_key: str, limit: int) -> list[ExternalMessage]:
        response = await self._request("chat.history", {"sessionKey": session_key, "limit": limit})
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))
        return self.parse_messages(response.get("payload") or {})

    async def subscribe(self, session_key: str) -> None:
        response = await self._request("sessions.messages.subscribe", {"key": session_key})
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))

    async def unsubscribe(self, session_key: str) -> None:
        response = await self._request("sessions.messages.unsubscribe", {"key": session_key})
        if not response.get("ok"):
            raise RuntimeError(self._format_rpc_error(response))

    async def receive_event(self) -> dict[str, Any]:
        if self._ws is None:
            raise RuntimeError("OpenClaw Gateway is not connected.")
        self._ensure_reader_task()
        return await self._event_queue.get()

    async def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if self._ws is None:
            raise RuntimeError("OpenClaw Gateway is not connected.")
        self._ensure_reader_task()
        request_id = str(self._next_id)
        self._next_id += 1
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        await self._ws.send(json.dumps({"type": "req", "id": request_id, "method": method, "params": params}))
        try:
            return await asyncio.wait_for(future, timeout=self.timeout_seconds)
        finally:
            self._pending.pop(request_id, None)

    def _ensure_reader_task(self) -> None:
        if self._reader_task is None or self._reader_task.done():
            self._reader_task = asyncio.create_task(self._read_messages())

    async def _read_messages(self) -> None:
        if self._ws is None:
            return
        try:
            while True:
                message = json.loads(await self._ws.recv())
                if message.get("type") == "res":
                    request_id = str(message.get("id") or "")
                    future = self._pending.get(request_id)
                    if future is not None and not future.done():
                        future.set_result(message)
                    continue
                if message.get("type") == "event":
                    self._event_queue.put_nowait(message)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(error)
            self._pending.clear()

    def parse_sessions(self, payload: dict[str, Any]) -> list[ExternalSession]:
        output: list[ExternalSession] = []
        for item in payload.get("sessions") or []:
            if not isinstance(item, dict):
                continue
            origin = item.get("origin") if isinstance(item.get("origin"), dict) else {}
            delivery = item.get("deliveryContext") if isinstance(item.get("deliveryContext"), dict) else {}
            channel = str(item.get("lastChannel") or delivery.get("channel") or origin.get("provider") or "")
            provider = str(origin.get("provider") or channel)
            if provider != self.channel and channel != self.channel:
                continue
            key = str(item.get("key") or "").strip()
            if not key:
                continue
            output.append(
                ExternalSession(
                    key=key,
                    display_name=str(item.get("displayName") or item.get("label") or key),
                    provider=provider,
                    channel=channel or self.channel,
                    updated_at=int(item.get("updatedAt") or 0),
                    raw=item,
                )
            )
        return output

    def parse_messages(self, payload: dict[str, Any]) -> list[ExternalMessage]:
        output: list[ExternalMessage] = []
        for item in payload.get("messages") or []:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "")
            content = item.get("content")
            if isinstance(content, list):
                content = "\n".join(str(part.get("text") or part.get("content") or "") for part in content if isinstance(part, dict))
            openclaw = item.get("__openclaw") if isinstance(item.get("__openclaw"), dict) else {}
            message_id = openclaw.get("id") or item.get("id") or item.get("message_id") or item.get("responseId") or item.get("toolCallId")
            output.append(
                ExternalMessage(
                    id=str(message_id) if message_id else None,
                    role=role,
                    content=str(content or ""),
                    timestamp=int(item.get("timestamp") or item.get("createdAt") or 0) or None,
                    raw=item,
                )
            )
        return output

    @staticmethod
    def _format_rpc_error(response: dict[str, Any]) -> str:
        error = response.get("error") if isinstance(response.get("error"), dict) else {}
        return str(error.get("message") or "OpenClaw Gateway RPC failed.")


def _run_async(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    raise RuntimeError("MessageBridgeService sync helpers cannot run inside an active event loop.")


def _external_message_id(provider: str, session_key: str, message: ExternalMessage) -> str:
    if message.id:
        return message.id
    raw = message.raw or {}
    for key in ("id", "message_id", "responseId", "toolCallId"):
        value = raw.get(key)
        if value:
            return str(value)
    openclaw = raw.get("__openclaw")
    if isinstance(openclaw, dict):
        for key in ("id", "messageId", "eventId"):
            value = openclaw.get(key)
            if value:
                return str(value)
    fingerprint = f"{provider}|{session_key}|{message.role}|{message.timestamp}|{message.content}"
    return sha256(fingerprint.encode("utf-8")).hexdigest()


def _chat_role(role: str) -> str | None:
    normalized = role.strip().lower()
    if normalized in {"user", "assistant", "system"}:
        return normalized
    return None


def _normalize_bridge_message(message: ExternalMessage) -> dict[str, Any]:
    role = _chat_role(message.role)
    if role == "assistant":
        normalized = normalize_assistant_reply(message.content)
        if normalized.get("parse_mode") != "plain_text":
            return {
                "content": normalized["text"],
                "emotion": normalized.get("emotion") or "neutral",
                "action": normalized.get("action") or "idle",
                "motion_plan": normalized.get("motion_plan"),
                "memory_ops": normalized.get("memory_ops", []),
                "tts_emotion_label": normalized.get("tts_emotion_label"),
                "tts_pause_profile": normalized.get("tts_pause_profile"),
                "parse_mode": normalized.get("parse_mode"),
            }
    raw = message.raw or {}
    motion_plan = raw.get("motion_plan") if isinstance(raw.get("motion_plan"), dict) else None
    return {
        "content": message.content,
        "emotion": str(raw.get("emotion") or "neutral") if role == "assistant" else None,
        "action": str(raw.get("action") or "idle") if role == "assistant" else None,
        "motion_plan": motion_plan,
        "memory_ops": [],
        "tts_emotion_label": raw.get("tts_emotion_label"),
        "tts_pause_profile": raw.get("tts_pause_profile"),
        "parse_mode": "bridge_raw",
    }


class MessageBridgeService:
    def __init__(self, *, store, provider: MessageBridgeProvider, history_limit: int = 100):
        self.store = store
        self.provider = provider
        self.history_limit = history_limit

    def sync_default_binding_for_user(self, user_id: str) -> dict[str, Any]:
        return _run_async(self.ensure_default_binding_for_user(user_id))

    def close_provider(self) -> None:
        _run_async(self.provider.close())

    async def close_provider_async(self) -> None:
        await self.provider.close()

    async def ensure_default_binding_for_user(self, user_id: str) -> dict[str, Any]:
        ctx = self.store.get_current_workspace_context(user_id)
        state = self.store.get_message_bridge_state(self.provider.provider, self.provider.channel)
        if not state["enabled"]:
            raise RuntimeError("Message bridge is disabled.")

        feishu_sessions = await self.list_external_sessions_async()
        self._insert_event(
            user_id=user_id,
            session_id=None,
            stage="message_bridge.openclaw.sessions.list",
            status="ok",
            payload={"count": len(feishu_sessions)},
        )
        if not feishu_sessions:
            raise RuntimeError("No Feishu sessions found from bridge provider.")

        latest = feishu_sessions[0]
        existing = self.store.get_default_message_bridge_binding(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            provider=self.provider.provider,
            channel=self.provider.channel,
        )
        if existing and existing["external_session_key"] == latest.key:
            binding = existing
        else:
            session = self.store.create_session(
                ctx["workspace"]["id"],
                ctx["account"]["id"],
                title=latest.display_name or "Feishu",
            )
            binding = self.store.upsert_message_bridge_binding(
                workspace_id=ctx["workspace"]["id"],
                account_id=ctx["account"]["id"],
                local_session_id=session["id"],
                provider=self.provider.provider,
                channel=self.provider.channel,
                external_session_key=latest.key,
                external_display_name=latest.display_name,
                is_default=True,
                status="active",
            )
            self._insert_event(
                user_id=user_id,
                session_id=session["id"],
                stage="message_bridge.openclaw.session.bind",
                status="ok",
                payload={
                    "external_session_key": latest.key,
                    "external_display_name": latest.display_name,
                },
            )

        await self.sync_history_async(binding, limit=self.history_limit, source="history")
        await self.provider.subscribe(binding["external_session_key"])
        self._insert_event(
            user_id=user_id,
            session_id=binding["local_session_id"],
            stage="message_bridge.openclaw.subscribe",
            status="ok",
            payload={"external_session_key": binding["external_session_key"]},
        )
        return self.store.get_message_bridge_binding(binding["id"]) or binding

    def list_external_sessions(self) -> list[ExternalSession]:
        return _run_async(self.list_external_sessions_async())

    async def list_external_sessions_async(self) -> list[ExternalSession]:
        sessions = await self.provider.list_external_sessions()
        return self._sort_external_sessions(sessions)

    async def list_external_sessions_isolated_async(self) -> list[ExternalSession]:
        provider = self._create_isolated_provider()
        if provider is None:
            return await self.list_external_sessions_async()
        try:
            await provider.connect()
            sessions = await provider.list_external_sessions()
            return self._sort_external_sessions(sessions)
        finally:
            with contextlib.suppress(Exception):
                await provider.close()

    async def fetch_history_isolated_async(self, session_key: str, limit: int) -> list[ExternalMessage]:
        provider = self._create_isolated_provider()
        if provider is None:
            return await self.provider.fetch_history(session_key, limit)
        try:
            await provider.connect()
            return await provider.fetch_history(session_key, limit)
        finally:
            with contextlib.suppress(Exception):
                await provider.close()

    def _create_isolated_provider(self) -> OpenClawGatewayProvider | None:
        if not isinstance(self.provider, OpenClawGatewayProvider):
            return None
        return OpenClawGatewayProvider(
            base_url=self.provider.base_url,
            token=self.provider.token,
            channel=self.provider.channel,
            timeout_seconds=self.provider.timeout_seconds,
            origin=self.provider.origin,
        )

    def _sort_external_sessions(self, sessions: list[ExternalSession]) -> list[ExternalSession]:
        return sorted(
            [
                session
                for session in sessions
                if session.channel == self.provider.channel or session.provider == self.provider.channel
            ],
            key=lambda item: item.updated_at,
            reverse=True,
        )

    def bind_external_session_for_user(self, user_id: str, external_session_key: str) -> dict[str, Any]:
        return _run_async(self.bind_external_session_for_user_async(user_id, external_session_key))

    async def bind_external_session_for_user_async(self, user_id: str, external_session_key: str) -> dict[str, Any]:
        ctx = self.store.get_current_workspace_context(user_id)
        sessions = await self.list_external_sessions_isolated_async()
        target = next((session for session in sessions if session.key == external_session_key), None)
        if target is None:
            raise RuntimeError("External session not found.")
        previous = self.store.get_default_message_bridge_binding(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            provider=self.provider.provider,
            channel=self.provider.channel,
        )
        session = self.store.create_session(
            ctx["workspace"]["id"],
            ctx["account"]["id"],
            title=target.display_name or "Feishu",
        )
        binding = self.store.upsert_message_bridge_binding(
            workspace_id=ctx["workspace"]["id"],
            account_id=ctx["account"]["id"],
            local_session_id=session["id"],
            provider=self.provider.provider,
            channel=self.provider.channel,
            external_session_key=target.key,
            external_display_name=target.display_name,
            is_default=True,
            status="active",
        )
        self._insert_event(
            user_id=user_id,
            session_id=session["id"],
            stage="message_bridge.openclaw.session.bind",
            status="ok",
            payload={
                "external_session_key": target.key,
                "external_display_name": target.display_name,
            },
        )
        await self.sync_history_async(binding, limit=self.history_limit, source="history", isolated=True)
        state = self.store.get_message_bridge_state(self.provider.provider, self.provider.channel)
        provider_connected = state["websocket_status"] == "connected" or not isinstance(self.provider, OpenClawGatewayProvider)
        if provider_connected and previous and previous["external_session_key"] != binding["external_session_key"]:
            unsubscribe = getattr(self.provider, "unsubscribe", None)
            if unsubscribe is not None:
                await unsubscribe(previous["external_session_key"])
                self._insert_event(
                    user_id=user_id,
                    session_id=previous["local_session_id"],
                    stage="message_bridge.openclaw.unsubscribe",
                    status="ok",
                    payload={"external_session_key": previous["external_session_key"]},
                )
        if provider_connected:
            await self.provider.subscribe(binding["external_session_key"])
            self._insert_event(
                user_id=user_id,
                session_id=binding["local_session_id"],
                stage="message_bridge.openclaw.subscribe",
                status="ok",
                payload={"external_session_key": binding["external_session_key"]},
            )
        return self.store.get_message_bridge_binding(binding["id"]) or binding

    def sync_history(self, binding: dict[str, Any], *, limit: int, source: str) -> list[dict[str, Any]]:
        return _run_async(self.sync_history_async(binding, limit=limit, source=source))

    async def sync_history_async(
        self,
        binding: dict[str, Any],
        *,
        limit: int,
        source: str,
        isolated: bool = False,
    ) -> list[dict[str, Any]]:
        if isolated:
            messages = await self.fetch_history_isolated_async(binding["external_session_key"], limit)
        else:
            messages = await self.provider.fetch_history(binding["external_session_key"], limit)
        inserted = [
            message
            for external in messages
            if (message := self.ingest_external_message(binding, external, source=source)) is not None
        ]
        self.store.update_message_bridge_binding_sync(binding["id"], last_history_sync_at=_utc_from_store())
        self._insert_event(
            user_id=self._binding_user_id(binding),
            session_id=binding["local_session_id"],
            stage="message_bridge.openclaw.history.load",
            status="ok",
            payload={
                "external_session_key": binding["external_session_key"],
                "count": len(messages),
                "inserted_count": len(inserted),
                "source": source,
            },
        )
        return inserted

    def ingest_external_message(
        self,
        binding: dict[str, Any],
        external_message: ExternalMessage,
        *,
        source: str,
    ) -> dict[str, Any] | None:
        role = _chat_role(external_message.role)
        if not role:
            return None
        normalized = _normalize_bridge_message(external_message)
        external_id = _external_message_id(self.provider.provider, binding["external_session_key"], external_message)
        message = self.store.insert_message_if_external_missing(
            binding["workspace_id"],
            binding["local_session_id"],
            binding["account_id"],
            role=role,
            content=normalized["content"],
            openclaw_message_id=external_id,
            emotion=normalized["emotion"],
            action=normalized["action"],
            tts_emotion_label=normalized.get("tts_emotion_label"),
            tts_pause_profile=normalized.get("tts_pause_profile"),
            motion_plan=normalized["motion_plan"],
            memory_ops=normalized["memory_ops"],
            metadata={
                "source": "message_bridge",
                "provider": self.provider.provider,
                "channel": self.provider.channel,
                "external_session_key": binding["external_session_key"],
                "external_message_id": external_id,
                "synced_from": source,
                "parse_mode": normalized.get("parse_mode"),
            },
        )
        if role == "assistant" and not message.get("motion_resolution"):
            message["motion_resolution"] = self.store.create_message_motion_resolution(
                binding["workspace_id"],
                message["id"],
                selected_model_path=None,
                source_action=message.get("action"),
                source_template=None,
                resolved_asset_id=None,
                resolved_asset_url=None,
                resolved_display_name=None,
                status="fallback_idle",
                fallback_reason="bridge_default_idle",
            )
        self.store.update_message_bridge_binding_sync(binding["id"], last_message_at=_utc_from_store())
        self._insert_event(
            user_id=self._binding_user_id(binding),
            session_id=binding["local_session_id"],
            stage="message_bridge.openclaw.message.received",
            status="ok",
            payload={
                "external_session_key": binding["external_session_key"],
                "external_message_id": external_id,
                "role": role,
                "source": source,
            },
        )
        return message

    async def run_forever(self, default_user_id: str) -> None:
        backoffs = [1, 2, 5, 10, 30]
        attempt = 0
        while True:
            try:
                state = self.store.get_message_bridge_state(self.provider.provider, self.provider.channel)
                if not state["enabled"]:
                    self.store.update_message_bridge_state(
                        self.provider.provider,
                        self.provider.channel,
                        websocket_status="disabled",
                        reconnect_attempts=0,
                        last_error=None,
                    )
                    with contextlib.suppress(Exception):
                        await self.provider.close()
                    await asyncio.sleep(5)
                    continue
                self.store.update_message_bridge_state(
                    self.provider.provider,
                    self.provider.channel,
                    websocket_status="reconnecting" if attempt else "disconnected",
                    reconnect_attempts=attempt,
                    last_error=None,
                )
                await self.provider.connect()
                self.store.update_message_bridge_state(
                    self.provider.provider,
                    self.provider.channel,
                    websocket_status="connected",
                    reconnect_attempts=attempt,
                    last_connected_at=_utc_from_store(),
                    last_error=None,
                )
                binding = await self.ensure_default_binding_for_user(default_user_id)
                if attempt:
                    await self.sync_history_async(binding, limit=20, source="reconnect_history")
                attempt = 0
                await self._consume_events(binding)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.store.update_message_bridge_state(
                    self.provider.provider,
                    self.provider.channel,
                    websocket_status="reconnecting",
                    reconnect_attempts=attempt + 1,
                    last_error=str(error),
                )
                with contextlib.suppress(Exception):
                    await self.provider.close()
                delay = backoffs[min(attempt, len(backoffs) - 1)]
                attempt += 1
                await asyncio.sleep(delay)

    async def _consume_events(self, binding: dict[str, Any], *, max_events: int | None = None) -> None:
        receive_event = getattr(self.provider, "receive_event", None)
        if receive_event is None:
            return
        consumed = 0
        active_binding = binding
        while max_events is None or consumed < max_events:
            state = self.store.get_message_bridge_state(self.provider.provider, self.provider.channel)
            if not state["enabled"]:
                self.store.update_message_bridge_state(
                    self.provider.provider,
                    self.provider.channel,
                    websocket_status="disabled",
                    last_error=None,
                )
                return
            event = await receive_event()
            consumed += 1
            if event.get("event") != "session.message":
                continue
            latest_binding = self.store.get_default_message_bridge_binding(
                active_binding["workspace_id"],
                active_binding["account_id"],
                provider=self.provider.provider,
                channel=self.provider.channel,
            )
            if latest_binding:
                active_binding = latest_binding
            payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
            external = self._external_message_from_event_payload(payload)
            if external is not None:
                self.ingest_external_message(active_binding, external, source="realtime")

    @staticmethod
    def _external_message_from_event_payload(payload: dict[str, Any]) -> ExternalMessage | None:
        message = payload.get("message") if isinstance(payload.get("message"), dict) else payload
        if not isinstance(message, dict):
            return None
        provider = OpenClawGatewayProvider(base_url="http://localhost", token="")
        parsed = provider.parse_messages({"messages": [message]})
        return parsed[0] if parsed else None

    def _binding_user_id(self, binding: dict[str, Any]) -> str:
        return self.store.get_account_external_user_id(binding["account_id"]) or binding["account_id"]

    def _insert_event(
        self,
        *,
        user_id: str,
        session_id: str | None,
        stage: str,
        status: str,
        payload: dict[str, Any],
        error_code: str | None = None,
    ) -> None:
        self.store.insert_event(
            trace_id=f"message-bridge-{uuid4()}",
            user_id=user_id,
            session_id=session_id,
            stage=stage,
            status=status,
            latency_ms=None,
            payload={
                "provider": self.provider.provider,
                "channel": self.provider.channel,
                **payload,
            },
            error_code=error_code,
        )


def _utc_from_store() -> str:
    from app.db.store import _utc_now_iso

    return _utc_now_iso()
