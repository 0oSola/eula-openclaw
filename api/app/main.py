from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.db.store import TraceStore
from app.routes.assets import router as assets_router
from app.routes.chat import router as chat_router
from app.routes.config import router as config_router
from app.routes.health import router as health_router
from app.routes.trace import router as trace_router
from app.routes.tts import router as tts_router
from app.services.openclaw_client import OpenClawClient
from app.services.voice_workflow_tts_client import VoiceWorkflowTtsClient


def create_app(overrides: dict | None = None) -> FastAPI:
    settings = Settings.from_env(overrides)
    db_path = settings.data_dir / "sqlite" / "trace.db"
    ndjson_dir = settings.data_dir / "logs"
    trace_store = TraceStore(db_path=db_path, ndjson_dir=ndjson_dir)
    openclaw_client = OpenClawClient(
        base_url=settings.openclaw_base_url,
        token=settings.openclaw_token,
        model=settings.openclaw_model,
        agent_id=settings.openclaw_agent_id,
        message_channel=settings.openclaw_message_channel,
        proxy_url=settings.openclaw_proxy_url,
        verify_ssl=settings.openclaw_verify_ssl,
        timeout_seconds=settings.openclaw_timeout_seconds,
    )
    tts_client = VoiceWorkflowTtsClient(
        base_url=settings.tts_service_base_url,
        timeout_seconds=settings.tts_service_timeout_seconds,
        poll_interval_seconds=settings.tts_service_poll_interval_seconds,
        max_poll_attempts=settings.tts_service_max_poll_attempts,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await app.state.tts_client.close()
        await app.state.openclaw_client.close()
        app.state.trace_store.close()

    app = FastAPI(title="MMD Companion API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.trace_store = trace_store
    app.state.openclaw_client = openclaw_client
    app.state.tts_client = tts_client
    app.state.last_cleanup_check = datetime.now(UTC)

    app.include_router(health_router)
    app.include_router(chat_router)
    app.include_router(trace_router)
    app.include_router(config_router)
    app.include_router(assets_router)
    app.include_router(tts_router)
    return app


app = create_app()
