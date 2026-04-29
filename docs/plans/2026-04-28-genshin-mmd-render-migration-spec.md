# Genshin MMD Render Migration Spec

**Date:** 2026-04-28

**Status:** Draft for implementation planning

**Source project:** `D:\workspace\MMD project2`

**Target project:** `D:\workspace\MMD project`

## Goal

Migrate the useful MMD rendering behavior from `MMD project2` into the target project's `genshin` render pipeline while preserving the existing `classic` pipeline as the regression baseline.

This is not a full component port. `project2` uses a single hard-coded React Three Fiber canvas, while the target project already has a shared `MMDCompanionRuntime` with switchable presentation presets. The migration should therefore land only in the target project's `genshin` visual branch and reuse the existing target runtime for model loading, VMD playback, speech state, interaction completion, resizing, and model switching.

## Current Findings

### Source: `MMD project2`

The source implementation is concentrated in:

- `src/components/MMDCanvas.tsx`
- `src/store/useAppStore.ts`
- `src/components/ActionPanel.tsx`
- `src/hooks/useChatService.ts`
- `src/app/api/models/route.ts`

Important source behavior:

- Loads PMX/PMD with `MMDLoader`.
- Uses `MMDAnimationHelper` and direct `loadAnimation()` for VMD playback.
- Applies a generated three-step toon ramp to materials.
- Forces texture maps to `THREE.SRGBColorSpace`.
- Deletes stale `skinning` and `morphTargets` material fields.
- Reduces PMX ambient/emissive over-lighting by zeroing most emissive colors.
- Special-cases glow/purple FX materials.
- Hides face mask-like materials.
- Sets `alphaTest = 0.5` and `DoubleSide` on MMD materials.
- Uses a strong readable lighting setup:
  - ambient `0.8`
  - hemisphere `0.6`
  - key directional `1.2`
  - fill directional `0.5`
- Applies a hard-coded elegant rest pose before animation.
- Uses simple random mouth morph movement while speaking.
- Maps UI and LLM action ids to `/MMD/motions/*.vmd`.

Limitations in the source implementation:

- No explicit `classic` or `genshin` mode separation.
- Rendering, materials, pose, animation, lighting, and UI are tightly coupled in one component.
- VMD paths are string-built from action ids.
- The hard-coded rest pose may interfere with VMD base-pose assumptions if ported directly.
- Source model discovery assumes Next.js `public/MMD`, while the target project serves MMD assets through the API.

### Target: `MMD project`

The target project already has most of the desired architecture:

- `web/src/features/stage/MMDStage.tsx`
- `web/src/features/stage/mmdCompanionRuntime.js`
- `web/src/features/stage/modelCatalog.js`
- `web/src/app/companion/page.tsx`
- `web/src/lib/session.ts`
- `web/tests/mmd-render-runtime.test.mjs`
- `web/tests/e2e/app-routes-smoke.spec.ts`
- `web/tests/e2e/mmd-stage-debug.spec.ts`

Existing runtime support:

- `getStagePresentationConfig("classic")`
- `getStagePresentationConfig("hero-shot")`
- `getStagePresentationConfig("genshin")`
- pipeline-aware material tuning
- generated toon ramps
- geometry-based outline
- procedural floor glow, rings, contact shadow
- procedural backdrop
- post-processing composer for non-classic visual modes
- shared model load, VMD playback, loop handling, speech morphs, and procedural interactions

Runtime verification already passes:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Observed result during analysis:

- 44 tests
- 44 pass
- 0 fail

Current target gap:

- `/companion` currently treats `genshin` as a legacy value and normalizes it to `hero-shot`.
- The visible render pipeline selector exposes `Classic` and `Hero Shot`, not a real `Genshin` option.
- Existing E2E coverage is internally inconsistent:
  - `app-routes-smoke` expects legacy `genshin` sessions to become `hero-shot`.
  - `mmd-stage-debug` selects `genshin` and expects it to work.

## Non-Negotiable Constraints

- `classic` remains the default.
- `classic` visual output and runtime behavior must not be intentionally changed.
- No `project2` React Three Fiber canvas should be copied into the target project.
- No source behavior should be added globally if it can be scoped to `genshin`.
- No backend API migration from `project2` is needed for this phase.
- No VMD playback semantics should fork by pipeline.
- No hard-coded rest pose should be applied to VMD playback without a separate proof that it does not disturb captured base skeletons.

## Product Definition

`genshin` is a game-like anime presentation pipeline for the existing `/companion` MMD stage.

It should provide:

- readable face and upper body
- stronger toon staging than `classic`
- cutout-safe hair and lashes
- controlled emissive and glow behavior
- soft blue presentation backdrop
- floor glow and contact grounding
- stylized but restrained outline
- postfx that improves the stage without washing out the model or UI

`classic` remains the plain, stable baseline for comparison and regression recovery.

## Pipeline Model

Supported render pipelines should be:

- `classic`
- `hero-shot`
- `genshin`

Rules:

- Unknown values fallback to `classic`.
- Existing `hero-shot` stays available unless explicitly removed in a separate decision.
- `genshin` should no longer be treated as a legacy alias of `hero-shot`.
- Session persistence should store and restore all supported pipeline ids.
- Pipeline switching may recreate the runtime, but must preserve page stability.

## Migration Scope

### In Scope

Apply to `genshin` only:

- Source-inspired texture color-space hygiene.
- Source-inspired alpha cutout safety.
- Source-inspired MMD toon ramp treatment where it improves current behavior.
- Source-inspired emissive/glow/mask material handling.
- Genshin-specific material profile refinements for:
  - face
  - skin
  - hair
  - cloth
  - metal
  - default
- UI and session changes so `genshin` is selectable and persistent.
- Test updates that lock `classic` and exercise `genshin`.

### Out of Scope

- Copying `src/components/MMDCanvas.tsx`.
- Replacing target runtime with React Three Fiber.
- Changing backend MMD asset discovery to match `project2`.
- Changing action mapping architecture to `project2` string-built VMD paths.
- Applying the source S-curve rest pose during VMD playback.
- Adding new downloaded textures, extracted game assets, or proprietary shader data.
- Making `genshin` a perfect clone of any commercial renderer.

## Technical Design

### 1. UI and Session

Update `/companion` pipeline handling:

- Change `RenderPipeline` from `classic | hero-shot` to `classic | hero-shot | genshin`.
- Change `normalizeRenderPipeline()` so:
  - `classic` returns `classic`
  - `hero-shot` returns `hero-shot`
  - `genshin` returns `genshin`
  - unknown returns `classic`
- Stop rewriting saved `{ renderPipeline: "genshin" }` to `hero-shot`.
- Add a visible `Genshin` option to the render pipeline selector.
- Preserve `Classic` as the first option and default.

Expected user-facing selector:

- `Classic`
- `Hero Shot`
- `Genshin`

### 2. Runtime Boundaries

Keep one shared `MMDCompanionRuntime`.

Shared systems remain shared:

- constructor lifecycle
- `init()`
- `setupScene()` dispatcher
- renderer and resize lifecycle
- model loading entry point
- VMD playback and loop handling
- captured base skeleton logic
- speech morph updates
- procedural interactions
- dispose and cleanup paths

Pipeline-specific systems:

- presentation preset
- toon ramp values
- material tuning
- outline parameters
- floor and backdrop parameters
- postfx parameters

### 3. Genshin Material Migration

The source's useful material behavior should be expressed as explicit `genshin` tuning, not as global cleanup.

Candidate behavior to add or verify in `tuneGenshinMMDMaterial()` and adjacent helpers:

- Ensure texture maps use `THREE.SRGBColorSpace`.
- Keep generated ramp textures in `THREE.NoColorSpace`.
- Preserve authored `gradientMap` if present.
- Ensure transparent, alpha-mapped, hair, lash, and cloth materials remain cutout-safe.
- Keep `alphaTest` at or above `0.5`.
- Keep thin geometry `DoubleSide` where needed.
- Cap face and skin specular to avoid plastic highlights.
- Retain controlled metal highlights.
- Control PMX-derived emissive instead of letting ambient data wash out the model.
- Detect glow or FX materials by conservative material-name hints.
- Detect mask-like face materials by conservative hints and either suppress or reduce them only in `genshin`.

Important caution:

The source hides mask-like materials aggressively. In the target project this should be guarded by narrow hints and tests, because hiding arbitrary face materials can remove valid eyelashes, brows, or accessories.

### 4. Lighting and Presentation

The source lighting confirms the target `genshin` mode should remain high-readability:

- ambient should be at least source-like strength
- key light should remain strong and warm
- fill light should prevent black model areas
- rim light should separate silhouette

The current target `genshin` preset already has:

- ambient `0.88`
- hemisphere `0.68`
- key `1.56`
- fill `0.58`
- rim `0.46`

Therefore the implementation should not blindly copy source light values downward. The source should be used as validation that the target's multi-light strategy is directionally correct.

### 5. Rest Pose

Do not port the source hard-coded rest pose in the first implementation batch.

Reason:

- Target VMD playback captures base skeleton state and builds animation targets from that state.
- Applying an S-curve rest pose before or during VMD loading can shift VMD playback, foot grounding, or anchor stabilization.

If later needed, introduce it as a separate feature:

- `genshin` idle-only pose layer
- disabled whenever `currentClip` is active
- covered by tests proving VMD anchor bones and loop playback remain stable

### 6. Actions and VMD Mapping

Do not port `project2` action-to-path string construction directly.

Target project already supports:

- resolved mappings
- uploaded VMD assets
- built-in MMD VMD catalog
- favorite/autoplay VMD loops
- standby and loop transitions

If project2 action ids such as `wavefile`, `catwalk`, `elegant`, or `greet` are desired, add them through target mapping/config facilities rather than hard-coding `/MMD/motions/${action}.vmd` in the stage.

## Implementation Plan Outline

This spec is not the implementation plan. A separate plan should split coding into small TDD batches:

1. Restore `genshin` as a first-class UI/session pipeline.
2. Update E2E expectations around pipeline persistence and legacy session handling.
3. Add or tighten runtime tests for `classic` immutability and `genshin` material behavior.
4. Move source-inspired material hygiene into the `genshin` branch only.
5. Verify `classic`, `hero-shot`, and `genshin` runtime tests.
6. Run smoke/debug E2E for stage load and pipeline switching.

## Acceptance Criteria

Functional:

- `/companion` shows `Classic`, `Hero Shot`, and `Genshin`.
- First-time sessions still default to `Classic`.
- Selecting `Genshin` persists across reload.
- Saved `genshin` sessions are restored as `genshin`, not rewritten to `hero-shot`.
- Switching `Classic -> Genshin -> Classic` keeps the stage visible.
- Model switching still works after pipeline switching.
- VMD preview and favorite autoplay still work after pipeline switching.
- Speaking state still drives mouth morphs.

Classic regression:

- `getStagePresentationConfig("classic")` remains unchanged.
- `classic` does not enable backdrop.
- `classic` does not enable outline unless already specified by its preset.
- `classic` renders directly through `renderer.render()`.
- `classic` material tuning is not modified by `genshin` additions.

Genshin behavior:

- `getStagePresentationConfig("genshin")` returns a distinct preset.
- `genshin` enables backdrop/floor presentation layers.
- `genshin` enables postfx through composer.
- `genshin` attaches character outline when configured.
- `genshin` material tuning differs from `classic`.
- `genshin` keeps cutout materials safe.
- `genshin` does not remove valid face, eye, brow, or lash materials accidentally.

## Verification Plan

Minimum local verification:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
npm --prefix web run check:basic
npm --prefix web run build
```

Recommended E2E verification:

```powershell
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Manual QA:

- Start with `Classic`, confirm current baseline still loads.
- Switch to `Genshin`, confirm the same model remains visible and brighter/stylized.
- Reload, confirm `Genshin` persists.
- Switch back to `Classic`, confirm baseline returns.
- Preview at least one built-in VMD.
- Trigger browser/server TTS and confirm mouth morphs still move.
- Switch models and confirm no stale outline/backdrop/postfx resources leak visually.

## Risks

- Treating source material fixes as global changes could regress `classic`.
- Aggressive mask hiding could remove valid facial details.
- Extra emissive suppression could dull intentionally glowing materials.
- Outline clones can create artifacts on transparent hair or lashes.
- Pipeline switching can leak composer, outline, floor, or backdrop resources if cleanup is incomplete.
- E2E tests currently encode an old `genshin -> hero-shot` migration assumption and must be updated carefully.

## Recommended Next Step

Create an implementation plan from this spec before coding.

The implementation plan should be TDD-oriented and should keep each batch small enough to verify independently:

- one batch for UI/session pipeline restoration
- one batch for tests
- one batch for `genshin` material migration
- one batch for final regression verification

