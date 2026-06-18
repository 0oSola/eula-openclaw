import type { CodexStatus } from "./codexStatus";

export type CodexCompletionNotice = {
  key: string;
  title: string;
  workspaceLabel: string;
  taskLabel?: string;
  workspacePath: string;
};

function compact(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function workspaceLabel(workspacePath: string): string {
  const parts = workspacePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "workspace";
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function completionKey(status: CodexStatus, workspacePath: string): string {
  return compact(status.codexSessionId) || [workspacePath, compact(status.sessionTitle), compact(status.lastOutput)].join("|");
}

export function buildCodexCompletionNotice(
  status: CodexStatus | null | undefined,
  dismissedKey: string | null | undefined,
  agentLabel = "Codex",
): CodexCompletionNotice | null {
  const workspacePath = compact(status?.workspacePath);
  if (!status || status.state !== "completed" || !workspacePath) return null;

  const key = completionKey(status, workspacePath);
  if (!key || key === dismissedKey) return null;

  const label = workspaceLabel(workspacePath);
  const task = truncate(redactSensitiveText(compact(status.sessionTitle)), 72);
  return {
    key,
    title: `${agentLabel} task completed`,
    workspaceLabel: label,
    taskLabel: task && task !== label ? task : undefined,
    workspacePath,
  };
}
