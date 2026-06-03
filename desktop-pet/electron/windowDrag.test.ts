import { describe, expect, it } from "vitest";

import { getDraggedWindowPosition } from "./windowDrag.js";

describe("desktop pet manual window drag", () => {
  it("moves the window by cursor delta", () => {
    expect(
      getDraggedWindowPosition(
        {
          startCursor: { x: 120, y: 80 },
          startWindow: { x: 40, y: 30 },
        },
        { x: 150, y: 110 },
      ),
    ).toEqual({ x: 70, y: 60 });
  });
});
