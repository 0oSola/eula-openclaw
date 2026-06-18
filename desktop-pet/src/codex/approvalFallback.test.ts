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

  it("makes relay approvals directly actionable when an approval id is available", () => {
    const fallback = buildApprovalFallback(
      {
        state: "waiting_approval",
        sessionTitle: "npm install",
        workspacePath: "D:\\workspace\\MMD project",
        codexSessionId: "codex_sess_1",
        source: "app-server-relay",
        pendingApprovals: [
          {
            id: "approval_1",
            title: "Run npm install",
            actionType: "command",
            detail: { command: "npm install" },
          },
        ],
      },
      "medium",
    );

    expect(fallback).toMatchObject({
      canApprove: true,
      canDeny: true,
      approvalId: "approval_1",
      codexSessionId: "codex_sess_1",
      primaryAction: {
        type: "approve",
        label: "Approve",
      },
      secondaryAction: {
        type: "deny",
        label: "Deny",
      },
      limitationCode: "relay-approval-id",
    });
    expect(fallback?.message).toBe("Codex needs approval · npm install · Run npm install");
  });
});
