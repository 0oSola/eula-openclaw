import { describe, expect, it } from "vitest";

import { shouldCaptureStagePointer } from "@/features/stage/MMDStage";

describe("MMDStage pointer capture", () => {
  it("does not capture pointer events when character click capture is disabled", () => {
    expect(shouldCaptureStagePointer({ enableCharacterClickCapture: false, button: 0 })).toBe(false);
  });

  it("captures only primary button events when character click capture is enabled", () => {
    expect(shouldCaptureStagePointer({ enableCharacterClickCapture: true, button: 0 })).toBe(true);
    expect(shouldCaptureStagePointer({ enableCharacterClickCapture: true, button: 2 })).toBe(false);
  });
});
