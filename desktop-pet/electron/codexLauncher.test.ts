import { describe, expect, it, vi } from "vitest";

import {
  focusVscodeWorkspace,
  launchNewCodexSession,
  resolvePetWorkspacePath,
  resumeCodexSession,
  sendCodexPrompt,
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

  it("quotes the VSCode workspace path when focusing a Windows workspace with spaces", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });

    focusVscodeWorkspace({
      workspacePath: "D:\\workspace\\MMD project",
      env: {},
      platform: "win32",
      spawn,
    });

    expect(spawned[0]).toMatchObject({
      command: "code",
      args: ["--reuse-window", '"D:\\workspace\\MMD project"'],
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
    });

    expect(spawned[0]).toMatchObject({
      command: '"C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd"',
      args: ["--reuse-window", '"D:\\workspace\\MMD project"'],
      options: { shell: true },
    });
  });

  it("opens VSCode with the helper extension and requests a Codex integrated terminal", () => {
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
    });

    expect(result.workspacePath).toBe("D:\\workspace\\MMD project");
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({
      command: "code",
      args: [
        "--reuse-window",
        "--extensionDevelopmentPath",
        '"D:\\workspace\\MMD project\\desktop-pet\\vscode-helper"',
        '"D:\\workspace\\MMD project"',
      ],
      options: { cwd: "D:\\workspace\\MMD project", shell: true, windowsHide: true },
    });
    expect(launcherFs.fs.mkdirSync).toHaveBeenCalledWith("D:\\workspace\\MMD project\\.codex-pet", {
      recursive: true,
    });
    expect(launcherFs.writes[0].path).toBe(
      "D:\\workspace\\MMD project\\.codex-pet\\vscode-terminal-request.json",
    );
    expect(JSON.parse(launcherFs.writes[0].value)).toMatchObject({
      mode: "new",
      workspacePath: "D:\\workspace\\MMD project",
      commandLine: "codex",
    });
  });

  it("opens VSCode without extensionDevelopmentPath when helper mode is installed", () => {
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
    });

    expect(spawned[0]).toMatchObject({
      command: "code",
      args: ["--reuse-window", '"D:\\workspace\\MMD project"'],
      options: { cwd: "D:\\workspace\\MMD project", shell: true, windowsHide: true },
    });
    expect(spawned[0].args).not.toContain("--extensionDevelopmentPath");
    expect(JSON.parse(launcherFs.writes[0].value)).toMatchObject({
      mode: "new",
      workspacePath: "D:\\workspace\\MMD project",
      commandLine: "codex",
    });
  });

  it("falls back to development helper mode for an unknown helper mode", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });

    launchNewCodexSession({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      env: { MMD_PET_VSCODE_HELPER_MODE: "unknown" },
      platform: "win32",
      spawn,
      fs: createLauncherFs().fs,
    });

    expect(spawned[0].args).toContain("--extensionDevelopmentPath");
  });

  it("opens VSCode with the helper extension and requests Codex resume in the integrated terminal", () => {
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
    });

    expect(result).toEqual({
      codexSessionId: "019e88e4-4f27-7f20-be48-fd1ef50e9492",
      workspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
    });
    expect(spawned[0]).toMatchObject({
      command: "code",
      args: [
        "--reuse-window",
        "--extensionDevelopmentPath",
        '"D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet\\desktop-pet\\vscode-helper"',
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

  it("quotes a custom Codex CLI path in the terminal request command line", () => {
    const launcherFs = createLauncherFs();

    launchNewCodexSession({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      env: { MMD_PET_CODEX_CLI: "C:\\Program Files\\Codex\\codex.cmd" },
      platform: "win32",
      spawn: vi.fn(() => ({ unref: vi.fn() })),
      fs: launcherFs.fs,
    });

    expect(JSON.parse(launcherFs.writes[0].value)).toMatchObject({
      commandLine: '"C:\\Program Files\\Codex\\codex.cmd"',
    });
  });

  it("writes a prompt request for the VSCode integrated terminal", () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });
    const launcherFs = createLauncherFs();

    const result = sendCodexPrompt({
      workspacePath: "D:\\workspace\\MMD project",
      prompt: "继续实现 Pet prompt 发送",
      env: { MMD_PET_VSCODE_HELPER_MODE: "installed" },
      platform: "win32",
      spawn,
      fs: launcherFs.fs,
    });

    expect(result).toEqual({ workspacePath: "D:\\workspace\\MMD project" });
    expect(spawned[0].args).toEqual(["--reuse-window", '"D:\\workspace\\MMD project"']);
    expect(JSON.parse(launcherFs.writes[0].value)).toMatchObject({
      mode: "prompt",
      workspacePath: "D:\\workspace\\MMD project",
      commandLine: "继续实现 Pet prompt 发送",
    });
  });

  it("rejects empty prompt requests", () => {
    expect(() =>
      sendCodexPrompt({
        workspacePath: "D:\\workspace\\MMD project",
        prompt: "   ",
        spawn: vi.fn(() => ({ unref: vi.fn() })),
        fs: createLauncherFs().fs,
      }),
    ).toThrow("prompt is required");
  });
});
