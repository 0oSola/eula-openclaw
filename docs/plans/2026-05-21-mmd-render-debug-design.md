# MMD Render Debug Design

Date: 2026-05-21

## Goal

Add a render-focused debug mode for `/companion` so MMD visual effects can be inspected and tuned without the chat UI, podcast rail, command bar, or normal companion panels getting in the way.

The first version focuses on rendering diagnostics and safe rendering controls. It is not a general MMD animation editor, VMD timeline editor, material authoring tool, or backend-managed preset system.

## Confirmed Decisions

- Debug scope: rendering effects.
- First version style: broad visibility with only safe writable controls.
- Entry point: a `渲染调试` switch in the existing advanced panel.
- Opening behavior: enabling render debug immediately enters a focus layout.
- Focus layout keeps only the MMD stage, render debug UI, and a minimal exit control.
- Hidden while focused: Chatbox, Daily Podcast/right rail content, command bar, normal session panels, and non-debug overlays.
- Presets are manual only. Nothing persists unless the user saves a render config.
- Preset scope: `modelPath + renderPipeline`.
- Storage: browser `localStorage`, with JSON export/import.
- Rollback: provide a safe `恢复默认` action that returns to the current runtime default render parameters.

## Layout

`/companion` owns a render debug mode state:

```ts
type MmdRenderDebugMode = {
  enabled: boolean;
  focus: boolean;
};
```

In version 1, `focus` is always `true` when `enabled` becomes true. The split state is still useful because it keeps the layout decision explicit and leaves room for a later non-focused drawer mode if needed.

The focus layout must not unmount `MMDStage`. It should change the visible shell around the existing stage instance so the model, active VMD, camera, and runtime state are preserved when entering and exiting debug mode. The MMD stage should expand to the available viewport. The debug UI should appear as a narrow right panel or collapsible side panel with stable dimensions.

Exit behavior:

- `退出调试` turns `enabled=false`.
- The normal companion layout is restored.
- Temporary render overrides can remain applied until reset or replaced, but they are not automatically saved.
- Chat/session/MMD interaction state must not be reset by entering or leaving the focus layout.

## Runtime Debug Bridge

Expose a narrow debug bridge on `MMDStageHandle` and `MMDCompanionRuntime`.

Suggested methods:

```ts
type MmdRenderDebugConfig = {
  toneMappingExposure?: number;
  ambientLightIntensity?: number;
  hemisphereLightIntensity?: number;
  mainLightIntensity?: number;
  fillLightIntensity?: number;
  outlineEnabled?: boolean;
  outlineStrength?: number;
  bloomEnabled?: boolean;
  bloomStrength?: number;
};

type MmdRenderDebugSnapshot = {
  source: "default" | "temporary" | "preset";
  presetId?: string;
  presetName?: string;
  modelPath: string;
  renderPipeline: string;
  config: Required<MmdRenderDebugConfig>;
  defaults: Required<MmdRenderDebugConfig>;
  camera: unknown;
  renderer: {
    toneMapping: string;
    outputColorSpace: string;
    pixelRatio: number;
    canvasWidth: number;
    canvasHeight: number;
  };
  sceneStats: {
    meshes: number;
    materials: number;
    textures: number;
    transparentMaterials: number;
  };
  materialSummary: Record<string, number>;
};
```

The bridge should support:

- `getRenderDebugSnapshot()`
- `applyRenderDebugConfig(config)`
- `resetRenderDebugOverrides()`
- `copyRenderDebugSnapshot()` at the UI layer

This bridge must only touch rendering parameters. It must not manipulate `stageInteractionMachine`, chat-driven interactions, click actions, VMD playback queues, or model selection.

## Safe Controls

Version 1 writable controls:

- `toneMappingExposure`, range `0.2-2.5`
- `ambientLightIntensity`, range `0-3`
- `hemisphereLightIntensity`, range `0-3`
- `mainLightIntensity`, range `0-3`
- `fillLightIntensity`, range `0-3`
- `outlineEnabled`
- `outlineStrength`, range `0-2`
- `bloomEnabled`
- `bloomStrength`, range `0-2`

These controls are intentionally conservative. They cover the common render-debug needs: character brightness, toon visibility, outline readability, bloom strength, and exposure balance. The first version should not expose per-material mutation, shader replacement, transparency sorting strategy, texture replacement, physics, or VMD controls.

Read-only diagnostics:

- Current model path and model display name.
- Current `renderPipeline`.
- Active VMD URL or asset id when available.
- Current config source: default, temporary, or preset.
- Renderer information.
- Camera snapshot.
- Mesh/material/texture counts.
- Transparent material count.
- Material classification summary such as face, body, hair, eye, cloth, metal, stockings, unknown.

## Presets

Presets are stored in localStorage and grouped by `modelPath + renderPipeline`.

Suggested storage key:

```text
mmd_render_debug_presets_v1
```

Suggested shape:

```ts
type MmdRenderDebugPreset = {
  id: string;
  name: string;
  modelPath: string;
  renderPipeline: string;
  config: Required<MmdRenderDebugConfig>;
  createdAt: string;
  updatedAt: string;
};
```

UI actions:

- `保存为新配置`
- `更新当前配置`
- `切换配置`
- `删除配置`
- `导出 JSON`
- `导入 JSON`
- `恢复默认`

Preset switching applies the saved config immediately. Import should validate required fields, clamp numeric values, and ignore presets for unknown shapes rather than throwing UI-breaking errors.

`恢复默认` clears temporary overrides and reapplies the runtime defaults for the current pipeline. It does not delete presets, reset camera, reload the model, or affect VMD playback.

## Data Flow

1. User opens the advanced panel and enables `渲染调试`.
2. Companion enters focus layout.
3. Debug panel asks `MMDStage` for `getRenderDebugSnapshot()`.
4. User changes safe controls.
5. Debug panel calls `applyRenderDebugConfig()` with clamped values.
6. Runtime applies only render overrides and returns an updated snapshot.
7. User can save current values as a preset for the current model and pipeline.
8. User can switch presets from the current model/pipeline list.
9. User can click `恢复默认` to clear overrides and return to the current runtime default.

## Error Handling

- If runtime is not ready, show disabled controls and a compact "MMD stage not ready" state.
- If a control update fails, keep the previous snapshot and show a non-blocking error in the debug panel.
- If localStorage is unavailable or full, keep the current temporary config but report that saving failed.
- If imported JSON is invalid, do not modify existing presets.
- If a preset belongs to a different `modelPath + pipeline`, keep it stored but hide it from the current preset selector.

## Testing

Backend tests are not required for version 1 because storage is localStorage-only.

Frontend unit/basic checks:

- Preset key generation by `modelPath + renderPipeline`.
- Preset import validation and numeric clamping.
- Default/temporary/preset source calculation.
- `恢复默认` clears overrides without deleting presets.

Runtime tests:

- Applying debug config mutates only render parameters.
- Reset restores pipeline defaults.
- Snapshot returns renderer, camera, scene stats, and material summary without throwing when optional systems are absent.

UI/E2E checks:

- Advanced panel has a `渲染调试` entry.
- Enabling it enters focus layout and hides Chatbox/right rail/command bar.
- MMD stage remains visible in focus layout.
- Controls do not overflow on desktop and mobile widths.
- Saving, switching, deleting, exporting, importing, and restoring default all work without reloading the stage.

## Non-Goals

- Backend preset persistence.
- Sharing presets between users automatically.
- Editing individual materials.
- Shader graph editing.
- VMD timeline debugging.
- Animation/IK/physics debugging.
- Replacing the existing camera save workflow.
