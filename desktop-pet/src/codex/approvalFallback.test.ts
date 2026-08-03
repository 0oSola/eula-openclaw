import { describe, expect, it } from "vitest";

import { buildApprovalFallback } from "./approvalFallback";

describe("Codex approval fallback", () => {
  it("returns no approval action when Codex is not waiting for approval", () => {
    expect(buildApprovalFallback({ state: "running" }, "medium")).toBeNull();
  });

  it("makes waiting approval actionable only by focusing VSCode", () => {
    const fallback = buildApprovalFallback(
      {
        state: "waiting_approval",
        sessionTitle: "npm install",
        workspacePath: "D:\\workspace\\MMD project",
      },
      "medium",
    );

    expect(fallback).toMatchObject({
      canApprove: false,
      canDeny: false,
      primaryAction: {
        type: "focus-vscode",
        label: "Open VSCode",
      },
      limitationCode: "scanner-missing-approval-id",
    });
    expect(fallback?.message).toBe(
      "Codex needs approval · npm install · Open VSCode to approve or deny in the Codex terminal.",
    );
    expect(fallback?.limitation).toContain("JSONL scanner does not expose an approval id");
  });

});
