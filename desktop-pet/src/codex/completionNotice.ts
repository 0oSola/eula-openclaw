import type { CodexStatus } from "./codexStatus";

export type CodexCompletionNotice = {
  key: string;
  title: string;
  workspaceLabel: string;
  taskLabel?: string;
  workspacePath: string;
};

export const DISMISSED_COMPLETION_NOTICE_STORAGE_KEY = "pet:dismissed-completion-notice";
export const MAX_DISMISSED_COMPLETION_NOTICE_KEYS = 100;

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

function normalizeDismissedCompletionNoticeKeys(values: readonly unknown[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (
    let index = values.length - 1;
    index >= 0 && keys.length < MAX_DISMISSED_COMPLETION_NOTICE_KEYS;
    index -= 1
  ) {
    const value = values[index];
    const key = typeof value === "string" ? compact(value) : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return keys.reverse();
}

export function parseDismissedCompletionNoticeKeys(value: string | null | undefined): string[] {
  const stored = value?.trim();
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) return normalizeDismissedCompletionNoticeKeys(parsed);
    if (typeof parsed === "string") return normalizeDismissedCompletionNoticeKeys([parsed]);
    return [];
  } catch {
    // Legacy versions stored one raw completion key instead of a JSON array.
    return normalizeDismissedCompletionNoticeKeys([stored]);
  }
}

export function addDismissedCompletionNoticeKey(keys: readonly string[], value: string): string[] {
  return normalizeDismissedCompletionNoticeKeys([...keys, value]);
}

export function serializeDismissedCompletionNoticeKeys(keys: readonly string[]): string {
  return JSON.stringify(normalizeDismissedCompletionNoticeKeys(keys));
}

export function buildCodexCompletionNotice(
  status: CodexStatus | null | undefined,
  dismissedKeys: readonly string[] | null | undefined,
  agentLabel = "Codex",
): CodexCompletionNotice | null {
  const workspacePath = compact(status?.workspacePath);
  if (!status || status.state !== "completed" || !workspacePath) return null;

  const key = compact(status.completionNoticeKey);
  if (!key || dismissedKeys?.includes(key)) return null;

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

export function resolveLatchedCodexCompletionNotice(
  current: CodexCompletionNotice | null | undefined,
  status: CodexStatus | null | undefined,
  dismissedKeys: readonly string[] | null | undefined,
  agentLabel = "Codex",
): CodexCompletionNotice | null {
  const next = buildCodexCompletionNotice(status, dismissedKeys, agentLabel);
  if (next) return next;
  if (current && dismissedKeys?.includes(current.key)) return null;
  return current ?? null;
}
