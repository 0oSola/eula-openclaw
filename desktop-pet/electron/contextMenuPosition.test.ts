import { describe, expect, it } from "vitest";

import {
  normalizeRendererMenuPosition,
  resolveContextMenuPosition,
  toScreenMenuPosition,
  toWindowMenuPosition,
} from "./contextMenuPosition.js";

describe("desktop pet context menu position", () => {
  it("maps screen coordinates to window-local popup coordinates", () => {
    expect(
      toWindowMenuPosition(
        { x: 1480, y: 730 },
        { x: 1320, y: 520, width: 320, height: 420 },
      ),
    ).toEqual({ x: 160, y: 210 });
  });

  it("keeps renderer-provided popup coordinates when valid", () => {
    expect(normalizeRendererMenuPosition({ x: 42.3, y: 77.9 })).toEqual({ x: 42, y: 78 });
  });

  it("maps window-local popup coordinates to screen coordinates for duplicate suppression", () => {
    expect(
      toScreenMenuPosition(
        { x: 149, y: 92 },
        { x: 4191, y: 740, width: 221, height: 293 },
      ),
    ).toEqual({ x: 4340, y: 832 });
  });

  it("drops invalid renderer popup coordinates", () => {
    expect(normalizeRendererMenuPosition({ x: Number.NaN, y: 77 })).toBeNull();
    expect(normalizeRendererMenuPosition(null)).toBeNull();
  });

  it("resolves a screen click to window-local popup coordinates for Electron Menu.popup", () => {
    expect(
      resolveContextMenuPosition({
        input: { space: "screen", point: { x: 300, y: 250 } },
        bounds: { x: 116, y: 100, width: 322, height: 420 },
      }),
    ).toEqual({
      screenPosition: { x: 300, y: 250 },
      popupPosition: { x: 184, y: 150 },
    });
  });

  it("resolves a renderer click to both popup-local and dedupe screen coordinates", () => {
    expect(
      resolveContextMenuPosition({
        input: { space: "window", point: { x: 184, y: 150 } },
        bounds: { x: 116, y: 100, width: 322, height: 420 },
      }),
    ).toEqual({
      screenPosition: { x: 300, y: 250 },
      popupPosition: { x: 184, y: 150 },
    });
  });

  it("clamps out-of-range renderer coordinates to the pet window before opening the menu", () => {
    expect(
      resolveContextMenuPosition({
        input: { space: "window", point: { x: 624, y: 375 } },
        bounds: { x: 116, y: 100, width: 322, height: 420 },
      }).popupPosition,
    ).toEqual({ x: 322, y: 375 });
  });

  it("drops native screen clicks outside the pet window bounds", () => {
    expect(
      resolveContextMenuPosition({
        input: { space: "screen", point: { x: 457, y: 942 } },
        bounds: { x: 1356, y: 570, width: 322, height: 420 },
      }),
    ).toBeNull();
  });
});
