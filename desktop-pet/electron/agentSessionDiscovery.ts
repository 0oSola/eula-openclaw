import type {
  CodexReviewFacts,
  CodexSessionFileSummary,
  CodexSessionStatus,
} from "./codexSessionFiles.js";
import type { ClaudeSessionFileSummary } from "./claudeSessionFiles.js";

export const AGENT_SESSION_PROVIDERS = ["codex", "claude"] as const;
export type AgentSessionProvider = (typeof AGENT_SESSION_PROVIDERS)[number];

export const AGENT_SESSION_RUNTIMES = ["desktop", "cli", "wsl", "unknown"] as const;
export type AgentSessionRuntime = (typeof AGENT_SESSION_RUNTIMES)[number];

export type AgentSessionState = CodexSessionStatus | "idle";

export type AgentSessionEvidence = {
  source: "codex-jsonl" | "claude-jsonl";
  sessionFileModifiedAt: string;
  sessionFile: string;
};

export type AgentSessionRecord = {
  sessionKey: string;
  provider: AgentSessionProvider;
  agent: AgentSessionProvider;
  runtime: AgentSessionRuntime;
  hostId: "local";
  sessionId: string;
  workspacePath: string;
  displayTitle: string;
  firstPromptPreview: string | null;
  lastSummary: string | null;
  lastOutput: string | null;
  state: AgentSessionState;
  sessionStartedAt: string;
  lastEventAt: string | null;
  lastActivityAt: string;
  sessionFile: string;
  originator: string | null;
  source: string | null | undefined;
  cliVersion: string | null;
  gitBranch: string | null;
  reviewFacts: CodexReviewFacts;
  evidence: AgentSessionEvidence[];
};

export type AgentSessionDiscoverySnapshot = {
  refreshedAt: string;
  sessions: AgentSessionRecord[];
};

export type CodexSessionScanner = (options: {
  codexHome: string;
  wslCodexHome?: string | null;
  workspacePath?: string | null;
  limit?: number;
  maxFiles?: number;
}) => CodexSessionFileSummary[];

export type ClaudeSessionScanner = (options: {
  claudeHome: string;
  workspacePath?: string | null;
  limit?: number;
  maxFiles?: number;
}) => ClaudeSessionFileSummary[];

export type LocalCodexSessionDiscoveryOptions = {
  codexHome: string;
  wslCodexHome?: string | null;
  limit?: number;
  maxFiles?: number;
  scan: CodexSessionScanner;
  now?: () => Date;
};

export type LocalClaudeSessionDiscoveryOptions = {
  claudeHome: string;
  limit?: number;
  maxFiles?: number;
  scan: ClaudeSessionScanner;
  now?: () => Date;
};

function compact(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function parseTime(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isWslEvidence(summary: CodexSessionFileSummary): boolean {
  return (
    summary.filePath.toLowerCase().includes("\\\\wsl.localhost\\") ||
    summary.workspacePath.toLowerCase().startsWith("/mnt/")
  );
}

function displayWorkspacePath(value: string): string {
  const workspacePath = compact(value);
  const match = workspacePath.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
  if (!match) return workspacePath;
  const drive = match[1]?.toUpperCase();
  const tail = (match[2] ?? "").replace(/\//g, "\\");
  return `${drive}:\\${tail}`.replace(/\\+$/, "\\");
}

function classifyRuntime(summary: CodexSessionFileSummary): AgentSessionRuntime {
  const originator = compact(summary.originator).toLowerCase();
  if (/desktop/.test(originator)) return "desktop";
  if (compact(summary.source).toLowerCase() === "desktop") return "desktop";
  if (/cli|tui/.test(originator)) return isWslEvidence(summary) ? "wsl" : "cli";
  if (compact(summary.source).toLowerCase() === "cli") return isWslEvidence(summary) ? "wsl" : "cli";
  return isWslEvidence(summary) ? "wsl" : "unknown";
}

function sessionKey(summary: CodexSessionFileSummary): string {
  return `local:codex:${summary.codexSessionId}`;
}

function sessionKeyFor(provider: AgentSessionProvider, sessionId: string): string {
  return `local:${provider}:${sessionId}`;
}

const ACTIVE_STATES = new Set<CodexSessionStatus>([
  "starting",
  "running",
  "command_running",
  "file_changed",
  "waiting_approval",
]);
const DEFAULT_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function deriveState(
  status: CodexSessionStatus,
  lastActivityAt: string,
  nowMs: number,
  activeWindowMs = DEFAULT_ACTIVE_WINDOW_MS,
): AgentSessionState {
  if (!ACTIVE_STATES.has(status)) return status;
  const lastActivityMs = parseTime(lastActivityAt);
  if (!lastActivityMs || nowMs - lastActivityMs > activeWindowMs) return "idle";
  return status;
}

function toRecord(summary: CodexSessionFileSummary, now: Date): AgentSessionRecord {
  const lastActivityAt =
    summary.lastEventAt || summary.fileModifiedAt || summary.sessionStartedAt;
  return {
    sessionKey: sessionKey(summary),
    provider: "codex",
    agent: "codex",
    runtime: classifyRuntime(summary),
    hostId: "local",
    sessionId: summary.codexSessionId,
    workspacePath: displayWorkspacePath(summary.workspacePath),
    displayTitle: summary.displayTitle,
    firstPromptPreview: summary.firstPromptPreview,
    lastSummary: summary.lastSummary,
    lastOutput: summary.lastOutput,
    state: deriveState(summary.lastStatus, lastActivityAt, now.getTime()),
    sessionStartedAt: summary.sessionStartedAt,
    lastEventAt: summary.lastEventAt,
    lastActivityAt,
    sessionFile: summary.filePath,
    originator: summary.originator,
    source: summary.source,
    cliVersion: summary.cliVersion,
    gitBranch: null,
    reviewFacts: summary.reviewFacts,
    evidence: [{
      source: "codex-jsonl",
      sessionFileModifiedAt: summary.fileModifiedAt,
      sessionFile: summary.filePath,
    }],
  };
}

function toClaudeRecord(summary: ClaudeSessionFileSummary, now: Date): AgentSessionRecord {
  const lastActivityAt =
    summary.lastEventAt || summary.fileModifiedAt || summary.sessionStartedAt;
  return {
    sessionKey: sessionKeyFor("claude", summary.claudeSessionId),
    provider: "claude",
    agent: "claude",
    runtime: "cli",
    hostId: "local",
    sessionId: summary.claudeSessionId,
    workspacePath: displayWorkspacePath(summary.workspacePath),
    displayTitle: summary.displayTitle,
    firstPromptPreview: summary.firstPromptPreview,
    lastSummary: summary.lastSummary,
    lastOutput: summary.lastOutput,
    state: deriveState(summary.lastStatus, lastActivityAt, now.getTime()),
    sessionStartedAt: summary.sessionStartedAt,
    lastEventAt: summary.lastEventAt,
    lastActivityAt,
    sessionFile: summary.filePath,
    originator: "claude-code",
    source: "claude-jsonl",
    cliVersion: summary.cliVersion,
    gitBranch: summary.gitBranch,
    reviewFacts: summary.reviewFacts,
    evidence: [{
      source: "claude-jsonl",
      sessionFileModifiedAt: summary.fileModifiedAt,
      sessionFile: summary.filePath,
    }],
  };
}

function preferNewer(left: AgentSessionRecord, right: AgentSessionRecord): AgentSessionRecord {
  const preferred = parseTime(right.lastActivityAt) >= parseTime(left.lastActivityAt) ? right : left;
  const evidence = new Map(
    [...left.evidence, ...right.evidence].map((item) => [
      `${item.source}:${item.sessionFile}`,
      item,
    ]),
  );
  return {
    ...preferred,
    evidence: Array.from(evidence.values()).sort(
      (leftEvidence, rightEvidence) =>
        parseTime(rightEvidence.sessionFileModifiedAt) -
        parseTime(leftEvidence.sessionFileModifiedAt),
    ),
  };
}

function dedupeAndSort(
  records: AgentSessionRecord[],
  refreshedAt: string,
): AgentSessionDiscoverySnapshot {
  const bySession = new Map<string, AgentSessionRecord>();
  for (const record of records) {
    const previous = bySession.get(record.sessionKey);
    bySession.set(record.sessionKey, previous ? preferNewer(previous, record) : record);
  }
  const sessions = Array.from(bySession.values()).sort(
    (left, right) => parseTime(right.lastActivityAt) - parseTime(left.lastActivityAt),
  );
  return { refreshedAt, sessions };
}

export async function discoverLocalCodexSessions(
  options: LocalCodexSessionDiscoveryOptions,
): Promise<AgentSessionDiscoverySnapshot> {
  const now = (options.now ?? (() => new Date()))();
  const summaries = options.scan({
    codexHome: options.codexHome,
    wslCodexHome: options.wslCodexHome,
    workspacePath: undefined,
    limit: Math.max(1, Math.min(options.limit ?? 50, 200)),
    maxFiles: Math.max(options.maxFiles ?? 400, options.limit ?? 50),
  });
  return dedupeAndSort(
    summaries.map((summary) => toRecord(summary, now)),
    now.toISOString(),
  );
}

export async function discoverLocalClaudeSessions(
  options: LocalClaudeSessionDiscoveryOptions,
): Promise<AgentSessionDiscoverySnapshot> {
  const now = (options.now ?? (() => new Date()))();
  const summaries = options.scan({
    claudeHome: options.claudeHome,
    workspacePath: undefined,
    limit: Math.max(1, Math.min(options.limit ?? 50, 200)),
    maxFiles: Math.max(options.maxFiles ?? 400, options.limit ?? 50),
  });
  return dedupeAndSort(
    summaries.map((summary) => toClaudeRecord(summary, now)),
    now.toISOString(),
  );
}
