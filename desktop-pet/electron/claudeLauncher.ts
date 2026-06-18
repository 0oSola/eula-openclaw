import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { resolvePetWorkspacePath } from "./codexLauncher.js";

type LauncherEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;
type SpawnOptions = {
  cwd: string;
  detached: boolean;
  stdio: "ignore";
  shell: boolean;
  windowsHide: boolean;
};
type SpawnFn = (command: string, args: string[], options: SpawnOptions) => Pick<ChildProcess, "unref">;

export type ClaudeLauncherOptions = {
  cwd?: string;
  workspacePath?: string;
  env?: LauncherEnv;
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
  /** Override the per-window user-data-dir. Defaults to a fresh timestamped dir. */
  userDataDir?: string;
};

export type ClaudeLaunchResult = {
  workspacePath: string;
  /** The command the user should run in the new VSCode terminal (for copy-to-clipboard). */
  commandLine: string;
  /** The isolated VSCode user-data-dir created for this window. */
  userDataDir: string;
};

export type ClaudeResumeOptions = ClaudeLauncherOptions & {
  claudeSessionId: string;
};

export type ClaudeResumeResult = ClaudeLaunchResult & {
  claudeSessionId: string;
};

const VSCODE_USER_DATA_PARENT_DIR = "mmd-pet-vscode-ud";

function cleanPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function resolveLauncherWorkspacePath(options: {
  cwd?: string;
  workspacePath?: string;
  env: LauncherEnv;
}): string {
  const explicit = cleanPath(options.workspacePath);
  if (explicit) return explicit;
  return resolvePetWorkspacePath({ cwd: options.cwd ?? process.cwd(), env: options.env });
}

function launchDetached(spawn: SpawnFn, command: string, args: string[], options: SpawnOptions) {
  const child = spawn(command, args, options);
  child.unref?.();
}

function quoteWindowsShellArg(value: string): string {
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function prepareShellSpawnValue(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? quoteWindowsShellArg(value) : value;
}

function prepareShellSpawnArgs(args: string[], platform: NodeJS.Platform): string[] {
  return platform === "win32" ? args.map((arg) => quoteWindowsShellArg(arg)) : args;
}

function quoteTerminalArg(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

// VSCode de-duplicates windows by (folder + user-data-dir): opening the same
// folder under the same user-data-dir focuses the existing window instead of
// opening a new one. Giving each session a fresh user-data-dir is the only
// reliable way to force a brand-new window for the same workspace every time.
export function resolveVscodeUserDataDir(options: {
  userDataDir?: string;
  now?: number;
  random?: string;
}): string {
  const explicit = cleanPath(options.userDataDir);
  if (explicit) return explicit;
  const stamp = options.now ?? Date.now();
  const suffix = options.random ?? Math.random().toString(36).slice(2, 8);
  return path.join(os.tmpdir(), VSCODE_USER_DATA_PARENT_DIR, `${stamp}-${suffix}`);
}

function buildClaudeTerminalCommand(options: { claudeCli: string; claudeSessionId?: string }): string {
  const claudeCli = quoteTerminalArg(options.claudeCli);
  if (!options.claudeSessionId) return claudeCli;
  return `${claudeCli} --resume ${quoteTerminalArg(options.claudeSessionId)}`;
}

function openVscodeWindow(options: {
  workspacePath: string;
  userDataDir: string;
  env: LauncherEnv;
  platform: NodeJS.Platform;
  spawn: SpawnFn;
}) {
  const codeCli = options.env.MMD_PET_VSCODE_CLI?.trim() || "code";
  const args = ["--new-window", "--user-data-dir", options.userDataDir, options.workspacePath];
  launchDetached(
    options.spawn,
    prepareShellSpawnValue(codeCli, options.platform),
    prepareShellSpawnArgs(args, options.platform),
    {
      cwd: options.workspacePath,
      detached: true,
      stdio: "ignore",
      shell: options.platform === "win32",
      windowsHide: true,
    },
  );
}

function launchClaudeWindow(options: {
  claudeSessionId?: string;
  cwd?: string;
  workspacePath: string;
  userDataDir?: string;
  env: LauncherEnv;
  platform: NodeJS.Platform;
  spawn: SpawnFn;
}): { commandLine: string; userDataDir: string } {
  const claudeCli = options.env.MMD_PET_CLAUDE_CLI?.trim() || "claude";
  const commandLine = buildClaudeTerminalCommand({ claudeCli, claudeSessionId: options.claudeSessionId });
  const userDataDir = resolveVscodeUserDataDir({ userDataDir: options.userDataDir });
  openVscodeWindow({
    workspacePath: options.workspacePath,
    userDataDir,
    env: options.env,
    platform: options.platform,
    spawn: options.spawn,
  });
  return { commandLine, userDataDir };
}

export function launchNewClaudeSession(options: ClaudeLauncherOptions = {}): ClaudeLaunchResult {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const workspacePath = resolveLauncherWorkspacePath({ cwd: options.cwd, workspacePath: options.workspacePath, env });
  const spawn = options.spawn ?? nodeSpawn;

  const { commandLine, userDataDir } = launchClaudeWindow({
    cwd: options.cwd,
    workspacePath,
    userDataDir: options.userDataDir,
    env,
    platform,
    spawn,
  });

  return { workspacePath, commandLine, userDataDir };
}

export function resumeClaudeSession(options: ClaudeResumeOptions): ClaudeResumeResult {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const workspacePath = resolveLauncherWorkspacePath({ cwd: options.cwd, workspacePath: options.workspacePath, env });
  const spawn = options.spawn ?? nodeSpawn;
  const claudeSessionId = options.claudeSessionId.trim();

  if (!claudeSessionId) {
    throw new Error("claudeSessionId is required");
  }

  const { commandLine, userDataDir } = launchClaudeWindow({
    claudeSessionId,
    cwd: options.cwd,
    workspacePath,
    userDataDir: options.userDataDir,
    env,
    platform,
    spawn,
  });

  return { workspacePath, claudeSessionId, commandLine, userDataDir };
}
