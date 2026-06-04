import { describe, expect, it } from "vitest";

import { formatCodexStatusNotification } from "./notificationDetail";

const detailedStatus = {
  state: "command_running" as const,
  workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
  sessionTitle: "Implement desktop pet approval fallback",
  codexSessionId: "12345678-90ab-cdef-1234-567890abcdef",
  updatedAt: "2026-06-04T04:00:00.000Z",
};

describe("Codex notification detail policy", () => {
  it("keeps low detail short and omits workspace, path, and session identifiers", () => {
    const text = formatCodexStatusNotification(detailedStatus, "low");

    expect(text).toBe("Codex running command");
    expect(text).not.toContain("desktop-mmd-codex-pet");
    expect(text).not.toContain("D:\\workspace");
    expect(text).not.toContain("12345678");
  });

  it("uses medium detail for readable session context without full paths or ids", () => {
    const text = formatCodexStatusNotification(detailedStatus, "medium");

    expect(text).toBe("Codex running command · Implement desktop pet approval fallback");
    expect(text).not.toContain("D:\\workspace");
    expect(text).not.toContain("12345678");
  });

  it("uses high detail for diagnostic context including full workspace and session id", () => {
    const text = formatCodexStatusNotification(detailedStatus, "high");

    expect(text).toContain("Codex running command");
    expect(text).toContain("workspace D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet");
    expect(text).toContain("session 12345678-90ab-cdef-1234-567890abcdef");
    expect(text).toContain("updated 2026-06-04T04:00:00.000Z");
  });

  it("includes failure errors only when detail is medium or high", () => {
    expect(formatCodexStatusNotification({ state: "failed", error: "code command was not found" }, "low")).toBe(
      "Codex failed",
    );
    expect(formatCodexStatusNotification({ state: "failed", error: "code command was not found" }, "medium")).toBe(
      "Codex failed · code command was not found",
    );
  });
});
