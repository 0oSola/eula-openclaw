import { describe, expect, it } from "vitest";

import {
  WM_LBUTTONDOWN,
  WM_LBUTTONUP,
  WM_MOUSEMOVE,
  shouldStartNativeWindowDrag,
} from "./nativeMouseInput";

describe("native Windows mouse input", () => {
  it("uses only the Win32 mouse messages needed for window dragging", () => {
    expect(WM_LBUTTONDOWN).toBe(0x0201);
    expect(WM_LBUTTONUP).toBe(0x0202);
    expect(WM_MOUSEMOVE).toBe(0x0200);
  });

  it("starts native window dragging only in window-drag mode", () => {
    expect(shouldStartNativeWindowDrag({ interactionMode: "window-drag" })).toBe(true);
    expect(shouldStartNativeWindowDrag({ interactionMode: "camera-adjust" })).toBe(false);
  });

  it("does not start native dragging while a context menu is active or just closed", () => {
    expect(
      shouldStartNativeWindowDrag({
        interactionMode: "window-drag",
        contextMenuActive: true,
        nowMs: 1000,
      }),
    ).toBe(false);
    expect(
      shouldStartNativeWindowDrag({
        interactionMode: "window-drag",
        contextMenuActive: false,
        lastContextMenuClosedAtMs: 900,
        nowMs: 1000,
      }),
    ).toBe(false);
    expect(
      shouldStartNativeWindowDrag({
        interactionMode: "window-drag",
        contextMenuActive: false,
        lastContextMenuClosedAtMs: 100,
        nowMs: 1000,
      }),
    ).toBe(true);
  });
});
