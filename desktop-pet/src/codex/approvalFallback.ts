import type { CodexStatus } from "./codexStatus";
import type { NotificationDetailLevel } from "./notificationDetail";
import { formatCodexStatusNotification } from "./notificationDetail";

export type ApprovalFallbackFocus = {
  canApprove: false;
  canDeny: false;
  primaryAction: {
    type: "focus-vscode";
    label: "Open VSCode";
  };
  message: string;
  limitation: string;
  limitationCode: "scanner-missing-approval-id";
};

export type ApprovalFallbackDirect = {
  canApprove: true;
  canDeny: true;
  approvalId: string;
  codexSessionId: string;
  primaryAction: {
    type: "approve";
    label: "Approve";
  };
  secondaryAction: {
    type: "deny";
    label: "Deny";
  };
  message: string;
  limitation: string;
  limitationCode: "relay-approval-id";
};

export type ApprovalFallback = ApprovalFallbackFocus | ApprovalFallbackDirect;

export function buildApprovalFallback(
  status: CodexStatus | null | undefined,
  detailLevel: NotificationDetailLevel,
): ApprovalFallback | null {
  if (!status || status.state !== "waiting_approval") return null;

  const approval = status.pendingApprovals?.find((item) => item.id.trim());
  if (status.source === "app-server-relay" && status.codexSessionId?.trim() && approval) {
    const message = `${formatCodexStatusNotification(status, detailLevel) ?? "Codex needs approval"} · ${approval.title || "Approval required"}`;
    return {
      canApprove: true,
      canDeny: true,
      approvalId: approval.id,
      codexSessionId: status.codexSessionId,
      primaryAction: {
        type: "approve",
        label: "Approve",
      },
      secondaryAction: {
        type: "deny",
        label: "Deny",
      },
      message,
      limitation: "Desktop Pet received the app-server approval id and can submit approve or deny directly.",
      limitationCode: "relay-approval-id",
    };
  }

  const message = `${formatCodexStatusNotification(status, detailLevel) ?? "Codex needs approval"} · Open VSCode to approve or deny in the Codex terminal.`;
  return {
    canApprove: false,
    canDeny: false,
    primaryAction: {
      type: "focus-vscode",
      label: "Open VSCode",
    },
    message,
    limitation: "The local JSONL scanner does not expose an approval id, so Desktop Pet cannot submit approve or deny decisions.",
    limitationCode: "scanner-missing-approval-id",
  };
}
