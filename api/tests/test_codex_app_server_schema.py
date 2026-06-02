import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
API_SCHEMA_ROOT = REPO_ROOT / "api" / "app" / "codex_schema"
WEB_SCHEMA_ROOT = REPO_ROOT / "web" / "src" / "codex-schema"


def _schema_text() -> str:
    bundle = API_SCHEMA_ROOT / "generated" / "codex_app_server_protocol.schemas.json"
    assert bundle.exists(), "Run scripts/generate-codex-app-server-schema.ps1 to pin the Codex schema bundle"
    return bundle.read_text(encoding="utf-8")


def test_codex_app_server_schema_bundle_is_pinned_for_api_and_web():
    api_bundle = API_SCHEMA_ROOT / "generated" / "codex_app_server_protocol.schemas.json"
    web_index = WEB_SCHEMA_ROOT / "generated" / "index.ts"
    manifest = API_SCHEMA_ROOT / "generated" / "manifest.json"

    assert api_bundle.exists()
    assert web_index.exists()
    assert manifest.exists()

    data = json.loads(api_bundle.read_text(encoding="utf-8"))
    assert data["title"] == "CodexAppServerProtocol"
    assert json.loads(manifest.read_text(encoding="utf-8"))["codex_cli_version"].startswith("codex-cli ")


def test_codex_method_constants_match_pinned_schema():
    from app.codex_schema.methods import (
        CLIENT_REQUEST_METHODS,
        CLIENT_NOTIFICATION_METHODS,
        SERVER_NOTIFICATION_METHODS,
        SERVER_REQUEST_METHODS,
    )

    schema = _schema_text()
    required = {
        "initialize",
        "initialized",
        "thread/start",
        "turn/start",
        "turn/interrupt",
        "turn/completed",
        "item/agentMessage/delta",
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "execCommandApproval",
        "applyPatchApproval",
        "process/exited",
    }

    for method in required:
        assert f'"{method}"' in schema

    assert CLIENT_REQUEST_METHODS.INITIALIZE == "initialize"
    assert CLIENT_REQUEST_METHODS.THREAD_START == "thread/start"
    assert CLIENT_REQUEST_METHODS.TURN_START == "turn/start"
    assert CLIENT_NOTIFICATION_METHODS.INITIALIZED == "initialized"
    assert SERVER_NOTIFICATION_METHODS.TURN_COMPLETED == "turn/completed"
    assert SERVER_NOTIFICATION_METHODS.PROCESS_EXITED == "process/exited"
    assert SERVER_REQUEST_METHODS.COMMAND_APPROVAL == "item/commandExecution/requestApproval"
    assert SERVER_REQUEST_METHODS.LEGACY_APPLY_PATCH_APPROVAL == "applyPatchApproval"
