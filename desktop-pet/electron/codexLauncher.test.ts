import path from "node:path";
import os from "node:os";

import { describe, expect, it, vi } from "vitest";

import {
  defaultVscodeUserDataDir,
  focusVscodeWorkspace,
  launchNewCodexSession,
  resolvePetWorkspacePath,
  resumeCodexSession,
  VSCODE_USER_DATA_ROOT_DIR,
} from "./codexLauncher";

describe("desktop pet Codex launcher", () => {
  function createLauncherFs() {
    const writes: Array<{ path: string; value: string }> = [];
    return {
      fs: {
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((path: string, value: string) => {
          writes.push({ path, value });
        }),
      },
      writes,
    };
  }

  it("uses the parent project as the default workspace when Electron starts inside desktop-pet", () => {
    expect(resolvePetWorkspacePath({ cwd: "D:\\workspace\\MMD project\\desktop-pet", env: {} })).toBe(
      "D:\\workspace\\MMD project",
    );
  });

  it("lets an environment variable override the workspace path", () => {
    expect(
      resolvePetWorkspacePath({
        cwd: "D:\\workspace\\MMD project\\desktop-pet",
        env: { MMD_PET_WORKSPACE_PATH: "D:\\workspace\\Other project" },
      }),
    ).toBe("D:\\workspace\\Other project");
  });

  it("derives a throwaway user-data-dir under the OS temp area", () => {
    const dir = defaultVscodeUserDataDir(1700000000000, 0.123456789);
    expect(dir.startsWith(path.join(os.tmpdir(), VSCODE_USER_DATA_ROOT_DIR))).toBe(true);
    expect(dir).toContain("1700000000000-");
  });

  it("opens a fresh VSCode window when focusing a Windows workspace with spaces", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });

    const result = focusVscodeWorkspace({
      workspacePath: "D:\\workspace\\MMD project",
      env: {},
      platform: "win32",
      spawn,
      userDataDir: "C:\\Temp\\focus-1",
    });

    expect(result).toMatchObject({
      workspacePath: "D:\\workspace\\MMD project",
      userDataDir: "C:\\Temp\\focus-1",
    });
    expect(spawned[0]).toMatchObject({
      command: "code",
      args: ["--new-window", "--user-data-dir", "C:\\Temp\\focus-1", '"D:\\workspace\\MMD project"'],
      options: { shell: true },
    });
  });

  it("quotes a custom Windows VSCode CLI path when launching through the shell", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });

    focusVscodeWorkspace({
      workspacePath: "D:\\workspace\\MMD project",
      env: { MMD_PET_VSCODE_CLI: "C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd" },
      platform: "win32",
      spawn,
      userDataDir: "C:\\Temp\\focus-2",
    });

    expect(spawned[0]).toMatchObject({
      command: '"C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd"',
      args: ["--new-window", "--user-data-dir", "C:\\Temp\\focus-2", '"D:\\workspace\\MMD project"'],
      options: { shell: true },
    });
  });

  it("generates a unique focus user-data-dir per workspace open when none is provided", () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));

    const first = focusVscodeWorkspace({ workspacePath: "D:\\workspace\\MMD project", env: {}, platform: "win32", spawn });
    const second = focusVscodeWorkspace({ workspacePath: "D:\\workspace\\MMD project", env: {}, platform: "win32", spawn });

    expect(first.userDataDir).not.toBe(second.userDataDir);
    expect(first.userDataDir.startsWith(path.join(os.tmpdir(), VSCODE_USER_DATA_ROOT_DIR))).toBe(true);
  });

  it("opens a fresh VSCode window with the helper extension and requests a Codex integrated terminal", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });
    const launcherFs = createLauncherFs();

    const result = launchNewCodexSession({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
      userDataDir: "C:\\Temp\\ud-1",
    });

    expect(result).toMatchObject({
      workspacePath: "D:\\workspace\\MMD project",
      commandLine: "codex",
      userDataDir: "C:\\Temp\\ud-1",
      terminalRequest: {
        path: "D:\\workspace\\MMD project\\.codex-pet\\vscode-terminal-request.json",
        globalPath: path.join(os.tmpdir(), "mmd-codex-pet", "vscode-terminal-request.json"),
        workspacePath: "D:\\workspace\\MMD project",
      },
    });
    expect(spawned).toHaveLength(1);
    // A unique --user-data-dir is what forces VSCode to open a brand-new window
    // for the same workspace every time (VSCode de-dupes by folder+user-data-dir).
    expect(spawned[0]).toMatchObject({
      command: "code",
      args: [
        "--new-window",
        "--user-data-dir",
        "C:\\Temp\\ud-1",
        "--extensionDevelopmentPath",
        '"D:\\workspace\\MMD project\\desktop-pet\\vscode-helper"',
        '"D:\\workspace\\MMD project"',
      ],
      options: { cwd: "D:\\workspace\\MMD project", shell: true, windowsHide: true },
    });
    expect(launcherFs.fs.mkdirSync).toHaveBeenCalledWith("D:\\workspace\\MMD project\\.codex-pet", {
      recursive: true,
    });
    expect(launcherFs.fs.mkdirSync).toHaveBeenCalledWith(path.join(os.tmpdir(), "mmd-codex-pet"), {
      recursive: true,
    });
    expect(launcherFs.writes.map((write) => write.path)).toEqual([
      "D:\\workspace\\MMD project\\.codex-pet\\vscode-terminal-request.json",
      path.join(os.tmpdir(), "mmd-codex-pet", "vscode-terminal-request.json"),
    ]);
    expect(JSON.parse(launcherFs.writes[0].value)).toMatchObject({
      mode: "new",
      workspacePath: "D:\\workspace\\MMD project",
      terminalName: "Codex Pet",
      commandLine: "codex",
    });
    expect(JSON.parse(launcherFs.writes[1].value)).toEqual(JSON.parse(launcherFs.writes[0].value));
  });

  it("generates a unique user-data-dir per launch when none is provided", () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const launcherFs = createLauncherFs();

    const first = launchNewCodexSession({
      workspacePath: "D:\\workspace\\MMD project",
      env: {},
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
    });
    const second = launchNewCodexSession({
      workspacePath: "D:\\workspace\\MMD project",
      env: {},
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
    });

    expect(first.userDataDir).not.toBe(second.userDataDir);
    expect(first.userDataDir.startsWith(path.join(os.tmpdir(), VSCODE_USER_DATA_ROOT_DIR))).toBe(true);
  });

  it("opens VSCode without extensionDevelopmentPath in installed helper mode but still writes the terminal request", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });
    const launcherFs = createLauncherFs();

    launchNewCodexSession({
      workspacePath: "D:\\workspace\\MMD project",
      env: { MMD_PET_VSCODE_HELPER_MODE: "installed" },
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
      userDataDir: "C:\\Temp\\installed-ud",
    });

    expect(spawned[0]).toMatchObject({
      command: "code",
      args: ["--new-window", "--user-data-dir", "C:\\Temp\\installed-ud", '"D:\\workspace\\MMD project"'],
      options: { cwd: "D:\\workspace\\MMD project", shell: true, windowsHide: true },
    });
    expect(spawned[0].args).not.toContain("--extensionDevelopmentPath");
    expect(JSON.parse(launcherFs.writes[0].value)).toMatchObject({
      mode: "new",
      workspacePath: "D:\\workspace\\MMD project",
      commandLine: "codex",
    });
  });

  it("returns the codex resume command and a fresh window for restored sessions", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });
    const launcherFs = createLauncherFs();

    const result = resumeCodexSession({
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
      userDataDir: "C:\\Temp\\ud-resume",
    });

    expect(result).toMatchObject({
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      userDataDir: "C:\\Temp\\ud-resume",
      commandLine:
        'codex resume --cd "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet" 019e88e4-4f27-7f20-be48-fd1ef50e9492',
      terminalRequest: {
        path: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet\\.codex-pet\\vscode-terminal-request.json",
        globalPath: path.join(os.tmpdir(), "mmd-codex-pet", "vscode-terminal-request.json"),
        workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      },
    });
    expect(spawned[0]).toMatchObject({
      command: "code",
      args: [
        "--new-window",
        "--user-data-dir",
        "C:\\Temp\\ud-resume",
        "--extensionDevelopmentPath",
        '"D:\\workspace\\MMD project\\desktop-pet\\vscode-helper"',
        '"D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet"',
      ],
    });
    expect(JSON.parse(launcherFs.writes[0].value)).toMatchObject({
      mode: "resume",
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      commandLine:
        'codex resume --cd "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet" 019e88e4-4f27-7f20-be48-fd1ef50e9492',
    });
  });

  it("quotes a custom Codex CLI path in the returned command line", () => {
    const launcherFs = createLauncherFs();

    const result = launchNewCodexSession({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      env: { MMD_PET_CODEX_CLI: "C:\\Program Files\\Codex\\codex.cmd" },
      platform: "win32",
      spawn: vi.fn(() => ({ unref: vi.fn() })),
      fs: launcherFs.fs,
    });

    expect(result.commandLine).toBe('"C:\\Program Files\\Codex\\codex.cmd"');
    expect(JSON.parse(launcherFs.writes[0].value)).toMatchObject({
      commandLine: '"C:\\Program Files\\Codex\\codex.cmd"',
    });
  });

  it("rejects empty resume session ids", () => {
    expect(() =>
      resumeCodexSession({
        codexSessionId: "   ",
        workspacePath: "D:\\workspace\\MMD project",
        spawn: vi.fn(() => ({ unref: vi.fn() })),
      }),
    ).toThrow("codexSessionId is required");
  });
});
