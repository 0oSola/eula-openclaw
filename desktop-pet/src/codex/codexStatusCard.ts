import type { CodexStatus } from "./codexStatus";
import {
  formatCodexStatusNotification,
  type NotificationDetailLevel,
} from "./notificationDetail";

export type CodexStatusCard = {
  title: string;
  outputLines: string[];
  focusable: boolean;
  workspacePath?: string;
  /** The terminal command the user should run in the freshly opened VSCode window. */
  commandLine?: string;
};

const MAX_OUTPUT_LINES = 3;
const MAX_OUTPUT_LINE_LENGTH = 180;

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function compactLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function workspaceLabel(workspacePath: string | undefined): string {
  const parts = workspacePath?.trim().split(/[\\/]/).filter(Boolean) ?? [];
  return parts.at(-1) || "workspace";
}

function truncateLine(value: string): string {
  if (value.length <= MAX_OUTPUT_LINE_LENGTH) return value;
  return `${value.slice(0, MAX_OUTPUT_LINE_LENGTH - 3).trimEnd()}...`;
}

function isToolRunMetadataLine(value: string): boolean {
  return (
    /^Exit code:\s*-?\d+$/i.test(value) ||
    /^Wall time:\s*\d+(?:\.\d+)?\s*(?:ms|s|seconds?)$/i.test(value) ||
    /^Total output lines:\s*\d+$/i.test(value)
  );
}

function statusCardTitle(status: CodexStatus, detailLevel: NotificationDetailLevel, agentLabel: string): string | null {
  if (status.state === "completed") return `${agentLabel} completed - ${workspaceLabel(status.workspacePath)}`;
  return formatCodexStatusNotification(status, detailLevel, agentLabel);
}

function completedTaskLine(status: CodexStatus): string | null {
  if (status.state !== "completed") return null;
  const task = compactLine(status.sessionTitle ?? "");
  if (!task || task === workspaceLabel(status.workspacePath)) return null;
  return truncateLine(redactSensitiveText(`Task: ${task}`));
}

function buildOutputLines(status: CodexStatus): string[] {
  const rawOutput = status.lastOutput || (status.state === "failed" ? status.error : "");
  const outputLines = rawOutput?.trim()
    ? rawOutput
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map(compactLine)
        .filter((line) => line && !isToolRunMetadataLine(line))
        .map((line) => truncateLine(redactSensitiveText(line)))
        .filter(Boolean)
    : [];
  return [completedTaskLine(status), ...outputLines].filter((line): line is string => Boolean(line)).slice(0, MAX_OUTPUT_LINES);
}

export function buildCodexStatusCard(
  status: CodexStatus | null | undefined,
  detailLevel: NotificationDetailLevel,
  agentLabel = "Codex",
): CodexStatusCard | null {
  if (!status) return null;
  const title = statusCardTitle(status, detailLevel, agentLabel);
  if (!title) return null;
  const workspacePath = status.workspacePath?.trim() || undefined;
  const commandLine = status.commandLine?.trim() || undefined;
  return {
    title,
    outputLines: buildOutputLines(status),
    focusable: Boolean(workspacePath),
    workspacePath,
    commandLine,
  };
}

export function buildIdleCodexStatusCardFallback(options: {
  hasSelectedModel: boolean;
  loading: boolean;
  loadError: string | null | undefined;
  agentLabel?: string;
}): CodexStatusCard | null {
  if (!options.hasSelectedModel || options.loading || options.loadError) return null;
  const agentLabel = options.agentLabel ?? "Codex";
  return {
    title: `${agentLabel} idle`,
    outputLines: [`No active ${agentLabel} output`],
    focusable: false,
  };
}
