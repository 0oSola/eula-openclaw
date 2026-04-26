# Hero-Shot Stage Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new procedural-only `hero-shot` render pipeline to `/companion`, expose it in the UI beside `classic`, and preserve the existing `classic` baseline without visual or behavioral regression.

**Architecture:** Keep one shared `MMDCompanionRuntime` and one shared `MMDStage`, but extend the presentation layer so `classic` and `hero-shot` resolve different camera/light/material/outline/backdrop/postfx presets. Do not fork model loading, VMD playback, stage interaction logic, or session semantics. Treat current `genshin` references as legacy state that should be migrated or normalized, not as the user-facing target mode.

**Tech Stack:** Next.js App Router, React 19, Three.js, three-stdlib, node:test, Playwright

---

### Task 1: Introduce `hero-shot` as a first-class pipeline id and normalize legacy session values

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/src/features/stage/MMDStage.tsx`
- Test: `web/tests/e2e/app-routes-smoke.spec.ts`

**Step 1: Write the failing test**

Update `web/tests/e2e/app-routes-smoke.spec.ts` so the pipeline smoke no longer expects `genshin` and instead verifies:

- the render-pipeline `<select>` contains `Classic` and `Hero Shot`
- selecting `hero-shot` persists across reload
- the page does not silently normalize `hero-shot` back to `classic`

Suggested replacement shape for the existing pipeline smoke:

```ts
test("companion render pipeline selection persists across reloads @smoke", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  const pipelineSelect = page.getByRole("combobox", { name: "Render pipeline" });
  await expect(pipelineSelect).toBeVisible();
  await expect(pipelineSelect).toHaveValue("classic");

  await pipelineSelect.selectOption("hero-shot");
  await expect(pipelineSelect).toHaveValue("hero-shot");

  await page.reload();

  await expect(page.getByRole("combobox", { name: "Render pipeline" })).toHaveValue("hero-shot");
});
```

Add one small backward-compatibility case to the same file or a sibling smoke:

- seed `localStorage` with `{ renderPipeline: "genshin" }`
- confirm the page upgrades it to `hero-shot` or falls back deterministically to `classic`

Recommendation: migrate legacy `genshin` -> `hero-shot` once, then persist the upgraded value.

**Step 2: Run test to verify it fails**

Run:

```powershell
cmd /c ""C:\nvm4w\nodejs\npm.cmd" exec -- playwright test tests/e2e/app-routes-smoke.spec.ts --reporter=list
```

Expected: FAIL because:

- `page.tsx` only exposes `Classic`
- the `renderPipeline` state and handler still use `"classic" | "genshin"`
- mount logic force-resets non-`classic` values to `classic`

**Step 3: Write minimal implementation**

In `web/src/lib/types.ts`:

- change `UserSession.renderPipeline` from:

```ts
renderPipeline?: "classic" | "genshin";
```

to:

```ts
renderPipeline?: "classic" | "hero-shot" | "genshin";
```

This preserves ability to read old saved sessions.

In `web/src/features/stage/MMDStage.tsx`:

- extend the prop type from `"classic" | "genshin"` to `"classic" | "hero-shot" | "genshin"`
- keep the default prop value as `"classic"`

In `web/src/app/companion/page.tsx`:

- change local state type to:

```tsx
const [renderPipeline, setRenderPipeline] = useState<"classic" | "hero-shot">("classic");
```

- add a tiny normalizer near the component top:

```tsx
function normalizeRenderPipeline(value?: string): "classic" | "hero-shot" {
  if (value === "hero-shot" || value === "genshin") return "hero-shot";
  return "classic";
}
```

- replace the current mount-time force reset logic with:
  - load session
  - compute `normalizedPipeline`
  - call `setRenderPipeline(normalizedPipeline)`
  - if the saved value was `genshin`, immediately persist the migrated session with `hero-shot`

- update `handleRenderPipelineChange()` to accept `"classic" | "hero-shot"` and stop coercing non-`classic` values back to `classic`

- update the `<select>` to:

```tsx
onChange={(event) => handleRenderPipelineChange(event.target.value as "classic" | "hero-shot")}
```

- add:

```tsx
<option value="hero-shot">Hero Shot</option>
```

**Step 4: Run test to verify it passes**

Run the same Playwright command and confirm:

- the pipeline combobox shows both options
- `hero-shot` persists across reload
- no forced fallback to `classic`

**Step 5: Commit**

```bash
git add web/src/lib/types.ts web/src/features/stage/MMDStage.tsx web/src/app/companion/page.tsx web/tests/e2e/app-routes-smoke.spec.ts
git commit -m "feat: add hero-shot pipeline selection and legacy migration"
```

---

### Task 2: Add a dedicated `hero-shot` presentation preset without mutating `classic`

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

Add a new runtime config test beside the existing presentation preset tests:

```js
test("stage presentation config supports hero-shot while preserving classic fallback", () => {
  const classic = getStagePresentationConfig("classic");
  const heroShot = getStagePresentationConfig("hero-shot");

  assert.equal(classic.camera.fov, 36);
  assert.notDeepEqual(heroShot.camera.position, classic.camera.position);
  assert.ok(heroShot.outline?.enabled);
  assert.ok(heroShot.backdrop?.enabled);
  assert.ok(heroShot.postfx?.enabled);
  assert.deepEqual(getStagePresentationConfig("unknown"), classic);
});
```

Also keep the existing `classic` assertions unchanged. Do not weaken them.

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL because `hero-shot` preset does not exist yet.

**Step 3: Write minimal implementation**

In `web/src/features/stage/mmdCompanionRuntime.js`:

- add a new `hero-shot` entry to `STAGE_PRESENTATION_PRESETS`
- do not edit numeric values inside `classic`
- do not replace `classic` fallback behavior

Initial `hero-shot` preset should differ from `classic` in at least:

- `camera.fov`
- `camera.position`
- `camera.target`
- stronger face/key readability
- outline enabled
- backdrop enabled
- floor rings/glow enabled
- postfx enabled

Recommended first-pass camera:

```js
camera: {
  fov: 28,
  position: [0, 8.6, 18.8],
  target: [0, 7.4, 0],
  minDistance: 11,
  maxDistance: 24,
  maxPolarAngle: Math.PI * 0.4,
}
```

Recommended first-pass light direction:

- key: warm-neutral frontal left
- fill: cool frontal right
- rim: cool rear
- ambient/hemisphere slightly stronger than `classic`

Do not move any runtime motion logic in this task.

**Step 4: Run test to verify it passes**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: the new hero-shot preset assertions pass and existing classic assertions remain green.

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add hero-shot stage presentation preset"
```

---

### Task 3: Add hero-shot-specific material tuning and keep `classic` material behavior intact

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

Add a focused material regression test:

```js
test("hero-shot material tuning differs from classic while preserving alpha safety", () => {
  const classic = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const hero = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

  tuneClassicMMDMaterial(classic, {});
  tuneHeroShotMMDMaterial(hero, {});

  assert.ok(classic.alphaTest >= 0.48);
  assert.ok(hero.alphaTest >= 0.48);
  assert.notEqual(hero.emissiveIntensity, classic.emissiveIntensity);
  assert.notEqual(hero.gradientMap, null);
});
```

Also add one profile-oriented test for face-specific behavior:

```js
test("hero-shot keeps face shading softer than generic cloth shading", () => {
  // compare a face-ish material and a cloth-ish material under hero-shot tuning
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL because only current tuning behavior exists.

**Step 3: Write minimal implementation**

Inside `web/src/features/stage/mmdCompanionRuntime.js`:

- split the current tuning path into explicit branches:
  - `tuneClassicMMDMaterial(material, toonRampTexture)`
  - `tuneHeroShotMMDMaterial(material, toonRampTexture)`
- keep `classic` branch as close to current behavior as possible
- add a tiny dispatcher:

```js
function tuneMaterialByPipeline(material, toonRampTexture, pipeline) {
  if (pipeline === "hero-shot") return tuneHeroShotMMDMaterial(material, toonRampTexture);
  return tuneClassicMMDMaterial(material, toonRampTexture);
}
```

- update `loadModel()` to call the dispatcher using `this.renderPipeline`

`hero-shot` tuning goals:

- face and skin: softer shading, less harsh contrast
- hair: stronger separation than skin, still alpha-safe
- cloth: readable folds, lower plastic gloss
- metal: keep controlled highlight emphasis
- eyelashes / eyebrows / cutout elements: preserve alphaTest safety

Stay procedural:

- reuse `createToonRampTexture()` or add a pipeline-aware ramp generator
- do not load external gradient/ramp textures

**Step 4: Run test to verify it passes**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: new material assertions pass and old model/material tests stay green.

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add hero-shot material tuning profiles"
```

---

### Task 4: Refine hero-shot outline, floor, backdrop, and postfx as a procedural showcase layer

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js`
- Test: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing test**

Add runtime assertions covering the hero-shot visual stack:

```js
test("hero-shot enables outline, backdrop, and postfx without affecting classic direct render", () => {
  const classic = makeRuntime({ renderPipeline: "classic" });
  const hero = makeRuntime({ renderPipeline: "hero-shot" });

  assert.equal(classic.shouldUsePostFX(getStagePresentationConfig("classic")), false);
  assert.equal(hero.shouldUsePostFX(getStagePresentationConfig("hero-shot")), true);
  assert.equal(getStagePresentationConfig("hero-shot").outline.enabled, true);
  assert.equal(getStagePresentationConfig("hero-shot").backdrop.enabled, true);
});
```

Add one outline-style test:

```js
test("hero-shot outline uses softer profile than pure black body outlines", () => {
  // verify outline color / opacity / scale stay in the intended range
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL until hero-shot visual details are fully wired.

**Step 3: Write minimal implementation**

In `web/src/features/stage/mmdCompanionRuntime.js`:

- extend backdrop/floor/postfx numbers for `hero-shot`
- keep all assets procedural:
  - use generated gradients
  - use generated halo textures
  - use generated concentric rings

Hero-shot outline rules:

- keep geometry outline approach
- face meshes get thinner, lower-opacity edges
- body/hair may be slightly fuller
- use blue-gray / charcoal-blue outline color, not pure black

Hero-shot floor/backdrop rules:

- deeper blue field than `classic`
- one primary character halo
- one or two luminous stage rings
- softer contact grounding than a plain flat floor

Hero-shot postfx rules:

- enable composer path
- use subtle color grading
- keep bloom mild enough that line work stays crisp

Do not modify the `classic` render path in this task beyond explicit branching.

**Step 4: Run test to verify it passes**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
npm --prefix web run build
```

Expected:

- runtime tests pass
- production build succeeds after hero-shot visual changes

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add hero-shot procedural visual stack"
```

---

### Task 5: Update companion UI and smoke tests to support `hero-shot` as the user-facing showcase mode

**Files:**
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/tests/e2e/app-routes-smoke.spec.ts`
- Modify: `web/tests/e2e/mmd-stage-debug.spec.ts`

**Step 1: Write the failing test**

In `web/tests/e2e/mmd-stage-debug.spec.ts`, replace the existing `genshin` selection with `hero-shot`:

```ts
await pipelineSelect.selectOption("hero-shot");
await expect(pipelineSelect).toHaveValue("hero-shot");
```

In `web/tests/e2e/app-routes-smoke.spec.ts`, extend the existing pipeline smoke so it also checks:

- the `Hero Shot` option is present in the select list
- switching to `hero-shot` hides or alters the same HUD elements that currently depend on a non-classic stage presentation
- reload preserves `hero-shot`

If those hidden/visible assertions are too tightly coupled to old `genshin` styling, replace them with simpler pipeline-agnostic assertions:

- value changes
- no console errors
- canvas remains visible
- stage wrap remains visible

**Step 2: Run test to verify it fails**

Run:

```powershell
cmd /c ""C:\nvm4w\nodejs\npm.cmd" exec -- playwright test tests/e2e/app-routes-smoke.spec.ts tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected: FAIL until all UI-facing references move from `genshin` to `hero-shot`.

**Step 3: Write minimal implementation**

In `web/src/app/companion/page.tsx`:

- ensure the pipeline select renders:

```tsx
<option value="classic">Classic</option>
<option value="hero-shot">Hero Shot</option>
```

- ensure `data-render-pipeline={renderPipeline}` continues to update, since CSS/HUD tests may depend on it

- if any current CSS or stage-wrap behavior depends on `"genshin"`, introduce a single helper:

```tsx
const isShowcasePipeline = renderPipeline === "hero-shot";
```

and use that instead of checking `"genshin"`.

Important:

- do not let UI copy mention `genshin`
- keep `classic` default and selected at first load

**Step 4: Run test to verify it passes**

Run:

```powershell
cmd /c ""C:\nvm4w\nodejs\npm.cmd" exec -- playwright test tests/e2e/app-routes-smoke.spec.ts tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected:

- route smoke passes
- stage debug passes
- hero-shot can be selected and survives reload

**Step 5: Commit**

```bash
git add web/src/app/companion/page.tsx web/tests/e2e/app-routes-smoke.spec.ts web/tests/e2e/mmd-stage-debug.spec.ts
git commit -m "feat: expose hero-shot pipeline in companion ui"
```

---

### Task 6: Lock regression baseline and verify classic remains untouched

**Files:**
- Modify: `web/tests/mmd-render-runtime.test.mjs`
- Modify: `web/tests/e2e/app-routes-smoke.spec.ts`
- Optional Update: `docs/plans/2026-04-26-hero-shot-stage-pipeline-spec.md`

**Step 1: Write the failing test**

Add one explicit regression test in `web/tests/mmd-render-runtime.test.mjs` that keeps `classic` fixed:

```js
test("classic presentation baseline remains unchanged after hero-shot additions", () => {
  const classic = getStagePresentationConfig("classic");

  assert.equal(classic.camera.fov, 36);
  assert.deepEqual(classic.camera.position, [0, 9.6, 24]);
  assert.equal(classic.outline.enabled, false);
  assert.equal(classic.postfx.enabled, false);
});
```

If any current smoke tests implicitly assume old `genshin` behavior, rewrite them so they assert:

- `classic` still works
- `hero-shot` works
- no user-facing regression occurs

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
```

Expected: FAIL if classic preset drifted during hero-shot work.

**Step 3: Write minimal implementation**

Only fix actual regressions:

- restore any changed `classic` preset values
- restore any accidentally shared hero-shot material tweaks
- restore any postfx/outline defaults that leaked into classic

Do not add new features in this task.

**Step 4: Run full verification**

Run:

```powershell
node --test web/tests/mmd-render-runtime.test.mjs
npm --prefix web run check:basic
npm --prefix web run build
cmd /c ""C:\nvm4w\nodejs\npm.cmd" exec -- playwright test tests/e2e/app-routes-smoke.spec.ts tests/e2e/mmd-stage-debug.spec.ts --reporter=list
```

Expected:

- all runtime tests PASS
- `check:basic` PASS
- production build PASS
- Playwright smoke PASS

**Step 5: Commit**

```bash
git add web/tests/mmd-render-runtime.test.mjs web/tests/e2e/app-routes-smoke.spec.ts web/tests/e2e/mmd-stage-debug.spec.ts docs/plans/2026-04-26-hero-shot-stage-pipeline-spec.md
git commit -m "test: lock classic baseline and hero-shot regression coverage"
```

---

Plan complete and saved to `docs/plans/2026-04-26-hero-shot-stage-pipeline-implementation.md`.

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
