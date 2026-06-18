import { describe, expect, it } from "vitest";

import { createPetBrowserWindowOptions } from "./petWindowOptions.js";

describe("desktop pet BrowserWindow options", () => {
  it("keeps the frameless pet window fixed-size while app drag moves it", () => {
    expect(createPetBrowserWindowOptions("preload.cjs")).toMatchObject({
      width: 360,
      height: 420,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      hasShadow: false,
      webPreferences: {
        preload: "preload.cjs",
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
  });

  it("restores saved window position without restoring an abnormal size", () => {
    expect(
      createPetBrowserWindowOptions("preload.cjs", {
        x: 120,
        y: 240,
        width: 999,
        height: 100,
      }),
    ).toMatchObject({
      x: 120,
      y: 240,
      width: 360,
      height: 420,
      minWidth: 360,
      minHeight: 420,
      maxWidth: 360,
      maxHeight: 420,
      resizable: false,
    });
  });

  it("recenters saved window positions that are outside the current display work areas", () => {
    expect(
      createPetBrowserWindowOptions(
        "preload.cjs",
        {
          x: 4790,
          y: 637,
          width: 360,
          height: 420,
        },
        [{ x: 0, y: 0, width: 2560, height: 1392 }],
      ),
    ).toMatchObject({
      x: 1100,
      y: 486,
      width: 360,
      height: 420,
    });
  });

  it("keeps saved window positions that are visible on an attached secondary display", () => {
    expect(
      createPetBrowserWindowOptions(
        "preload.cjs",
        {
          x: 4790,
          y: 637,
          width: 360,
          height: 420,
        },
        [
          { x: 0, y: 0, width: 2560, height: 1392 },
          { x: 3840, y: 0, width: 1920, height: 1032 },
        ],
      ),
    ).toMatchObject({
      x: 4790,
      y: 637,
      width: 360,
      height: 420,
    });
  });
});
