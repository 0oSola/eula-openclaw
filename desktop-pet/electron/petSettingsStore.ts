import nodeFs from "node:fs";
import path from "node:path";

import { resolvePetWorkspacePath } from "./codexLauncher.js";
import { MENU_LANGUAGES, NOTIFICATION_PROFILES, PET_AGENTS, type MenuLanguage, type NotificationProfile, type PetAgent } from "./petMenuModel.js";

type LauncherEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

type PetSettingsFs = {
  existsSync: (filePath: string) => boolean;
  mkdirSync: (dirPath: string, options: { recursive: true }) => unknown;
  readFileSync: (filePath: string, encoding: "utf8") => string;
  writeFileSync: (filePath: string, value: string, encoding: "utf8") => unknown;
};

export type PetSettings = {
  selectedWorkspacePath?: string;
  menuLanguage?: MenuLanguage;
  notificationProfile?: NotificationProfile;
  alwaysOnTop?: boolean;
  agent?: PetAgent;
  windowBounds?: PetWindowBounds;
};

export const PET_SETTINGS_FILE_NAME = "pet-settings.json";
export const PET_WINDOW_SETTINGS_WIDTH = 360;
export const PET_WINDOW_SETTINGS_HEIGHT = 420;

export type PetWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function petSettingsPath(userDataPath: string): string {
  return path.join(userDataPath, PET_SETTINGS_FILE_NAME);
}

function normalizeWorkspacePath(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? path.resolve(trimmed) : undefined;
}

function normalizeMenuLanguageSetting(value: unknown): MenuLanguage | undefined {
  return MENU_LANGUAGES.includes(value as MenuLanguage) ? (value as MenuLanguage) : undefined;
}

function normalizeNotificationProfileSetting(value: unknown): NotificationProfile | undefined {
  return NOTIFICATION_PROFILES.includes(value as NotificationProfile) ? (value as NotificationProfile) : undefined;
}

function normalizeAlwaysOnTop(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeAgentSetting(value: unknown): PetAgent | undefined {
  return PET_AGENTS.includes(value as PetAgent) ? (value as PetAgent) : undefined;
}

export function normalizePetWindowBounds(value: unknown): PetWindowBounds | undefined {
  if (!value || typeof value !== "object") return undefined;
  const bounds = value as Record<string, unknown>;
  const x = typeof bounds.x === "number" && Number.isFinite(bounds.x) ? Math.round(bounds.x) : undefined;
  const y = typeof bounds.y === "number" && Number.isFinite(bounds.y) ? Math.round(bounds.y) : undefined;
  if (x === undefined || y === undefined) return undefined;
  return {
    x,
    y,
    width: PET_WINDOW_SETTINGS_WIDTH,
    height: PET_WINDOW_SETTINGS_HEIGHT,
  };
}

function normalizePetSettingsPayload(payload: Record<string, unknown>): PetSettings {
  const settings: PetSettings = {};
  const selectedWorkspacePath = normalizeWorkspacePath(payload.selectedWorkspacePath);
  const menuLanguage = normalizeMenuLanguageSetting(payload.menuLanguage);
  const notificationProfile = normalizeNotificationProfileSetting(payload.notificationProfile);
  const alwaysOnTop = normalizeAlwaysOnTop(payload.alwaysOnTop);
  const agent = normalizeAgentSetting(payload.agent);
  const windowBounds = normalizePetWindowBounds(payload.windowBounds);
  if (selectedWorkspacePath) settings.selectedWorkspacePath = selectedWorkspacePath;
  if (menuLanguage) settings.menuLanguage = menuLanguage;
  if (notificationProfile) settings.notificationProfile = notificationProfile;
  if (alwaysOnTop !== undefined) settings.alwaysOnTop = alwaysOnTop;
  if (agent) settings.agent = agent;
  if (windowBounds) settings.windowBounds = windowBounds;
  return settings;
}

export function readPetSettings(options: {
  userDataPath: string;
  fs?: PetSettingsFs;
}): PetSettings {
  const fs = options.fs ?? nodeFs;
  const filePath = petSettingsPath(options.userDataPath);
  if (!fs.existsSync(filePath)) return {};
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    return normalizePetSettingsPayload(payload);
  } catch {
    return {};
  }
}

export function writePetSettings(options: {
  userDataPath: string;
  patch: Partial<PetSettings>;
  fs?: PetSettingsFs;
}): PetSettings {
  const fs = options.fs ?? nodeFs;
  const current = readPetSettings({ userDataPath: options.userDataPath, fs });
  const patch = normalizePetSettingsPayload(options.patch as Record<string, unknown>);
  const settings: PetSettings = { ...current, ...patch };
  fs.mkdirSync(options.userDataPath, { recursive: true });
  fs.writeFileSync(petSettingsPath(options.userDataPath), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

export function writeSelectedWorkspacePath(options: {
  workspacePath: string;
  userDataPath: string;
  fs?: PetSettingsFs;
}): PetSettings {
  const selectedWorkspacePath = normalizeWorkspacePath(options.workspacePath);
  return writePetSettings({
    userDataPath: options.userDataPath,
    fs: options.fs,
    patch: selectedWorkspacePath ? { selectedWorkspacePath } : {},
  });
}

export function resolveSelectedWorkspacePath(options: {
  cwd: string;
  env: LauncherEnv;
  userDataPath: string;
  fs?: PetSettingsFs;
}): string {
  const settings = readPetSettings({ userDataPath: options.userDataPath, fs: options.fs });
  return settings.selectedWorkspacePath ?? resolvePetWorkspacePath({ cwd: options.cwd, env: options.env });
}

export function resolvePetAgent(options: { userDataPath: string; fs?: PetSettingsFs }): PetAgent {
  const settings = readPetSettings({ userDataPath: options.userDataPath, fs: options.fs });
  return settings.agent ?? "codex";
}
