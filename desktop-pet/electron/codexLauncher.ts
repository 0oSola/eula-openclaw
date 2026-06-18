import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

type LauncherEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;
type LauncherFs = Pick<typeof nodeFs, "mkdirSync" | "writeFileSync">;
type VscodeHelperMode = "development" | "installed";
type SpawnOptions = {
  cwd: string;
  detached: boolean;
  stdio: "ignore";
  shell: boolean;
  windowsHide: boolean;
};
type SpawnFn = (command: string, args: string[], options: SpawnOptions) => Pick<ChildProcess, "unref">;

export type CodexLauncherOptions = {
  cwd?: string;
  workspacePath?: string;
  env?: LauncherEnv;
  platform?: NodeJS.Platform;
  spawn?: SpawnFn;
  fs?: LauncherFs;
  userDataDir?: string;
};

export type VscodeTerminalRequestMode = "new" | "resume";

export type VscodeTerminalRequest = {
  id: string;
  mode: VscodeTerminalRequestMode;
  workspacePath: string;
  terminalName: string;
  commandLine: string;
  codexSessionId?: string;
  createdAt: string;
};

export type VscodeTerminalRequestRef = {
  id: string;
  path: string;
  globalPath: string;
  workspacePath: string;
};

export type CodexLaunchResult = {
  workspacePath: string;
  commandLine: string;
  userDataDir: string;
  terminalRequest?: VscodeTerminalRequestRef;
};

export type VscodeWorkspaceOpenResult = {
  workspacePath: string;
  userDataDir: string;
};

export type CodexResumeOptions = CodexLauncherOptions & {
  codexSessionId: string;
};

export type CodexResumeResult = CodexLaunchResult & {
  codexSessionId: string;
};

const VSCODE_TERMINAL_REQUEST_DIR = ".codex-pet";
const VSCODE_TERMINAL_REQUEST_FILE = "vscode-terminal-request.json";
const VSCODE_TERMINAL_NAME = "Codex Pet";
const VSCODE_GLOBAL_REQUEST_DIR = "mmd-codex-pet";
export const VSCODE_USER_DATA_ROOT_DIR = "mmd-pet-vscode-ud";

function cleanPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function resolvePetWorkspacePath(options: { cwd: string; env: LauncherEnv }): string {
  const configured = cleanPath(options.env.MMD_PET_WORKSPACE_PATH);
  if (configured) return configured;

  const cwd = path.resolve(options.cwd);
  return path.basename(cwd).toLowerCase() === "desktop-pet" ? path.dirname(cwd) : cwd;
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

function resolveDesktopPetRoot(cwd: string): string {
  const resolved = path.resolve(cwd);
  return path.basename(resolved).toLowerCase() === "desktop-pet" ? resolved : path.join(resolved, "desktop-pet");
}

function resolveVscodeHelperExtensionPath(options: { cwd?: string; env: LauncherEnv }): string {
  const configured = cleanPath(options.env.MMD_PET_VSCODE_HELPER_EXTENSION_PATH);
  if (configured) return configured;
  return path.join(resolveDesktopPetRoot(options.cwd ?? process.cwd()), "vscode-helper");
}

function resolveVscodeHelperMode(env: LauncherEnv): VscodeHelperMode {
  return env.MMD_PET_VSCODE_HELPER_MODE?.trim() === "installed" ? "installed" : "development";
}

function quoteTerminalArg(value: string): string {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

function buildCodexTerminalCommand(options: {
  codexCli: string;
  workspacePath: string;
  codexSessionId?: string;
}): string {
  const codexCli = quoteTerminalArg(options.codexCli);
  if (!options.codexSessionId) return codexCli;
  return `${codexCli} resume --cd ${quoteTerminalArg(options.workspacePath)} ${quoteTerminalArg(options.codexSessionId)}`;
}

// VSCode de-duplicates windows by "folder + user-data-dir": opening the same
// workspace folder under the same user-data-dir focuses the existing window
// instead of opening a new one. To guarantee a fresh window for repeat Pet
// opens, each launch gets a throwaway user-data-dir under the OS temp area.
// Callers pass an explicit userDataDir; this helper provides the default.
export function defaultVscodeUserDataDir(now = Date.now(), random = Math.random()): string {
  const stamp = `${now}-${random.toString(36).slice(2, 10)}`;
  return path.join(os.tmpdir(), VSCODE_USER_DATA_ROOT_DIR, stamp);
}

function vscodeTerminalRequestPath(workspacePath: string): string {
  return path.join(workspacePath, VSCODE_TERMINAL_REQUEST_DIR, VSCODE_TERMINAL_REQUEST_FILE);
}

function globalVscodeTerminalRequestPath(): string {
  return path.join(os.tmpdir(), VSCODE_GLOBAL_REQUEST_DIR, VSCODE_TERMINAL_REQUEST_FILE);
}

function writeVscodeTerminalRequest(options: {
  fs: LauncherFs;
  workspacePath: string;
  request: VscodeTerminalRequest;
}): VscodeTerminalRequestRef {
  const requestPath = vscodeTerminalRequestPath(options.workspacePath);
  const globalPath = globalVscodeTerminalRequestPath();
  const serialized = `${JSON.stringify(options.request, null, 2)}\n`;

  options.fs.mkdirSync(path.dirname(requestPath), { recursive: true });
  options.fs.writeFileSync(requestPath, serialized, "utf8");
  options.fs.mkdirSync(path.dirname(globalPath), { recursive: true });
  options.fs.writeFileSync(globalPath, serialized, "utf8");

  return {
    id: options.request.id,
    path: requestPath,
    globalPath,
    workspacePath: options.workspacePath,
  };
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

function openVscodeWorkspaceWithHelper(options: {
  cwd?: string;
  workspacePath: string;
  userDataDir: string;
  env: LauncherEnv;
  platform: NodeJS.Platform;
  spawn: SpawnFn;
}) {
  const codeCli = options.env.MMD_PET_VSCODE_CLI?.trim() || "code";
  const helperMode = resolveVscodeHelperMode(options.env);
  const args = ["--new-window", "--user-data-dir", options.userDataDir];
  if (helperMode !== "installed") {
    args.push("--extensionDevelopmentPath", resolveVscodeHelperExtensionPath({ cwd: options.cwd, env: options.env }));
  }
  args.push(options.workspacePath);

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

function requestCodexInVscodeTerminal(options: {
  mode: VscodeTerminalRequestMode;
  codexSessionId?: string;
  cwd?: string;
  workspacePath: string;
  userDataDir: string;
  env: LauncherEnv;
  platform: NodeJS.Platform;
  spawn: SpawnFn;
  fs: LauncherFs;
}) {
  const codexCli = options.env.MMD_PET_CODEX_CLI?.trim() || "codex";
  const commandLine = buildCodexTerminalCommand({
    codexCli,
    workspacePath: options.workspacePath,
    codexSessionId: options.codexSessionId,
  });
  const terminalRequest = writeVscodeTerminalRequest({
    fs: options.fs,
    workspacePath: options.workspacePath,
    request: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mode: options.mode,
      workspacePath: options.workspacePath,
      terminalName: VSCODE_TERMINAL_NAME,
      commandLine,
      codexSessionId: options.codexSessionId,
      createdAt: new Date().toISOString(),
    },
  });

  openVscodeWorkspaceWithHelper({
    cwd: options.cwd,
    workspacePath: options.workspacePath,
    userDataDir: options.userDataDir,
    env: options.env,
    platform: options.platform,
    spawn: options.spawn,
  });

  return { commandLine, terminalRequest };
}

export function focusVscodeWorkspace(options: CodexLauncherOptions = {}): VscodeWorkspaceOpenResult {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const workspacePath = resolveLauncherWorkspacePath({ cwd: options.cwd, workspacePath: options.workspacePath, env });
  const spawn = options.spawn ?? nodeSpawn;
  const userDataDir = options.userDataDir?.trim() || defaultVscodeUserDataDir();

  openVscodeWindow({ workspacePath, userDataDir, env, platform, spawn });

  return { workspacePath, userDataDir };
}

export function launchNewCodexSession(options: CodexLauncherOptions = {}): CodexLaunchResult {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const workspacePath = resolveLauncherWorkspacePath({ cwd: options.cwd, workspacePath: options.workspacePath, env });
  const spawn = options.spawn ?? nodeSpawn;
  const fs = options.fs ?? nodeFs;
  const userDataDir = options.userDataDir?.trim() || defaultVscodeUserDataDir();
  const { commandLine, terminalRequest } = requestCodexInVscodeTerminal({
    mode: "new",
    cwd: options.cwd,
    workspacePath,
    userDataDir,
    env,
    platform,
    spawn,
    fs,
  });

  return { workspacePath, commandLine, userDataDir, terminalRequest };
}

export function resumeCodexSession(options: CodexResumeOptions): CodexResumeResult {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const workspacePath = resolveLauncherWorkspacePath({ cwd: options.cwd, workspacePath: options.workspacePath, env });
  const spawn = options.spawn ?? nodeSpawn;
  const fs = options.fs ?? nodeFs;
  const codexSessionId = options.codexSessionId.trim();

  if (!codexSessionId) {
    throw new Error("codexSessionId is required");
  }

  const userDataDir = options.userDataDir?.trim() || defaultVscodeUserDataDir();
  const { commandLine, terminalRequest } = requestCodexInVscodeTerminal({
    mode: "resume",
    codexSessionId,
    cwd: options.cwd,
    workspacePath,
    userDataDir,
    env,
    platform,
    spawn,
    fs,
  });

  return { workspacePath, commandLine, userDataDir, terminalRequest, codexSessionId };
}
