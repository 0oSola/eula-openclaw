from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.models.chat import OpenClawReply


class OpenClawInvocationError(RuntimeError):
    """Raised when both OpenClaw endpoints fail."""


class OpenClawClient:
    OPERATOR_SCOPES = ",".join(
        [
            "operator.admin",
            "operator.read",
            "operator.write",
            "operator.approvals",
            "operator.pairing",
        ]
    )

    def __init__(
        self,
        base_url: str,
        token: str,
        model: str,
        agent_id: str = "main",
        message_channel: str = "feishu",
        proxy_url: str | None = None,
        verify_ssl: bool = True,
        timeout_seconds: int = 15,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.model = model.strip()
        self.agent_id = agent_id.strip()
        self.message_channel = message_channel.strip()
        self.proxy_url = (proxy_url or "").strip()
        self.verify_ssl = verify_ssl
        self.timeout_seconds = timeout_seconds
        self._external_client = http_client is not None
        if http_client is not None:
            self.http_client = http_client
        else:
            client_kwargs: dict[str, Any] = {
                "timeout": timeout_seconds,
                "verify": verify_ssl,
            }
            if self.proxy_url:
                client_kwargs["proxy"] = self.proxy_url
            self.http_client = httpx.AsyncClient(**client_kwargs)

    async def close(self) -> None:
        if not self._external_client:
            await self.http_client.aclose()

    def _resolve_request_target(self) -> tuple[str, str, str]:
        payload_model = "openclaw"
        agent_id = self.agent_id or "main"
        backend_model = ""
        raw_model = self.model

        if raw_model.startswith("openclaw:") or raw_model.startswith("agent:"):
            payload_model = raw_model
            return payload_model, "", ""
        if raw_model in {"openclaw", "agent"}:
            payload_model = raw_model
            return payload_model, agent_id, ""
        if raw_model.startswith("openclaw/"):
            legacy_agent = raw_model.split("/", 1)[1].strip()
            if legacy_agent and legacy_agent != "default":
                agent_id = legacy_agent
            return payload_model, agent_id, ""
        if raw_model:
            backend_model = raw_model
        return payload_model, agent_id, backend_model

    def _headers(self, session_id: str | None) -> dict[str, str]:
        _, agent_id, _ = self._resolve_request_target()
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
            headers["x-openclaw-scopes"] = self.OPERATOR_SCOPES
        if agent_id:
            headers["x-openclaw-agent-id"] = agent_id
        if self.message_channel:
            headers["x-openclaw-message-channel"] = self.message_channel
        if session_id:
            headers["x-openclaw-session-key"] = session_id
        return headers

    @staticmethod
    def _truncate_detail(text: str, limit: int = 240) -> str:
        collapsed = " ".join(text.split())
        if len(collapsed) <= limit:
            return collapsed
        return f"{collapsed[: limit - 3]}..."

    def _diagnostic_probe_result(
        self,
        *,
        endpoint: str,
        ok: bool | None,
        status_code: int | None,
        detail: str,
    ) -> dict[str, Any]:
        return {
            "ok": ok,
            "status_code": status_code,
            "detail": self._truncate_detail(detail),
            "endpoint": endpoint,
        }

    async def _probe_endpoint(
        self,
        endpoint: str,
        caller: Callable[[], Awaitable[httpx.Response]],
    ) -> dict[str, Any]:
        try:
            response = await caller()
        except Exception as error:
            return self._diagnostic_probe_result(
                endpoint=endpoint,
                ok=False,
                status_code=None,
                detail=str(error),
            )

        if response.is_success:
            return self._diagnostic_probe_result(
                endpoint=endpoint,
                ok=True,
                status_code=response.status_code,
                detail="ok",
            )

        body = response.text.strip() or "Unknown error."
        return self._diagnostic_probe_result(
            endpoint=endpoint,
            ok=False,
            status_code=response.status_code,
            detail=f"status {response.status_code}: {body}",
        )

    @staticmethod
    def _probe_needs_scope_fix(detail: str) -> bool:
        text = detail.lower()
        return "missing scope: operator.read" in text or "missing scope: operator.write" in text

    async def diagnose(self) -> dict[str, Any]:
        payload_model, _, _ = self._resolve_request_target()
        headers = self._headers(None)
        models_probe = await self._probe_endpoint(
            "/v1/models",
            lambda: self.http_client.get(
                f"{self.base_url}/v1/models",
                headers=headers,
                timeout=self.timeout_seconds,
            ),
        )
        responses_probe = await self._probe_endpoint(
            "/v1/responses",
            lambda: self.http_client.post(
                f"{self.base_url}/v1/responses",
                headers=headers,
                json={
                    "model": payload_model,
                    "input": "ping",
                    "stream": False,
                },
                timeout=self.timeout_seconds,
            ),
        )
        if responses_probe["ok"] is True:
            chat_probe = self._diagnostic_probe_result(
                endpoint="/v1/chat/completions",
                ok=None,
                status_code=None,
                detail="not_run",
            )
        else:
            chat_probe = await self._probe_endpoint(
                "/v1/chat/completions",
                lambda: self.http_client.post(
                    f"{self.base_url}/v1/chat/completions",
                    headers=headers,
                    json={
                        "model": payload_model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "stream": False,
                    },
                    timeout=self.timeout_seconds,
                ),
            )

        recommendations: list[str] = []
        probe_details = [models_probe["detail"], responses_probe["detail"], chat_probe["detail"]]
        if any(self._probe_needs_scope_fix(detail) for detail in probe_details):
            recommendations.append(
                "OpenClaw accepted the bearer token but denied operator scopes. "
                "Forward x-openclaw-scopes or rotate a token with operator.read/operator.write."
            )
        if any(
            probe["status_code"] == 404
            for probe in (models_probe, responses_probe, chat_probe)
            if probe["status_code"] is not None
        ):
            recommendations.append(
                "Ensure OPENCLAW_BASE_URL points at the Gateway port and "
                "gateway.http.endpoints.responses.enabled / gateway.http.endpoints.chatCompletions.enabled are enabled."
            )
        if any(
            "connection attempts failed" in detail.lower()
            or "timed out" in detail.lower()
            or "refused" in detail.lower()
            for detail in probe_details
        ):
            recommendations.append(
                "OpenClaw was unreachable from the API process. Verify OPENCLAW_BASE_URL, "
                "OPENCLAW_PROXY_URL, firewall rules, and TLS settings."
            )

        return {
            "ok": models_probe["ok"] is True and (responses_probe["ok"] is True or chat_probe["ok"] is True),
            "base_url": self.base_url,
            "agent_id": self.agent_id or "main",
            "model": self.model,
            "proxy_configured": bool(self.proxy_url),
            "verify_ssl": self.verify_ssl,
            "scope_header_enabled": bool(self.token),
            "probes": {
                "models": models_probe,
                "responses": responses_probe,
                "chat_completions": chat_probe,
            },
            "recommendations": recommendations,
        }

    async def _post_with_retry(
        self,
        endpoint: str,
        payload: dict[str, Any],
        headers: dict[str, str],
    ) -> httpx.Response:
        url = f"{self.base_url}{endpoint}"
        last_error: Exception | None = None
        for _ in range(2):
            try:
                response = await self.http_client.post(
                    url,
                    json=payload,
                    headers=headers,
                    timeout=self.timeout_seconds,
                )
                if response.status_code >= 500:
                    last_error = RuntimeError(f"Server status {response.status_code}: {response.text}")
                    continue
                return response
            except (httpx.HTTPError, RuntimeError) as error:
                last_error = error
        if last_error:
            raise last_error
        raise RuntimeError("OpenClaw request failed without response.")

    @staticmethod
    def _extract_responses_text(payload: dict[str, Any]) -> str:
        if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
            return payload["output_text"].strip()

        output = payload.get("output")
        if not isinstance(output, list):
            return ""
        chunks: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if part.get("type") == "output_text" and isinstance(text, str):
                    chunks.append(text)
        return "\n".join(chunks).strip()

    @staticmethod
    def _extract_chat_text(payload: dict[str, Any]) -> str:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            return ""
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if not isinstance(message, dict):
            return ""
        content = message.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item, str):
                    parts.append(item)
            return "\n".join(parts).strip()
        return ""

    def _format_error(self, response: httpx.Response) -> str:
        text = response.text.strip() or "Unknown error."
        if response.status_code == 404:
            return (
                "OpenClaw HTTP endpoint returned 404. Ensure OPENCLAW_BASE_URL points at the Gateway port "
                "and enable gateway.http.endpoints.responses.enabled and "
                "gateway.http.endpoints.chatCompletions.enabled. "
                f"Response body: {text}"
            )
        return f"OpenClaw failed with status {response.status_code}: {text}"

    async def generate_reply(
        self,
        user_id: str,
        session_id: str | None,
        message: str,
        history: list[dict[str, str]],
    ) -> OpenClawReply:
        payload_model, _, _ = self._resolve_request_target()
        headers = self._headers(session_id)
        responses_payload = {
            "model": payload_model,
            "input": message,
            "user": user_id,
            "stream": False,
        }

        try:
            resp = await self._post_with_retry("/v1/responses", responses_payload, headers)
            if resp.is_success:
                text = self._extract_responses_text(resp.json())
                if text:
                    return OpenClawReply(
                        raw_text=text,
                        endpoint_used="/v1/responses",
                        status_code=resp.status_code,
                    )
        except Exception:
            pass

        chat_payload = {
            "model": payload_model,
            "messages": history + [{"role": "user", "content": message}],
            "user": user_id,
            "stream": False,
        }
        try:
            resp = await self._post_with_retry("/v1/chat/completions", chat_payload, headers)
            if not resp.is_success:
                raise OpenClawInvocationError(self._format_error(resp))

            text = self._extract_chat_text(resp.json())
            if not text:
                raise OpenClawInvocationError("OpenClaw returned empty content.")
            return OpenClawReply(
                raw_text=text,
                endpoint_used="/v1/chat/completions",
                status_code=resp.status_code,
            )
        except Exception as error:
            if isinstance(error, OpenClawInvocationError):
                raise
            raise OpenClawInvocationError(str(error)) from error
