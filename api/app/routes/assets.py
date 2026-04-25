from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from app.security import resolve_requester


router = APIRouter(prefix="/assets", tags=["assets"])

ALLOWED_SLOTS = {"neutral", "happy", "sad", "thinking", "excited", "caring"}
MMD_MODEL_EXTENSIONS = {".pmx", ".pmd"}
MMD_MOTION_EXTENSIONS = {".vmd"}


def _asset_public(item: dict) -> dict:
    return {
        "asset_id": item["asset_id"],
        "user_id": item["user_id"],
        "slot": item["slot"],
        "filename": item["filename"],
        "size_bytes": item["size_bytes"],
        "created_at": item["created_at"],
        "url": f"/assets/vmd/file/{item['asset_id']}",
    }


def _resolve_mmd_request_path(root: Path, file_path: str) -> Path:
    requested = (root / file_path).resolve()
    if root not in requested.parents and requested != root:
        raise HTTPException(status_code=400, detail="Invalid path.")
    return requested


def _iter_mmd_models(root: Path) -> list[Path]:
    if not root.exists() or not root.is_dir():
        return []
    models = [
        item
        for item in root.rglob("*")
        if item.is_file() and item.suffix.lower() in MMD_MODEL_EXTENSIONS
    ]
    return sorted(models, key=lambda item: item.relative_to(root).as_posix().lower())


def _iter_mmd_vmds(root: Path) -> list[Path]:
    motion_root = root / "vmd"
    if not motion_root.exists() or not motion_root.is_dir():
        return []
    motions = [
        item
        for item in motion_root.rglob("*")
        if item.is_file() and item.suffix.lower() in MMD_MOTION_EXTENSIONS
    ]
    return sorted(motions, key=lambda item: item.relative_to(root).as_posix().lower())


def _encode_url_path(relative_path: str) -> str:
    return "/".join(quote(part) for part in relative_path.split("/"))


def _mmd_model_label(path: Path, root: Path) -> str:
    relative_parent = path.relative_to(root).parent
    if str(relative_parent) in {".", ""}:
        return path.stem or path.name
    return path.parent.name or path.stem or path.name


def _humanize_motion_label(name: str) -> str:
    label = re.sub(r"[_-]+", " ", name).strip()
    return re.sub(r"\s+", " ", label)


def _mmd_model_public(path: Path, root: Path) -> dict:
    relative_path = path.relative_to(root).as_posix()
    return {
        "name": path.name,
        "label": _mmd_model_label(path, root),
        "relative_path": relative_path,
        "size_bytes": path.stat().st_size,
        "url": f"/assets/mmd/{_encode_url_path(relative_path)}",
    }


def _mmd_motion_public(path: Path, root: Path) -> dict:
    relative_path = path.relative_to(root).as_posix()
    return {
        "name": path.name,
        "label": _humanize_motion_label(path.stem or path.name),
        "relative_path": relative_path,
        "size_bytes": path.stat().st_size,
        "url": f"/assets/mmd/{_encode_url_path(relative_path)}",
    }


@router.post("/vmd")
async def upload_vmd(
    request: Request,
    user_id: str = Form(...),
    slot: str = Form(...),
    file: UploadFile = File(...),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin and requester.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot upload for another user.")
    if slot not in ALLOWED_SLOTS:
        raise HTTPException(status_code=400, detail="Invalid slot.")
    if not file.filename.lower().endswith(".vmd"):
        raise HTTPException(status_code=400, detail="Only .vmd files are allowed.")

    data = await file.read()
    if len(data) > 30 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (30MB max).")

    asset_root = settings.data_dir / "storage" / "vmd" / user_id / slot
    asset_root.mkdir(parents=True, exist_ok=True)
    local_name = f"{uuid4()}.vmd"
    full_path = asset_root / local_name
    full_path.write_bytes(data)
    relative_path = str(full_path.relative_to(settings.data_dir))
    store = request.app.state.trace_store
    item = store.add_asset(
        user_id=user_id,
        slot=slot,
        filename=file.filename,
        relative_path=relative_path,
        size_bytes=len(data),
    )
    return _asset_public(item)


@router.get("/vmd")
def list_vmd_assets(
    request: Request,
    user_id: str | None = Query(default=None),
    x_user_id: str | None = Header(default=None),
):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    items = store.list_assets(
        requester_user_id=requester.user_id,
        is_admin=requester.is_admin,
        user_id_filter=user_id,
    )
    return {"items": [_asset_public(item) for item in items]}


@router.delete("/vmd/{asset_id}")
def delete_vmd_asset(asset_id: str, request: Request, x_user_id: str | None = Header(default=None)):
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    store = request.app.state.trace_store
    item = store.get_asset(asset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Asset not found.")
    if not requester.is_admin and requester.user_id != item["user_id"]:
        raise HTTPException(status_code=403, detail="Cannot delete another user's asset.")

    full_path = settings.data_dir / item["relative_path"]
    if full_path.exists():
        full_path.unlink()
    store.delete_asset(asset_id)
    return {"deleted": True, "asset_id": asset_id}


@router.get("/vmd/file/{asset_id}")
def get_vmd_asset_file(asset_id: str, request: Request):
    settings = request.app.state.settings
    store = request.app.state.trace_store
    item = store.get_asset(asset_id)
    if not item:
        raise HTTPException(status_code=404, detail="Asset not found.")
    full_path = settings.data_dir / item["relative_path"]
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="Asset file missing.")
    return FileResponse(full_path, media_type="application/octet-stream", filename=item["filename"])


@router.get("/mmd/models")
def list_mmd_models(request: Request):
    settings = request.app.state.settings
    root = settings.mmd_root_dir.resolve()
    models = _iter_mmd_models(root)
    return {
        "root_dir": str(root),
        "root_exists": root.exists() and root.is_dir(),
        "count": len(models),
        "items": [_mmd_model_public(model, root) for model in models],
    }


@router.get("/mmd/vmds")
def list_mmd_vmds(request: Request):
    settings = request.app.state.settings
    root = settings.mmd_root_dir.resolve()
    motions = _iter_mmd_vmds(root)
    motion_root = root / "vmd"
    return {
        "root_dir": str(motion_root),
        "root_exists": motion_root.exists() and motion_root.is_dir(),
        "count": len(motions),
        "items": [_mmd_motion_public(motion, root) for motion in motions],
    }


@router.get("/mmd/validate")
def validate_mmd_models(request: Request, model_path: str | None = Query(default=None)):
    settings = request.app.state.settings
    root = settings.mmd_root_dir.resolve()
    root_exists = root.exists() and root.is_dir()
    if not root_exists:
        return {
            "root_dir": str(root),
            "root_exists": False,
            "count": 0,
            "all_ok": False,
            "items": [],
            "message": "MMD root directory does not exist.",
        }

    if model_path:
        requested = _resolve_mmd_request_path(root, model_path)
        if requested.suffix.lower() not in MMD_MODEL_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Only .pmx/.pmd model files are supported.")
        if not requested.exists() or not requested.is_file():
            raise HTTPException(status_code=404, detail="MMD model not found.")
        targets = [requested]
    else:
        targets = _iter_mmd_models(root)

    items = []
    for target in targets:
        payload = _mmd_model_public(target, root)
        payload["valid"] = target.exists() and target.is_file()
        items.append(payload)

    return {
        "root_dir": str(root),
        "root_exists": True,
        "count": len(items),
        "all_ok": len(items) > 0 and all(item["valid"] for item in items),
        "items": items,
    }


@router.get("/mmd/{file_path:path}")
def serve_mmd_file(file_path: str, request: Request):
    settings = request.app.state.settings
    root = settings.mmd_root_dir.resolve()
    requested = _resolve_mmd_request_path(root, file_path)
    if not requested.exists() or not requested.is_file():
        raise HTTPException(status_code=404, detail="MMD asset not found.")
    return FileResponse(requested)
