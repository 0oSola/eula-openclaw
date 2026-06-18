import path from "node:path";
import os from "node:os";

import { describe, expect, it, vi } from "vitest";

import {
  launchNewClaudeSession,
  resumeClaudeSession,
} from "./claudeLauncher";

describe("desktop pet Claude launcher", () => {
  function createSpawn() {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const spawn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      return { unref: vi.fn() };
    });
    return { spawn, spawned };
  }

  const FIXED_UDD = "D:\\udd\\claude-session-1";

  it("opens the workspace in a fresh VSCode window with an isolated user-data-dir", () => {
    const { spawn, spawned } = createSpawn();

    const result = launchNewClaudeSession({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      platform: "win32",
      spawn,
      userDataDir: FIXED_UDD,
    });

    expect(result.workspacePath).toBe("D:\\workspace\\MMD project");
    expect(result.commandLine).toBe("claude");
    expect(result.userDataDir).toBe(FIXED_UDD);
    expect(spawned).toHaveLength(1);
    // A throwaway --user-data-dir is what forces VSCode to open a brand-new
    // window for the same workspace every time (VSCode de-dupes by folder+udd).
    expect(spawned[0]).toMatchObject({
      command: "code",
      args: ["--new-window", "--user-data-dir", FIXED_UDD, '"D:\\workspace\\MMD project"'],
      options: { cwd: "D:\\workspace\\MMD project", shell: true, windowsHide: true },
    });
    expect(spawned[0].args).not.toContain("--extensionDevelopmentPath");
  });

  it("defaults to a fresh timestamped user-data-dir under the OS temp area", () => {
    const { spawn } = createSpawn();

    const result = launchNewClaudeSession({
      workspacePath: "D:\\workspace\\MMD project",
      env: {},
      platform: "win32",
      spawn,
    });

    const expectedRoot = path.join(os.tmpdir(), "mmd-pet-vscode-ud");
    expect(result.userDataDir.startsWith(expectedRoot)).toBe(true);
    expect(result.userDataDir).not.toBe(expectedRoot);
  });

  it("returns the resume command and a fresh window for an existing session", () => {
    const { spawn, spawned } = createSpawn();

    const result = resumeClaudeSession({
      claudeSessionId: "92bc9f7f-1f37-4244-a6f5-5a11d0a0f7c6",
      workspacePath: "D:\\workspace\\MMD project",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      platform: "win32",
      spawn,
      userDataDir: FIXED_UDD,
    });

    expect(result).toMatchObject({
      claudeSessionId: "92bc9f7f-1f37-4244-a6f5-5a11d0a0f7c6",
      workspacePath: "D:\\workspace\\MMD project",
      commandLine: "claude --resume 92bc9f7f-1f37-4244-a6f5-5a11d0a0f7c6",
      userDataDir: FIXED_UDD,
    });
    expect(spawned[0]).toMatchObject({
      command: "code",
      args: ["--new-window", "--user-data-dir", FIXED_UDD, '"D:\\workspace\\MMD project"'],
    });
  });

  it("quotes a custom Claude CLI path in the returned command line", () => {
    const { spawn } = createSpawn();

    const result = launchNewClaudeSession({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      env: { MMD_PET_CLAUDE_CLI: "C:\\Program Files\\Claude\\claude.cmd" },
      platform: "win32",
      spawn,
      userDataDir: FIXED_UDD,
    });

    expect(result.commandLine).toBe('"C:\\Program Files\\Claude\\claude.cmd"');
  });

  it("rejects empty resume session ids", () => {
    const { spawn } = createSpawn();
    expect(() =>
      resumeClaudeSession({
        claudeSessionId: "   ",
        workspacePath: "D:\\workspace\\MMD project",
        spawn,
      }),
    ).toThrow("claudeSessionId is required");
  });
});
