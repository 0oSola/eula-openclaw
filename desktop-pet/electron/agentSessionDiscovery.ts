import type {
  CodexReviewFacts,
  CodexSessionFileSummary,
  CodexSessionStatus,
} from "./codexSessionFiles.js";

export const AGENT_SESSION_PROVIDERS = ["codex"] as const;
export type AgentSessionProvider = (typeof AGENT_SESSION_PROVIDERS)[number];

export const AGENT_SESSION_RUNTIMES = ["desktop", "cli", "wsl", "unknown"] as const;
export type AgentSessionRuntime = (typeof AGENT_SESSION_RUNTIMES)[number];

export type AgentSessionState = CodexSessionStatus;

export type AgentSessionRecord = {
  sessionKey: string;
  provider: AgentSessionProvider;
  agent: "codex";
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
  reviewFacts: CodexReviewFacts;
  evidence: {
    source: "codex-jsonl";
    sessionFileModifiedAt: string;
  };
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

export type LocalCodexSessionDiscoveryOptions = {
  codexHome: string;
  wslCodexHome?: string | null;
  limit?: number;
  maxFiles?: number;
  scan: CodexSessionScanner;
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

function toRecord(summary: CodexSessionFileSummary): AgentSessionRecord {
  const lastActivityAt =
    summary.lastEventAt || summary.fileModifiedAt || summary.sessionStartedAt;
  return {
    sessionKey: sessionKey(summary),
    provider: "codex",
    agent: "codex",
    runtime: classifyRuntime(summary),
    hostId: "local",
    sessionId: summary.codexSessionId,
    workspacePath: summary.workspacePath,
    displayTitle: summary.displayTitle,
    firstPromptPreview: summary.firstPromptPreview,
    lastSummary: summary.lastSummary,
    lastOutput: summary.lastOutput,
    state: summary.lastStatus,
    sessionStartedAt: summary.sessionStartedAt,
    lastEventAt: summary.lastEventAt,
    lastActivityAt,
    sessionFile: summary.filePath,
    originator: summary.originator,
    source: summary.source,
    cliVersion: summary.cliVersion,
    reviewFacts: summary.reviewFacts,
    evidence: {
      source: "codex-jsonl",
      sessionFileModifiedAt: summary.fileModifiedAt,
    },
  };
}

function preferNewer(left: AgentSessionRecord, right: AgentSessionRecord): AgentSessionRecord {
  return parseTime(right.lastActivityAt) >= parseTime(left.lastActivityAt) ? right : left;
}

export async function discoverLocalCodexSessions(
  options: LocalCodexSessionDiscoveryOptions,
): Promise<AgentSessionDiscoverySnapshot> {
  const summaries = options.scan({
    codexHome: options.codexHome,
    wslCodexHome: options.wslCodexHome,
    workspacePath: undefined,
    limit: Math.max(1, Math.min(options.limit ?? 50, 200)),
    maxFiles: Math.max(options.maxFiles ?? 400, options.limit ?? 50),
  });
  const bySession = new Map<string, AgentSessionRecord>();
  for (const summary of summaries) {
    const record = toRecord(summary);
    const previous = bySession.get(record.sessionKey);
    bySession.set(record.sessionKey, previous ? preferNewer(previous, record) : record);
  }
  const sessions = Array.from(bySession.values()).sort(
    (left, right) => parseTime(right.lastActivityAt) - parseTime(left.lastActivityAt),
  );
  return {
    refreshedAt: (options.now ?? (() => new Date()))().toISOString(),
    sessions,
  };
}
