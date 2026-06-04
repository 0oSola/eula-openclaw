import { describe, expect, it } from "vitest";

import { createPetBrowserWindowOptions } from "./petWindowOptions.js";

describe("desktop pet BrowserWindow options", () => {
  it("keeps the frameless pet window fixed-size while app drag moves it", () => {
    expect(createPetBrowserWindowOptions("preload.cjs")).toMatchObject({
      width: 320,
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
      width: 320,
      height: 420,
      minWidth: 320,
      minHeight: 420,
      maxWidth: 320,
      maxHeight: 420,
      resizable: false,
    });
  });
});
