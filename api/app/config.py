from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


def _parse_admin_ids(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def _parse_csv(raw: object) -> list[str]:
    return [item.strip() for item in str(raw or "").split(",") if item.strip()]


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


def _workspace_env_suffix(workspace_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", workspace_id).strip("_").upper()


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
    openclaw_greeting_index_path: Path | None
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
    codex_interactive_enabled: bool
    codex_bin: str
    codex_home: Path
    codex_transport: str
    codex_allowed_users: list[str]
    codex_allowed_workspaces: list[str]
    codex_workspace_paths: dict[str, Path]
    codex_default_sandbox: str
    codex_patch_sandbox: str
    codex_allow_danger_full_access: bool
    codex_allow_yolo: bool
    codex_use_worktree: bool
    codex_worktree_root: Path
    codex_branch_prefix: str
    codex_max_concurrent_sessions: int
    codex_session_idle_timeout_seconds: int
    codex_turn_timeout_seconds: int
    codex_process_start_timeout_seconds: int
    codex_max_prompt_chars: int
    codex_require_git_repo: bool
    codex_require_git_clean_for_apply: bool
    codex_require_human_approval: bool
    codex_trace_redact_secrets: bool

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

        raw_greeting_index_path = str(
            resolve_value("openclaw_greeting_index_path", "OPENCLAW_GREETING_DASHBOARD_INDEX_PATH", "")
        ).strip()
        greeting_index_path = (
            _resolve_setting_path(raw_greeting_index_path, base_dir=project_root)
            if raw_greeting_index_path
            else root / "openclaw" / "greeting-dashboard-injections.jsonl"
        )

        ids = overrides.get("admin_user_ids")
        if ids is None:
            ids = _parse_admin_ids(str(resolve_value("admin_user_ids", "ADMIN_USER_IDS", "")))

        codex_allowed_users = overrides.get("codex_allowed_users")
        if codex_allowed_users is None:
            codex_allowed_users = _parse_csv(resolve_value("codex_allowed_users", "CODEX_ALLOWED_USERS", ""))

        codex_allowed_workspaces = overrides.get("codex_allowed_workspaces")
        if codex_allowed_workspaces is None:
            codex_allowed_workspaces = _parse_csv(
                resolve_value("codex_allowed_workspaces", "CODEX_ALLOWED_WORKSPACES", "")
            )

        raw_codex_workspace_paths = overrides.get("codex_workspace_paths") or {}
        codex_workspace_paths: dict[str, Path] = {}
        for workspace_id in codex_allowed_workspaces:
            raw_path = raw_codex_workspace_paths.get(workspace_id) if isinstance(raw_codex_workspace_paths, dict) else None
            if raw_path is None:
                env_key = f"CODEX_WORKSPACE_{_workspace_env_suffix(workspace_id)}"
                raw_path = resolve_value(f"codex_workspace_{workspace_id}", env_key, "")
            if str(raw_path or "").strip():
                codex_workspace_paths[workspace_id] = _resolve_setting_path(str(raw_path), base_dir=project_root)

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
            openclaw_greeting_index_path=greeting_index_path,
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
            codex_interactive_enabled=_parse_bool(
                resolve_value("codex_interactive_enabled", "CODEX_INTERACTIVE_ENABLED", False),
                default=False,
            ),
            codex_bin=str(resolve_value("codex_bin", "CODEX_BIN", "codex")).strip() or "codex",
            codex_home=_resolve_setting_path(
                resolve_value("codex_home", "CODEX_HOME", root / "codex-home"),
                base_dir=project_root,
            ),
            codex_transport=str(resolve_value("codex_transport", "CODEX_TRANSPORT", "stdio")).strip() or "stdio",
            codex_allowed_users=list(codex_allowed_users),
            codex_allowed_workspaces=list(codex_allowed_workspaces),
            codex_workspace_paths=codex_workspace_paths,
            codex_default_sandbox=str(
                resolve_value("codex_default_sandbox", "CODEX_DEFAULT_SANDBOX", "read-only")
            ).strip()
            or "read-only",
            codex_patch_sandbox=str(
                resolve_value("codex_patch_sandbox", "CODEX_PATCH_SANDBOX", "workspace-write")
            ).strip()
            or "workspace-write",
            codex_allow_danger_full_access=_parse_bool(
                resolve_value("codex_allow_danger_full_access", "CODEX_ALLOW_DANGER_FULL_ACCESS", False),
                default=False,
            ),
            codex_allow_yolo=_parse_bool(
                resolve_value("codex_allow_yolo", "CODEX_ALLOW_YOLO", False),
                default=False,
            ),
            codex_use_worktree=_parse_bool(
                resolve_value("codex_use_worktree", "CODEX_USE_WORKTREE", True),
                default=True,
            ),
            codex_worktree_root=_resolve_setting_path(
                resolve_value("codex_worktree_root", "CODEX_WORKTREE_ROOT", root / "codex-worktrees"),
                base_dir=project_root,
            ),
            codex_branch_prefix=str(resolve_value("codex_branch_prefix", "CODEX_BRANCH_PREFIX", "codex/")).strip()
            or "codex/",
            codex_max_concurrent_sessions=int(
                resolve_value("codex_max_concurrent_sessions", "CODEX_MAX_CONCURRENT_SESSIONS", 1)
            ),
            codex_session_idle_timeout_seconds=int(
                resolve_value("codex_session_idle_timeout_seconds", "CODEX_SESSION_IDLE_TIMEOUT_SECONDS", 1800)
            ),
            codex_turn_timeout_seconds=int(
                resolve_value("codex_turn_timeout_seconds", "CODEX_TURN_TIMEOUT_SECONDS", 900)
            ),
            codex_process_start_timeout_seconds=int(
                resolve_value("codex_process_start_timeout_seconds", "CODEX_PROCESS_START_TIMEOUT_SECONDS", 30)
            ),
            codex_max_prompt_chars=int(resolve_value("codex_max_prompt_chars", "CODEX_MAX_PROMPT_CHARS", 12000)),
            codex_require_git_repo=_parse_bool(
                resolve_value("codex_require_git_repo", "CODEX_REQUIRE_GIT_REPO", True),
                default=True,
            ),
            codex_require_git_clean_for_apply=_parse_bool(
                resolve_value("codex_require_git_clean_for_apply", "CODEX_REQUIRE_GIT_CLEAN_FOR_APPLY", True),
                default=True,
            ),
            codex_require_human_approval=_parse_bool(
                resolve_value("codex_require_human_approval", "CODEX_REQUIRE_HUMAN_APPROVAL", True),
                default=True,
            ),
            codex_trace_redact_secrets=_parse_bool(
                resolve_value("codex_trace_redact_secrets", "CODEX_TRACE_REDACT_SECRETS", True),
                default=True,
            ),
        )
