# MMD VMD and Camera Storage Spec

Date: 2026-04-29

This document records the storage and lookup contract for MMD usage VMD assets, model favorite VMD association, and advanced camera snapshots.

## Scope

This spec covers:

- Importing and discovering VMD files under `MMD/usage/vmd`.
- Persisting VMD asset metadata in `asset_registry`.
- Associating favorited VMD assets with the current MMD model.
- Persisting advanced camera snapshots for the active favorite VMD or render pipeline.
- Reading saved camera snapshots back into the Three.js MMD stage.

It does not change PMX/PMD model loading, VMD playback semantics, material tuning, or render-pipeline selection.

## VMD Directory Matching

Usage VMD files are matched by the model file's parent folder name.

For a model:

```text
MMD/<model-parent>/<model-file>.pmx
```

The matching usage VMD directory is:

```text
MMD/usage/vmd/<model-parent>[动作]/
```

Example:

```text
MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx
MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/回答-自信.vmd
```

The model association for that VMD is:

```text
favorite_model_relative_path = 优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx
favorite_relative_path = usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/回答-自信.vmd
```

The matching rule must not use the PMX filename, UI label, display name, or any generated model label when the model lives inside a parent folder. Root-level model files may fall back to the model stem because they have no meaningful parent folder.

## VMD DB Persistence

The API is responsible for making usage VMD files visible to the web app through `asset_registry`.

When `/assets/vmd` is requested, the backend scans:

```text
MMD/usage/vmd/**/*.vmd
```

For each matched usage VMD:

- Infer `favorite_model_relative_path` by matching the VMD parent directory to `<model-parent>[动作]`.
- Write or update one DB row in `asset_registry` for the requesting user.
- Use `favorite_relative_path` as the stable dedupe key per user.
- Do not create duplicate DB rows for the same `(user_id, favorite_relative_path)`.
- Store usage-discovered VMDs as favorites by default.

Default fields for usage-discovered VMD assets:

```json
{
  "slot": "neutral",
  "filename": "<vmd filename>",
  "display_name": "<vmd filename>",
  "source_relative_path": "usage/vmd/<model-parent>[动作]/<vmd filename>",
  "relative_path": "usage/vmd/<model-parent>[动作]/<vmd filename>",
  "is_favorite": true,
  "favorite_relative_path": "usage/vmd/<model-parent>[动作]/<vmd filename>",
  "favorite_model_relative_path": "<model-parent>/<model-file>.pmx"
}
```

Uploaded VMD assets still store the uploaded file under API storage first. When favorited for a model, the backend copies the uploaded file into:

```text
MMD/usage/vmd/<model-parent>[动作]/<display-name>.vmd
```

and updates the same favorite fields in `asset_registry`.

## VMD File Reads

VMD playback URLs use:

```text
/assets/vmd/file/{asset_id}
```

The file resolver first checks the API data storage path. If that file is not present, it falls back to the MMD root path referenced by either:

```text
relative_path
favorite_relative_path
```

This allows DB rows created from existing `MMD/usage/vmd` files to play directly without copying those files into API storage.

## Favorite VMD Selection

The companion UI treats a VMD as a current-model favorite only when:

```text
asset.is_favorite === true
asset.favorite_model_relative_path === selectedModel.relative_path
```

Only current-model favorite assets are eligible for automatic favorite loops and favorite-linked camera storage.

When a user previews a favorite VMD, the UI records the active VMD asset id. Built-in motions, procedural interactions, model switching, and reset clear the active VMD asset id so camera saves cannot accidentally attach to the wrong favorite.

## Camera Snapshot Shape

Camera snapshots are stored in the web session with this shape:

```json
{
  "fov": 33,
  "position": [0, 9.2, 21.6],
  "target": [0, 7.9, 0],
  "locked": false
}
```

Numeric values are rounded before persistence to avoid floating point tails.

The default `genshin` camera starts unlocked:

```json
{
  "fov": 33,
  "position": [0, 9.2, 21.6],
  "target": [0, 7.9, 0],
  "locked": false
}
```

Saving a camera does not lock the camera. The save action captures the current camera state with `captureCamera()`, persists it with `locked: false`, and keeps OrbitControls enabled.

The UI logs the final saved snapshot to the browser console:

```js
console.info("[mmd-camera] saved snapshot", snapshot);
```

## Camera Storage Keys

Camera snapshots are stored in `mmd_companion_session_v1` localStorage.

When a current-model favorite VMD is active, save the camera under:

```text
session.mmdCameraByFavoriteVmd["<pipeline>::<encoded model relative path>::<encoded vmd asset id>"]
```

Example:

```text
genshin::Eula_by_Genshin%2FEula.pmx::asset-1
```

When no current-model favorite VMD is active, fall back to pipeline-level storage:

```text
session.mmdCamera[renderPipeline]
```

Read precedence:

1. Active favorite VMD camera key in `session.mmdCameraByFavoriteVmd`.
2. Current `renderPipeline` camera in `session.mmdCamera`.
3. Runtime presentation default.

Reset removes only the active key:

- If an active favorite VMD key exists, delete that entry from `mmdCameraByFavoriteVmd`.
- Otherwise delete the current pipeline entry from `mmdCamera`.

## Runtime Application

The React stage passes the selected `cameraSnapshot` into the MMD runtime.

The runtime applies the snapshot before camera setup so saved `fov`, `position`, `target`, and `locked` are present in presentation config before OrbitControls are initialized.

The snapshot `locked` field must be preserved exactly when present:

```js
locked: typeof snapshot?.locked === "boolean" ? snapshot.locked : Boolean(fallbackCamera.locked)
```

This prevents the default unlocked camera from overwriting an explicitly locked or unlocked saved snapshot.

## Verification Coverage

Backend coverage:

- `test_usage_vmd_folder_name_uses_model_parent_folder_name`
- `test_usage_vmd_files_are_synced_into_asset_registry_by_parent_folder`
- `test_legacy_favorite_vmd_assets_backfill_model_association_from_usage_folder`
- `test_vmd_asset_can_be_renamed_and_favorited_into_character_usage_folder`

Runtime coverage:

- `stage presentation config keeps classic untouched while genshin now reuses the transparent classic framing`
- `setupCamera keeps genshin at the screenshot MMD framing without locking controls by default`
- `runtime camera controls can be unlocked, moved, captured, and locked again`
- `setupScene applies a saved genshin camera snapshot before camera setup`

Browser coverage:

- `advanced panel can unlock and save the active favorite VMD camera @smoke`

Expected verification commands:

```powershell
python -m pytest api/tests -q
npm --prefix web run check:basic
npm --prefix web run build
cd web; node --test tests/mmd-render-runtime.test.mjs
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:<port>'; npx playwright test tests/e2e/app-routes-smoke.spec.ts --reporter=list
```
