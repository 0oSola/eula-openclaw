import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexSessionStatus =
  | "starting"
  | "running"
  | "command_running"
  | "file_changed"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "disconnected";

export type CodexSessionJsonEvent = {
  timestamp?: string;
  type?: string;
  payload?: unknown;
};

export type CodexSessionFileSummary = {
  codexSessionId: string;
  workspacePath: string;
  filePath: string;
  firstPromptPreview: string | null;
  displayTitle: string;
  lastSummary: string | null;
  lastStatus: CodexSessionStatus;
  originator: string | null;
  cliVersion: string | null;
  lastEventAt: string | null;
  fileModifiedAt: string;
};

export type DesktopPetSessionPayload = {
  pet_session_id: string;
  codex_session_id: string;
  workspace_id: string | null;
  workspace_path: string;
  codex_home: string | null;
  display_title: string;
  first_prompt_preview: string | null;
  last_summary: string | null;
  last_status: CodexSessionStatus;
  launch_mode: string;
  remote_url: string | null;
  app_server_pid: number | null;
  app_server_port: number | null;
  metadata: Record<string, unknown>;
};

type ParseOptions = {
  maxHeadBytes?: number;
  maxTailBytes?: number;
};

const DEFAULT_HEAD_BYTES = 1024 * 1024;
const DEFAULT_TAIL_BYTES = 256 * 1024;
const DEFAULT_SCAN_FILE_LIMIT = 80;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function compactText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string | null | undefined, maxLength: number): string | null {
  const text = compactText(value);
  if (!text) return null;
  return Array.from(text).slice(0, maxLength).join("");
}

function workspaceName(workspacePath: string): string {
  const parts = workspacePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "workspace";
}

function normalizeComparablePath(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

export function resolveCodexHome(env: NodeJS.ProcessEnv | Record<string, string | undefined>, platform = process.platform): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const configured = env.CODEX_HOME?.trim();
  if (configured) return pathApi.resolve(configured);
  if (platform === "win32" && env.USERPROFILE?.trim()) return pathApi.join(env.USERPROFILE.trim(), ".codex");
  if (env.HOME?.trim()) return pathApi.join(env.HOME.trim(), ".codex");
  return pathApi.join(os.homedir(), ".codex");
}

function readFileWindow(filePath: string, start: number, length: number): string {
  if (length <= 0) return "";
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function readHeadText(filePath: string, size: number, maxBytes: number): string {
  const text = readFileWindow(filePath, 0, Math.min(size, maxBytes));
  if (size <= maxBytes || text.endsWith("\n")) return text;
  const lastNewline = text.lastIndexOf("\n");
  return lastNewline >= 0 ? text.slice(0, lastNewline) : text;
}

function readTailText(filePath: string, size: number, maxBytes: number): string {
  if (size <= maxBytes) return "";
  const start = Math.max(0, size - maxBytes);
  const text = readFileWindow(filePath, start, size - start);
  if (start === 0) return text;
  const firstNewline = text.indexOf("\n");
  return firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
}

function parseJsonLine(line: string): CodexSessionJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as CodexSessionJsonEvent;
  } catch {
    return null;
  }
}

function parseJsonLines(text: string): CodexSessionJsonEvent[] {
  return text
    .split(/\r?\n/)
    .map(parseJsonLine)
    .filter((event): event is CodexSessionJsonEvent => event !== null);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return compactText(content);
  if (!Array.isArray(content)) return "";
  return compactText(
    content
      .map((item) => {
        const record = asRecord(item);
        return typeof record.text === "string" ? record.text : "";
      })
      .join(" "),
  );
}

function isInjectedUserContext(text: string): boolean {
  return (
    text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("The following is the Codex agent history")
  );
}

function userPromptFromEvent(event: CodexSessionJsonEvent): string | null {
  const payload = asRecord(event.payload);
  if (event.type === "response_item" && payload.type === "message" && payload.role === "user") {
    const text = contentText(payload.content);
    return text && !isInjectedUserContext(text) ? text : null;
  }
  if (event.type === "event_msg" && payload.type === "user_message") {
    const text = compactText(payload.message);
    return text && !isInjectedUserContext(text) ? text : null;
  }
  return null;
}

function assistantSummaryFromEvent(event: CodexSessionJsonEvent): string | null {
  const payload = asRecord(event.payload);
  if (event.type === "response_item" && payload.type === "message" && payload.role === "assistant") {
    return truncateText(contentText(payload.content), 1000);
  }
  if (event.type === "event_msg" && payload.type === "agent_message") {
    return truncateText(compactText(payload.message), 1000);
  }
  return null;
}

function isApprovalEvent(event: CodexSessionJsonEvent): boolean {
  const payload = asRecord(event.payload);
  const eventType = String(payload.type || "");
  if (/approval|permission/i.test(eventType)) return true;
  const message = compactText(payload.message);
  return /APPROVAL REQUEST START|approval request|permission request/i.test(message);
}

export function inferCodexSessionStatus(events: CodexSessionJsonEvent[]): CodexSessionStatus {
  let status: CodexSessionStatus = "running";

  for (const event of events) {
    const payload = asRecord(event.payload);
    const payloadType = String(payload.type || "");
    const role = String(payload.role || "");

    if (isApprovalEvent(event)) {
      status = "waiting_approval";
      continue;
    }

    if (event.type === "response_item") {
      if (payloadType === "function_call") status = "command_running";
      else if (/file.*change|patch|diff/i.test(payloadType)) status = "file_changed";
      else if (payloadType === "function_call_output" || payloadType === "reasoning") status = "running";
      else if (payloadType === "message" && role === "assistant") status = "completed";
      else if (payloadType === "message" && role === "user") status = "running";
      continue;
    }

    if (event.type !== "event_msg") continue;

    if (payloadType === "task_complete" || payloadType === "agent_message") status = "completed";
    else if (payloadType === "task_started" || payloadType === "user_message") status = "running";
    else if (/file.*change|patch|diff/i.test(payloadType)) status = "file_changed";
    else if (/process.*exit|session.*closed|disconnected/i.test(payloadType)) status = "disconnected";
    else if (/failed|error/i.test(payloadType)) status = "failed";
  }

  return status;
}

function extractSessionMeta(events: CodexSessionJsonEvent[]): {
  codexSessionId: string;
  workspacePath: string;
  originator: string | null;
  cliVersion: string | null;
} | null {
  const meta = events.find((event) => event.type === "session_meta");
  const payload = asRecord(meta?.payload);
  const codexSessionId = compactText(payload.id);
  const workspacePath = compactText(payload.cwd);
  if (!codexSessionId || !workspacePath) return null;
  return {
    codexSessionId,
    workspacePath,
    originator: truncateText(compactText(payload.originator), 120),
    cliVersion: truncateText(compactText(payload.cli_version), 80),
  };
}

export function parseCodexSessionFile(filePath: string, options: ParseOptions = {}): CodexSessionFileSummary {
  const stat = fs.statSync(filePath);
  const headEvents = parseJsonLines(readHeadText(filePath, stat.size, options.maxHeadBytes ?? DEFAULT_HEAD_BYTES));
  const tailEvents = parseJsonLines(readTailText(filePath, stat.size, options.maxTailBytes ?? DEFAULT_TAIL_BYTES));
  const events = [...headEvents, ...tailEvents];
  const meta = extractSessionMeta(events);

  if (!meta) {
    throw new Error(`Codex session metadata not found in ${filePath}`);
  }

  const firstPromptPreview = truncateText(events.map(userPromptFromEvent).find(Boolean), 240);
  const lastSummary = truncateText(events.map(assistantSummaryFromEvent).filter(Boolean).at(-1), 1000);
  const displayTitle = truncateText(firstPromptPreview || workspaceName(meta.workspacePath), 48) || "Codex session";
  const lastEventAt = [...events]
    .reverse()
    .map((event) => (typeof event.timestamp === "string" ? event.timestamp : null))
    .find(Boolean);

  return {
    ...meta,
    filePath,
    firstPromptPreview,
    displayTitle,
    lastSummary,
    lastStatus: inferCodexSessionStatus(events),
    lastEventAt: lastEventAt || null,
    fileModifiedAt: stat.mtime.toISOString(),
  };
}

function findRolloutFiles(root: string): Array<{ filePath: string; mtimeMs: number }> {
  if (!fs.existsSync(root)) return [];
  const found: Array<{ filePath: string; mtimeMs: number }> = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/i.test(entry.name)) continue;
      const stat = fs.statSync(entryPath);
      found.push({ filePath: entryPath, mtimeMs: stat.mtimeMs });
    }
  }

  return found.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

export function scanRecentCodexSessionFiles(options: {
  codexHome: string;
  workspacePath?: string | null;
  limit?: number;
  maxFiles?: number;
}): CodexSessionFileSummary[] {
  const sessionsRoot = path.join(options.codexHome, "sessions");
  const workspaceFilter = normalizeComparablePath(options.workspacePath);
  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const maxFiles = Math.max(limit, options.maxFiles ?? DEFAULT_SCAN_FILE_LIMIT);
  const summaries: CodexSessionFileSummary[] = [];

  for (const candidate of findRolloutFiles(sessionsRoot).slice(0, maxFiles)) {
    try {
      const summary = parseCodexSessionFile(candidate.filePath);
      if (workspaceFilter && normalizeComparablePath(summary.workspacePath) !== workspaceFilter) continue;
      summaries.push(summary);
      if (summaries.length >= limit) break;
    } catch {
      continue;
    }
  }

  return summaries.sort((left, right) => Date.parse(right.fileModifiedAt) - Date.parse(left.fileModifiedAt));
}

export function buildDesktopPetSessionPayload(
  summary: CodexSessionFileSummary,
  codexHome: string | null,
): DesktopPetSessionPayload {
  return {
    pet_session_id: `codex:${summary.codexSessionId}`,
    codex_session_id: summary.codexSessionId,
    workspace_id: null,
    workspace_path: summary.workspacePath,
    codex_home: codexHome,
    display_title: summary.displayTitle,
    first_prompt_preview: summary.firstPromptPreview,
    last_summary: summary.lastSummary,
    last_status: summary.lastStatus,
    launch_mode: "workspace-write",
    remote_url: null,
    app_server_pid: null,
    app_server_port: null,
    metadata: {
      source: "codex-jsonl",
      session_file: summary.filePath,
      session_file_mtime: summary.fileModifiedAt,
      originator: summary.originator,
      cli_version: summary.cliVersion,
      last_event_at: summary.lastEventAt,
    },
  };
}
