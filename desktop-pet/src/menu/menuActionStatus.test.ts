import { describe, expect, it } from "vitest";

import { describeMenuActionResult } from "./menuActionStatus";

describe("desktop pet menu action status", () => {
  it("describes notification detail changes", () => {
    expect(describeMenuActionResult({ type: "notification-detail", profile: "high" })).toBe(
      "Notification detail: High",
    );
  });

  it("keeps launch actions explicit while bridges are not wired", () => {
    expect(describeMenuActionResult({ type: "new-session" })).toContain("not wired yet");
    expect(describeMenuActionResult({ type: "focus-vscode" })).toContain("not wired yet");
  });
});
