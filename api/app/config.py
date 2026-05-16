from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _parse_admin_ids(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def _parse_bool(raw: object, *, default: bool) -> bool:
    if raw is None:
        return default
    text = str(raw).strip().lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "on"}


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        item = line.strip()
        if not item or item.startswith("#") or "=" not in item:
            continue
        key, raw_value = item.split("=", 1)
        values[key.strip()] = raw_value.strip().strip('"').strip("'")
    return values


def _resolve_setting_path(raw: str | Path, *, base_dir: Path) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = base_dir / path
    return path.resolve()


@dataclass(slots=True)
class Settings:
    data_dir: Path
    openclaw_base_url: str
    openclaw_token: str
    openclaw_agent_id: str
    openclaw_model: str
    openclaw_message_channel: str
    openclaw_proxy_url: str
    openclaw_verify_ssl: bool
    openclaw_timeout_seconds: int
    admin_user_ids: list[str]
    retention_days: int
    ndjson_compress_after_days: int
    mmd_root_dir: Path
    tts_service_enabled: bool
    tts_service_base_url: str
    tts_service_timeout_seconds: int
    tts_service_poll_interval_seconds: float
    tts_service_max_poll_attempts: int
    tts_sync_wait_seconds: float
    tts_job_worker_interval_seconds: float
    tts_job_lock_timeout_seconds: int
    message_service_tts_retention_days: int
    realtime_voice_enabled: bool
    realtime_voice_max_queue_size: int
    realtime_voice_chunk_timeout_seconds: int
    realtime_voice_circuit_failure_threshold: int
    realtime_voice_circuit_window_seconds: int
    realtime_voice_circuit_open_seconds: int
    realtime_voice_max_queue_wait_seconds: int
    openclaw_stream_mode: str

    @classmethod
    def from_env(cls, overrides: dict | None = None) -> "Settings":
        overrides = overrides or {}
        project_root = Path(__file__).resolve().parents[2]
        env_file = _read_env_file(project_root / "api" / ".env")

        def resolve_value(override_key: str, env_key: str, default: object = "") -> object:
            if override_key in overrides and overrides[override_key] is not None:
                return overrides[override_key]
            if env_key in os.environ and os.environ[env_key] != "":
                return os.environ[env_key]
            if env_key in env_file and env_file[env_key] != "":
                return env_file[env_key]
            return default

        root = _resolve_setting_path(
            resolve_value("data_dir", "API_DATA_DIR", "api/data"),
            base_dir=project_root,
        )
        mmd_root = _resolve_setting_path(
            resolve_value("mmd_root_dir", "MMD_ROOT_DIR", "MMD"),
            base_dir=project_root,
        )

        ids = overrides.get("admin_user_ids")
        if ids is None:
            ids = _parse_admin_ids(str(resolve_value("admin_user_ids", "ADMIN_USER_IDS", "")))

        return cls(
            data_dir=root,
            openclaw_base_url=str(resolve_value("openclaw_base_url", "OPENCLAW_BASE_URL", "http://127.0.0.1:18789")).rstrip("/"),
            openclaw_token=str(resolve_value("openclaw_token", "OPENCLAW_TOKEN", "")),
            openclaw_agent_id=str(resolve_value("openclaw_agent_id", "OPENCLAW_AGENT_ID", "main")).strip(),
            openclaw_model=str(resolve_value("openclaw_model", "OPENCLAW_MODEL", "")).strip(),
            openclaw_message_channel=str(resolve_value("openclaw_message_channel", "OPENCLAW_MESSAGE_CHANNEL", "feishu")).strip(),
            openclaw_proxy_url=str(resolve_value("openclaw_proxy_url", "OPENCLAW_PROXY_URL", "")).strip(),
            openclaw_verify_ssl=_parse_bool(
                resolve_value("openclaw_verify_ssl", "OPENCLAW_VERIFY_SSL", True),
                default=True,
            ),
            openclaw_timeout_seconds=int(resolve_value("openclaw_timeout_seconds", "OPENCLAW_TIMEOUT_SECONDS", 120)),
            admin_user_ids=list(ids),
            retention_days=int(resolve_value("retention_days", "RETENTION_DAYS", 30)),
            ndjson_compress_after_days=int(
                resolve_value("ndjson_compress_after_days", "NDJSON_COMPRESS_AFTER_DAYS", 7)
            ),
            mmd_root_dir=mmd_root,
            tts_service_enabled=_parse_bool(
                resolve_value("tts_service_enabled", "TTS_SERVICE_ENABLED", False),
                default=False,
            ),
            tts_service_base_url=str(
                resolve_value("tts_service_base_url", "TTS_SERVICE_BASE_URL", "http://10.11.252.164:5555")
            ).rstrip("/"),
            tts_service_timeout_seconds=int(resolve_value("tts_service_timeout_seconds", "TTS_SERVICE_TIMEOUT_SECONDS", 30)),
            tts_service_poll_interval_seconds=float(
                resolve_value("tts_service_poll_interval_seconds", "TTS_SERVICE_POLL_INTERVAL_SECONDS", 3)
            ),
            tts_service_max_poll_attempts=int(
                resolve_value("tts_service_max_poll_attempts", "TTS_SERVICE_MAX_POLL_ATTEMPTS", 40)
            ),
            tts_sync_wait_seconds=float(resolve_value("tts_sync_wait_seconds", "TTS_SYNC_WAIT_SECONDS", 8)),
            tts_job_worker_interval_seconds=float(
                resolve_value("tts_job_worker_interval_seconds", "TTS_JOB_WORKER_INTERVAL_SECONDS", 2)
            ),
            tts_job_lock_timeout_seconds=int(
                resolve_value("tts_job_lock_timeout_seconds", "TTS_JOB_LOCK_TIMEOUT_SECONDS", 30)
            ),
            message_service_tts_retention_days=int(
                resolve_value("message_service_tts_retention_days", "MESSAGE_SERVICE_TTS_RETENTION_DAYS", 14)
            ),
            realtime_voice_enabled=_parse_bool(
                resolve_value("realtime_voice_enabled", "REALTIME_VOICE_ENABLED", False),
                default=False,
            ),
            realtime_voice_max_queue_size=int(
                resolve_value("realtime_voice_max_queue_size", "REALTIME_VOICE_MAX_QUEUE_SIZE", 3)
            ),
            realtime_voice_chunk_timeout_seconds=int(
                resolve_value("realtime_voice_chunk_timeout_seconds", "REALTIME_VOICE_CHUNK_TIMEOUT_SECONDS", 30)
            ),
            realtime_voice_circuit_failure_threshold=int(
                resolve_value(
                    "realtime_voice_circuit_failure_threshold",
                    "REALTIME_VOICE_CIRCUIT_FAILURE_THRESHOLD",
                    5,
                )
            ),
            realtime_voice_circuit_window_seconds=int(
                resolve_value("realtime_voice_circuit_window_seconds", "REALTIME_VOICE_CIRCUIT_WINDOW_SECONDS", 60)
            ),
            realtime_voice_circuit_open_seconds=int(
                resolve_value("realtime_voice_circuit_open_seconds", "REALTIME_VOICE_CIRCUIT_OPEN_SECONDS", 120)
            ),
            realtime_voice_max_queue_wait_seconds=int(
                resolve_value("realtime_voice_max_queue_wait_seconds", "REALTIME_VOICE_MAX_QUEUE_WAIT_SECONDS", 120)
            ),
            openclaw_stream_mode=str(resolve_value("openclaw_stream_mode", "OPENCLAW_STREAM_MODE", "http_sse")).strip()
            or "http_sse",
        )
