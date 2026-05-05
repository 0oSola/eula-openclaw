# Companion Send Button Design Restore

date: 2026-05-05

## Target Area

Only the `/companion` command input right-end send button and its direct relationship to the input shell are in scope.

## Reference Boundary

Use `Design/底栏.pen` nodes `Unified Prompt Input` and `Embedded Send Button` as the visual reference. Use the local send cut image under `web/images/send.png` as the final rendered button visual.

## Acceptance Criteria

- Remove the old multi-layer send button image stack from the component HTML.
- Remove old `.mio-send-art-*` rendering styles and pseudo-element dead code.
- The send button is embedded inside the input shell right edge, not an independent floating button.
- Button width is `64px`; height fills the input shell.
- Button radius follows the design: left corners `13px`, right corners `18px`.
- Button visual is rendered from the send cut image, not recreated with CSS gradients or inline SVG.
- Default, hover, disabled, and loading states keep identical geometry.
- State changes may alter brightness, saturation, opacity, or pulse only; no position or scale shifts.

## Forbidden Shortcuts

- Do not keep the old multi-state PNG layer stack under a restyled wrapper.
- Do not add an extra visible shell around the button.
- Do not make the button overflow outside the input shell.
- Do not replace the send cut image with inline SVG.
- Do not declare completion without a build or type check.

## Screenshot Stop Condition

When a local preview is available, capture the command bar and compare the send button against the design boundary. If preview startup is blocked, stop only after build verification and report the preview blocker.
