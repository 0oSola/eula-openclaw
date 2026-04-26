# Favorite VMD Loop Design

**Date:** 2026-04-26

**Status:** Draft for confirmation

**Goal**

After the model finishes initializing, automatically loop through the current model's favorited VMD motions. The runtime must play a randomly selected favorite motion, then reset through the special standby motion named `进场待机` / `entry idle`, then select the next random favorite motion. This cycle continues until interrupted by model switching or another higher-priority interaction. If the only favorite is the standby motion itself, loop that standby motion continuously.

---

## Scope

This feature applies only to the stage runtime on the companion page and only to the current model's favorites list.

In scope:

- Detect current-model favorite VMD assets from the existing favorites data.
- Build an automatic playback plan after model initialization.
- Insert `进场待机` between favorite motions.
- Resume the automatic loop after temporary manual or chat-triggered motions finish.
- Rebuild the loop when the selected model changes.

Out of scope:

- Backend schema changes.
- New persistent settings for enabling/disabling auto favorite loop.
- New UI controls for loop mode selection.

---

## Current-Code Fit

The current frontend/runtime already has most of the needed primitives:

- `currentModelFavoriteAssets` in `web/src/app/companion/page.tsx`
- VMD interaction fields:
  - `vmdUrl`
  - `vmdLoopUrls`
  - `standbyVmdUrl`
  - `loopMode`
  - `loopGapMs`
- Runtime VMD end detection in `web/src/features/stage/mmdCompanionRuntime.js`
- Existing standby-name detection helper pattern in `web/src/features/mapping/vmdPreview.js`

The feature should therefore be implemented as frontend orchestration plus runtime loop-state refinement, without changing the API contract.

---

## Asset Classification Rules

For the current selected model, use the existing model-scoped favorites list as the source pool:

- Source: `currentModelFavoriteAssets`
- `standbyAsset`: the first favorite asset whose `display_name` or `filename` matches either:
  - `进场待机`
  - `entry idle`
- `playableAssets`: all other favorite assets with a valid `url`

Matching should reuse or centralize the existing standby-name detection logic so the same rule is used consistently across preview and autoplay.

---

## Playback Rules

### Normal case: standby + one or more non-standby favorites

When the model is ready:

1. Randomly select one asset from `playableAssets`.
2. Play it once.
3. After it ends, play `standbyAsset` once.
4. After standby ends, randomly select the next asset from `playableAssets`.
5. Continue indefinitely.

Random selection rule:

- Avoid selecting the same non-standby favorite twice in a row when there are 2 or more playable assets.
- If there is only 1 playable asset, repeat it as needed.

### Special case: only standby is favorited

If `standbyAsset` exists and `playableAssets` is empty:

- Start playback with `standbyAsset`
- After it ends, play `standbyAsset` again
- Continue indefinitely

### Fallback case: no standby, but there are non-standby favorites

If no standby asset is detected, but `playableAssets` is non-empty:

- Randomly loop through `playableAssets` directly
- Do not insert a standby transition

This avoids total feature failure due to missing or inconsistent naming.

### Empty case: no favorites at all

If the current model has no favorited VMD assets:

- Do not start automatic VMD loop playback
- Keep the existing default idle/procedural state

---

## Priority and Resume Rules

Automatic favorite looping is the background/default stage mode for the selected model, but it is not absolute priority.

Higher-priority interactions:

- Manual VMD preview from the advanced panel
- Manual built-in motion preview
- Chat-triggered motion playback

Behavior:

1. When a higher-priority interaction starts, it temporarily overrides the automatic favorite loop.
2. After that temporary interaction finishes, the stage must resume automatic favorite looping.
3. Resume sequence should begin from standby if standby exists:
   - `进场待机` once
   - then next random favorite motion
4. If no standby exists, resume directly with the next random favorite motion.
5. If only standby is favorited, resume by replaying standby.

This keeps transitions visually stable and satisfies the requirement that the character resets through the standby motion between content motions.

---

## Model Switching Rules

When the selected model changes:

1. Cancel any active automatic favorite loop state for the previous model.
2. Recompute `standbyAsset` and `playableAssets` for the new model's favorites.
3. After the new model finishes loading, start that model's automatic loop from its own pool.
4. Previous-model autoplay state must not bleed into the new model.

---

## Recommended Implementation Approach

### 1. Centralize autoplay-plan generation

Extend the VMD preview helper layer so it can produce a normalized autoplay plan from a model's favorite assets.

Recommended helper output:

- `vmdUrl`: first clip to play
- `vmdLoopUrls`: non-standby random pool
- `standbyVmdUrl`: standby motion URL if available
- `loopMode`: `random`
- `playbackRate`: derived from the starting asset
- extra internal metadata if needed for resume decisions

### 2. Let the page own autoplay intent

In `web/src/app/companion/page.tsx`:

- derive the current model's autoplay candidate plan from favorites
- apply it automatically after model selection / model data load
- track whether the current stage interaction is:
  - background autoplay
  - temporary manual override
  - temporary chat override
- when a temporary override finishes, restore autoplay

### 3. Refine runtime end-of-clip looping

In `web/src/features/stage/mmdCompanionRuntime.js`:

- preserve the current loop timing mechanism
- change the next-clip selection logic from:
  - "clip ended -> pick next loop URL"
- to:
  - "non-standby clip ended -> play standby once if standby exists"
  - "standby clip ended -> pick next non-standby loop URL"
  - "standby-only mode -> replay standby"

The runtime should explicitly know whether the just-finished clip was:

- a standby clip
- a non-standby loop clip
- a fallback direct-loop clip

That state is necessary to implement the two-step cycle correctly.

---

## State Model

Suggested conceptual state inside runtime:

- `currentVmdUrl`
- `currentVmdLoopUrls`
- `currentVmdStandbyUrl`
- `currentVmdLoopMode`
- `lastPlayedLoopMotionUrl`
- `currentAutoplayPhase`
  - `loop`
  - `standby`
  - `standby-only`
  - `fallback-loop`

Suggested conceptual state inside page:

- `autoFavoriteInteraction` for the current model
- `shouldResumeAutoFavoriteLoop`
- optional source tag on current interaction:
  - `autoplay`
  - `manual-preview`
  - `chat`

The exact shape can vary, but the implementation needs enough state to distinguish background autoplay from temporary overrides.

---

## Error Handling

- If one autoplay VMD fails to load, skip to the next valid candidate rather than leaving the stage stuck.
- If standby fails to load and there are playable favorites, continue with direct random looping.
- If the selected model changes during VMD load, ignore stale loads using the existing token/cancellation pattern.
- If favorites are updated while autoplay is active, rebuild the autoplay plan from the latest list.

---

## Verification Targets

Minimum behaviors to verify during implementation:

1. Model loads with standby + multiple favorites:
   - first random favorite plays
   - standby plays next
   - another random favorite plays next
2. Model loads with only standby favorited:
   - standby loops continuously
3. Model loads with favorites but no standby:
   - favorites loop randomly without standby insertion
4. Manual preview during autoplay:
   - preview interrupts autoplay
   - autoplay resumes from standby, then continues
5. Chat-triggered motion during autoplay:
   - chat motion interrupts autoplay
   - autoplay resumes from standby, then continues
6. Model switch:
   - previous model loop stops
   - new model favorites determine the new autoplay plan

---

## Files Expected To Change During Development

- `web/src/app/companion/page.tsx`
- `web/src/features/mapping/vmdPreview.js`
- `web/src/features/stage/MMDStage.tsx`
- `web/src/features/stage/mmdCompanionRuntime.js`
- `web/tests/vmd-preview-check.mjs`
- `web/tests/mmd-render-runtime.test.mjs`
- additional focused tests if needed

---

## Open Confirmation

This design assumes:

- autoplay should start automatically whenever the model is initialized and favorites are available
- resume after interruption should prefer standby first
- standby detection continues to rely on naming convention rather than explicit metadata

If this matches your intent, the next step is to turn it into an implementation plan and then develop it.
