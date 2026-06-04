import { describe, expect, it, vi } from "vitest";

import { applyPetAlwaysOnTop } from "./petAlwaysOnTop.js";

describe("desktop pet always-on-top window state", () => {
  it("enables floating always-on-top for the Pet window", () => {
    const window = { setAlwaysOnTop: vi.fn() };

    applyPetAlwaysOnTop(window, true);

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
  });

  it("disables always-on-top without keeping a stale Electron level", () => {
    const window = { setAlwaysOnTop: vi.fn() };

    applyPetAlwaysOnTop(window, false);

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });
});
