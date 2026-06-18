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

export type CodexReviewFacts = {
  failed_commands: Array<{
    command: string | null;
    exit_code: number;
    excerpt: string;
  }>;
  changed_files: string[];
  approvals: Array<{
    title: string;
    action_type: string | null;
  }>;
  errors: Array<{
    type: string;
    excerpt: string;
  }>;
  event_counts: Record<string, number>;
};

export type CodexSessionFileSummary = {
  codexSessionId: string;
  workspacePath: string;
  filePath: string;
  firstPromptPreview: string | null;
  displayTitle: string;
  lastSummary: string | null;
  lastOutput: string | null;
  lastStatus: CodexSessionStatus;
  originator: string | null;
  cliVersion: string | null;
  lastEventAt: string | null;
  fileModifiedAt: string;
  reviewFacts: CodexReviewFacts;
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
const REVIEW_FACT_MAX_FAILED_COMMANDS = 6;
const REVIEW_FACT_MAX_FAILED_COMMAND_EXCERPT = 500;
const REVIEW_FACT_MAX_ERRORS = 8;
const REVIEW_FACT_MAX_ERROR_EXCERPT = 500;
const REVIEW_FACT_MAX_APPROVALS = 10;
const REVIEW_FACT_MAX_CHANGED_FILES = 40;
const REVIEW_FACT_MAX_TEXT = 240;

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

function normalizeOutputText(value: unknown): string {
  if (typeof value === "string") return value.replace(/\r\n/g, "\n").trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeOutputText(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (!value || typeof value !== "object") return "";
  const record = asRecord(value);
  return normalizeOutputText(record.text ?? record.output ?? record.content ?? record.message);
}

function truncateOutput(value: string | null | undefined, maxLength: number): string | null {
  const text = value?.replace(/\r\n/g, "\n").trim() ?? "";
  if (!text) return null;
  return Array.from(text).slice(0, maxLength).join("");
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function boundedFactText(value: unknown, maxLength = 1000): string {
  const output = redactSensitiveText(normalizeOutputText(value)).replace(/\r\n/g, "\n").trim();
  if (!output) return "";
  return Array.from(output).slice(0, maxLength).join("");
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

function outputFromEvent(event: CodexSessionJsonEvent): string | null {
  const payload = asRecord(event.payload);
  if (event.type === "response_item" && payload.type === "function_call_output") {
    return truncateOutput(normalizeOutputText(payload.output), 1000);
  }
  return assistantSummaryFromEvent(event);
}

function isApprovalEvent(event: CodexSessionJsonEvent): boolean {
  const payload = asRecord(event.payload);
  const eventType = String(payload.type || "");
  if (/approval|permission/i.test(eventType)) return true;
  const message = compactText(payload.message);
  return /APPROVAL REQUEST START|approval request|permission request/i.test(message);
}

function eventFactType(event: CodexSessionJsonEvent): string | null {
  const payload = asRecord(event.payload);
  const payloadType = compactText(payload.type);
  if (event.type === "response_item" && payloadType === "message") {
    const role = compactText(payload.role);
    return role ? `${role}_message` : payloadType;
  }
  return payloadType || compactText(event.type) || null;
}

function parseFunctionCallCommand(payload: Record<string, unknown>): string | null {
  for (const key of ["command", "cmd"]) {
    const direct = compactText(payload[key]);
    if (direct) return direct;
  }

  const args = payload.arguments;
  if (typeof args === "string") {
    try {
      return parseFunctionCallCommand(JSON.parse(args));
    } catch {
      return compactText(args) || null;
    }
  }
  if (args && typeof args === "object") {
    const nested = asRecord(args);
    for (const key of ["command", "cmd"]) {
      const value = compactText(nested[key]);
      if (value) return value;
    }
  }

  return compactText(payload.name) || null;
}

function parseExitCode(payload: Record<string, unknown>, output: string): number | null {
  if (typeof payload.exit_code === "number" && Number.isFinite(payload.exit_code)) return payload.exit_code;
  if (typeof payload.exitCode === "number" && Number.isFinite(payload.exitCode)) return payload.exitCode;
  const match = output.match(/\bExit code:\s*(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

function addUnique(items: string[], value: unknown, maxItems: number, maxLength = REVIEW_FACT_MAX_TEXT) {
  const text = truncateText(compactText(value), maxLength);
  if (!text || items.includes(text) || items.length >= maxItems) return;
  items.push(text);
}

function addChangedFiles(target: string[], value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) addUnique(target, item, REVIEW_FACT_MAX_CHANGED_FILES);
    return;
  }
  addUnique(target, value, REVIEW_FACT_MAX_CHANGED_FILES);
}

export function extractCodexReviewFacts(events: CodexSessionJsonEvent[]): CodexReviewFacts {
  const facts: CodexReviewFacts = {
    failed_commands: [],
    changed_files: [],
    approvals: [],
    errors: [],
    event_counts: {},
  };
  let lastCommand: string | null = null;

  for (const event of events) {
    const payload = asRecord(event.payload);
    const factType = eventFactType(event);
    if (factType) {
      facts.event_counts[factType] = (facts.event_counts[factType] ?? 0) + 1;
    }

    if (event.type === "response_item" && payload.type === "function_call") {
      lastCommand = parseFunctionCallCommand(payload);
    }

    if (event.type === "response_item" && payload.type === "function_call_output") {
      const excerpt = boundedFactText(payload.output, REVIEW_FACT_MAX_FAILED_COMMAND_EXCERPT);
      const exitCode = parseExitCode(payload, excerpt);
      if (exitCode !== null && exitCode !== 0 && facts.failed_commands.length < REVIEW_FACT_MAX_FAILED_COMMANDS) {
        facts.failed_commands.push({
          command: truncateText(lastCommand, REVIEW_FACT_MAX_TEXT),
          exit_code: exitCode,
          excerpt,
        });
      }
    }

    addChangedFiles(facts.changed_files, payload.path);
    addChangedFiles(facts.changed_files, payload.file_path);
    addChangedFiles(facts.changed_files, payload.changed_files);

    if (isApprovalEvent(event) && facts.approvals.length < REVIEW_FACT_MAX_APPROVALS) {
      const title = compactText(payload.title) || compactText(payload.message) || compactText(payload.type) || "Approval request";
      facts.approvals.push({
        title: truncateText(title, REVIEW_FACT_MAX_TEXT) || "Approval request",
        action_type: truncateText(compactText(payload.action_type) || compactText(payload.actionType), 80),
      });
    }

    const payloadType = compactText(payload.type);
    if (/failed|error/i.test(payloadType) && facts.errors.length < REVIEW_FACT_MAX_ERRORS) {
      const excerpt = boundedFactText(
        payload.message ?? payload.error ?? payload.detail ?? payload.reason,
        REVIEW_FACT_MAX_ERROR_EXCERPT,
      );
      if (excerpt) {
        facts.errors.push({
          type: payloadType || "error",
          excerpt,
        });
      }
    }
  }

  return facts;
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
  const lastOutput = truncateOutput(events.map(outputFromEvent).filter(Boolean).at(-1), 1000);
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
    lastOutput,
    lastStatus: inferCodexSessionStatus(events),
    lastEventAt: lastEventAt || null,
    fileModifiedAt: stat.mtime.toISOString(),
    reviewFacts: extractCodexReviewFacts(events),
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
      last_output: summary.lastOutput,
      facts: summary.reviewFacts,
    },
  };
}
