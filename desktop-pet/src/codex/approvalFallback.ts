import type { CodexStatus } from "./codexStatus";
import type { NotificationDetailLevel } from "./notificationDetail";
import { formatCodexStatusNotification } from "./notificationDetail";

export type ApprovalFallback = {
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

export function buildApprovalFallback(
  status: CodexStatus | null | undefined,
  detailLevel: NotificationDetailLevel,
): ApprovalFallback | null {
  if (!status || status.state !== "waiting_approval") return null;

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
