import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  globalRequestPath,
  handleAllWorkspaceRequests,
  handleWorkspaceRequest,
  parseTerminalRequest,
  requestPathForWorkspace,
} = require("./extensionCore.cjs") as {
  globalRequestPath: () => string;
  handleAllWorkspaceRequests: (options: {
    vscode: {
      workspace: { workspaceFolders?: Array<{ uri: { fsPath: string } }> };
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
    handledRequestIds: Set<string>;
  }) => Array<{ id: string; commandLine: string }>;
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

  it("ignores a pending request while the JSON file is only partially written", () => {
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => "{"),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      window: {
        terminals: [terminal],
        createTerminal: vi.fn(),
      },
    };

    expect(() =>
      handleWorkspaceRequest({
        vscode,
        fs,
        workspacePath: "D:\\workspace\\MMD project",
        handledRequestIds: new Set(),
      }),
    ).not.toThrow();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
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

  it("handles a global request pointer when VSCode opens the helper without workspace folders", () => {
    const workspacePath = "D:\\workspace\\MMD project";
    const globalPath = globalRequestPath();
    const localPath = requestPathForWorkspace(workspacePath);
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const requestPayload = JSON.stringify({
      id: "global-request-1",
      mode: "new",
      workspacePath,
      terminalName: "Codex Pet",
      commandLine: "codex",
      createdAt: new Date().toISOString(),
    });
    const fs = {
      existsSync: vi.fn((path: string) => path === globalPath || path === localPath),
      readFileSync: vi.fn(() => requestPayload),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: {
        workspaceFolders: undefined,
      },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
    });

    expect(handled.map((request) => request.id)).toEqual(["global-request-1"]);
    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: "Codex Pet",
      cwd: workspacePath,
    });
    expect(terminal.sendText).toHaveBeenCalledWith("codex", true);
    expect(fs.unlinkSync).toHaveBeenCalledWith(globalPath);
    expect(fs.unlinkSync).toHaveBeenCalledWith(localPath);
  });

  it("does not run a global request pointer without a matching workspace-local request", () => {
    const workspacePath = "D:\\workspace\\MMD project";
    const globalPath = globalRequestPath();
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const fs = {
      existsSync: vi.fn((path: string) => path === globalPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "global-request-without-local",
          mode: "new",
          workspacePath,
          terminalName: "Codex Pet",
          commandLine: "codex",
          createdAt: new Date().toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };
    const vscode = {
      workspace: {
        workspaceFolders: undefined,
      },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };

    const handled = handleAllWorkspaceRequests({
      vscode,
      fs,
      handledRequestIds: new Set(),
    });

    expect(handled).toEqual([]);
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
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
