from pathlib import Path
from uuid import uuid4
from urllib.parse import quote

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def _make_case_dir() -> Path:
    path = Path("D:/workspace/MMD project/api/tests_runtime") / uuid4().hex
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


def test_vmd_upload_and_list():
    case_dir = _make_case_dir()
    app = create_app({"data_dir": str(case_dir), "admin_user_ids": []})
    client = TestClient(app)

    upload = client.post(
        "/assets/vmd",
        headers={"x-user-id": "u1"},
        data={"user_id": "u1", "slot": "happy"},
        files={"file": ("wave.vmd", b"Vocaloid Motion Data 0002", "application/octet-stream")},
    )
    assert upload.status_code == 200
    item = upload.json()
    assert item["slot"] == "happy"
    assert item["filename"] == "wave.vmd"

    listed = client.get("/assets/vmd?user_id=u1", headers={"x-user-id": "u1"})
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1


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




