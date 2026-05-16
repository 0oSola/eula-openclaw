from pathlib import Path
from uuid import uuid4
import struct
from urllib.parse import quote

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.routes import config as config_routes


def _make_vmd_bytes(frames: list[tuple[str, tuple[float, float, float], tuple[float, float, float, float]]]) -> bytes:
    header = b"Vocaloid Motion Data 0002".ljust(30, b"\x00")
    model_name = b"test-model".ljust(20, b"\x00")
    data = bytearray(header + model_name + struct.pack("<I", len(frames)))
    for index, (name, position, rotation) in enumerate(frames):
        encoded_name = name.encode("cp932")[:15].ljust(15, b"\x00")
        data.extend(encoded_name)
        data.extend(struct.pack("<I", index))
        data.extend(struct.pack("<3f", *position))
        data.extend(struct.pack("<4f", *rotation))
        data.extend(bytes(64))
    return bytes(data)


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_mapping_resolution_and_trace_acl():
    case_dir = _make_case_dir()
    app = create_app(
        {
            "data_dir": str(case_dir),
            "admin_user_ids": ["admin-1"],
        }
    )
    client = TestClient(app)

    set_defaults = client.put(
        "/config/mapping/default",
        json={
            "mappings": {
                "happy": {"kind": "procedural", "value": "wave"},
                "sad": {"kind": "procedural", "value": "comfort"},
            }
        },
        headers={"x-user-id": "admin-1"},
    )
    assert set_defaults.status_code == 200

    set_override = client.put(
        "/config/mapping/user/u1",
        json={"mappings": {"happy": {"kind": "procedural", "value": "cheer"}}},
        headers={"x-user-id": "u1"},
    )
    assert set_override.status_code == 200

    resolved = client.get("/config/mapping/resolved/u1", headers={"x-user-id": "u1"})
    assert resolved.status_code == 200
    body = resolved.json()
    assert body["mappings"]["happy"]["value"] == "cheer"
    assert body["mappings"]["sad"]["value"] == "comfort"

    denied = client.get("/trace/events?user_id=u2", headers={"x-user-id": "u1"})
    assert denied.status_code == 200
    # non-admin cannot query other users
    assert denied.json()["requester"]["effective_user_id"] == "u1"


def test_settings_default_openclaw_gateway_values(monkeypatch):
    for key in (
        "OPENCLAW_BASE_URL",
        "OPENCLAW_TOKEN",
        "OPENCLAW_MODEL",
        "OPENCLAW_AGENT_ID",
        "OPENCLAW_MESSAGE_CHANNEL",
        "OPENCLAW_PROXY_URL",
        "OPENCLAW_VERIFY_SSL",
        "OPENCLAW_TIMEOUT_SECONDS",
    ):
        monkeypatch.delenv(key, raising=False)

    monkeypatch.setattr("app.config._read_env_file", lambda _: {}, raising=False)

    case_dir = _make_case_dir()
    settings = Settings.from_env(
        {
            "data_dir": str(case_dir / "data"),
            "mmd_root_dir": str(case_dir / "mmd"),
            "admin_user_ids": [],
        }
    )

    assert settings.openclaw_base_url == "http://127.0.0.1:18789"
    assert settings.openclaw_agent_id == "main"
    assert settings.openclaw_model == ""
    assert settings.openclaw_message_channel == "feishu"
    assert settings.openclaw_proxy_url == ""
    assert settings.openclaw_verify_ssl is True
    assert settings.openclaw_timeout_seconds == 120
    assert settings.realtime_voice_enabled is False
    assert settings.realtime_voice_max_queue_size == 3
    assert settings.realtime_voice_chunk_timeout_seconds == 30
    assert settings.realtime_voice_circuit_failure_threshold == 5
    assert settings.realtime_voice_circuit_window_seconds == 60
    assert settings.realtime_voice_circuit_open_seconds == 120
    assert settings.realtime_voice_max_queue_wait_seconds == 120
    assert settings.openclaw_stream_mode == "http_sse"




def test_settings_loads_openclaw_values_from_dot_env(monkeypatch):
    for key in (
        "OPENCLAW_BASE_URL",
        "OPENCLAW_TOKEN",
        "OPENCLAW_MODEL",
        "OPENCLAW_AGENT_ID",
        "OPENCLAW_MESSAGE_CHANNEL",
        "OPENCLAW_PROXY_URL",
        "OPENCLAW_VERIFY_SSL",
    ):
        monkeypatch.delenv(key, raising=False)

    monkeypatch.setattr(
        "app.config._read_env_file",
        lambda _: {
            "OPENCLAW_BASE_URL": "http://10.0.0.8:18789",
            "OPENCLAW_AGENT_ID": "beta",
            "OPENCLAW_MODEL": "provider/model",
            "OPENCLAW_MESSAGE_CHANNEL": "custom-channel",
            "OPENCLAW_PROXY_URL": "http://127.0.0.1:7897",
            "OPENCLAW_VERIFY_SSL": "false",
        },
        raising=False,
    )

    case_dir = _make_case_dir()
    settings = Settings.from_env(
        {
            "data_dir": str(case_dir / "data"),
            "mmd_root_dir": str(case_dir / "mmd"),
            "admin_user_ids": [],
        }
    )

    assert settings.openclaw_base_url == "http://10.0.0.8:18789"
    assert settings.openclaw_agent_id == "beta"
    assert settings.openclaw_model == "provider/model"
    assert settings.openclaw_message_channel == "custom-channel"
    assert settings.openclaw_proxy_url == "http://127.0.0.1:7897"
    assert settings.openclaw_verify_ssl is False


def test_healthz_openclaw_returns_diagnostic_payload():
    case_dir = _make_case_dir()
    app = create_app({"data_dir": str(case_dir), "admin_user_ids": []})

    class StubOpenClawClient:
        async def diagnose(self):
            return {
                "ok": True,
                "base_url": "http://127.0.0.1:18789",
                "agent_id": "main",
                "model": "openclaw/default",
                "proxy_configured": False,
                "verify_ssl": True,
                "scope_header_enabled": True,
                "probes": {
                    "models": {"ok": True, "status_code": 200, "detail": "ok", "endpoint": "/v1/models"},
                    "responses": {"ok": True, "status_code": 200, "detail": "ok", "endpoint": "/v1/responses"},
                    "chat_completions": {
                        "ok": None,
                        "status_code": None,
                        "detail": "not_run",
                        "endpoint": "/v1/chat/completions",
                    },
                },
                "recommendations": [],
            }

        async def close(self):
            return None

    app.state.openclaw_client = StubOpenClawClient()
    client = TestClient(app)

    response = client.get("/healthz/openclaw")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["scope_header_enabled"] is True
    assert payload["probes"]["models"]["status_code"] == 200
    assert payload["probes"]["responses"]["endpoint"] == "/v1/responses"


def test_openclaw_config_route_reads_saved_env_values(monkeypatch):
    case_dir = _make_case_dir()
    env_path = case_dir / ".env"
    monkeypatch.setattr(config_routes, "_openclaw_env_path", lambda: env_path)
    env_path.write_text(
        "\n".join(
            [
                "OPENCLAW_BASE_URL=http://10.0.0.8:18789/",
                "OPENCLAW_TOKEN=secret-token",
                "OPENCLAW_AGENT_ID=beta",
                "OPENCLAW_MODEL=provider/model",
                "OPENCLAW_MESSAGE_CHANNEL=custom-channel",
                "OPENCLAW_PROXY_URL=http://127.0.0.1:7897",
                "OPENCLAW_VERIFY_SSL=false",
                "OPENCLAW_TIMEOUT_SECONDS=42",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    app = create_app({"data_dir": str(case_dir), "admin_user_ids": ["admin-1"]})
    client = TestClient(app)

    response = client.get("/config/openclaw", headers={"x-user-id": "admin-1"})
    assert response.status_code == 200
    assert response.json() == {
        "base_url": "http://10.0.0.8:18789",
        "token_configured": True,
        "agent_id": "beta",
        "model": "provider/model",
        "message_channel": "custom-channel",
        "proxy_url": "http://127.0.0.1:7897",
        "verify_ssl": False,
        "timeout_seconds": 42,
    }


def test_openclaw_config_route_persists_env_and_preserves_existing_token(monkeypatch):
    case_dir = _make_case_dir()
    env_path = case_dir / ".env"
    monkeypatch.setattr(config_routes, "_openclaw_env_path", lambda: env_path)
    env_path.write_text(
        "# existing comment\nOPENCLAW_TOKEN=keep-me\nUNRELATED_KEY=stay-put\n",
        encoding="utf-8",
    )

    app = create_app({"data_dir": str(case_dir), "admin_user_ids": ["admin-1"]})
    client = TestClient(app)

    response = client.put(
        "/config/openclaw",
        headers={"x-user-id": "admin-1"},
        json={
            "base_url": "http://127.0.0.1:18789/",
            "token": None,
            "agent_id": "main",
            "model": "openclaw/default",
            "message_channel": "feishu",
            "proxy_url": "",
            "verify_ssl": True,
            "timeout_seconds": 15,
        },
    )
    assert response.status_code == 200
    assert response.json()["token_configured"] is True
    assert response.json()["restart_required"] is False
    assert response.json()["message"] == "Saved to api/.env and reloaded in the running API."

    saved = env_path.read_text(encoding="utf-8")
    assert "# existing comment" in saved
    assert "UNRELATED_KEY=stay-put" in saved
    assert "OPENCLAW_TOKEN=keep-me" in saved
    assert "OPENCLAW_BASE_URL=http://127.0.0.1:18789" in saved
    assert "OPENCLAW_MODEL=openclaw/default" in saved
    assert "OPENCLAW_VERIFY_SSL=true" in saved
    assert "OPENCLAW_TIMEOUT_SECONDS=15" in saved
    assert app.state.settings.openclaw_base_url == "http://127.0.0.1:18789"
    assert app.state.settings.openclaw_token == "keep-me"
    assert app.state.settings.openclaw_model == "openclaw/default"
    assert app.state.openclaw_client.base_url == "http://127.0.0.1:18789"
    assert app.state.openclaw_client.token == "keep-me"
    assert app.state.openclaw_client.model == "openclaw/default"


def test_vmd_upload_and_list():
    case_dir = _make_case_dir()
    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(case_dir / "mmd"),
        }
    )
    client = TestClient(app)

    upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        data={
            "user_id": "u1",
            "slot": "happy",
            "source_relative_path": "Idle Animations Pack - Copy/Air Scent Idle Animation/Smelling Something in the Air.vmd",
        },
        files={"file": ("wave.vmd", b"Vocaloid Motion Data 0002", "application/octet-stream")},
    )
    assert upload.status_code == 200
    item = upload.json()
    assert item["slot"] == "happy"
    assert item["filename"] == "wave.vmd"
    assert (
        item["source_relative_path"]
        == "Idle Animations Pack - Copy/Air Scent Idle Animation/Smelling Something in the Air.vmd"
    )

    listed = client.get("/assets/vmd?user_id=u1", headers={"x-user-id": "u1"})
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1
    assert (
        listed.json()["items"][0]["source_relative_path"]
        == "Idle Animations Pack - Copy/Air Scent Idle Animation/Smelling Something in the Air.vmd"
    )


def test_usage_vmd_folder_name_uses_model_parent_folder_name():
    from app.routes.assets import _usage_vmd_folder_name_for_model

    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    model_rel = Path("优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx")
    model_abs = mmd_root / model_rel
    model_abs.parent.mkdir(parents=True, exist_ok=True)
    model_abs.write_bytes(b"pmx")

    assert _usage_vmd_folder_name_for_model(model_abs, mmd_root) == "优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]"


def test_vmd_asset_can_be_renamed_and_favorited_into_character_usage_folder():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    model_rel = Path("Role/NemesisDefault.pmx")
    model_abs = mmd_root / model_rel
    model_abs.parent.mkdir(parents=True, exist_ok=True)
    model_abs.write_bytes(b"pmx")

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        data={"user_id": "u1", "slot": "happy"},
        files={"file": ("wave.vmd", b"Vocaloid Motion Data 0002", "application/octet-stream")},
    )
    assert upload.status_code == 200
    asset = upload.json()

    renamed = client.patch(
        f"/assets/vmd/{asset['asset_id']}",
        headers={"x-user-id": "u1"},
        json={
            "display_name": "Greeting Loop",
            "favorite": True,
            "model_relative_path": model_rel.as_posix(),
        },
    )
    assert renamed.status_code == 200
    payload = renamed.json()
    assert payload["display_name"] == "Greeting Loop.vmd"
    assert payload["is_favorite"] is True
    assert payload["favorite_relative_path"] == "usage/vmd/Role[动作]/Greeting Loop.vmd"
    assert payload["favorite_model_relative_path"] == model_rel.as_posix()

    favorite_file = mmd_root / "usage" / "vmd" / "Role[动作]" / "Greeting Loop.vmd"
    assert favorite_file.exists()
    assert favorite_file.read_bytes() == b"Vocaloid Motion Data 0002"

    listed = client.get("/assets/vmd?user_id=u1", headers={"x-user-id": "u1"})
    assert listed.status_code == 200
    listed_item = listed.json()["items"][0]
    assert listed_item["display_name"] == "Greeting Loop.vmd"
    assert listed_item["is_favorite"] is True
    assert listed_item["favorite_model_relative_path"] == model_rel.as_posix()

    motions = client.get("/assets/mmd/vmds")
    assert motions.status_code == 200
    relative_paths = {item["relative_path"] for item in motions.json()["items"]}
    assert "usage/vmd/Role[动作]/Greeting Loop.vmd" in relative_paths

    unfavorited = client.patch(
        f"/assets/vmd/{asset['asset_id']}",
        headers={"x-user-id": "u1"},
        json={"favorite": False},
    )
    assert unfavorited.status_code == 200
    unfavorited_payload = unfavorited.json()
    assert unfavorited_payload["is_favorite"] is False
    assert unfavorited_payload["favorite_relative_path"] is None
    assert unfavorited_payload["favorite_model_relative_path"] is None


def test_legacy_favorite_vmd_assets_backfill_model_association_from_usage_folder():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    model_rel = Path("优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx")
    model_abs = mmd_root / model_rel
    model_abs.parent.mkdir(parents=True, exist_ok=True)
    model_abs.write_bytes(b"pmx")

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        data={"user_id": "u1", "slot": "happy"},
        files={"file": ("wave.vmd", b"Vocaloid Motion Data 0002", "application/octet-stream")},
    )
    assert upload.status_code == 200
    asset = upload.json()

    favorite_dir = mmd_root / "usage" / "vmd" / "优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]"
    favorite_dir.mkdir(parents=True, exist_ok=True)
    favorite_file = favorite_dir / "Legacy Wave.vmd"
    favorite_file.write_bytes(b"Vocaloid Motion Data 0002")

    store = app.state.trace_store
    updated = store.update_asset(
        asset["asset_id"],
        display_name="Legacy Wave.vmd",
        is_favorite=True,
        favorite_relative_path="usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/Legacy Wave.vmd",
        favorite_model_relative_path=None,
    )
    assert updated is not None

    listed = client.get("/assets/vmd?user_id=u1", headers={"x-user-id": "u1"})
    assert listed.status_code == 200
    listed_item = listed.json()["items"][0]
    assert listed_item["is_favorite"] is True
    assert listed_item["favorite_model_relative_path"] == model_rel.as_posix()


def test_usage_vmd_files_are_synced_into_asset_registry_by_parent_folder():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    model_rel = Path("优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx")
    model_abs = mmd_root / model_rel
    model_abs.parent.mkdir(parents=True, exist_ok=True)
    model_abs.write_bytes(b"pmx")

    favorite_rel = Path("usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/回答-自信.vmd")
    favorite_abs = mmd_root / favorite_rel
    favorite_abs.parent.mkdir(parents=True, exist_ok=True)
    favorite_abs.write_bytes(b"Vocaloid Motion Data 0002")

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    listed = client.get("/assets/vmd?user_id=u1", headers={"x-user-id": "u1"})
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["filename"] == "回答-自信.vmd"
    assert item["display_name"] == "回答-自信.vmd"
    assert item["slot"] == "neutral"
    assert item["is_favorite"] is True
    assert item["favorite_relative_path"] == favorite_rel.as_posix()
    assert item["favorite_model_relative_path"] == model_rel.as_posix()

    stored_items = app.state.trace_store.list_assets(requester_user_id="u1", is_admin=False, user_id_filter="u1")
    assert len(stored_items) == 1
    assert stored_items[0]["favorite_relative_path"] == favorite_rel.as_posix()

    fetched = client.get(item["url"])
    assert fetched.status_code == 200
    assert fetched.content == b"Vocaloid Motion Data 0002"


def test_vmd_assets_report_companion_motion_safety():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    model_rel = Path("Role/NemesisDefault.pmx")
    model_abs = mmd_root / model_rel
    model_abs.parent.mkdir(parents=True, exist_ok=True)
    model_abs.write_bytes(b"pmx")

    favorite_dir = mmd_root / "usage" / "vmd" / "Role[动作]"
    favorite_dir.mkdir(parents=True, exist_ok=True)
    safe_motion = favorite_dir / "Upper Body.vmd"
    safe_motion.write_bytes(_make_vmd_bytes([("上半身", (0.0, 0.0, 0.0), (0.05, 0.0, 0.0, 1.0))]))
    unsafe_motion = favorite_dir / "Leg Lift.vmd"
    unsafe_motion.write_bytes(_make_vmd_bytes([("右足ＩＫ", (0.0, 1.2, 0.0), (0.0, 0.0, 0.0, 1.0))]))

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    listed = client.get("/assets/vmd?user_id=u1", headers={"x-user-id": "u1"})
    assert listed.status_code == 200
    items = {item["filename"]: item for item in listed.json()["items"]}

    assert items["Upper Body.vmd"]["motion_profile"]["companion_safe"] is True
    assert items["Leg Lift.vmd"]["motion_profile"]["companion_safe"] is False
    assert items["Leg Lift.vmd"]["motion_profile"]["lower_body_track_count"] == 1
    assert items["Leg Lift.vmd"]["motion_profile"]["lower_body_motion_score"] == 1.2


def test_mmd_models_list_and_serving_url():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    model_rel = Path("绾崇編瑗夸笣路琛嶅厜鍘熺毊/GirlsFrontline NemesisGnosisDefault.pmx")
    model_abs = mmd_root / model_rel
    model_abs.parent.mkdir(parents=True, exist_ok=True)
    model_abs.write_bytes(b"pmx")
    root_model_rel = Path("root_idle.pmd")
    root_model_abs = mmd_root / root_model_rel
    root_model_abs.write_bytes(b"pmd")

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    listed = client.get("/assets/mmd/models")
    assert listed.status_code == 200
    payload = listed.json()
    assert payload["count"] == 2
    items = {item["relative_path"]: item for item in payload["items"]}

    item = items[model_rel.as_posix()]
    assert item["name"] == "GirlsFrontline NemesisGnosisDefault.pmx"
    assert item["label"] == "绾崇編瑗夸笣路琛嶅厜鍘熺毊"
    assert item["relative_path"] == model_rel.as_posix()
    assert item["url"].startswith("/assets/mmd/")
    assert item["url"].startswith(f"/assets/mmd/{quote(model_rel.parts[0])}/")

    root_item = items[root_model_rel.as_posix()]
    assert root_item["name"] == "root_idle.pmd"
    assert root_item["label"] == "root_idle"

    fetched = client.get(item["url"])
    assert fetched.status_code == 200
    assert fetched.content == b"pmx"


def test_mmd_vmds_list_and_serving_url():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    motion_rel = Path("vmd/idle/standing_idle.vmd")
    motion_abs = mmd_root / motion_rel
    motion_abs.parent.mkdir(parents=True, exist_ok=True)
    motion_abs.write_bytes(b"vmd")
    ignored_zip = mmd_root / "vmd/idle/pack.zip"
    ignored_zip.write_bytes(b"zip")

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    listed = client.get("/assets/mmd/vmds")
    assert listed.status_code == 200
    payload = listed.json()
    assert payload["count"] == 1
    items = {item["relative_path"]: item for item in payload["items"]}

    item = items[motion_rel.as_posix()]
    assert item["name"] == "standing_idle.vmd"
    assert item["label"] == "standing idle"
    assert item["relative_path"] == motion_rel.as_posix()
    assert item["url"].startswith("/assets/mmd/")
    assert item["url"].endswith("standing_idle.vmd")

    fetched = client.get(item["url"])
    assert fetched.status_code == 200
    assert fetched.content == b"vmd"


def test_mmd_validate_all_models():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    a = mmd_root / "A/idle.pmx"
    b = mmd_root / "B/walk.pmd"
    a.parent.mkdir(parents=True, exist_ok=True)
    b.parent.mkdir(parents=True, exist_ok=True)
    a.write_bytes(b"a")
    b.write_bytes(b"b")

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    validated = client.get("/assets/mmd/validate")
    assert validated.status_code == 200
    payload = validated.json()
    assert payload["root_exists"] is True
    assert payload["count"] == 2
    assert payload["all_ok"] is True
    assert all(item["valid"] is True for item in payload["items"])


def test_mmd_validate_single_model_and_missing_path():
    case_dir = _make_case_dir()
    mmd_root = case_dir / "mmd"
    model_rel = Path("Role/main.pmx")
    model_abs = mmd_root / model_rel
    model_abs.parent.mkdir(parents=True, exist_ok=True)
    model_abs.write_bytes(b"main")

    app = create_app(
        {
            "data_dir": str(case_dir / "data"),
            "admin_user_ids": [],
            "mmd_root_dir": str(mmd_root),
        }
    )
    client = TestClient(app)

    validated = client.get("/assets/mmd/validate", params={"model_path": model_rel.as_posix()})
    assert validated.status_code == 200
    payload = validated.json()
    assert payload["count"] == 1
    assert payload["items"][0]["relative_path"] == model_rel.as_posix()
    assert payload["all_ok"] is True

    missing = client.get("/assets/mmd/validate", params={"model_path": "Role/missing.pmx"})
    assert missing.status_code == 404




