import { describe, expect, it } from "vitest";

import { describeMainSiteSyncResult, describeMenuActionResult } from "./menuActionStatus";

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

  it("describes menu language changes", () => {
    expect(describeMenuActionResult({ type: "menu-language", language: "zh-CN" })).toBe("菜单语言：中文");
    expect(describeMenuActionResult({ type: "menu-language", language: "en" })).toBe("Menu language: English");
  });

  it("describes main site sync clearly", () => {
    expect(describeMenuActionResult({ type: "sync-main-site" })).toBe("Syncing from main site...");
  });

  it("describes completed main site sync with the loaded model and pipeline", () => {
    expect(describeMainSiteSyncResult("Eula", "mio-reference")).toBe("Synced: Eula · mio-reference");
  });

  it("describes completed main site sync when no model is selected", () => {
    expect(describeMainSiteSyncResult(null, "classic")).toBe("Synced: no model · classic");
  });
});
