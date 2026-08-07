from pathlib import Path

from test_message_service_v2 import _client, _make_case_dir


CANONICAL_FOLDER = "优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]"


def test_only_canonical_eula_folder_is_favorite_and_it_is_copied_to_builtin_library():
    mmd_root = _make_case_dir() / "MMD"
    client, app = _client(app_overrides={"mmd_root_dir": str(mmd_root)})
    model = mmd_root / "优菈_by_原神_339146e6e418d79e85a515b26414c0b0" / "优菈.pmx"
    model.parent.mkdir(parents=True, exist_ok=True)
    model.write_bytes(b"pmx")

    canonical = mmd_root / "usage" / "vmd" / CANONICAL_FOLDER / "00_idle_loop" / "idle.vmd"
    canonical.parent.mkdir(parents=True, exist_ok=True)
    canonical.write_bytes(b"Vocaloid Motion Data 0002")

    legacy = app.state.trace_store.add_asset(
        user_id="u1",
        slot="neutral",
        filename="legacy.vmd",
        source_relative_path="usage/vmd/其他角色[动作]/legacy.vmd",
        relative_path="usage/vmd/其他角色[动作]/legacy.vmd",
        size_bytes=1,
    )
    app.state.trace_store.update_asset(
        legacy["asset_id"],
        display_name="legacy.vmd",
        is_favorite=True,
        favorite_relative_path="usage/vmd/其他角色[动作]/legacy.vmd",
        favorite_model_relative_path="其他角色/model.pmx",
    )
    stale_duplicate = app.state.trace_store.add_asset(
        user_id="u1",
        slot="neutral",
        filename="stale.vmd",
        source_relative_path="storage/vmd/u1/neutral/stale.vmd",
        relative_path="storage/vmd/u1/neutral/stale.vmd",
        size_bytes=1,
    )
    app.state.trace_store.update_asset(
        stale_duplicate["asset_id"],
        display_name="stale.vmd",
        is_favorite=True,
        favorite_relative_path=f"usage/vmd/{CANONICAL_FOLDER}/00_idle_loop/missing.vmd",
        favorite_model_relative_path="优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx",
    )

    response = client.get("/assets/vmd", headers={"x-user-id": "u1"})

    assert response.status_code == 200
    items = response.json()["items"]
    canonical_item = next(
        item
        for item in items
        if item["source_relative_path"] == f"usage/vmd/{CANONICAL_FOLDER}/00_idle_loop/idle.vmd"
    )
    builtin_item = next(
        item
        for item in items
        if item["source_relative_path"] == "usage/vmd/_builtin/00_idle_loop/idle.vmd"
    )
    legacy_item = next(item for item in items if item["asset_id"] == legacy["asset_id"])
    stale_item = next(item for item in items if item["asset_id"] == stale_duplicate["asset_id"])

    assert canonical_item["is_favorite"] is True
    assert canonical_item["favorite_relative_path"].startswith(f"usage/vmd/{CANONICAL_FOLDER}/")
    assert builtin_item["is_favorite"] is False
    assert legacy_item["is_favorite"] is False
    assert stale_item["is_favorite"] is False
    assert (mmd_root / "usage" / "vmd" / "_builtin" / "00_idle_loop" / "idle.vmd").exists()
