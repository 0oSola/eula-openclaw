import type { CodexStatus, CodexLaunchState } from "./codexStatus";

export type NotificationDetailLevel = "low" | "medium" | "high";

const LOW_LABELS: Record<CodexLaunchState, string | null> = {
  idle: null,
  starting: "Codex starting",
  launched: "Codex terminal running",
  resuming: "Codex resuming",
  running: "Codex running",
  command_running: "Codex running command",
  file_changed: "Codex changed files",
  waiting_approval: "Codex needs approval",
  completed: "Codex completed",
  failed: "Codex failed",
  disconnected: "Codex disconnected",
  "vscode-opened": "VSCode workspace open",
};

function compact(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function workspaceLabel(workspacePath: string | undefined): string {
  const parts = compact(workspacePath).split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "workspace";
}

function mediumContext(status: CodexStatus): string {
  if (status.state === "failed" && compact(status.error)) return compact(status.error);
  return compact(status.sessionTitle) || workspaceLabel(status.workspacePath);
}

export function normalizeNotificationDetailLevel(value: unknown): NotificationDetailLevel {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

export function formatCodexStatusNotification(
  status: CodexStatus | null | undefined,
  detailLevel: NotificationDetailLevel,
): string | null {
  if (!status) return null;
  const label = LOW_LABELS[status.state];
  if (!label) return null;

  const level = normalizeNotificationDetailLevel(detailLevel);
  if (level === "low") return label;

  const pieces = [label, mediumContext(status)];
  if (level === "high") {
    if (compact(status.workspacePath)) pieces.push(`workspace ${compact(status.workspacePath)}`);
    if (compact(status.codexSessionId)) pieces.push(`session ${compact(status.codexSessionId)}`);
    if (compact(status.updatedAt)) pieces.push(`updated ${compact(status.updatedAt)}`);
  }

  return pieces.filter(Boolean).join(" · ");
}
