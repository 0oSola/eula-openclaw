from __future__ import annotations

from datetime import UTC, datetime, timedelta
import gzip
import json
from pathlib import Path
import sqlite3
from typing import Any
from uuid import uuid4


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _ensure_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(UTC)
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class TraceStore:
    def __init__(self, db_path: Path, ndjson_dir: Path):
        self.db_path = Path(db_path)
        self.ndjson_dir = Path(ndjson_dir)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.ndjson_dir.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_db()

    def close(self) -> None:
        self._conn.close()

    def _init_db(self) -> None:
        cursor = self._conn.cursor()
        cursor.executescript(
            """
            CREATE TABLE IF NOT EXISTS trace_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                session_id TEXT,
                stage TEXT NOT NULL,
                status TEXT NOT NULL,
                latency_ms INTEGER,
                error_code TEXT,
                payload_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_mirror (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                request_json TEXT NOT NULL,
                raw_response TEXT,
                normalized_json TEXT,
                endpoint_used TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS retry_jobs (
                id TEXT PRIMARY KEY,
                trace_id TEXT NOT NULL,
                stage TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mapping_defaults (
                slot TEXT PRIMARY KEY,
                config_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mapping_user_override (
                user_id TEXT NOT NULL,
                slot TEXT NOT NULL,
                config_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, slot)
            );

            CREATE TABLE IF NOT EXISTS asset_registry (
                asset_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                slot TEXT NOT NULL,
                filename TEXT NOT NULL,
                display_name TEXT,
                source_relative_path TEXT,
                relative_path TEXT NOT NULL,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                favorite_relative_path TEXT,
                favorite_model_relative_path TEXT,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        existing_columns = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(asset_registry)").fetchall()
        }
        self._add_column_if_missing(existing_columns, "display_name", "ALTER TABLE asset_registry ADD COLUMN display_name TEXT")
        self._add_column_if_missing(
            existing_columns,
            "source_relative_path",
            "ALTER TABLE asset_registry ADD COLUMN source_relative_path TEXT",
        )
        self._add_column_if_missing(
            existing_columns,
            "is_favorite",
            "ALTER TABLE asset_registry ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
        )
        self._add_column_if_missing(
            existing_columns,
            "favorite_relative_path",
            "ALTER TABLE asset_registry ADD COLUMN favorite_relative_path TEXT",
        )
        self._add_column_if_missing(
            existing_columns,
            "favorite_model_relative_path",
            "ALTER TABLE asset_registry ADD COLUMN favorite_model_relative_path TEXT",
        )
        self._conn.commit()

    def _add_column_if_missing(self, existing_columns: set[str], column_name: str, statement: str) -> None:
        if column_name in existing_columns:
            return
        try:
            self._conn.execute(statement)
        except sqlite3.OperationalError as exc:
            if "duplicate column name" not in str(exc).lower():
                raise

    def _append_ndjson(self, record: dict[str, Any], created_at: datetime) -> None:
        file_name = f"{created_at.date().isoformat()}.ndjson"
        path = self.ndjson_dir / file_name
        line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        with path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    def insert_event(
        self,
        trace_id: str,
        user_id: str,
        session_id: str | None,
        stage: str,
        status: str,
        latency_ms: int | None,
        payload: dict[str, Any],
        error_code: str | None = None,
        created_at: datetime | None = None,
    ) -> None:
        ts = _ensure_utc(created_at)
        payload_json = json.dumps(payload, ensure_ascii=False)
        self._conn.execute(
            """
            INSERT INTO trace_events
                (trace_id, user_id, session_id, stage, status, latency_ms, error_code, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                user_id,
                session_id,
                stage,
                status,
                latency_ms,
                error_code,
                payload_json,
                ts.isoformat(),
            ),
        )
        self._conn.commit()
        self._append_ndjson(
            {
                "type": "trace_event",
                "trace_id": trace_id,
                "user_id": user_id,
                "session_id": session_id,
                "stage": stage,
                "status": status,
                "latency_ms": latency_ms,
                "error_code": error_code,
                "payload": payload,
                "created_at": ts.isoformat(),
            },
            ts,
        )

    def insert_chat_mirror(
        self,
        trace_id: str,
        user_id: str,
        request_payload: dict[str, Any],
        raw_response: str,
        normalized_payload: dict[str, Any],
        endpoint_used: str,
        status: str,
        created_at: datetime | None = None,
    ) -> None:
        ts = _ensure_utc(created_at)
        req_json = json.dumps(request_payload, ensure_ascii=False)
        normalized_json = json.dumps(normalized_payload, ensure_ascii=False)
        self._conn.execute(
            """
            INSERT INTO chat_mirror
                (trace_id, user_id, request_json, raw_response, normalized_json, endpoint_used, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trace_id,
                user_id,
                req_json,
                raw_response,
                normalized_json,
                endpoint_used,
                status,
                ts.isoformat(),
            ),
        )
        self._conn.commit()
        self._append_ndjson(
            {
                "type": "chat_mirror",
                "trace_id": trace_id,
                "user_id": user_id,
                "request": request_payload,
                "raw_response": raw_response,
                "normalized": normalized_payload,
                "endpoint_used": endpoint_used,
                "status": status,
                "created_at": ts.isoformat(),
            },
            ts,
        )

    def insert_retry_job(self, trace_id: str, stage: str, payload: dict[str, Any], last_error: str) -> str:
        job_id = str(uuid4())
        ts = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO retry_jobs (id, trace_id, stage, payload_json, attempts, status, last_error, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?)
            """,
            (job_id, trace_id, stage, json.dumps(payload, ensure_ascii=False), last_error, ts, ts),
        )
        self._conn.commit()
        return job_id

    def query_events(
        self,
        trace_id: str | None,
        requester_user_id: str,
        is_admin: bool,
        user_id_filter: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        params: list[Any] = []
        where: list[str] = []
        if trace_id:
            where.append("trace_id = ?")
            params.append(trace_id)
        if is_admin:
            if user_id_filter:
                where.append("user_id = ?")
                params.append(user_id_filter)
        else:
            where.append("user_id = ?")
            params.append(requester_user_id)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        query = f"""
            SELECT trace_id, user_id, session_id, stage, status, latency_ms, error_code, payload_json, created_at
            FROM trace_events
            {where_sql}
            ORDER BY id DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 1000)))
        rows = self._conn.execute(query, params).fetchall()
        output = []
        for row in rows:
            payload = json.loads(row["payload_json"] or "{}")
            output.append(
                {
                    "trace_id": row["trace_id"],
                    "user_id": row["user_id"],
                    "session_id": row["session_id"],
                    "stage": row["stage"],
                    "status": row["status"],
                    "latency_ms": row["latency_ms"],
                    "error_code": row["error_code"],
                    "payload": payload,
                    "created_at": row["created_at"],
                }
            )
        return output

    def query_mirrors(
        self,
        trace_id: str | None,
        requester_user_id: str,
        is_admin: bool,
        user_id_filter: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        params: list[Any] = []
        where: list[str] = []
        if trace_id:
            where.append("trace_id = ?")
            params.append(trace_id)
        if is_admin:
            if user_id_filter:
                where.append("user_id = ?")
                params.append(user_id_filter)
        else:
            where.append("user_id = ?")
            params.append(requester_user_id)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        query = f"""
            SELECT trace_id, user_id, request_json, raw_response, normalized_json, endpoint_used, status, created_at
            FROM chat_mirror
            {where_sql}
            ORDER BY id DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 1000)))
        rows = self._conn.execute(query, params).fetchall()
        output = []
        for row in rows:
            output.append(
                {
                    "trace_id": row["trace_id"],
                    "user_id": row["user_id"],
                    "request": json.loads(row["request_json"] or "{}"),
                    "raw_response": row["raw_response"],
                    "normalized": json.loads(row["normalized_json"] or "{}"),
                    "endpoint_used": row["endpoint_used"],
                    "status": row["status"],
                    "created_at": row["created_at"],
                }
            )
        return output

    def set_default_mappings(self, mappings: dict[str, dict[str, str]]) -> None:
        now = _utc_now_iso()
        for slot, config in mappings.items():
            self._conn.execute(
                """
                INSERT INTO mapping_defaults (slot, config_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(slot) DO UPDATE SET config_json=excluded.config_json, updated_at=excluded.updated_at
                """,
                (slot, json.dumps(config, ensure_ascii=False), now),
            )
        self._conn.commit()

    def set_user_mappings(self, user_id: str, mappings: dict[str, dict[str, str]]) -> None:
        now = _utc_now_iso()
        for slot, config in mappings.items():
            self._conn.execute(
                """
                INSERT INTO mapping_user_override (user_id, slot, config_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, slot) DO UPDATE SET config_json=excluded.config_json, updated_at=excluded.updated_at
                """,
                (user_id, slot, json.dumps(config, ensure_ascii=False), now),
            )
        self._conn.commit()

    def get_default_mappings(self) -> dict[str, dict[str, str]]:
        rows = self._conn.execute("SELECT slot, config_json FROM mapping_defaults").fetchall()
        return {row["slot"]: json.loads(row["config_json"]) for row in rows}

    def get_user_mappings(self, user_id: str) -> dict[str, dict[str, str]]:
        rows = self._conn.execute(
            "SELECT slot, config_json FROM mapping_user_override WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {row["slot"]: json.loads(row["config_json"]) for row in rows}

    def add_asset(
        self,
        user_id: str,
        slot: str,
        filename: str,
        source_relative_path: str | None,
        relative_path: str,
        size_bytes: int,
    ) -> dict[str, Any]:
        asset_id = str(uuid4())
        ts = _utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO asset_registry (
                asset_id, user_id, slot, filename, display_name, source_relative_path, relative_path, is_favorite, favorite_relative_path, favorite_model_relative_path, size_bytes, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
            """,
            (asset_id, user_id, slot, filename, filename, source_relative_path, relative_path, size_bytes, ts),
        )
        self._conn.commit()
        return {
            "asset_id": asset_id,
            "user_id": user_id,
            "slot": slot,
            "filename": filename,
            "display_name": filename,
            "source_relative_path": source_relative_path,
            "relative_path": relative_path,
            "is_favorite": False,
            "favorite_relative_path": None,
            "favorite_model_relative_path": None,
            "size_bytes": size_bytes,
            "created_at": ts,
        }

    def list_assets(self, requester_user_id: str, is_admin: bool, user_id_filter: str | None = None) -> list[dict[str, Any]]:
        if is_admin and user_id_filter:
            rows = self._conn.execute(
                "SELECT * FROM asset_registry WHERE user_id = ? ORDER BY created_at DESC",
                (user_id_filter,),
            ).fetchall()
        elif is_admin:
            rows = self._conn.execute("SELECT * FROM asset_registry ORDER BY created_at DESC").fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM asset_registry WHERE user_id = ? ORDER BY created_at DESC",
                (requester_user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        row = self._conn.execute("SELECT * FROM asset_registry WHERE asset_id = ?", (asset_id,)).fetchone()
        return dict(row) if row else None

    def update_asset(
        self,
        asset_id: str,
        *,
        display_name: str | None,
        is_favorite: bool,
        favorite_relative_path: str | None,
        favorite_model_relative_path: str | None,
    ) -> dict[str, Any] | None:
        self._conn.execute(
            """
            UPDATE asset_registry
            SET display_name = ?, is_favorite = ?, favorite_relative_path = ?, favorite_model_relative_path = ?
            WHERE asset_id = ?
            """,
            (display_name, 1 if is_favorite else 0, favorite_relative_path, favorite_model_relative_path, asset_id),
        )
        self._conn.commit()
        return self.get_asset(asset_id)

    def delete_asset(self, asset_id: str) -> None:
        self._conn.execute("DELETE FROM asset_registry WHERE asset_id = ?", (asset_id,))
        self._conn.commit()

    def cleanup(self, retention_days: int, compress_after_days: int) -> None:
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        cutoff_iso = cutoff.isoformat()
        for table in ("trace_events", "chat_mirror", "retry_jobs"):
            self._conn.execute(f"DELETE FROM {table} WHERE created_at < ?", (cutoff_iso,))
        self._conn.commit()

        compress_cutoff = datetime.now(UTC).date() - timedelta(days=compress_after_days)
        for path in self.ndjson_dir.glob("*.ndjson"):
            try:
                file_date = datetime.strptime(path.stem, "%Y-%m-%d").date()
            except ValueError:
                continue
            if file_date > compress_cutoff:
                continue
            gz_path = path.with_suffix(path.suffix + ".gz")
            with path.open("rb") as src, gzip.open(gz_path, "wb") as dst:
                dst.write(src.read())
            path.unlink(missing_ok=True)
