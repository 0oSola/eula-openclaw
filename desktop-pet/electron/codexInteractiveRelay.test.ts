import { describe, expect, it, vi } from "vitest";

import {
  CodexInteractiveRelayClient,
  buildCodexRelayWebSocketUrl,
  foldCodexRelayEvent,
  workspaceIdFromPath,
} from "./codexInteractiveRelay";

describe("Codex interactive relay", () => {
  it("creates a stable readable workspace id from a path", () => {
    expect(workspaceIdFromPath("D:\\workspace\\MMD project")).toMatch(/^mmd-project-[a-f0-9]{8}$/);
    expect(workspaceIdFromPath("D:\\workspace\\MMD project")).toBe(workspaceIdFromPath("D:/workspace/MMD project/"));
  });

  it("normalizes backend websocket paths against the configured API base URL", () => {
    expect(
      buildCodexRelayWebSocketUrl(
        "http://127.0.0.1:8000",
        "/api/backend/ws/codex/interactive/codex_sess_1?user_id=admin-1",
      ),
    ).toBe("ws://127.0.0.1:8000/ws/codex/interactive/codex_sess_1?user_id=admin-1");
  });

  it("folds live relay events into Pet status with approval ids and recent output", () => {
    const base = {
      state: "starting" as const,
      workspacePath: "D:\\workspace\\MMD project",
      sessionTitle: "MMD project",
      codexSessionId: "codex_sess_1",
      source: "app-server-relay" as const,
    };

    const command = foldCodexRelayEvent(base, { type: "command_started", command: "npm test" });
    const approval = foldCodexRelayEvent(command, {
      type: "approval_required",
      approval_id: "approval_1",
      action_type: "command",
      title: "Run npm test",
      detail: { command: "npm test" },
    });

    expect(approval).toMatchObject({
      state: "waiting_approval",
      lastOutput: "Run npm test\n{\"command\":\"npm test\"}",
      pendingApprovals: [
        {
          id: "approval_1",
          actionType: "command",
          title: "Run npm test",
        },
      ],
      source: "app-server-relay",
    });

    expect(foldCodexRelayEvent(approval, { type: "approval_decided", approval_id: "approval_1" })).toMatchObject({
      state: "running",
      pendingApprovals: [],
    });
  });

  it("uses REST for direct approval decisions", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ decision: "deny" }),
      } as Response;
    });
    const relay = new CodexInteractiveRelayClient({
      apiBaseUrl: "http://127.0.0.1:8000",
      userId: "admin-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await relay.decideApproval({
      sessionId: "codex_sess_1",
      approvalId: "approval_1",
      decision: "deny",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:8000/codex/interactive/codex_sess_1/approvals/approval_1");
    expect(calls[0].init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "admin-1",
      },
      body: JSON.stringify({ decision: "deny" }),
    });
  });

  it("registers the workspace, opens a websocket, and sends prompts through the relay protocol", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/codex/workspaces") && (!init || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({ workspaces: [] }),
        } as Response;
      }
      if (url.endsWith("/codex/workspaces") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ workspace: { id: "mmd-project-12345678", path: "D:\\workspace\\MMD project" } }),
        } as Response;
      }
      if (url.endsWith("/codex/interactive/sessions")) {
        return {
          ok: true,
          json: async () => ({
            id: "codex_sess_1",
            workspace_id: "mmd-project-12345678",
            status: "ready",
            sandbox: "workspace-write",
            ws_url: "/api/backend/ws/codex/interactive/codex_sess_1?user_id=admin-1",
          }),
        } as Response;
      }
      throw new Error(`unexpected request ${url}`);
    });
    const sockets: FakeRelaySocket[] = [];
    class FakeRelaySocket {
      readyState = 0;
      sent: string[] = [];
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data?: unknown }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onclose: ((event: unknown) => void) | null = null;

      constructor(public url: string) {
        sockets.push(this);
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.({});
        });
      }

      send(data: string) {
        this.sent.push(data);
      }

      close() {
        this.readyState = 3;
      }
    }
    const statuses: unknown[] = [];
    const relay = new CodexInteractiveRelayClient({
      apiBaseUrl: "http://127.0.0.1:8000",
      userId: "admin-1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      WebSocketImpl: FakeRelaySocket,
      onStatus: (status) => statuses.push(status),
    });

    await relay.sendPrompt({ workspacePath: "D:\\workspace\\MMD project", prompt: "continue todo" });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "turn_completed", final_text: "done" }) });

    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:8000/codex/workspaces",
      "http://127.0.0.1:8000/codex/workspaces",
      "http://127.0.0.1:8000/codex/interactive/sessions",
    ]);
    expect(sockets[0].url).toBe("ws://127.0.0.1:8000/ws/codex/interactive/codex_sess_1?user_id=admin-1");
    expect(sockets[0].sent).toEqual([JSON.stringify({ type: "user_message", text: "continue todo", mode: "patch" })]);
    expect(statuses.at(-1)).toMatchObject({
      state: "completed",
      lastOutput: "continue todo\ndone",
    });
  });
});
