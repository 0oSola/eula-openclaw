import { describe, expect, it } from "vitest";

import { describeCodexStatus, getCodexStatusPresentation } from "./codexStatus";

describe("desktop pet Codex status", () => {
  it("describes launch states with a readable workspace label", () => {
    expect(
      describeCodexStatus({
        state: "starting",
        workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      }),
    ).toBe("Codex starting · desktop-mmd-codex-pet");

    expect(
      describeCodexStatus({
        state: "launched",
        workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      }),
    ).toBe("Codex terminal running · desktop-mmd-codex-pet");
  });

  it("describes launch failures with the error message", () => {
    expect(
      describeCodexStatus({
        state: "failed",
        workspacePath: "D:\\workspace\\MMD project",
        error: "code command was not found",
      }),
    ).toBe("Codex launch failed · code command was not found");
  });

  it("describes live session states with readable titles", () => {
    expect(
      describeCodexStatus({
        state: "running",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "修复 Pet 状态同步",
      }),
    ).toBe("Codex running · 修复 Pet 状态同步");

    expect(
      describeCodexStatus({
        state: "command_running",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "修复 Pet 状态同步",
      }),
    ).toBe("Codex command running · 修复 Pet 状态同步");

    expect(
      describeCodexStatus({
        state: "waiting_approval",
        workspacePath: "D:\\workspace\\MMD project",
        sessionTitle: "npm install",
      }),
    ).toBe("Codex waiting approval · npm install");
  });

  it("maps live scanner states to pet motion intent, tone, and idle interruption", () => {
    expect(getCodexStatusPresentation({ state: "running" })).toMatchObject({
      motionIntent: "thinking",
      statusTone: "active",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "command_running" })).toMatchObject({
      motionIntent: "command",
      statusTone: "active",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "file_changed" })).toMatchObject({
      motionIntent: "file_change",
      statusTone: "attention",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "waiting_approval" })).toMatchObject({
      motionIntent: "approval",
      statusTone: "attention",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "completed" })).toMatchObject({
      motionIntent: "complete",
      statusTone: "success",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "failed" })).toMatchObject({
      motionIntent: "failure",
      statusTone: "danger",
      shouldInterruptIdle: true,
    });
    expect(getCodexStatusPresentation({ state: "disconnected" })).toMatchObject({
      motionIntent: "disconnected",
      statusTone: "offline",
      shouldInterruptIdle: true,
    });
  });
});
