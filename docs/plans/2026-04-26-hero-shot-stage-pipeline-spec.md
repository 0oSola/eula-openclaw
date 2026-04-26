# Hero-Shot Stage Pipeline Spec

**Date:** 2026-04-26

**Status:** Draft for confirmation

**Goal**

Add a new `hero-shot` render pipeline for the `/companion` MMD stage that produces a polished, game-like anime character presentation closer to the provided reference image, while leaving the existing `classic` pipeline visually and behaviorally unchanged.

---

## Core Constraints

This spec is governed by three hard constraints:

- `classic` is the baseline and must not regress.
- `hero-shot` is a new, independent pipeline, not a rewrite of `classic`.
- The first version must be fully procedural:
  - no new external ramp textures
  - no imported halo/ring/background art
  - no game-extracted material masks or face-light maps

The implementation may reuse the current stage runtime, model loading, VMD playback, and interaction logic, but the visual layer must be switchable by pipeline.

---

## Scope

In scope:

- Add a new render pipeline id: `hero-shot`
- Expose a runtime switcher in `/companion`
- Persist the selected pipeline in session storage
- Add a dedicated visual preset for:
  - camera
  - lights
  - toon ramp behavior
  - material tuning
  - outline
  - backdrop
  - floor treatment
  - post-processing
- Keep the existing MMD motion/runtime path shared across pipelines
- Add regression coverage proving `classic` remains intact

Out of scope:

- Replacing the `classic` style
- Requiring asset authors to provide custom shader metadata
- Perfect 1:1 replication of a commercial game's proprietary NPR renderer
- New backend schema or API changes
- New downloadable art packs or large texture bundles

---

## Current-Code Fit

The codebase already has most of the structural pieces needed for this feature.

Existing relevant files:

- `web/src/features/stage/mmdCompanionRuntime.js`
- `web/src/features/stage/MMDStage.tsx`
- `web/src/app/companion/page.tsx`
- `web/src/lib/session.ts`
- `web/tests/mmd-render-runtime.test.mjs`

Existing runtime support already present:

- pipeline-aware runtime construction in `MMDStage`
- switchable stage presentation presets in `mmdCompanionRuntime.js`
- multi-light setup
- procedural toon ramp generation
- geometry-based outline support
- procedural floor/backdrop layers
- color grading + bloom postfx

Important current limitation:

- `/companion` still hard-normalizes non-`classic` pipeline selection back to `classic` in `page.tsx`, so the UI and persistence layer currently do not allow a second visual mode to remain active.

This means the required work is not greenfield; it is mainly an isolation, refinement, and productization task.

---

## Product Definition

`hero-shot` is a presentation-oriented render mode optimized for a single anime-styled hero character standing center-frame in a clean showcase scene.

Target visual characteristics:

- brighter face and upper torso readability
- narrower camera and less perspective distortion
- soft but readable toon shadow steps
- restrained, elegant outline treatment
- luminous stage/floor accents
- polished blue-toned backdrop and halo elements
- mild bloom and color grading
- stable appearance during idle, speech, VMD playback, and model switching

This pipeline should feel like a premium character showcase rather than a general-purpose model viewer.

---

## Pipeline Model

The application must support at least these pipelines:

- `classic`
- `hero-shot`

Rules:

- `classic` remains the default.
- `classic` must keep its current appearance unless a bug fix is explicitly required.
- `hero-shot` must be implemented as a separate preset branch, not as conditionally mutating `classic`.
- Shared runtime systems must remain shared:
  - model load lifecycle
  - VMD playback
  - model switching
  - interaction completion
  - speech state
  - resize handling

Only the presentation layer should vary by pipeline.

---

## UI and Persistence Requirements

The `/companion` page must expose a visible render-pipeline switcher.

Requirements:

- Show both `Classic` and `Hero Shot` as user-facing options
- Default to `Classic` for first-time sessions
- Persist the current selection in the existing local session payload
- Restore the last selected pipeline on reload
- Switching pipelines may recreate the visual runtime, but must not crash the page or break core interaction flows

The current logic that force-resets any non-`classic` value to `classic` must be removed and replaced with proper validation:

- accepted values: `classic`, `hero-shot`
- unknown values fallback to `classic`

---

## Rendering Spec

### 1. Camera and Composition

`hero-shot` should use a more portrait-like showcase composition than `classic`.

Requirements:

- narrower FOV than `classic`
- tighter framing on the torso and head
- camera target biased toward the upper chest / face zone
- reduced perspective exaggeration
- character should remain centered and readable at rest

Desired outcome:

- the model reads like a character card / showcase render
- the face remains visually dominant
- the body does not feel stretched by a wide lens

### 2. Lighting

`hero-shot` should use a high-readability anime-lighting preset.

Required lighting pattern:

- strong frontal key
- soft cool fill
- gentle rim separation
- ambient + hemisphere support for shadow lift

Rules:

- the face must never collapse into muddy midtones
- the body should keep stylized contrast without turning harsh
- lighting must remain procedural and derived from preset values only

### 3. Toon Ramp and Material Profiles

`hero-shot` must not rely on one uniform material treatment for the whole character.

At minimum, materials must be tuned by profile:

- face
- skin
- hair
- cloth
- metal
- eye / lash / brow
- default

Expected behavior:

- face gets the softest shadow transition
- skin remains smooth and readable
- hair receives slightly stronger tonal separation
- cloth stays clean without plastic shine
- metal retains controlled specular emphasis

Procedural ramp generation remains allowed and preferred.

### 4. Outline

`hero-shot` should retain geometry-based outline, but tune it more carefully than the current generic pass.

Requirements:

- thinner outline on face-area meshes
- slightly fuller outline on body / hair
- cutout-safe behavior for alpha-tested materials
- avoid thick black borders
- use blue-gray or charcoal-blue rather than pure black

### 5. Backdrop and Floor

`hero-shot` must create a presentational stage space procedurally.

Required layers:

- deep blue background field or gradient plane
- soft halo behind the character
- decorative circular or orbital floor rings
- subtle contact/shadow grounding

Rules:

- all assets must be generated in code
- the backdrop must support the character rather than compete with it
- floor treatment should feel luminous but not noisy

### 6. Post-Processing

`hero-shot` may use postfx; `classic` must continue to render cleanly without adopting `hero-shot` grading.

Required postfx profile:

- mild bloom
- subtle color grading
- restrained exposure / contrast shaping

Rules:

- bloom must be low enough to preserve line clarity
- the scene must remain readable with UI overlays present
- if postfx becomes unstable or too expensive, the pipeline must degrade gracefully rather than affect `classic`

---

## Technical Architecture

The implementation should continue the existing runtime structure:

- one shared `MMDCompanionRuntime`
- one pipeline-specific presentation preset resolver
- one shared `MMDStage`
- one shared `/companion` interaction model

Recommended file ownership:

- `web/src/features/stage/mmdCompanionRuntime.js`
  - add `hero-shot` presentation preset
  - add pipeline-specific material tuning branch
  - add pipeline-specific visual configuration
- `web/src/features/stage/MMDStage.tsx`
  - extend accepted pipeline type
- `web/src/app/companion/page.tsx`
  - enable `hero-shot` selection in UI
  - remove forced fallback to `classic`
- `web/src/lib/session.ts`
  - continue storing the selected pipeline in the session object

No backend changes are required.

---

## Compatibility Rules

The following behaviors are mandatory:

- `classic` loads and renders exactly as before
- all current VMD playback features continue working in both pipelines
- model switching continues working in both pipelines
- stage reset / speech / dialogue flows continue working in both pipelines
- pipeline switching never mutates saved `classic` defaults

`hero-shot` may differ visually, but must not fork runtime semantics.

---

## Acceptance Criteria

This feature is complete only if all of the following are true:

- `/companion` exposes `Classic` and `Hero Shot`
- reloading the page restores the previously selected pipeline
- `classic` remains the default and matches current baseline behavior
- `hero-shot` is visibly different from `classic`
- `hero-shot` improves facial readability and showcase composition
- `hero-shot` uses only procedural visual assets
- model load, speech, VMD preview, favorites autoplay, and model switching still work
- no `classic` regression is introduced in runtime tests or build verification

---

## Verification Plan

Minimum verification:

- `node --test web/tests/mmd-render-runtime.test.mjs`
- `npm --prefix web run check:basic`
- `npm --prefix web run build`

Required regression assertions:

- `classic` config remains stable
- `hero-shot` config is independently selectable
- session persistence restores `hero-shot`
- material tuning differs between `classic` and `hero-shot`
- `hero-shot` outline/backdrop/postfx activate only for `hero-shot`
- `classic` direct-render path remains valid

Recommended manual QA:

- compare `Classic` vs `Hero Shot` on the same character
- verify face readability while idle
- verify appearance during multiple VMD previews
- verify no stage crash during pipeline switching
- verify UI readability over the brighter presentation mode

---

## Risks

Primary risks:

- `hero-shot` accidentally mutates `classic` behavior through shared helper functions
- aggressive bloom or grading reduces UI legibility
- one-size-fits-all toon tuning harms some PMX/PMD materials
- outline tuning may create artifacts on transparent hair or lashes

Mitigation:

- keep pipeline-specific branches explicit
- lock `classic` with regression tests
- use profile-based material tuning instead of global constants
- keep postfx conservative in version one

---

## Suggested Next Step

If this spec is approved, the next artifact should be an implementation plan that executes `hero-shot` in small TDD batches while preserving the current `classic` baseline.
