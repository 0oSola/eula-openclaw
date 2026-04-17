from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from app.db.store import TraceStore


def _make_case_dir() -> Path:
    path = Path("D:/workspace/MMD project/api/tests_runtime") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_trace_store_dual_writes_sqlite_and_ndjson():
    case_dir = _make_case_dir()
    db_path = case_dir / "trace.db"
    log_dir = case_dir / "logs"
    store = TraceStore(db_path=db_path, ndjson_dir=log_dir)

    store.insert_event(
        trace_id="trace-1",
        user_id="u1",
        session_id="s1",
        stage="ingress",
        status="ok",
        latency_ms=12,
        payload={"message": "hello"},
    )
    store.insert_chat_mirror(
        trace_id="trace-1",
        user_id="u1",
        request_payload={"message": "hello"},
        raw_response="raw text",
        normalized_payload={"text": "ok", "emotion": "neutral", "action": "idle"},
        endpoint_used="/v1/responses",
        status="ok",
    )

    events = store.query_events(trace_id="trace-1", requester_user_id="u1", is_admin=False)
    assert len(events) == 1
    assert events[0]["stage"] == "ingress"

    mirrors = store.query_mirrors(trace_id="trace-1", requester_user_id="u1", is_admin=False)
    assert len(mirrors) == 1
    assert mirrors[0]["endpoint_used"] == "/v1/responses"

    ndjson_files = list(log_dir.glob("*.ndjson"))
    assert len(ndjson_files) == 1
    assert '"trace_id":"trace-1"' in ndjson_files[0].read_text(encoding="utf-8")


def test_trace_retention_cleanup():
    case_dir = _make_case_dir()
    db_path = case_dir / "trace.db"
    log_dir = case_dir / "logs"
    store = TraceStore(db_path=db_path, ndjson_dir=log_dir)

    old_time = datetime.now(UTC) - timedelta(days=40)
    store.insert_event(
        trace_id="old-trace",
        user_id="u1",
        session_id="s1",
        stage="ingress",
        status="ok",
        latency_ms=1,
        payload={},
        created_at=old_time,
    )
    store.insert_chat_mirror(
        trace_id="old-trace",
        user_id="u1",
        request_payload={},
        raw_response="",
        normalized_payload={},
        endpoint_used="/v1/responses",
        status="ok",
        created_at=old_time,
    )

    store.cleanup(retention_days=30, compress_after_days=7)

    events = store.query_events(trace_id="old-trace", requester_user_id="u1", is_admin=False)
    mirrors = store.query_mirrors(trace_id="old-trace", requester_user_id="u1", is_admin=False)
    assert events == []
    assert mirrors == []
