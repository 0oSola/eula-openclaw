import { describe, expect, it } from "vitest";

import { toWindowMenuPosition } from "./contextMenuPosition.js";

describe("desktop pet context menu position", () => {
  it("maps screen coordinates to window-local popup coordinates", () => {
    expect(
      toWindowMenuPosition(
        { x: 1480, y: 730 },
        { x: 1320, y: 520, width: 320, height: 420 },
      ),
    ).toEqual({ x: 160, y: 210 });
  });
});
