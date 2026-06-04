import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  handleWorkspaceRequest,
  parseTerminalRequest,
  requestPathForWorkspace,
} = require("./extensionCore.cjs") as {
  handleWorkspaceRequest: (options: {
    vscode: {
      window: {
        terminals: Array<{ name: string; show: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> }>;
        createTerminal: ReturnType<typeof vi.fn>;
      };
    };
    fs: {
      existsSync: (path: string) => boolean;
      readFileSync: (path: string, encoding: "utf8") => string;
      unlinkSync?: (path: string) => void;
    };
    workspacePath: string;
    handledRequestIds: Set<string>;
    nowMs?: number;
  }) => { id: string; commandLine: string } | null;
  parseTerminalRequest: (raw: string) => { id: string; commandLine: string } | null;
  requestPathForWorkspace: (workspacePath: string) => string;
};

describe("VSCode helper terminal request core", () => {
  it("builds the workspace-local request path", () => {
    expect(requestPathForWorkspace("D:\\workspace\\MMD project")).toBe(
      path.join("D:\\workspace\\MMD project", ".codex-pet", "vscode-terminal-request.json"),
    );
  });

  it("rejects invalid terminal requests", () => {
    expect(parseTerminalRequest(JSON.stringify({ id: "request-1" }))).toBeNull();
    expect(parseTerminalRequest(JSON.stringify({ commandLine: "codex" }))).toBeNull();
  });

  it("creates a Codex Pet terminal and sends the request command", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const vscode = {
      window: {
        terminals: [],
        createTerminal: vi.fn(() => terminal),
      },
    };
    const requestPath = requestPathForWorkspace("D:\\workspace\\MMD project");
    const fs = {
      existsSync: vi.fn((path: string) => path === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "request-1",
          terminalName: "Codex Pet",
          workspacePath: "D:\\workspace\\MMD project",
          commandLine: 'codex resume --cd "D:\\workspace\\MMD project" session-1',
          createdAt: new Date().toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };

    const handled = handleWorkspaceRequest({
      vscode,
      fs,
      workspacePath: "D:\\workspace\\MMD project",
      handledRequestIds: new Set(),
    });

    expect(handled?.id).toBe("request-1");
    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: "Codex Pet",
      cwd: "D:\\workspace\\MMD project",
    });
    expect(terminal.show).toHaveBeenCalledWith(true);
    expect(terminal.sendText).toHaveBeenCalledWith('codex resume --cd "D:\\workspace\\MMD project" session-1', true);
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("sends prompt requests as terminal input", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const requestPath = requestPathForWorkspace("D:\\workspace\\MMD project");
    const prompt = "继续实现 Pet prompt 发送";
    const fs = {
      existsSync: vi.fn((path: string) => path === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "prompt-request-1",
          mode: "prompt",
          terminalName: "Codex Pet",
          workspacePath: "D:\\workspace\\MMD project",
          commandLine: prompt,
          createdAt: new Date().toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };

    const handled = handleWorkspaceRequest({
      vscode,
      fs,
      workspacePath: "D:\\workspace\\MMD project",
      handledRequestIds: new Set(),
    });

    expect(handled?.commandLine).toBe(prompt);
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.show).toHaveBeenCalledWith(true);
    expect(terminal.sendText).toHaveBeenCalledWith(prompt, true);
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("does not repeat a request id that was already handled", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const request = JSON.stringify({ id: "request-1", commandLine: "codex" });
    const fs = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => request),
    };
    const vscode = {
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };

    expect(
      handleWorkspaceRequest({
        vscode,
        fs,
        workspacePath: "D:\\workspace\\MMD project",
        handledRequestIds: new Set(["request-1"]),
      }),
    ).toBeNull();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it("ignores and deletes stale terminal requests", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const requestPath = requestPathForWorkspace("D:\\workspace\\MMD project");
    const fs = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "stale-request",
          commandLine: "codex",
          createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };

    expect(
      handleWorkspaceRequest({
        vscode,
        fs,
        workspacePath: "D:\\workspace\\MMD project",
        handledRequestIds: new Set(),
      }),
    ).toBeNull();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });
});
