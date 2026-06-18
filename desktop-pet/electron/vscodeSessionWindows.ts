import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VSCODE_USER_DATA_ROOT_DIR } from "./codexLauncher.js";

type SessionWindowDirEntry = {
  name: string;
  isDirectory: () => boolean;
};
type SessionWindowFs = {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, options: { recursive: true }) => unknown;
  readFileSync: (p: string, encoding: "utf8") => string;
  readdirSync: (p: string, options: { withFileTypes: true }) => SessionWindowDirEntry[];
  statSync: (p: string) => { mtimeMs: number };
  writeFileSync: (p: string, data: string, encoding: "utf8") => void;
};

export type VscodeSessionWindowMarker = {
  version: 1;
  workspacePath: string;
  userDataDir: string;
  agent: string;
  petSessionId?: string;
  codexSessionId?: string;
  updatedAt: string;
};
export type VscodeSessionWindowResolution = {
  userDataDir: string;
  source: "marker" | "workspace-storage";
};

export const VSCODE_SESSION_WINDOW_MARKER_PATH = path.join(".codex-pet", "session-window.json");

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFsPath(value: string): string {
  return path.resolve(value).toLowerCase();
}

function markerPath(userDataDir: string): string {
  return path.join(userDataDir, VSCODE_SESSION_WINDOW_MARKER_PATH);
}

function safeTimestamp(value: unknown): number {
  const timestamp = Date.parse(compactText(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function decodeWorkspaceFolder(value: unknown): string {
  const text = compactText(value);
  if (!text) return "";
  if (text.startsWith("file:")) {
    try {
      return fileURLToPath(text);
    } catch {
      return "";
    }
  }
  return text;
}

function sortByNewest<T extends { updatedAtMs: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

function parseMarker(value: string): VscodeSessionWindowMarker | null {
  try {
    const marker = JSON.parse(value) as Partial<VscodeSessionWindowMarker>;
    const workspacePath = compactText(marker.workspacePath);
    const userDataDir = compactText(marker.userDataDir);
    const updatedAt = compactText(marker.updatedAt);
    if (marker.version !== 1 || !workspacePath || !userDataDir || !updatedAt) return null;
    return {
      version: 1,
      workspacePath,
      userDataDir,
      agent: compactText(marker.agent) || "codex",
      petSessionId: compactText(marker.petSessionId) || undefined,
      codexSessionId: compactText(marker.codexSessionId) || undefined,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function listUserDataDirs(rootDir: string, fs: SessionWindowFs): string[] {
  if (!fs.existsSync(rootDir)) return [];
  try {
    return fs
      .readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(rootDir, entry.name));
  } catch {
    return [];
  }
}

export function vscodeSessionWindowRoot(tmpDir = os.tmpdir()): string {
  return path.join(tmpDir, VSCODE_USER_DATA_ROOT_DIR);
}

export function writeVscodeSessionWindowMarker(options: {
  userDataDir: string;
  workspacePath: string;
  agent: string;
  petSessionId?: string | null;
  codexSessionId?: string | null;
  updatedAt?: string;
  fs?: SessionWindowFs;
}): VscodeSessionWindowMarker | null {
  const fs = options.fs ?? (nodeFs as unknown as SessionWindowFs);
  const userDataDir = compactText(options.userDataDir);
  const workspacePath = compactText(options.workspacePath);
  if (!userDataDir || !workspacePath) return null;
  const marker: VscodeSessionWindowMarker = {
    version: 1,
    workspacePath,
    userDataDir,
    agent: compactText(options.agent) || "codex",
    petSessionId: compactText(options.petSessionId) || undefined,
    codexSessionId: compactText(options.codexSessionId) || undefined,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  };
  const destination = markerPath(userDataDir);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return marker;
}

function readSessionMarkers(rootDir: string, fs: SessionWindowFs): Array<VscodeSessionWindowMarker & { updatedAtMs: number }> {
  const markers: Array<VscodeSessionWindowMarker & { updatedAtMs: number }> = [];
  for (const userDataDir of listUserDataDirs(rootDir, fs)) {
    const destination = markerPath(userDataDir);
    if (!fs.existsSync(destination)) continue;
    try {
      const marker = parseMarker(fs.readFileSync(destination, "utf8"));
      if (marker) markers.push({ ...marker, updatedAtMs: safeTimestamp(marker.updatedAt) });
    } catch {
      // Locked or partially-written marker: ignore and continue scanning.
    }
  }
  return sortByNewest(markers);
}

function readWorkspaceFallbacks(rootDir: string, workspacePath: string, fs: SessionWindowFs): Array<{ userDataDir: string; updatedAtMs: number }> {
  const expectedWorkspacePath = normalizeFsPath(workspacePath);
  const matches: Array<{ userDataDir: string; updatedAtMs: number }> = [];
  for (const userDataDir of listUserDataDirs(rootDir, fs)) {
    const workspaceStorageDir = path.join(userDataDir, "User", "workspaceStorage");
    if (!fs.existsSync(workspaceStorageDir)) continue;
    let entries: SessionWindowDirEntry[];
    try {
      entries = fs.readdirSync(workspaceStorageDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspaceJsonPath = path.join(workspaceStorageDir, entry.name, "workspace.json");
      if (!fs.existsSync(workspaceJsonPath)) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(workspaceJsonPath, "utf8")) as { folder?: unknown };
        const folderPath = decodeWorkspaceFolder(payload.folder);
        if (!folderPath || normalizeFsPath(folderPath) !== expectedWorkspacePath) continue;
        const stat = fs.statSync(userDataDir);
        matches.push({ userDataDir, updatedAtMs: stat.mtimeMs });
      } catch {
        // Ignore unreadable workspace records from stale or locked VSCode dirs.
      }
    }
  }
  return sortByNewest(matches);
}

export function resolveVscodeSessionWindow(options: {
  workspacePath: string;
  petSessionId?: string | null;
  codexSessionId?: string | null;
  agent?: string;
  rootDir?: string;
  fs?: SessionWindowFs;
}): VscodeSessionWindowResolution | undefined {
  const fs = options.fs ?? (nodeFs as unknown as SessionWindowFs);
  const rootDir = options.rootDir ?? vscodeSessionWindowRoot();
  const workspacePath = compactText(options.workspacePath);
  if (!workspacePath) return undefined;
  const expectedWorkspacePath = normalizeFsPath(workspacePath);
  const petSessionId = compactText(options.petSessionId);
  const codexSessionId = compactText(options.codexSessionId);
  const agent = compactText(options.agent);

  for (const marker of readSessionMarkers(rootDir, fs)) {
    if (normalizeFsPath(marker.workspacePath) !== expectedWorkspacePath) continue;
    if (agent && marker.agent !== agent) continue;
    if (petSessionId && marker.petSessionId === petSessionId) return { userDataDir: marker.userDataDir, source: "marker" };
    if (codexSessionId && marker.codexSessionId === codexSessionId) return { userDataDir: marker.userDataDir, source: "marker" };
  }

  const fallback = readWorkspaceFallbacks(rootDir, workspacePath, fs)[0];
  return fallback ? { userDataDir: fallback.userDataDir, source: "workspace-storage" } : undefined;
}

export function resolveVscodeSessionWindowUserDataDir(
  options: Parameters<typeof resolveVscodeSessionWindow>[0],
): string | undefined {
  return resolveVscodeSessionWindow(options)?.userDataDir;
}
