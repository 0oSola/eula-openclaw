# Genshin Project2 Visual Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the existing `genshin` pipeline into a `project2`-style model renderer while preserving the existing `classic` pipeline as the untouched regression baseline.

**Architecture:** Keep the shared `MMDCompanionRuntime` and `/companion` UI/session flow, but replace the current `genshin` presentation/material/pose/mouth behavior with a `project2`-aligned implementation. The key rule is that all visual behavior changes stay behind `renderPipeline === "genshin"`; `classic` keeps its current camera, lighting, material tuning, direct render path, and tests.

**Tech Stack:** Next.js App Router, React 19, Three.js, three-stdlib, node:test, Playwright.

---

## Preconditions

- Work from `D:\workspace\MMD project\.worktrees\genshin-mmd-render-migration`.
- Do not edit `D:\workspace\MMD project2`; it is reference-only.
- Keep all production changes scoped to `web/src/features/stage/` unless a test proves another file is required.
- Preserve `classic` behavior and selector default exactly.

## Reference Files

- Source renderer: `D:\workspace\MMD project2\src\components\MMDCanvas.tsx`
- Target runtime: `web/src/features/stage/mmdCompanionRuntime.js`
- Runtime tests: `web/tests/mmd-render-runtime.test.mjs`
- E2E smoke: `web/tests/e2e/app-routes-smoke.spec.ts`
- E2E stage debug: `web/tests/e2e/mmd-stage-debug.spec.ts`

## Verification Commands

Use these commands exactly when called out by tasks:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
npm --prefix web run check:basic
npm --prefix web run build
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

---

### Task 1: Rewrite `genshin` runtime expectations around `project2` parity

**Files:**
- Modify: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write failing presentation tests**

Add or replace `genshin` presentation assertions so they match the new goal:

- `genshin` uses a dark neutral background closer to `project2`, not the current blue stage wrapper.
- `genshin` disables backdrop.
- `genshin` disables outline.
- `genshin` disables postfx/composer.
- `genshin` keeps source-like readable lights:
  - ambient close to `0.8`
  - hemisphere close to `0.6`
  - key close to `1.2`
  - fill close to `0.5`

Use test shape like:

```js
test("genshin presentation now mirrors the simpler project2 stage treatment", () => {
  const genshin = getStagePresentationConfig("genshin");

  assert.equal(genshin.backdrop.enabled, false);
  assert.equal(genshin.outline.enabled, false);
  assert.equal(genshin.postfx.enabled, false);
  assert.equal(genshin.lights.ambient.intensity, 0.8);
  assert.equal(genshin.lights.hemisphere.intensity, 0.6);
  assert.equal(genshin.lights.key.intensity, 1.2);
  assert.equal(genshin.lights.fill.intensity, 0.5);
});
```

**Step 2: Write failing rest-pose and mouth tests**

Add focused tests for new `genshin`-only helpers:

```js
test("genshin project2 rest pose is baked into the captured base skeleton", async () => {
  // Build a fake mesh with named bones matching the helper.
  // Load through runtime.loadModel().
  // Assert captured base rotations reflect the rest pose values, not zeros.
});

test("genshin speaking morph uses project2-style random mouth movement", () => {
  // Stub Math.random and performance.now.
  // Assert speaking drives a non-zero mouth morph on genshin.
  // Assert non-speaking drives it back to zero.
});
```

**Step 3: Write failing regression tests for `classic` separation**

Add or tighten tests that prove:

- `classic` still uses direct `renderer.render()`.
- `classic` still does not use backdrop/outline/postfx.
- `classic` render-frame morph behavior does not change because of the new `genshin` path.

**Step 4: Run runtime tests to verify failure**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL on the new `genshin` presentation, rest-pose, and mouth assertions.

**Step 5: Commit failing tests only if they are isolated and intentional**

If the repo convention allows red test commits:

```powershell
git add web/tests/mmd-render-runtime.test.mjs
git commit -m "test: define project2-style genshin runtime expectations"
```

If not, continue directly to Task 2 without committing.

---

### Task 2: Replace `genshin` presentation and material tuning with `project2`-style behavior

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Modify: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Strip shared material brightening out of the common path**

In `primeMMDMaterial()`, remove the current shared brightening behavior:

```js
if (material.color) material.color.multiplyScalar(1.12);
if (material.emissive) material.emissive.multiplyScalar(1.05);
if ("envMapIntensity" in material) material.envMapIntensity = 0.45;
if ("emissiveIntensity" in material) material.emissiveIntensity = 0.24;
```

Keep only safe shared prep there:

- `fog = false`
- texture `SRGBColorSpace`
- cutout detection
- profile inference

Move any non-source-like boosts into `tuneClassicMMDMaterial()` / `tuneHeroShotMMDMaterial()` if tests require it.

**Step 2: Rewrite the `genshin` presentation preset**

Update `STAGE_PRESENTATION_PRESETS.genshin` to remove the current wrapper look:

- darker background
- source-like light intensities and positions
- `backdrop.enabled = false`
- `outline.enabled = false`
- `postfx.enabled = false`
- floor reduced to a plain shadow catcher instead of glow/rings/contact styling

Do not change `classic`.

**Step 3: Make `tuneGenshinMMDMaterial()` mirror `project2`**

Implement `genshin` material behavior closer to source:

- preserve SRGB maps
- set `gradientMap`
- set `alphaTest` to at least `0.5`
- use `DoubleSide`
- zero ordinary emissive colors instead of globally boosting them
- keep purple/glow FX special-case
- keep mask suppression in `genshin` only
- delete stale `skinning` / `morphTargets` fields if still needed for compatibility

Prefer a dedicated helper such as:

```js
function cleanLegacyMMDMaterialFlags(material) {
  if ("skinning" in material) delete material.skinning;
  if ("morphTargets" in material) delete material.morphTargets;
}
```

Call it only where needed.

**Step 4: Run runtime tests**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: material and presentation tests pass; existing `classic` assertions stay green.

**Step 5: Commit**

```powershell
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: restyle genshin renderer toward project2 parity"
```

---

### Task 3: Bake the `project2` rest pose into `genshin` base skeleton capture

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Modify: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Add a `genshin`-only rest-pose helper**

Add a helper near bone utilities:

```js
function applyGenshinProject2RestPose(mesh) {
  // Find hip/chest/leg/arm/shoulder/elbow bones by the same hint strategy.
  // Apply the source angles from project2.
  // Update matrices/skeleton.
}
```

Source values to port:

- hip `z = 0.15`
- chest `z = -0.1`
- left knee `x = 0.4`
- left leg `z = 0.1`, `y = 0.1`
- left/right shoulder slight relax
- left arm `z = -1.35`, `x = 0.05`
- right arm `z = 1.35`, `x = 0.05`
- elbows slight bend

**Step 2: Apply the helper in `loadModel()` before capture**

Change the order for `genshin` only:

1. load mesh
2. tune materials
3. apply rest pose
4. fit/pin model to stage
5. add to scene/helper
6. capture bones

This ensures the captured base skeleton and animation build target both inherit the posed baseline.

**Step 3: Keep `classic` untouched**

Guard the rest-pose path behind:

```js
if (this.renderPipeline === "genshin") {
  applyGenshinProject2RestPose(mesh);
}
```

Do not apply it to `classic` or `hero-shot`.

**Step 4: Run runtime tests**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: the new rest-pose tests pass and existing VMD anchor tests remain green.

**Step 5: Commit**

```powershell
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: bake project2 rest pose into genshin base skeleton"
```

---

### Task 4: Restore `genshin` speaking-mouth behavior and re-verify stage flows

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Modify: `web/tests/mmd-render-runtime.test.mjs`
- Optional Modify: `web/tests/e2e/mmd-stage-debug.spec.ts`

**Step 1: Reconnect morph updates for the render loop**

`renderFrame()` currently does not call `updateMorph()`. Reintroduce morph updates in a controlled way:

- for `genshin`, run a `project2`-style speaking-mouth helper every frame
- keep it active during VMD playback too
- keep `classic` behavior unchanged unless an existing test proves otherwise

Preferred shape:

```js
if (this.renderPipeline === "genshin") {
  this.updateProject2SpeakingMorph(delta, nowMs);
}
```

Where the helper:

- chooses a mouth morph slot
- uses `0.2 + Math.random() * 0.6` while speaking
- returns to `0` while not speaking

**Step 2: Run runtime tests**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: speaking-mouth tests pass and no unrelated regressions appear.

**Step 3: Run stage debug E2E**

Run:

```powershell
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected: `genshin` still loads, switches, and stays visible after the renderer changes.

**Step 4: Commit**

```powershell
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs web/tests/e2e/mmd-stage-debug.spec.ts
git commit -m "feat: restore project2-style genshin speaking morphs"
```

---

### Task 5: Final regression verification

**Files:**
- No source changes expected

**Step 1: Run runtime tests**

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: all pass.

**Step 2: Run basic checks**

```powershell
npm --prefix web run check:basic
```

Expected: exit code 0.

**Step 3: Run build**

```powershell
npm --prefix web run build
```

Expected: exit code 0.

**Step 4: Run E2E smoke**

```powershell
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
```

Expected: all pass, including selector persistence.

**Step 5: Run E2E stage debug**

```powershell
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected: pass on `genshin` switching and model readiness.

**Step 6: Inspect worktree status**

```powershell
git status --short
git diff -- web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs web/tests/e2e/app-routes-smoke.spec.ts web/tests/e2e/mmd-stage-debug.spec.ts
```

Expected:

- no edits under `D:\workspace\MMD project2`
- no `classic` production regressions
- only intentional `genshin` and test changes

**Step 7: Final commit if needed**

```powershell
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs web/tests/e2e/app-routes-smoke.spec.ts web/tests/e2e/mmd-stage-debug.spec.ts
git commit -m "feat: convert genshin renderer to project2-style presentation"
```

---

## Done Definition

The work is complete only when:

- `classic` still looks and behaves the same.
- `genshin` visually reads closer to `project2` than to the previous blue staged variant.
- `genshin` no longer depends on backdrop/outline/postfx for its primary look.
- `genshin` captures the `project2` rest pose into its base skeleton without causing visible foot/arm drift during VMD playback.
- speaking in `genshin` drives source-like random mouth movement.
- runtime tests, build, smoke E2E, and stage debug E2E have all been run and recorded.
