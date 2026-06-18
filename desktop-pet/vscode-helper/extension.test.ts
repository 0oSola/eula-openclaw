import { createRequire } from "node:module";
import Module from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

function requireExtensionWithMocks(vscode: unknown, fs: unknown) {
  const moduleWithLoad = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleWithLoad._load;
  moduleWithLoad._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === "vscode") return vscode;
    if (request === "node:fs") return fs;
    return originalLoad.call(this, request, parent, isMain);
  };
  const extensionPath = require.resolve("./extension.cjs");
  delete require.cache[extensionPath];
  try {
    return require("./extension.cjs") as {
      activate: (context: { subscriptions: unknown[] }) => void;
    };
  } finally {
    moduleWithLoad._load = originalLoad;
  }
}

describe("VSCode helper extension activation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes a pending request when workspace folders appear after activation", () => {
    vi.useFakeTimers();
    const workspacePath = "D:\\workspace\\MMD project";
    const requestPath = `${workspacePath}\\.codex-pet\\vscode-terminal-request.json`;
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    let onWorkspaceFoldersChanged: (() => void) | null = null;
    const watcher = {
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    };
    const vscode = {
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
      },
      workspace: {
        workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
        createFileSystemWatcher: vi.fn(() => watcher),
        onDidChangeWorkspaceFolders: vi.fn((callback: () => void) => {
          onWorkspaceFoldersChanged = callback;
          return { dispose: vi.fn() };
        }),
      },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };
    const fs = {
      existsSync: vi.fn((path: string) => path === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "request-after-workspace",
          commandLine: "codex",
          workspacePath,
          createdAt: new Date().toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };

    const extension = requireExtensionWithMocks(vscode, fs);
    extension.activate({ subscriptions: [] });
    vi.advanceTimersByTime(200);
    expect(terminal.sendText).not.toHaveBeenCalled();

    vscode.workspace.workspaceFolders = [{ uri: { fsPath: workspacePath } }];
    onWorkspaceFoldersChanged?.();
    vi.advanceTimersByTime(200);

    expect(terminal.sendText).toHaveBeenCalledWith("codex", true);
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });

  it("polls pending requests when workspace folders appear without a change event", () => {
    vi.useFakeTimers();
    const workspacePath = "D:\\workspace\\MMD project";
    const requestPath = `${workspacePath}\\.codex-pet\\vscode-terminal-request.json`;
    const terminal = { name: "Codex Pet", show: vi.fn(), sendText: vi.fn() };
    const watcher = {
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    };
    const vscode = {
      commands: {
        registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
      },
      workspace: {
        workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
        createFileSystemWatcher: vi.fn(() => watcher),
        onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
      },
      window: {
        terminals: [] as Array<typeof terminal>,
        createTerminal: vi.fn(() => terminal),
      },
    };
    const fs = {
      existsSync: vi.fn((path: string) => path === requestPath),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          id: "request-after-silent-workspace",
          commandLine: "codex",
          workspacePath,
          createdAt: new Date().toISOString(),
        }),
      ),
      unlinkSync: vi.fn(),
    };

    const extension = requireExtensionWithMocks(vscode, fs);
    extension.activate({ subscriptions: [] });
    vi.advanceTimersByTime(200);
    expect(terminal.sendText).not.toHaveBeenCalled();

    vscode.workspace.workspaceFolders = [{ uri: { fsPath: workspacePath } }];
    vi.advanceTimersByTime(1000);

    expect(terminal.sendText).toHaveBeenCalledWith("codex", true);
    expect(fs.unlinkSync).toHaveBeenCalledWith(requestPath);
  });
});
