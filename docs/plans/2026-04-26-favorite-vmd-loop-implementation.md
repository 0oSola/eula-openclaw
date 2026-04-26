# Favorite VMD Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build automatic current-model favorite VMD looping with standby insertion, standby-only looping, and autoplay resume after temporary manual/chat overrides.

**Architecture:** Keep the feature entirely in the frontend. Extend the favorite-loop helper in `vmdPreview.js`, refine VMD phase handling in `mmdCompanionRuntime.js`, and let `companion/page.tsx` own when autoplay should start, pause, and resume for the currently selected model.

**Tech Stack:** Next.js 15, React 19, plain JS/TS in `web/src`, Node built-in test runner, existing assertion scripts in `web/tests`

> **Status note (2026-04-26):** The task list below captures the original standby-first implementation direction. After runtime debugging, pose-stability constraints and a temporary standby exclusion were added. Treat the "Post-debugging update" section below as the current safety baseline.

---

**Implementation context**

- The repo is already dirty. Execute this plan in a dedicated worktree before touching app code.
- Relevant design doc: `docs/plans/2026-04-26-favorite-vmd-loop-design.md`
- Relevant files today:
  - `web/src/features/mapping/vmdPreview.js:15-64`
  - `web/src/features/stage/mmdCompanionRuntime.js:327-341,1233-1341,1453-1459`
  - `web/src/features/stage/MMDStage.tsx:9-18,75-110`
  - `web/src/app/companion/page.tsx:201-211,226-259,351-360,395-482`

**Post-debugging update**

Recent runtime debugging changed the safe implementation envelope for favorite VMD looping.

1. Cross-clip pose drift root cause

- The main "model becomes increasingly distorted after several VMDs" bug came from `MMDLoader` building new skeletal tracks against the model's current live bone positions.
- That means autoplay can accidentally bake the previous clip's deformation into the next clip, especially in leg / IK chains.
- The runtime now avoids this by building VMD clips against a captured base skeleton snapshot (`animationBuildTarget`) instead of the currently animated mesh.

2. Runtime constraints that must not regress

- `resetToBasePose()` must restore all captured bone local transforms, not just a few named torso / arm bones.
- Hard-cut / helper-swap VMD transitions must reset to the captured base pose before attaching the next clip.
- VMD anchor stabilization must stay limited to root transport anchors:
  - `allparent`
  - `center`
  - `groove`
- Do not reintroduce leg / toe IK anchor pinning. Earlier experiments in that direction caused unnatural stretching and did not solve the underlying clip-build issue.
- Do not restore an intermediate "physics only" helper state before the next clip is attached. The swap path should move directly from reset -> remove helper state -> add next animation clip.

3. Standby behavior is temporarily narrowed

- The original plan assumes `杩涘満寰呮満` / `entry idle` is inserted between favorites and on autoplay resume.
- The current implementation temporarily excludes entry-standby assets from autoplay pools and advanced-panel display because the available standby asset introduced loop stalls and made pose debugging harder.
- In the current code path, autoplay loops directly across playable favorites and `standbyVmdUrl` is intentionally left empty.

4. Conditions for any future standby re-enable

- Re-enabling standby insertion is allowed only if repeated multi-clip playback proves:
  - no accumulated leg / IK drift
  - no loop stall when standby timing metadata is missing or zero
  - no helper-swap residual pose contamination
- Any future batch that revisits standby must add regression coverage for those exact failure modes before changing autoplay behavior.
- The original task list below is therefore historical context, not a drop-in execution recipe for the current codebase.

### Task 1: Lock favorite-loop helper behavior with tests

**Files:**
- Modify: `web/src/features/mapping/vmdPreview.js:15-64`
- Modify: `web/tests/vmd-preview-check.mjs`
- Modify: `web/tests/run-basic-checks.mjs`

**Step 1: Write the failing helper assertions**

Add coverage for these cases in `web/tests/vmd-preview-check.mjs`:

```js
assert.deepEqual(
  createDefaultFavoriteLoopInteraction([
    { display_name: "进场待机.vmd", filename: "进场待机.vmd", slot: "neutral", url: "/standby.vmd" },
    { display_name: "wave.vmd", filename: "wave.vmd", slot: "happy", url: "/wave.vmd" },
    { display_name: "nod.vmd", filename: "nod.vmd", slot: "happy", url: "/nod.vmd" },
  ]),
  {
    emotion: "happy",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/wave.vmd",
    vmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
    standbyVmdUrl: "/standby.vmd",
    loopMode: "random",
    playbackRate: 1.2,
    sequence: [],
  },
);

assert.deepEqual(
  createDefaultFavoriteLoopInteraction([
    { display_name: "进场待机.vmd", filename: "进场待机.vmd", slot: "neutral", url: "/standby.vmd" },
  ]),
  {
    emotion: "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/standby.vmd",
    vmdLoopUrls: [],
    standbyVmdUrl: "/standby.vmd",
    loopMode: "random",
    playbackRate: 1.2,
    sequence: [],
  },
);
```

Mirror the same cases in `web/tests/run-basic-checks.mjs` so the smoke script also protects the helper contract.

**Step 2: Run helper tests to verify they fail**

Run: `node web/tests/vmd-preview-check.mjs`

Expected: FAIL because `standbyVmdUrl` is missing and the standby-only case currently returns `null`.

**Step 3: Implement the minimal helper change**

Update `createDefaultFavoriteLoopInteraction()` in `web/src/features/mapping/vmdPreview.js` so it:

- extracts the first standby asset
- returns standby metadata explicitly
- supports standby-only mode
- preserves direct random looping when standby is absent

Implementation shape:

```js
const standbyAsset = assetsWithUrls.find(isEntryStandbyAsset) || null;
const playableAssets = assetsWithUrls.filter((asset) => asset.url && asset !== standbyAsset);
const leadAsset = playableAssets[0] || standbyAsset;

if (!leadAsset) return null;

return {
  emotion: leadAsset.slot || "neutral",
  action: "idle",
  mode: "vmd",
  vmdUrl: leadAsset.url,
  vmdLoopUrls: playableAssets.map((asset) => asset.url),
  standbyVmdUrl: standbyAsset?.url || "",
  loopMode: loopMode === "sequential" ? "sequential" : "random",
  playbackRate: resolveVmdPlaybackRate(leadAsset),
  sequence: [],
};
```

**Step 4: Run helper tests to verify they pass**

Run: `node web/tests/vmd-preview-check.mjs`

Expected: PASS with `vmd preview checks passed`.

**Step 5: Run basic smoke checks**

Run: `node web/tests/run-basic-checks.mjs`

Expected: PASS with `basic checks passed`.

**Step 6: Commit**

```bash
git add web/src/features/mapping/vmdPreview.js web/tests/vmd-preview-check.mjs web/tests/run-basic-checks.mjs
git commit -m "test: define favorite VMD loop helper behavior"
```

### Task 2: Add runtime phase handling for standby transitions

**Files:**
- Modify: `web/src/features/stage/mmdCompanionRuntime.js:327-341,1233-1341`
- Modify: `web/tests/mmd-render-runtime.test.mjs`

**Step 1: Write the failing runtime tests**

Add focused tests in `web/tests/mmd-render-runtime.test.mjs` for:

- non-standby loop clip ends -> standby plays next
- standby ends -> next random loop clip plays
- standby-only mode -> standby replays
- `applyStageRuntimeState()` passes `standbyVmdUrl` through `playVmd()`

Suggested test shape:

```js
test("updateVmdLoop inserts standby between loop clips", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip" },
    currentVmdPlaybackRate: 1.2,
    currentVmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
    currentVmdStandbyUrl: "/standby.vmd",
    currentVmdUrl: "/wave.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 500,
    currentVmdLoopPhase: "loop",
    playVmd(url, rate, loopUrls, options) {
      playCalls.push([url, rate, loopUrls, options]);
    },
  });

  runtime.updateVmdLoop(1600);
  assert.deepEqual(playCalls[0], [
    "/standby.vmd",
    1.2,
    ["/wave.vmd", "/nod.vmd"],
    { standbyUrl: "/standby.vmd", loopMode: "random", resumePhase: "standby" },
  ]);
});
```

**Step 2: Run runtime tests to verify they fail**

Run: `node --test web/tests/mmd-render-runtime.test.mjs`

Expected: FAIL because the runtime currently jumps directly to the next loop URL and does not track standby/loop phases.

**Step 3: Implement minimal runtime phase state**

Add explicit VMD phase tracking in `web/src/features/stage/mmdCompanionRuntime.js`.

Recommended fields:

```js
this.currentVmdLoopPhase = "loop";
this.currentVmdResumeAfterClip = false;
```

Update:

- `applyStageRuntimeState()` to forward `standbyVmdUrl`
- `clearModel()` and `applyInteraction()` to reset the new fields
- `playVmd()` to record whether the current clip is:
  - standby-only
  - standby transition
  - regular loop clip
- `updateVmdLoop()` to branch as:

```js
if (standbyOnlyMode) {
  replayStandby();
  return;
}

if (currentPhase === "loop" && standbyUrl) {
  playStandbyOnce();
  return;
}

playNextLoopClip();
```

Preserve existing random/sequential picker behavior for choosing the next non-standby loop clip.

**Step 4: Run runtime tests to verify they pass**

Run: `node --test web/tests/mmd-render-runtime.test.mjs`

Expected: PASS including the new standby transition tests.

**Step 5: Commit**

```bash
git add web/src/features/stage/mmdCompanionRuntime.js web/tests/mmd-render-runtime.test.mjs
git commit -m "feat: add standby-aware VMD runtime looping"
```

### Task 3: Add page-level autoplay orchestration and resume behavior

**Files:**
- Modify: `web/src/app/companion/page.tsx:201-211,226-259,351-360,395-482`
- Modify: `web/src/features/stage/MMDStage.tsx:9-18`

**Step 1: Write the failing page-level logic targets**

Before editing behavior, add small pure helpers inside `page.tsx` or extract them nearby so they can be reasoned about deterministically:

- `buildAutoFavoriteInteraction(favorites)`
- `buildAutoplayResumeInteraction(favorites)`

Target behavior:

```ts
const auto = buildAutoFavoriteInteraction(currentModelFavoriteAssets);
const resume = buildAutoplayResumeInteraction(currentModelFavoriteAssets);
```

Expected:

- autoplay starts with the helper output from Task 1
- resume prefers standby first when standby exists
- standby-only favorites resume by replaying standby

If extraction is awkward, document the expected control-flow in comments and cover the behavior indirectly in Task 4 verification.

**Step 2: Run targeted tests to confirm no existing coverage protects this yet**

Run: `node web/tests/run-basic-checks.mjs`

Expected: PASS before implementation, confirming Task 3 still needs new app logic rather than helper/runtime changes.

**Step 3: Implement page-level autoplay state**

In `web/src/app/companion/page.tsx`, add explicit interaction-source tracking:

```ts
type InteractionSource = "default" | "autoplay" | "manual-preview" | "chat";

const [interactionSource, setInteractionSource] = useState<InteractionSource>("default");
const autoFavoriteInteraction = useMemo(
  () => createDefaultFavoriteLoopInteraction(currentModelFavoriteAssets),
  [currentModelFavoriteAssets],
);
```

Implement these rules:

- after model data is ready and a selected model exists, if autoplay interaction is available and there is no active higher-priority interaction, apply it
- manual preview and built-in preview set source to `manual-preview`
- chat playback sets source to `chat`
- reset button sets source back to `default`
- model switch clears temporary override state and allows autoplay for the new model

Extend the interaction type in `MMDStage.tsx` if needed so standby/autoplay fields are typed consistently.

**Step 4: Implement autoplay resume after temporary overrides**

After a temporary override is dispatched, the page must queue autoplay restoration.

Recommended approach:

- store a `pendingAutoResume` boolean or a `resumeInteractionRef`
- when a manual/chat VMD finishes, restore:
  - standby-first interaction if standby exists
  - direct autoplay interaction otherwise

Concrete resume interaction shape:

```ts
{
  ...autoFavoriteInteraction,
  vmdUrl: autoFavoriteInteraction.standbyVmdUrl || autoFavoriteInteraction.vmdUrl,
}
```

This ensures the runtime re-enters the correct cycle:

- standby first if present
- then next random loop motion

**Step 5: Run smoke checks**

Run: `node web/tests/run-basic-checks.mjs`

Expected: PASS. No helper contract should regress while page orchestration changes.

**Step 6: Commit**

```bash
git add web/src/app/companion/page.tsx web/src/features/stage/MMDStage.tsx
git commit -m "feat: wire favorite VMD autoplay into companion page"
```

### Task 4: Verify integrated autoplay behavior

**Files:**
- Modify if needed: `web/tests/mmd-render-runtime.test.mjs`
- Modify if needed: `web/tests/run-basic-checks.mjs`

**Step 1: Add one integration-focused regression case if gaps remain**

If Task 2 and Task 3 leave a gap, add one more focused test that proves resume enters standby-first mode after a temporary override.

Example runtime-oriented fallback test:

```js
test("applyStageRuntimeState replays standby first when resume interaction uses standby as vmdUrl", () => {
  const calls = [];
  applyStageRuntimeState(
    {
      setSpeaking() {},
      applyInteraction(value) {
        calls.push(["interaction", value]);
      },
      playVmd(url, rate, loopUrls, options) {
        calls.push(["vmd", url, rate, loopUrls, options]);
      },
    },
    {
      interaction: {
        mode: "vmd",
        emotion: "neutral",
        action: "idle",
        vmdUrl: "/standby.vmd",
        vmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
        standbyVmdUrl: "/standby.vmd",
        loopMode: "random",
      },
    },
  );
```

**Step 2: Run focused tests**

Run:

- `node web/tests/vmd-preview-check.mjs`
- `node web/tests/run-basic-checks.mjs`
- `node --test web/tests/mmd-render-runtime.test.mjs`

Expected: all PASS.

**Step 3: Run repo basic check script**

Run: `npm --prefix web run check:basic`

Expected: PASS with the existing basic-check aggregator succeeding.

**Step 4: Commit**

```bash
git add web/tests/vmd-preview-check.mjs web/tests/run-basic-checks.mjs web/tests/mmd-render-runtime.test.mjs
git commit -m "test: cover favorite VMD autoplay integration"
```

### Task 5: Final manual verification

**Files:**
- No code changes required unless issues are found

**Step 1: Start the app stack**

Run: `& 'D:\workspace\MMD project\scripts\dev-stack.ps1' -Action start`

Expected: API and web dev services start successfully.

**Step 2: Manual verification checklist**

Verify these cases in the companion page:

1. Current model has standby + multiple favorites:
   - first non-standby favorite autoplays
   - standby plays after it
   - a different non-standby favorite follows
2. Current model has only standby favorite:
   - standby loops continuously
3. Current model has no standby but has favorites:
   - favorites loop directly
4. Manual preview during autoplay:
   - preview interrupts autoplay
   - autoplay resumes via standby first
5. Chat-triggered VMD during autoplay:
   - chat motion interrupts autoplay
   - autoplay resumes via standby first
6. Model switch:
   - old autoplay stops
   - new model autoplay starts from its own favorites

**Step 3: Stop the app stack**

Run: `& 'D:\workspace\MMD project\scripts\dev-stack.ps1' -Action stop`

Expected: local services stop cleanly.

**Step 4: Final commit if any manual-fix follow-up was needed**

```bash
git add <changed-files>
git commit -m "fix: polish favorite VMD autoplay behavior"
```
