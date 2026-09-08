import json
import pytest
from uuid import uuid4
from pathlib import Path
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routes.assets import router, V14D_GAME_TEXTURES, V14D_GAME_OCIO

@pytest.fixture
def tmp_path():
    path = Path(__file__).resolve().parents[2] / 'web' / '.scratch' / 'v14d-resource-tests' / uuid4().hex
    path.mkdir(parents=True)
    return path

def make_client(tmp_path):
    root = tmp_path / 'models'
    character = root / 'Koleda'
    preview = tmp_path / 'preview'
    character.mkdir(parents=True)
    (character / 'model.pmx').write_bytes(b'fixture model')
    for _, relative, _, _ in V14D_GAME_TEXTURES:
        p = character / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b'fixture texture')
    for _, relative in V14D_GAME_OCIO:
        p = preview / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b'{}' if p.suffix == '.json' else b'fixture ocio')
    assets = preview / 'assets'
    assets.mkdir()
    masks = [{'file': f'mask{i}.png'} for i in range(5)]
    for mask in masks:
        (assets / mask['file']).write_bytes(b'mask')
    source = {'masks': masks, 'materials': {}, 'lights': [{'type': 'AREA', 'shape': 'RECTANGLE', 'size': 1, 'sizeY': 1, 'power': 10, 'color': [1, 1, 1], 'matrix': [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]} for _ in range(6)]}
    (assets / 'manifest.json').write_text(json.dumps(source), encoding='utf-8')
    app = FastAPI()
    app.state.settings = SimpleNamespace(mmd_root_dir=root, v14d_game_assets_root=preview, v14d_game_model_relative_path='Koleda/model.pmx')
    app.include_router(router)
    return TestClient(app), assets, character

def test_masks_and_source_are_registered(tmp_path):
    client, assets, _ = make_client(tmp_path)
    data = client.get('/assets/v14d-game/manifest').json()
    assert data['available'] is True
    assert len(data['masks']) == 5
    assert client.get(data['materialSource']['url']).status_code == 200
    assert len(data['materialSource']['sha256']) == 64
    (assets / 'mask2.png').unlink()
    assert client.get('/assets/v14d-game/manifest').json()['available'] is False

def test_case_preserving_texture_and_unknown_path(tmp_path):
    client, _, character = make_client(tmp_path)
    texture_dir = character / 'textures'
    texture_dir.mkdir()
    (texture_dir / 'extra.png').write_bytes(b'actual image fixture')
    assert client.get('/assets/v14d-game/model/textures/extra.png').status_code == 200
    assert client.get('/assets/v14d-game/model/private.txt').status_code == 404
    assert client.get('/assets/v14d-game/model/textures/%2e%2e/%2e%2e/secret').status_code in (400, 404)
