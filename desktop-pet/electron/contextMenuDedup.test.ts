import { describe, expect, it } from "vitest";

import { shouldSuppressDuplicateContextMenuPopup } from "./contextMenuDedup.js";

describe("desktop pet context menu duplicate suppression", () => {
  it("suppresses delayed renderer duplicates from the same physical right-click", () => {
    expect(
      shouldSuppressDuplicateContextMenuPopup({
        nowMs: 1_966,
        position: { x: 1466, y: 548 },
        lastPopup: { atMs: 1_000, position: { x: 1466, y: 548 } },
      }),
    ).toBe(true);
  });

  it("suppresses immediate duplicates even when a fallback source lacks coordinates", () => {
    expect(
      shouldSuppressDuplicateContextMenuPopup({
        nowMs: 1_200,
        position: undefined,
        lastPopup: { atMs: 1_000, position: { x: 1466, y: 548 } },
      }),
    ).toBe(true);
  });

  it("allows a deliberate later popup request", () => {
    expect(
      shouldSuppressDuplicateContextMenuPopup({
        nowMs: 2_700,
        position: { x: 1466, y: 548 },
        lastPopup: { atMs: 1_000, position: { x: 1466, y: 548 } },
      }),
    ).toBe(false);
  });

  it("suppresses delayed renderer fallback after a native popup even when coordinates are stale", () => {
    expect(
      shouldSuppressDuplicateContextMenuPopup({
        nowMs: 1_900,
        source: "renderer",
        position: { x: 1248, y: 432 },
        lastPopup: { atMs: 1_000, source: "native", position: { x: 1508, y: 622 } },
        lastMenuClosedAtMs: 1_820,
      }),
    ).toBe(true);
  });

  it("allows a new renderer fallback at a different point after the previous native menu close grace window", () => {
    expect(
      shouldSuppressDuplicateContextMenuPopup({
        nowMs: 2_300,
        source: "renderer",
        position: { x: 1248, y: 432 },
        lastPopup: { atMs: 1_000, source: "native", position: { x: 1508, y: 622 } },
        lastMenuClosedAtMs: 1_820,
      }),
    ).toBe(false);
  });

  it("allows a later native popup at a different point", () => {
    expect(
      shouldSuppressDuplicateContextMenuPopup({
        nowMs: 1_900,
        source: "native",
        position: { x: 1248, y: 432 },
        lastPopup: { atMs: 1_000, source: "native", position: { x: 1508, y: 622 } },
      }),
    ).toBe(false);
  });

  it("suppresses native popup requests while a menu is already active", () => {
    expect(
      shouldSuppressDuplicateContextMenuPopup({
        nowMs: 1_600,
        source: "native",
        position: { x: 1520, y: 620 },
        lastPopup: { atMs: 1_000, source: "native", position: { x: 1400, y: 580 } },
        menuActive: true,
      }),
    ).toBe(true);
  });
});
