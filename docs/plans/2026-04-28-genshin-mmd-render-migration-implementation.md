# Genshin MMD Render Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore `genshin` as a first-class `/companion` render pipeline and migrate source-project MMD material hygiene into the `genshin` branch without changing `classic`.

**Architecture:** Keep the target project's existing shared `MMDCompanionRuntime`; do not port the source React Three Fiber canvas. Pipeline differences stay in presentation config, UI/session selection, and pipeline-specific material helpers. `classic` remains the default and regression baseline.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Three.js, three-stdlib, node:test, Playwright.

---

## Preconditions

- Work from `D:\workspace\MMD project`.
- Do not edit `D:\workspace\MMD project2`; it is reference-only.
- Keep implementation changes scoped to `web/` tests and stage runtime files.
- Do not change backend APIs unless a later failure proves it is required.
- Do not port the source S-curve rest pose in this plan.

## Reference Spec

- `docs/plans/2026-04-28-genshin-mmd-render-migration-spec.md`

## Verification Commands

Use these commands as called out by tasks:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
npm --prefix web run check:basic
npm --prefix web run build
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

---

### Task 1: Restore `genshin` as a first-class UI and session pipeline

**Files:**
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/tests/e2e/app-routes-smoke.spec.ts`

**Step 1: Write the failing E2E expectations**

Update `web/tests/e2e/app-routes-smoke.spec.ts`.

Change the render pipeline persistence test so the selector exposes three choices and persists `genshin`:

```ts
test("companion render pipeline selection persists across reloads @smoke", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  const pipelineSelect = page.getByRole("combobox", { name: "Render pipeline" });
  await expect(pipelineSelect).toBeVisible();
  await expect(pipelineSelect.locator("option")).toHaveText(["Classic", "Hero Shot", "Genshin"]);
  await expect(pipelineSelect).toHaveValue("classic");

  await pipelineSelect.selectOption("genshin");
  await expect(pipelineSelect).toHaveValue("genshin");

  await page.reload();

  await expect(page.getByRole("combobox", { name: "Render pipeline" })).toHaveValue("genshin");
});
```

Replace the legacy upgrade test with a restore test:

```ts
test("companion restores saved genshin render pipeline sessions @smoke", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "genshin" }),
    );
  });

  await page.goto("/companion");

  await expect(page.getByRole("combobox", { name: "Render pipeline" })).toHaveValue("genshin");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").renderPipeline),
    )
    .toBe("genshin");
});
```

**Step 2: Run the E2E test to verify it fails**

Run:

```powershell
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
```

Expected: FAIL because `/companion` currently exposes only `Classic` and `Hero Shot`, and `normalizeRenderPipeline("genshin")` maps to `hero-shot`.

**Step 3: Implement the minimal UI/session change**

Update `web/src/app/companion/page.tsx`.

Change the type:

```ts
type RenderPipeline = "classic" | "hero-shot" | "genshin";
```

Change `normalizeRenderPipeline`:

```ts
function normalizeRenderPipeline(value?: string): RenderPipeline {
  if (value === "classic" || value === "hero-shot" || value === "genshin") return value;
  return "classic";
}
```

In the initial session-loading `useEffect`, remove the migration that rewrites saved `genshin` sessions to `hero-shot`. The effect should simply load the session, normalize the current value, and save only if the stored value is invalid:

```ts
useEffect(() => {
  const saved = loadSession();
  const normalizedPipeline = normalizeRenderPipeline(saved?.renderPipeline);
  const normalizedSession =
    saved && saved.renderPipeline !== normalizedPipeline
      ? { ...saved, renderPipeline: normalizedPipeline }
      : saved;

  setSession(normalizedSession ?? null);
  setRenderPipeline(normalizedPipeline);
  if (normalizedSession && normalizedSession !== saved) {
    saveSession(normalizedSession);
  }
}, []);
```

Add the selector option:

```tsx
<option value="classic">Classic</option>
<option value="hero-shot">Hero Shot</option>
<option value="genshin">Genshin</option>
```

Do not change `MMDStage.tsx`; it already accepts `renderPipeline?: "classic" | "hero-shot" | "genshin"`.

**Step 4: Run the E2E test to verify it passes**

Run:

```powershell
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
```

Expected: PASS for the updated pipeline selector tests. If unrelated route smoke tests fail because of environment/backend availability, record the exact failure and continue with runtime/unit verification before deciding whether to adjust test setup.

**Step 5: Commit**

```powershell
git add web/src/app/companion/page.tsx web/tests/e2e/app-routes-smoke.spec.ts
git commit -m "feat: restore genshin render pipeline selection"
```

---

### Task 2: Add regression tests for source-inspired `genshin` material hygiene

**Files:**
- Modify: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write failing or tightening tests**

Add tests near the existing material tuning tests.

Test 1: `genshin` texture color space and cutout safety:

```js
test("genshin material tuning keeps texture color space and cutout safety source-compatible", () => {
  const material = makeMaterial({
    name: "Hair Cloth",
    transparent: true,
    specular: 0.7,
    shininess: 40,
  });
  const ramp = { id: "genshin-ramp" };

  runtimeModule.tuneGenshinMMDMaterial?.(material, ramp);

  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.emissiveMap.colorSpace, THREE.SRGBColorSpace);
  assert.ok(material.alphaTest >= 0.5);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.gradientMap, ramp);
});
```

Test 2: `classic` is not affected by `genshin`-specific emissive policy:

```js
test("classic material tuning remains separate from genshin emissive policy", () => {
  const classic = makeMaterial({ name: "Glow FX", transparent: false, shininess: 40 });
  const genshin = makeMaterial({ name: "Glow FX", transparent: false, shininess: 40 });

  runtimeModule.tuneClassicMMDMaterial?.(classic, { id: "classic-ramp" });
  runtimeModule.tuneGenshinMMDMaterial?.(genshin, { id: "genshin-ramp" });

  assert.notEqual(genshin.emissiveIntensity, classic.emissiveIntensity);
  assert.equal(classic.gradientMap.id, "classic-ramp");
  assert.equal(genshin.gradientMap.id, "genshin-ramp");
});
```

Test 3: mask-like suppression must be narrow and `genshin`-only. Prefer testing a helper if introduced in Task 3. If no helper exists yet, add the test in Task 3 after creating the helper.

**Step 2: Run runtime tests to verify current behavior**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: Tests may already pass for color-space and cutout behavior because `primeMMDMaterial()` currently handles part of it. If they pass, keep them as regression coverage. If the emissive separation test fails, proceed to Task 3.

**Step 3: Commit tests if they pass without implementation**

If the new tests pass without runtime changes:

```powershell
git add web/tests/mmd-render-runtime.test.mjs
git commit -m "test: lock genshin mmd material hygiene"
```

If any test fails, do not commit yet. Continue to Task 3 and commit tests plus implementation together.

---

### Task 3: Move source-inspired glow and mask handling into `genshin` material tuning

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Modify: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing helper tests**

In `web/tests/mmd-render-runtime.test.mjs`, add focused tests that express the desired behavior without relying on a real PMX file.

Preferred test shape:

```js
test("genshin material tuning boosts explicit glow materials without changing classic glow policy", () => {
  const classic = makeMaterial({ name: "purple glow fx", shininess: 20 });
  const genshin = makeMaterial({ name: "purple glow fx", shininess: 20 });

  runtimeModule.tuneClassicMMDMaterial?.(classic, { id: "classic-ramp" });
  runtimeModule.tuneGenshinMMDMaterial?.(genshin, { id: "genshin-ramp" });

  assert.ok(genshin.emissiveIntensity >= classic.emissiveIntensity);
  assert.equal(genshin.gradientMap.id, "genshin-ramp");
});
```

If adding a mask helper, export it and test it directly:

```js
test("genshin mask detection is narrow enough to avoid hiding ordinary face materials", () => {
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("face skin"), false);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("eye lash"), false);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("face mask"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("mouth mask"), true);
});
```

**Step 2: Run runtime tests to verify failure**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL if the helper does not exist or if glow/mask behavior is not yet implemented.

**Step 3: Implement minimal `genshin`-only helpers**

In `web/src/features/stage/mmdCompanionRuntime.js`, add small helpers near material helpers:

```js
const GENSHIN_GLOW_HINTS = ["glow", "emissive", "purple", "fx"];
const GENSHIN_MASK_HINTS = ["mask", "face mask", "mouth mask"];

export function isGenshinGlowMaterial(materialName = "") {
  const name = `${materialName}`.toLowerCase();
  return GENSHIN_GLOW_HINTS.some((hint) => name.includes(hint));
}

export function isGenshinSuppressedMaskMaterial(materialName = "") {
  const name = `${materialName}`.toLowerCase();
  return GENSHIN_MASK_HINTS.some((hint) => name.includes(hint));
}
```

Then call them only from `tuneGenshinMMDMaterial()`:

```js
const materialName = `${material?.name || ""}`;
if (isGenshinGlowMaterial(materialName)) {
  if (material.emissive?.isColor) {
    material.emissive.setHex?.(0x9d00ff);
  }
  if ("emissiveIntensity" in material) {
    material.emissiveIntensity = Math.max(material.emissiveIntensity || 0, 0.75);
  }
}

if (isGenshinSuppressedMaskMaterial(materialName)) {
  material.visible = false;
  material.transparent = true;
  material.opacity = 0;
}
```

Do not call these helpers from `tuneClassicMMDMaterial()` or `primeMMDMaterial()`.

**Step 4: Run runtime tests**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: PASS. Confirm existing `classic` tests still pass.

**Step 5: Commit**

```powershell
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add genshin-only mmd glow and mask material tuning"
```

---

### Task 4: Update E2E stage debug around `genshin` switching

**Files:**
- Modify: `web/tests/e2e/mmd-stage-debug.spec.ts`

**Step 1: Tighten the debug E2E assertions**

The existing debug test already selects `genshin`. Add persistence and recovery checks:

```ts
const pipelineSelect = page.getByRole("combobox", { name: "Render pipeline" });
await expect(pipelineSelect).toBeVisible();
await pipelineSelect.selectOption("genshin");
await expect(pipelineSelect).toHaveValue("genshin");
await expect(canvas).toBeVisible();

await pipelineSelect.selectOption("classic");
await expect(pipelineSelect).toHaveValue("classic");
await expect(canvas).toBeVisible();

await pipelineSelect.selectOption("genshin");
await expect(pipelineSelect).toHaveValue("genshin");
await expect(canvas).toBeVisible();
```

Keep the existing failed request and console error collection.

**Step 2: Run E2E debug test**

Run:

```powershell
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected: PASS when the dev server/API setup is available. If it fails because services are unavailable, capture the exact failing request/status and do not mask it with broad test skips.

**Step 3: Commit**

```powershell
git add web/tests/e2e/mmd-stage-debug.spec.ts
git commit -m "test: cover genshin pipeline switching in stage debug"
```

---

### Task 5: Full regression verification

**Files:**
- No source changes expected.
- Optional Modify: `README.md` only if a user-facing pipeline note is required.

**Step 1: Run runtime tests**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected:

- All tests pass.
- `classic` config and direct render assertions remain green.
- `genshin` material, outline, backdrop, floor, and postfx assertions remain green.

**Step 2: Run basic checks**

Run:

```powershell
npm --prefix web run check:basic
```

Expected: exit code 0.

**Step 3: Run build**

Run:

```powershell
npm --prefix web run build
```

Expected: exit code 0.

**Step 4: Run E2E smoke**

Run:

```powershell
npx playwright test web/tests/e2e/app-routes-smoke.spec.ts --reporter=list
```

Expected: pipeline selector tests pass and no route/page/console errors are introduced.

**Step 5: Run E2E stage debug**

Run:

```powershell
npx playwright test web/tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected: stage canvas remains visible through `classic -> genshin -> classic -> genshin`, no MMD asset request failures, final status reaches `Model ready`.

**Step 6: Inspect git diff**

Run:

```powershell
git status --short
git diff -- web/src/app/companion/page.tsx web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs web/tests/e2e/app-routes-smoke.spec.ts web/tests/e2e/mmd-stage-debug.spec.ts
```

Expected:

- No unintended backend changes.
- No changes to `D:\workspace\MMD project2`.
- `classic` behavior changes are test-only assertions, not implementation changes.

**Step 7: Final commit**

If all verification passes and no additional files are needed:

```powershell
git add web/src/app/companion/page.tsx web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs web/tests/e2e/app-routes-smoke.spec.ts web/tests/e2e/mmd-stage-debug.spec.ts
git commit -m "feat: migrate source mmd rendering behavior to genshin pipeline"
```

If commits were already made task-by-task, this final step should only report the clean status and verification evidence.

---

## Rollback Strategy

If `genshin` changes cause issues:

- Revert only the `genshin` material helper commit first.
- Keep the UI/session commit only if the runtime can still render the existing `genshin` preset.
- Never revert unrelated user changes.
- Do not change `classic` to compensate for `genshin` failures.

## Done Definition

The migration is complete only when:

- `Classic`, `Hero Shot`, and `Genshin` are selectable.
- `Genshin` persists across reload.
- Existing saved `genshin` sessions remain `genshin`.
- `classic` remains the default and passes all runtime regression tests.
- `genshin` uses source-inspired MMD material hygiene in its own branch.
- Runtime tests, basic checks, build, and relevant E2E tests have been run and their output recorded.

