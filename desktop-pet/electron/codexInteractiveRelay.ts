import { createHash } from "node:crypto";
import path from "node:path";

export type CodexRelayState =
  | "idle"
  | "starting"
  | "launched"
  | "resuming"
  | "running"
  | "command_running"
  | "file_changed"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "disconnected"
  | "vscode-opened";

export type CodexRelayApproval = {
  id: string;
  title: string;
  actionType: string;
  detail: Record<string, unknown>;
};

export type CodexRelayStatus = {
  state: CodexRelayState;
  workspacePath?: string;
  sessionTitle?: string;
  codexSessionId?: string;
  lastOutput?: string;
  error?: string;
  updatedAt?: string;
  source?: "app-server-relay" | "codex-jsonl" | "terminal";
  pendingApprovals?: CodexRelayApproval[];
};

export type CodexRelayMode = "read_only" | "patch";
export type CodexRelayDecision = "approve_once" | "deny";

type RelayWorkspace = {
  id: string;
  path: string;
  source?: string;
};

type RelaySessionResponse = {
  id: string;
  workspace_id: string;
  status: string;
  sandbox: string;
  ws_url: string;
};

type RelaySocket = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

type RelayWebSocketConstructor = new (url: string) => RelaySocket;

export type CodexInteractiveRelayClientOptions = {
  apiBaseUrl: string;
  userId: string;
  mode?: CodexRelayMode;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: RelayWebSocketConstructor;
  onStatus?: (status: CodexRelayStatus, event?: Record<string, unknown>) => void;
};

function normalizeUrlBase(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function safeDetail(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function workspaceName(workspacePath: string): string {
  return workspacePath.split(/[\\/]/).filter(Boolean).at(-1) || "workspace";
}

export function workspaceIdFromPath(workspacePath: string): string {
  const normalized = normalizeComparablePath(workspacePath);
  const name = workspaceName(normalized);
  const slug = name.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "codex-workspace";
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${slug.slice(0, 110)}-${hash}`.toLowerCase();
}

export function buildCodexRelayWebSocketUrl(apiBaseUrl: string, wsPath: string): string {
  const base = new URL(apiBaseUrl);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const source = new URL(wsPath, base);
  base.pathname = source.pathname.replace(/^\/api\/backend/, "") || "/";
  base.search = new URLSearchParams(source.searchParams).toString();
  base.hash = "";
  return base.toString();
}

function appendOutput(previous: string | undefined, nextLine: string): string | undefined {
  const line = nextLine.trim();
  if (!line) return previous;
  const previousLines = previous?.replace(/\r\n/g, "\n").split("\n").filter(Boolean) ?? [];
  return [...previousLines, line].slice(-6).join("\n");
}

function approvalOutput(event: Record<string, unknown>): string {
  const title = compactText(event.title) || "Approval required";
  const detail = safeDetail(event.detail);
  const detailText = Object.keys(detail).length ? JSON.stringify(detail) : "";
  return [title, detailText].filter(Boolean).join("\n");
}

function outputFromRelayEvent(event: Record<string, unknown>): string {
  const eventType = compactText(event.type);
  if (eventType === "text_delta" || eventType === "plan_delta") return compactText(event.text);
  if (eventType === "command_started") return compactText(event.command);
  if (eventType === "command_output") {
    const stream = compactText(event.stream) || "stdout";
    const text = compactText(event.text);
    return text ? `${stream}: ${text}` : "";
  }
  if (eventType === "file_changed") {
    const changeType = compactText(event.change_type);
    const changedPath = compactText(event.path);
    return [changeType, changedPath].filter(Boolean).join(" ");
  }
  if (eventType === "diff_ready" && Array.isArray(event.changed_files)) {
    return event.changed_files.map(compactText).filter(Boolean).join("\n");
  }
  if (eventType === "turn_completed") return compactText(event.final_text);
  if (eventType === "turn_failed") return compactText(event.error);
  if (eventType === "session_closed") return compactText(event.reason);
  if (eventType === "process_exit") return compactText(event.reason) || compactText(event.raw_method);
  return "";
}

function stateFromRelayEvent(event: Record<string, unknown>): CodexRelayState | null {
  switch (compactText(event.type)) {
    case "session_ready":
      return "running";
    case "turn_started":
    case "text_delta":
    case "plan_delta":
    case "approval_decided":
      return "running";
    case "command_started":
    case "command_output":
      return "command_running";
    case "file_changed":
    case "diff_ready":
      return "file_changed";
    case "approval_required":
      return "waiting_approval";
    case "turn_completed":
      return "completed";
    case "turn_failed":
      return "failed";
    case "session_closed":
      return "disconnected";
    case "process_exit":
      return Number(event.exit_code ?? 0) ? "failed" : "disconnected";
    default:
      return null;
  }
}

function mergeApproval(
  pendingApprovals: CodexRelayApproval[] | undefined,
  approval: CodexRelayApproval,
): CodexRelayApproval[] {
  const existing = pendingApprovals ?? [];
  return [...existing.filter((item) => item.id !== approval.id), approval];
}

export function foldCodexRelayEvent(status: CodexRelayStatus, event: Record<string, unknown>): CodexRelayStatus {
  const eventType = compactText(event.type);
  const nextState = stateFromRelayEvent(event) ?? status.state;
  const next: CodexRelayStatus = {
    ...status,
    state: nextState,
    source: "app-server-relay",
  };

  if (eventType === "session_ready") {
    next.codexSessionId = compactText(event.session_id) || next.codexSessionId;
  }

  if (eventType === "approval_required") {
    const approvalId = compactText(event.approval_id);
    if (approvalId) {
      next.pendingApprovals = mergeApproval(next.pendingApprovals, {
        id: approvalId,
        title: compactText(event.title) || "Approval required",
        actionType: compactText(event.action_type) || "unknown",
        detail: safeDetail(event.detail),
      });
    }
    next.lastOutput = approvalOutput(event);
    return next;
  }

  if (eventType === "approval_decided") {
    const approvalId = compactText(event.approval_id);
    next.pendingApprovals = approvalId
      ? (next.pendingApprovals ?? []).filter((approval) => approval.id !== approvalId)
      : [];
    return next;
  }

  const output = outputFromRelayEvent(event);
  if (output) next.lastOutput = appendOutput(next.lastOutput, output);
  if (eventType === "turn_failed") next.error = output || "Codex turn failed.";
  if (eventType === "process_exit" && next.state === "failed") next.error = output || "Codex app-server process exited.";
  return next;
}

export class CodexInteractiveRelayClient {
  private readonly apiBaseUrl: string;
  private readonly userId: string;
  private readonly mode: CodexRelayMode;
  private readonly fetchImpl: typeof fetch;
  private readonly WebSocketImpl?: RelayWebSocketConstructor;
  private readonly onStatus?: (status: CodexRelayStatus, event?: Record<string, unknown>) => void;
  private session:
    | {
        id: string;
        workspaceId: string;
        workspacePath: string;
        wsUrl: string;
        socket?: RelaySocket;
      }
    | null = null;
  private status: CodexRelayStatus | null = null;

  constructor(options: CodexInteractiveRelayClientOptions) {
    this.apiBaseUrl = normalizeUrlBase(options.apiBaseUrl);
    this.userId = options.userId;
    this.mode = options.mode ?? "patch";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.WebSocketImpl = options.WebSocketImpl;
    this.onStatus = options.onStatus;
  }

  currentStatus(): CodexRelayStatus | null {
    return this.status ? { ...this.status, pendingApprovals: [...(this.status.pendingApprovals ?? [])] } : null;
  }

  close() {
    this.session?.socket?.close();
    this.session = null;
    this.status = null;
  }

  async sendPrompt(options: { workspacePath: string; prompt: string }): Promise<CodexRelayStatus> {
    const prompt = options.prompt.trim();
    if (!prompt) throw new Error("prompt is required");
    const session = await this.ensureSession(options.workspacePath);
    await this.ensureSocket(session);
    if (!session.socket || session.socket.readyState !== 1) {
      throw new Error("Codex relay websocket is not open");
    }
    session.socket.send(JSON.stringify({ type: "user_message", text: prompt, mode: this.mode }));
    const status = {
      ...(this.status ?? this.baseStatus(session)),
      state: "running" as const,
      lastOutput: prompt,
    };
    this.publishStatus(status);
    return status;
  }

  async decideApproval(options: {
    sessionId: string;
    approvalId: string;
    decision: CodexRelayDecision;
  }): Promise<unknown> {
    const sessionId = options.sessionId.trim();
    const approvalId = options.approvalId.trim();
    if (!sessionId) throw new Error("sessionId is required");
    if (!approvalId) throw new Error("approvalId is required");
    if (!["approve_once", "deny"].includes(options.decision)) throw new Error("Unsupported Codex approval decision");
    return this.requestJson(`/codex/interactive/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`, {
      method: "POST",
      body: JSON.stringify({ decision: options.decision }),
    });
  }

  private async ensureSession(workspacePath: string) {
    const normalizedWorkspacePath = path.resolve(workspacePath);
    if (this.session && normalizeComparablePath(this.session.workspacePath) === normalizeComparablePath(normalizedWorkspacePath)) {
      return this.session;
    }

    this.close();
    const workspace = await this.ensureWorkspace(normalizedWorkspacePath);
    const created = await this.createSession(workspace.id);
    this.session = {
      id: created.id,
      workspaceId: created.workspace_id,
      workspacePath: normalizedWorkspacePath,
      wsUrl: buildCodexRelayWebSocketUrl(this.apiBaseUrl, created.ws_url),
    };
    this.publishStatus(this.baseStatus(this.session));
    return this.session;
  }

  private baseStatus(session: { id: string; workspacePath: string }): CodexRelayStatus {
    return {
      state: "starting",
      workspacePath: session.workspacePath,
      sessionTitle: workspaceName(session.workspacePath),
      codexSessionId: session.id,
      source: "app-server-relay",
      pendingApprovals: [],
    };
  }

  private async ensureWorkspace(workspacePath: string): Promise<RelayWorkspace> {
    const listed = await this.requestJson<{ workspaces?: RelayWorkspace[] }>("/codex/workspaces");
    const existing = (listed.workspaces ?? []).find(
      (workspace) => normalizeComparablePath(workspace.path) === normalizeComparablePath(workspacePath),
    );
    if (existing) return existing;
    const workspaceId = workspaceIdFromPath(workspacePath);
    const created = await this.requestJson<{ workspace: RelayWorkspace }>("/codex/workspaces", {
      method: "POST",
      body: JSON.stringify({ workspace_id: workspaceId, path: workspacePath }),
    });
    return created.workspace;
  }

  private async createSession(workspaceId: string): Promise<RelaySessionResponse> {
    return this.requestJson<RelaySessionResponse>("/codex/interactive/sessions", {
      method: "POST",
      body: JSON.stringify({
        local_chat_session_id: `desktop-pet:${Date.now()}`,
        workspace_id: workspaceId,
        mode: this.mode,
        sandbox: this.mode === "patch" ? "workspace-write" : "read-only",
      }),
    });
  }

  private async ensureSocket(session: NonNullable<CodexInteractiveRelayClient["session"]>): Promise<void> {
    if (session.socket?.readyState === 1) return;
    const WebSocketCtor = this.WebSocketImpl ?? (globalThis as typeof globalThis & { WebSocket?: RelayWebSocketConstructor }).WebSocket;
    if (!WebSocketCtor) throw new Error("Codex relay websocket is unavailable");
    const socket = new WebSocketCtor(session.wsUrl);
    session.socket = socket;
    socket.onmessage = (message) => this.handleSocketMessage(session, message);
    socket.onclose = () => {
      if (this.session?.id === session.id) {
        this.publishStatus({ ...(this.status ?? this.baseStatus(session)), state: "disconnected" });
      }
    };
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Codex relay websocket open timed out")), 10000);
      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Codex relay websocket connection failed"));
      };
    });
  }

  private handleSocketMessage(session: NonNullable<CodexInteractiveRelayClient["session"]>, message: { data?: unknown }) {
    if (typeof message.data !== "string") return;
    try {
      const event = JSON.parse(message.data) as Record<string, unknown>;
      const nextStatus = foldCodexRelayEvent(this.status ?? this.baseStatus(session), event);
      this.publishStatus(nextStatus, event);
    } catch {
      this.publishStatus({
        ...(this.status ?? this.baseStatus(session)),
        state: "failed",
        error: "Codex relay event parse failed.",
      });
    }
  }

  private async requestJson<T>(route: string, init: { method?: string; body?: string } = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${route}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-user-id": this.userId,
      },
      body: init.body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data && typeof data === "object" && "detail" in data ? String(data.detail) : "";
      throw new Error(detail || `Codex relay request failed: ${response.status}`);
    }
    return data as T;
  }

  private publishStatus(status: CodexRelayStatus, event?: Record<string, unknown>) {
    this.status = {
      ...status,
      updatedAt: new Date().toISOString(),
    };
    this.onStatus?.(this.status, event);
  }
}
