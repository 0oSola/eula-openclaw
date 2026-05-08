from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx


class VoiceWorkflowTtsError(RuntimeError):
    """Raised when the voice workflow TTS service cannot produce audio."""


@dataclass(slots=True)
class VoiceWorkflowTtsAudio:
    audio: bytes
    media_type: str
    task_id: str
    audio_url: str


class VoiceWorkflowTtsClient:
    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: int = 30,
        poll_interval_seconds: float = 3,
        max_poll_attempts: int = 40,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self.max_poll_attempts = max_poll_attempts
        self._external_client = http_client is not None
        self.http_client = http_client or httpx.AsyncClient(timeout=timeout_seconds)

    async def close(self) -> None:
        if not self._external_client:
            await self.http_client.aclose()

    @staticmethod
    def _format_response_error(service: str, response: httpx.Response) -> str:
        body = response.text.strip() or "Unknown error."
        return f"{service} failed with status {response.status_code}: {body}"

    @staticmethod
    def _normalize_emotion_label(emotion_label: str | None) -> str | None:
        if not emotion_label:
            return None
        label = emotion_label.strip()
        if not label or label == "default":
            return None
        return label

    async def _submit(self, *, text: str, emotion_label: str | None, pause_profile: str) -> str:
        payload: dict[str, Any] = {
            "text": text,
            "pause_profile": pause_profile or "podcast",
        }
        normalized_label = self._normalize_emotion_label(emotion_label)
        if normalized_label:
            payload["emotion_label"] = normalized_label

        response = await self.http_client.post(
            f"{self.base_url}/api/v1/tts",
            json=payload,
            timeout=self.timeout_seconds,
        )
        if response.status_code != 202:
            raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow TTS submit", response))

        data = response.json()
        task_id = data.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise VoiceWorkflowTtsError("Voice workflow TTS submit returned no task_id.")
        return task_id

    async def _poll_completed(self, task_id: str) -> dict[str, Any]:
        for attempt in range(self.max_poll_attempts):
            response = await self.http_client.get(
                f"{self.base_url}/api/v1/tasks/{task_id}",
                timeout=self.timeout_seconds,
            )
            if not response.is_success:
                raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow TTS task status", response))

            data = response.json()
            status = data.get("status")
            if status == "completed":
                return data
            if status == "failed":
                raise VoiceWorkflowTtsError(str(data.get("error") or "Voice workflow TTS task failed."))

            if attempt < self.max_poll_attempts - 1:
                await asyncio.sleep(self.poll_interval_seconds)

        raise VoiceWorkflowTtsError(f"Voice workflow TTS task {task_id} did not complete before timeout.")

    async def _download(self, audio_url: str) -> tuple[bytes, str]:
        if not audio_url.startswith("/"):
            audio_url = f"/{audio_url}"
        response = await self.http_client.get(
            f"{self.base_url}{audio_url}",
            timeout=self.timeout_seconds,
        )
        if not response.is_success:
            raise VoiceWorkflowTtsError(self._format_response_error("Voice workflow TTS audio download", response))
        if not response.content:
            raise VoiceWorkflowTtsError("Voice workflow TTS returned empty audio.")
        media_type = response.headers.get("content-type", "audio/wav").split(";", 1)[0] or "audio/wav"
        return response.content, media_type

    async def synthesize(
        self,
        *,
        text: str,
        emotion_label: str | None = None,
        pause_profile: str = "podcast",
    ) -> VoiceWorkflowTtsAudio:
        task_id = await self._submit(text=text, emotion_label=emotion_label, pause_profile=pause_profile)
        task = await self._poll_completed(task_id)
        audio_url = task.get("audio_url")
        if not isinstance(audio_url, str) or not audio_url:
            raise VoiceWorkflowTtsError(f"Voice workflow TTS task {task_id} completed without audio_url.")
        audio, media_type = await self._download(audio_url)
        return VoiceWorkflowTtsAudio(
            audio=audio,
            media_type=media_type,
            task_id=task_id,
            audio_url=audio_url,
        )
