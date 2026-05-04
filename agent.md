# Project Agent Rules

## Default Delivery Flow

For medium-or-larger UI, interaction, architecture, or cross-file behavior changes, use this default workflow:

1. Align on requirements with the user first.
2. Write the agreed outcome into a local spec file in the repository.
3. Wait for user confirmation on that spec when the change has meaningful product or interaction impact.
4. Only then begin implementation.

This is the project-level default unless the user explicitly asks to skip or shorten the flow.

## What Counts As "Needs a Local Spec"

Write a local spec before coding when the change includes any of the following:

- New or changed interaction model
- UI layout or workspace restructuring
- Multi-component coordination
- New state model or view-switching behavior
- Any change where acceptance criteria are easier to verify from a written spec first

## Spec Expectations

The local spec should be concrete enough to guide implementation. When relevant, include:

- Goal and scope
- User-facing behavior
- Interaction rules
- State model
- Component boundaries
- DOM/layout structure
- Acceptance criteria

## Small Changes

Tiny fixes, narrow copy edits, or low-risk single-purpose changes do not require a spec unless the user asks for one.

## Reference-Match UI Flow

When the user asks for a UI element, icon, panel, or layout to match a provided design reference, screenshot, or mockup exactly or says things like:

- "和设计稿一致"
- "和参考图一致"
- "100% 还原"
- "完全对齐"
- "不要差不多"
- "按参考图硬对齐"

treat the task as a reference-match hard-alignment task rather than a normal visual polish task.

### Required Workflow

1. Align on scope first:
   - Ask or restate what exactly must match the reference.
   - Make the comparison boundary explicit, for example:
     - only the button
     - the button plus its container edge
     - the whole bar section
2. Write a local spec before implementation.
3. In that spec, include measurable acceptance criteria for the matched area whenever possible.
4. After user confirmation, implement.
5. Before declaring the task done, capture the actual local result and compare it against the reference yourself.

### Required Acceptance Framing

For reference-match tasks, do not rely on subjective language like "closer", "more like", or "basically matched" as the final acceptance standard.

The implementation and review should explicitly consider all relevant visual dimensions of the target area, such as:

- outer frame width and height
- visible subject width and height
- transparent padding or dead space inside source assets
- left/right/top/bottom visual padding
- alignment inside the parent container
- relationship to adjacent borders, slots, or cut lines
- state-to-state consistency for hover, disabled, loading, and similar variants

### Required Verification

Before saying the result matches the reference, the agent must:

1. Capture the real local UI result.
2. Review the captured result against the reference.
3. State clearly what still differs if anything is still off.

If the result is still off, continue iterating instead of stopping at "差不多".

### Forbidden Shortcuts

For reference-match tasks, do not:

- stop after only heuristic micro-tweaks without comparing against a captured result
- assume CSS box size alone proves a visual match
- ignore transparent padding inside PNG or other raster assets
- declare success without checking the actual rendered result
