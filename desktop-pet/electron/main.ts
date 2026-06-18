import { BrowserWindow, Menu, app, clipboard, crashReporter, dialog, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type ContextMenuPositionInput,
  normalizeRendererMenuPosition,
  resolveContextMenuPosition,
  type ScreenPoint,
} from "./contextMenuPosition.js";
import { ensureApiRuntime, type ApiRuntimeStatus } from "./apiRuntime.js";
import {
  type ContextMenuPopupSource,
  shouldSuppressDuplicateContextMenuPopup,
  type ContextMenuPopupRecord,
} from "./contextMenuDedup.js";
import {
  focusVscodeWorkspace,
  launchNewCodexSession,
  resumeCodexSession,
} from "./codexLauncher.js";
import {
  buildDesktopPetSessionPayload,
  resolveCodexHome,
  scanRecentCodexSessionFiles,
  type CodexSessionStatus,
  type DesktopPetSessionPayload,
} from "./codexSessionFiles.js";
import {
  launchNewClaudeSession,
  resumeClaudeSession,
} from "./claudeLauncher.js";
import {
  buildClaudeDesktopPetSessionPayload,
  resolveClaudeHome,
  scanRecentClaudeSessionFiles,
} from "./claudeSessionFiles.js";
import { cleanupStaleVscodeUserDataDirs } from "./vscodeUserDataCleanup.js";
import {
  resolveVscodeSessionWindow,
  writeVscodeSessionWindowMarker,
} from "./vscodeSessionWindows.js";
import {
  CodexInteractiveRelayClient,
  type CodexRelayDecision,
  type CodexRelayStatus,
} from "./codexInteractiveRelay.js";
import { toElectronMenuTemplate } from "./electronMenuTemplate.js";
import {
  resolveCrashDiagnosticsPaths,
  serializeCrashError,
  writePetCrashEvent,
  type CrashEventPayload,
} from "./crashDiagnostics.js";
import {
  DEFAULT_INTERACTION_MODE,
  type PetInteractionMode,
  normalizeInteractionMode,
} from "./interactionMode.js";
import {
  WM_LBUTTONDOWN,
  WM_LBUTTONUP,
  WM_MOUSEMOVE,
  WM_RBUTTONUP,
  shouldStartNativeWindowDrag,
} from "./nativeMouseInput.js";
import { createPetBrowserWindowOptions } from "./petWindowOptions.js";
import {
  calculateEndedWindowDragBounds,
  calculateDraggedWindowBounds,
  shouldAcceptWindowDragStart,
  shouldApplyWindowDragMove,
  type WindowDragSession,
  type WindowDragSource,
} from "./windowDrag.js";
import {
  buildActiveWorkspaceSummaries,
  buildPetMenuModel,
  normalizeMenuLanguage,
  normalizeNotificationProfile,
  normalizePetAgent,
  PET_AGENT_LABELS,
  type MenuLanguage,
  type NotificationProfile,
  type PetAgent,
  type PetMenuAction,
  type PetMenuSession,
} from "./petMenuModel.js";
import { applyPetAlwaysOnTop } from "./petAlwaysOnTop.js";
import {
  readPetSettings,
  resolveSelectedWorkspacePath,
  resolvePetAgent,
  writePetSettings,
  writeSelectedWorkspacePath,
} from "./petSettingsStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const devRendererUrl =
  process.env.MMD_PET_RENDERER_URL ?? `http://127.0.0.1:${process.env.MMD_PET_DEV_PORT ?? "5174"}`;
const apiBaseUrl = process.env.MMD_PET_API_BASE_URL ?? "http://127.0.0.1:8000";
const menuUserId = process.env.MMD_PET_USER_ID ?? "admin-1";
const debugEventsEnabled = process.env.MMD_PET_DEBUG_EVENTS === "1";
const debugEventsLogPath = process.env.MMD_PET_DEBUG_EVENTS_LOG ?? path.join(process.cwd(), "desktop-pet-debug-events.ndjson");
const crashDiagnosticsPaths = resolveCrashDiagnosticsPaths({ cwd: process.cwd(), env: process.env });
const CODEX_SESSION_WATCH_INTERVAL_MS = 2500;
const CODEX_SESSION_WATCH_MAX_DURATION_MS = 60 * 60 * 1000;
let currentInteractionMode: PetInteractionMode = DEFAULT_INTERACTION_MODE;
let currentNotificationProfile: NotificationProfile = "medium";
let currentMenuLanguage: MenuLanguage = "en";
let currentAlwaysOnTop = true;
let currentAgent: PetAgent = "codex";
type CodexPetStatus = {
  state:
    | "idle"
    | "starting"
    | "launched"
    | "resuming"
    | "running"
    | "command_running"
    | "file_changed"
    | "waiting_approval"
    | "completed"
    | "failed"
    | "disconnected"
    | "vscode-opened";
  workspacePath?: string;
  sessionTitle?: string;
  codexSessionId?: string;
  lastOutput?: string;
  error?: string;
  updatedAt?: string;
  /** Command the user should run in the freshly opened VSCode terminal (copy-to-clipboard). */
  commandLine?: string;
  source?: "app-server-relay" | "codex-jsonl" | "claude-jsonl" | "terminal";
  pendingApprovals?: Array<{
    id: string;
    title: string;
    actionType: string;
    detail: Record<string, unknown>;
  }>;
};
let currentCodexStatus: CodexPetStatus = { state: "idle" };
let currentApiRuntimeStatus: ApiRuntimeStatus | null = null;
let lastApiAvailable = true;
let lastMenuPopup: ContextMenuPopupRecord | undefined;
let contextMenuActive = false;
let lastContextMenuClosedAtMs: number | undefined;
let lastMenuSessionsByPetId = new Map<string, PetMenuSession>();
let codexRelayClient: CodexInteractiveRelayClient | null = null;
const windowDragState = new WeakMap<BrowserWindow, WindowDragSession>();
type ActiveSessionWindow = {
  workspacePath: string;
  userDataDir: string;
  petSessionId?: string;
  codexSessionId?: string;
  agent: PetAgent;
  updatedAt: string;
};
let activeSessionWindowsByPetId = new Map<string, ActiveSessionWindow>();
let activeSessionWindowsByWorkspace = new Map<string, ActiveSessionWindow>();
type CodexSessionOutputWatch = {
  workspacePath: string;
  minModifiedAtMs: number;
  codexSessionId?: string;
  userDataDir?: string;
  agent: PetAgent;
  interval: ReturnType<typeof setInterval>;
  timeout: ReturnType<typeof setTimeout>;
  inFlight: boolean;
};
const codexSessionOutputWatches = new WeakMap<BrowserWindow, CodexSessionOutputWatch>();

function logPetDebugEvent(type: string, payload: Record<string, unknown> = {}) {
  if (!debugEventsEnabled) return;
  fs.appendFileSync(debugEventsLogPath, `${JSON.stringify({ at: new Date().toISOString(), type, ...payload })}\n`, "utf8");
}

function logPetCrashEvent(type: string, payload: CrashEventPayload = {}) {
  try {
    writePetCrashEvent({
      eventsLogPath: crashDiagnosticsPaths.eventsLogPath,
      type,
      payload,
    });
  } catch {
    // Crash diagnostics must never become the reason the app exits.
  }
  logPetDebugEvent(`crash:${type}`, {
    ...payload,
    eventsLogPath: crashDiagnosticsPaths.eventsLogPath,
    crashDumpsDir: crashDiagnosticsPaths.crashDumpsDir,
  });
}

function installPetCrashDiagnostics() {
  try {
    fs.mkdirSync(crashDiagnosticsPaths.crashDumpsDir, { recursive: true });
    app.setPath("crashDumps", crashDiagnosticsPaths.crashDumpsDir);
    crashReporter.start({
      productName: "MMD Codex Pet",
      uploadToServer: false,
      compress: true,
      globalExtra: {
        component: "desktop-pet",
        mode: isDev ? "dev" : "prod",
      },
    });
    logPetCrashEvent("crash-reporter:started", {
      eventsLogPath: crashDiagnosticsPaths.eventsLogPath,
      crashDumpsDir: app.getPath("crashDumps"),
      uploadToServer: false,
    });
  } catch (error) {
    logPetCrashEvent("crash-reporter:start-error", serializeCrashError(error));
  }

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    logPetCrashEvent("main:uncaught-exception", {
      origin,
      ...serializeCrashError(error),
    });
  });
  process.on("unhandledRejection", (reason) => {
    logPetCrashEvent("main:unhandled-rejection", serializeCrashError(reason));
  });
  process.on("warning", (warning) => {
    logPetCrashEvent("main:warning", serializeCrashError(warning));
  });
  app.on("render-process-gone", (_event, webContents, details) => {
    logPetCrashEvent("renderer:gone", {
      ...details,
      webContentsId: webContents.id,
      url: webContents.getURL(),
    });
  });
  app.on("child-process-gone", (_event, details) => {
    logPetCrashEvent("child-process:gone", details as unknown as CrashEventPayload);
  });
}

installPetCrashDiagnostics();

function logRendererDomState(window: BrowserWindow, label: string) {
  if (!debugEventsEnabled || window.isDestroyed()) return;
  window.webContents
    .executeJavaScript(
      `(() => ({
        url: window.location.href,
        readyState: document.readyState,
        bodyText: document.body?.innerText?.slice(0, 240) ?? "",
        bodyHtmlLength: document.body?.innerHTML?.length ?? 0,
        hasPetShell: Boolean(document.querySelector(".pet-shell")),
        hasPetStage: Boolean(document.querySelector(".pet-stage")),
        hasHitSurface: Boolean(document.querySelector(".pet-input-hit-surface")),
        hasPetStatus: Boolean(document.querySelector(".pet-status")),
        hasDesktopPet: Boolean(window.desktopPet),
      }))()`,
      true,
    )
    .then((state) => logPetDebugEvent("renderer:dom-state", { label, state }))
    .catch((error: Error) => logPetDebugEvent("renderer:dom-state-error", { label, error: error.message }));
}

function readCurrentPetSettings() {
  return readPetSettings({ userDataPath: app.getPath("userData") });
}

function applyPersistedPetPreferences() {
  const settings = readCurrentPetSettings();
  currentNotificationProfile = settings.notificationProfile ?? currentNotificationProfile;
  currentMenuLanguage = settings.menuLanguage ?? currentMenuLanguage;
  currentAlwaysOnTop = settings.alwaysOnTop ?? currentAlwaysOnTop;
  currentAgent = settings.agent ?? currentAgent;
  return settings;
}

function persistPetPreferences(patch: Parameters<typeof writePetSettings>[0]["patch"]) {
  try {
    return writePetSettings({
      userDataPath: app.getPath("userData"),
      patch,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("settings:write-error", { error: message });
    return undefined;
  }
}

function persistPetWindowBounds(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  persistPetPreferences({ windowBounds: window.getBounds() });
}

function publishApiRuntimeStatus(runtimeStatus: ApiRuntimeStatus | null) {
  currentApiRuntimeStatus = runtimeStatus;
  if (runtimeStatus) {
    lastApiAvailable = runtimeStatus.available;
  } else {
    lastApiAvailable = false;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("pet:api-runtime:changed", currentApiRuntimeStatus);
    }
  }
}

async function refreshApiRuntimeStatus() {
  try {
    const runtimeStatus = await ensureApiRuntime({
      apiBaseUrl,
      cwd: process.cwd(),
      env: process.env,
    });
    lastApiAvailable = runtimeStatus.available;
    currentApiRuntimeStatus = runtimeStatus;
    publishApiRuntimeStatus(runtimeStatus);
    logPetDebugEvent("api-runtime:status", runtimeStatus);
    return runtimeStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publishApiRuntimeStatus(null);
    logPetDebugEvent("api-runtime:error", { apiBaseUrl, error: message });
    return null;
  }
}

function resolveCurrentWorkspacePath(): string {
  return resolveSelectedWorkspacePath({
    cwd: process.cwd(),
    env: process.env,
    userDataPath: app.getPath("userData"),
  });
}

function publishInteractionMode(window: BrowserWindow, mode: PetInteractionMode) {
  currentInteractionMode = mode;
  window.webContents.send("pet:interaction-mode:changed", currentInteractionMode);
}

function publishCodexStatus(window: BrowserWindow, status: CodexPetStatus) {
  currentCodexStatus = { ...status, updatedAt: new Date().toISOString() };
  logPetDebugEvent("codex-status:changed", currentCodexStatus);
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send("pet:codex-status:changed", currentCodexStatus);
  window.webContents.invalidate();
}

function relayModeFromEnv(): "read_only" | "patch" {
  return process.env.MMD_PET_CODEX_RELAY_MODE?.trim() === "read_only" ? "read_only" : "patch";
}

function shouldUseCodexRelay(): boolean {
  // The app-server relay is a Codex-only path; Claude runs purely through the
  // VSCode integrated terminal + local JSONL scanning.
  if (currentAgent !== "codex") return false;
  const configured = process.env.MMD_PET_CODEX_RELAY_ENABLED?.trim().toLowerCase();
  if (configured && ["0", "false", "off", "no"].includes(configured)) return false;
  return lastApiAvailable && currentApiRuntimeStatus?.available !== false;
}

function relayStatusToPetStatus(status: CodexRelayStatus): CodexPetStatus {
  return {
    state: status.state,
    workspacePath: status.workspacePath,
    sessionTitle: status.sessionTitle,
    codexSessionId: status.codexSessionId,
    lastOutput: status.lastOutput,
    error: status.error,
    updatedAt: status.updatedAt,
    source: status.source,
    pendingApprovals: status.pendingApprovals,
  };
}

function codexRelayForWindow(window: BrowserWindow): CodexInteractiveRelayClient {
  if (codexRelayClient) return codexRelayClient;
  codexRelayClient = new CodexInteractiveRelayClient({
    apiBaseUrl,
    userId: menuUserId,
    mode: relayModeFromEnv(),
    onStatus: (status, event) => {
      logPetDebugEvent("codex-relay:event", { event });
      if (!window.isDestroyed()) publishCodexStatus(window, relayStatusToPetStatus(status));
    },
  });
  return codexRelayClient;
}

const KNOWN_SESSION_STATUSES = new Set<CodexSessionStatus>([
  "starting",
  "running",
  "command_running",
  "file_changed",
  "waiting_approval",
  "completed",
  "failed",
  "disconnected",
]);

function normalizeCodexSessionStatus(value: unknown): CodexSessionStatus {
  return KNOWN_SESSION_STATUSES.has(value as CodexSessionStatus) ? (value as CodexSessionStatus) : "running";
}

function sessionMenuKey(session: PetMenuSession): string {
  return String(session.pet_session_id || session.codex_session_id || "");
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function trimOutputText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength - 3);
  const lastSpace = clipped.lastIndexOf(" ");
  const boundary = lastSpace >= Math.floor(maxLength * 0.62) ? lastSpace : clipped.length;
  return `${clipped.slice(0, boundary).trimEnd()}...`;
}

function sessionTitle(session: PetMenuSession): string {
  const rawTitle = compactText(session.display_title) || compactText(session.first_prompt_preview) || "Codex session";
  return truncateText(redactSensitiveText(rawTitle), 80);
}

function sessionLastOutput(session: PetMenuSession): string | undefined {
  const metadata = session.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};
  return trimOutputText(metadata.last_output) || trimOutputText(session.last_summary) || undefined;
}

function activeSessionWorkspaceKey(workspacePath: string, agent: PetAgent): string {
  return `${agent}:${path.resolve(workspacePath).toLowerCase()}`;
}

function sessionVscodeUserDataDir(session: PetMenuSession | undefined): string {
  const metadata = session?.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {};
  return compactText(metadata.vscode_user_data_dir) || compactText(metadata.vscodeUserDataDir);
}

function findMenuSessionByPetId(petSessionId: string): PetMenuSession | undefined {
  const key = compactText(petSessionId);
  if (!key) return undefined;
  return (
    lastMenuSessionsByPetId.get(key) ||
    Array.from(lastMenuSessionsByPetId.values()).find(
      (session) => session.pet_session_id === key || session.codex_session_id === key,
    )
  );
}

function cacheActiveSessionWindow(options: {
  workspacePath: string;
  userDataDir: string;
  petSessionId?: string | null;
  codexSessionId?: string | null;
  agent?: PetAgent;
  persistMarker?: boolean;
}): ActiveSessionWindow | null {
  const workspacePath = compactText(options.workspacePath);
  const userDataDir = compactText(options.userDataDir);
  if (!workspacePath || !userDataDir) return null;
  const record: ActiveSessionWindow = {
    workspacePath,
    userDataDir,
    petSessionId: compactText(options.petSessionId) || undefined,
    codexSessionId: compactText(options.codexSessionId) || undefined,
    agent: options.agent ?? currentAgent,
    updatedAt: new Date().toISOString(),
  };
  for (const key of [record.petSessionId, record.codexSessionId].filter((value): value is string => Boolean(value))) {
    activeSessionWindowsByPetId.set(key, record);
  }
  activeSessionWindowsByWorkspace.set(activeSessionWorkspaceKey(record.workspacePath, record.agent), record);
  if (options.persistMarker !== false) {
    try {
      writeVscodeSessionWindowMarker(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("codex-launch:active-session-window-marker-error", {
        workspacePath: record.workspacePath,
        petSessionId: record.petSessionId,
        codexSessionId: record.codexSessionId,
        agent: record.agent,
        error: message,
      });
    }
  }
  logPetDebugEvent("codex-launch:active-session-window-cache", {
    workspacePath: record.workspacePath,
    petSessionId: record.petSessionId,
    codexSessionId: record.codexSessionId,
    agent: record.agent,
  });
  return record;
}

function bindActiveSessionWindowToSession(
  session: PetMenuSession,
  options: { userDataDir?: string; agent?: PetAgent } = {},
): ActiveSessionWindow | null {
  const workspacePath = compactText(session.workspace_path);
  if (!workspacePath) return null;
  const agent = options.agent ?? currentAgent;
  const workspaceRecord = activeSessionWindowsByWorkspace.get(activeSessionWorkspaceKey(workspacePath, agent));
  const userDataDir = compactText(options.userDataDir) || workspaceRecord?.userDataDir || sessionVscodeUserDataDir(session);
  if (!userDataDir) return null;
  return cacheActiveSessionWindow({
    workspacePath,
    userDataDir,
    petSessionId: session.pet_session_id,
    codexSessionId: session.codex_session_id,
    agent,
  });
}

function resolveActiveSessionWindow(petSessionId: string, session: PetMenuSession | undefined): ActiveSessionWindow | undefined {
  const requestedPetSessionId = compactText(petSessionId);
  const memoryRecord =
    activeSessionWindowsByPetId.get(requestedPetSessionId) ||
    activeSessionWindowsByPetId.get(compactText(session?.pet_session_id)) ||
    activeSessionWindowsByPetId.get(compactText(session?.codex_session_id));
  if (memoryRecord) return memoryRecord;

  const workspacePath = compactText(session?.workspace_path);
  if (!workspacePath) return undefined;
  const resolvedWindow = resolveVscodeSessionWindow({
    workspacePath,
    petSessionId: compactText(session?.pet_session_id) || requestedPetSessionId,
    codexSessionId: compactText(session?.codex_session_id),
    agent: currentAgent,
  });
  const userDataDir = resolvedWindow?.userDataDir;
  if (!userDataDir) return undefined;
  if (resolvedWindow.source === "workspace-storage") {
    logPetDebugEvent("codex-launch:focus-active-session-workspace-fallback", {
      workspacePath,
      petSessionId: session?.pet_session_id || requestedPetSessionId,
      codexSessionId: session?.codex_session_id,
      agent: currentAgent,
    });
    return {
      workspacePath,
      userDataDir,
      petSessionId: compactText(session?.pet_session_id) || requestedPetSessionId || undefined,
      codexSessionId: compactText(session?.codex_session_id) || undefined,
      agent: currentAgent,
      updatedAt: new Date().toISOString(),
    };
  }
  return cacheActiveSessionWindow({
    workspacePath,
    userDataDir,
    petSessionId: session?.pet_session_id || requestedPetSessionId,
    codexSessionId: session?.codex_session_id,
    agent: currentAgent,
  }) ?? undefined;
}

function focusActiveSessionWindow(
  window: BrowserWindow,
  petSessionId: string,
): { workspacePath: string; userDataDir: string; sessionTitle?: string; codexSessionId?: string } {
  const session = findMenuSessionByPetId(petSessionId);
  const activeWindow = resolveActiveSessionWindow(petSessionId, session);
  const workspacePath = activeWindow?.workspacePath || compactText(session?.workspace_path);
  const userDataDir = activeWindow?.userDataDir || sessionVscodeUserDataDir(session);
  const title = session ? sessionTitle(session) : "Codex session";
  const codexSessionId = compactText(session?.codex_session_id) || activeWindow?.codexSessionId;
  if (!workspacePath || !userDataDir) {
    const message = "Active task window metadata is unavailable";
    const fallbackWorkspacePath = workspacePath || resolveCurrentWorkspacePath();
    logPetDebugEvent("codex-launch:focus-active-session-error", {
      petSessionId,
      workspacePath: fallbackWorkspacePath,
      codexSessionId,
      error: message,
    });
    publishCodexStatus(window, {
      state: "failed",
      workspacePath: fallbackWorkspacePath,
      sessionTitle: title,
      codexSessionId,
      error: message,
      source: "terminal",
    });
    throw new Error(message);
  }
  return { workspacePath, userDataDir, sessionTitle: title, codexSessionId };
}

function toPetMenuSession(payload: DesktopPetSessionPayload, lastSeenAt?: string | null): PetMenuSession {
  return {
    ...payload,
    last_seen_at: lastSeenAt ?? null,
    updated_at: lastSeenAt ?? null,
  };
}

function readLocalCodexSessions(workspacePath: string, limit = 10): Array<{
  payload: DesktopPetSessionPayload;
  menuSession: PetMenuSession;
  fileModifiedAt: string;
}> {
  if (currentAgent === "claude") {
    const claudeHome = resolveClaudeHome(process.env);
    return scanRecentClaudeSessionFiles({
      claudeHome,
      workspacePath,
      limit,
      maxFiles: Math.max(120, limit * 8),
    }).map((summary) => {
      const payload = buildClaudeDesktopPetSessionPayload(summary, claudeHome);
      return {
        payload,
        menuSession: toPetMenuSession(payload, summary.fileModifiedAt),
        fileModifiedAt: summary.fileModifiedAt,
      };
    });
  }

  const codexHome = resolveCodexHome(process.env);
  return scanRecentCodexSessionFiles({
    codexHome,
    workspacePath,
    limit,
    maxFiles: Math.max(120, limit * 8),
  }).map((summary) => {
    const payload = buildDesktopPetSessionPayload(summary, codexHome);
    return {
      payload,
      menuSession: toPetMenuSession(payload, summary.fileModifiedAt),
      fileModifiedAt: summary.fileModifiedAt,
    };
  });
}

async function upsertDesktopPetSession(payload: DesktopPetSessionPayload): Promise<PetMenuSession> {
  const response = await fetch(`${apiBaseUrl}/desktop-pet/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": menuUserId },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`session upsert failed: ${response.status}`);
  return (await response.json()) as PetMenuSession;
}

function payloadFromMenuSession(session: PetMenuSession, lastStatus?: CodexSessionStatus): DesktopPetSessionPayload | null {
  const codexSessionId = session.codex_session_id?.trim();
  const workspacePath = session.workspace_path?.trim();
  if (!codexSessionId || !workspacePath) return null;
  return {
    pet_session_id: session.pet_session_id || `codex:${codexSessionId}`,
    codex_session_id: codexSessionId,
    workspace_id: session.workspace_id ?? null,
    workspace_path: workspacePath,
    codex_home: session.codex_home ?? resolveCodexHome(process.env),
    display_title: truncateText(sessionTitle(session), 48),
    first_prompt_preview: session.first_prompt_preview ?? null,
    last_summary: session.last_summary ?? null,
    last_status: lastStatus ?? normalizeCodexSessionStatus(session.last_status),
    launch_mode: session.launch_mode || "workspace-write",
    remote_url: session.remote_url ?? null,
    app_server_pid: session.app_server_pid ?? null,
    app_server_port: session.app_server_port ?? null,
    metadata: session.metadata ?? {},
  };
}

function mergeSessions(apiSessions: PetMenuSession[], localSessions: PetMenuSession[], limit = 10): PetMenuSession[] {
  const byKey = new Map<string, PetMenuSession>();
  for (const session of apiSessions) {
    const key = sessionMenuKey(session);
    if (key) byKey.set(key, session);
  }
  for (const session of localSessions) {
    const key = sessionMenuKey(session);
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) ?? {}), ...session });
  }
  return Array.from(byKey.values())
    .sort((left, right) => {
      const leftTime = Date.parse(left.last_seen_at || left.updated_at || "");
      const rightTime = Date.parse(right.last_seen_at || right.updated_at || "");
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, limit);
}

function cacheMenuSessions(sessions: PetMenuSession[]) {
  lastMenuSessionsByPetId = new Map(
    sessions
      .map((session) => [sessionMenuKey(session), session] as const)
      .filter(([key]) => key.length > 0),
  );
}

function listImmediateMenuSessions(): PetMenuSession[] {
  const cachedSessions = Array.from(lastMenuSessionsByPetId.values());
  try {
    const workspacePath = resolveCurrentWorkspacePath();
    const localSessions = readLocalCodexSessions(workspacePath).map((item) => item.menuSession);
    const sessions = mergeSessions(cachedSessions, localSessions, 10);
    cacheMenuSessions(sessions);
    return sessions;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-session:local-read-error", { error: message });
    return cachedSessions;
  }
}

function publishCodexStatusForSession(window: BrowserWindow, session: PetMenuSession) {
  publishCodexStatus(window, {
    state: normalizeCodexSessionStatus(session.last_status),
    workspacePath: session.workspace_path || undefined,
    sessionTitle: sessionTitle(session),
    codexSessionId: session.codex_session_id || undefined,
    lastOutput: sessionLastOutput(session),
    source: currentAgent === "claude" ? "claude-jsonl" : "codex-jsonl",
  });
}

function shouldUpsertSessionsToApi(): boolean {
  // Claude sessions are tracked purely from the local JSONL transcripts and are
  // never written to the FastAPI desktop-pet registry (that registry is Codex's
  // cross-machine review surface). Codex keeps its existing API upsert path.
  return currentAgent === "codex";
}

async function syncLocalCodexSessions(workspacePath: string, limit = 10): Promise<PetMenuSession[]> {
  const local = readLocalCodexSessions(workspacePath, limit);
  if (!shouldUpsertSessionsToApi()) return local.map((item) => item.menuSession);
  for (const item of [...local].reverse()) {
    try {
      await upsertDesktopPetSession(item.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("codex-session:upsert-error", {
        workspacePath,
        codexSessionId: item.payload.codex_session_id,
        error: message,
      });
      break;
    }
  }
  return local.map((item) => item.menuSession);
}

async function refreshRecentSessionsInBackground(window: BrowserWindow) {
  try {
    const sessions = await listRecentSessions();
    if (window.isDestroyed()) return;
    if (sessions[0]) publishCodexStatusForSession(window, sessions[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-session:background-refresh-error", { error: message });
  }
}

async function refreshAndPublishLocalCodexStatus(
  window: BrowserWindow,
  workspacePath: string,
  options: { minModifiedAtMs?: number; codexSessionId?: string } = {},
): Promise<PetMenuSession | null> {
  try {
    const local = readLocalCodexSessions(workspacePath);
    if (shouldUpsertSessionsToApi()) {
      for (const item of [...local].reverse()) {
        try {
          await upsertDesktopPetSession(item.payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logPetDebugEvent("codex-session:refresh-upsert-error", {
            workspacePath,
            codexSessionId: item.payload.codex_session_id,
            error: message,
          });
          break;
        }
      }
    }
    const codexSessionId = options.codexSessionId?.trim();
    const latest = local.find((item) => {
      if (codexSessionId && item.menuSession.codex_session_id !== codexSessionId) return false;
      if (!options.minModifiedAtMs) return true;
      return Date.parse(item.fileModifiedAt) >= options.minModifiedAtMs;
    });
    if (latest) {
      publishCodexStatusForSession(window, latest.menuSession);
      return latest.menuSession;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-session:refresh-error", { workspacePath, error: message });
  }
  return null;
}

function stopCodexSessionOutputWatch(window: BrowserWindow, reason = "replaced") {
  const watch = codexSessionOutputWatches.get(window);
  if (!watch) return;
  clearInterval(watch.interval);
  clearTimeout(watch.timeout);
  codexSessionOutputWatches.delete(window);
  logPetDebugEvent("codex-session:watch-stop", {
    reason,
    workspacePath: watch.workspacePath,
    codexSessionId: watch.codexSessionId,
  });
}

function shouldStopCodexSessionOutputWatch(session: PetMenuSession): boolean {
  const status = normalizeCodexSessionStatus(session.last_status);
  return status === "failed" || status === "disconnected";
}

function startCodexSessionOutputWatch(
  window: BrowserWindow,
  workspacePath: string,
  options: { minModifiedAtMs: number; codexSessionId?: string; userDataDir?: string },
) {
  stopCodexSessionOutputWatch(window);
  const watch: CodexSessionOutputWatch = {
    workspacePath,
    minModifiedAtMs: options.minModifiedAtMs,
    codexSessionId: options.codexSessionId?.trim() || undefined,
    userDataDir: options.userDataDir?.trim() || undefined,
    agent: currentAgent,
    interval: setInterval(() => {
      void tickCodexSessionOutputWatch(window, watch);
    }, CODEX_SESSION_WATCH_INTERVAL_MS),
    timeout: setTimeout(() => {
      stopCodexSessionOutputWatch(window, "max-duration");
    }, CODEX_SESSION_WATCH_MAX_DURATION_MS),
    inFlight: false,
  };
  codexSessionOutputWatches.set(window, watch);
  logPetDebugEvent("codex-session:watch-start", {
    workspacePath,
    codexSessionId: watch.codexSessionId,
    hasUserDataDir: Boolean(watch.userDataDir),
    minModifiedAtMs: watch.minModifiedAtMs,
    intervalMs: CODEX_SESSION_WATCH_INTERVAL_MS,
    maxDurationMs: CODEX_SESSION_WATCH_MAX_DURATION_MS,
  });
  void tickCodexSessionOutputWatch(window, watch);
}

async function tickCodexSessionOutputWatch(window: BrowserWindow, watch: CodexSessionOutputWatch) {
  if (codexSessionOutputWatches.get(window) !== watch) return;
  if (window.isDestroyed()) {
    stopCodexSessionOutputWatch(window, "window-destroyed");
    return;
  }
  if (watch.inFlight) return;
  watch.inFlight = true;
  try {
    const session = await refreshAndPublishLocalCodexStatus(window, watch.workspacePath, {
      minModifiedAtMs: watch.minModifiedAtMs,
      codexSessionId: watch.codexSessionId,
    });
    if (session) bindActiveSessionWindowToSession(session, { userDataDir: watch.userDataDir, agent: watch.agent });
    if (session && shouldStopCodexSessionOutputWatch(session)) {
      stopCodexSessionOutputWatch(window, `status:${normalizeCodexSessionStatus(session.last_status)}`);
    }
  } finally {
    watch.inFlight = false;
  }
}

async function dispatchMenuAction(window: BrowserWindow, action: PetMenuAction) {
  if (action.type === "select-workspace") {
    const currentWorkspacePath = resolveCurrentWorkspacePath();
    window.webContents.send("pet:menu:action", action);
    try {
      const result = await dialog.showOpenDialog(window, {
        title: currentMenuLanguage === "zh-CN" ? "选择 Codex 工作区" : "Select Codex Workspace",
        defaultPath: currentWorkspacePath,
        properties: ["openDirectory"],
      });
      const selectedPath = result.filePaths[0]?.trim();
      if (result.canceled || !selectedPath) return;
      if (!fs.statSync(selectedPath).isDirectory()) {
        throw new Error("Selected workspace is not a directory");
      }
      const settings = writeSelectedWorkspacePath({
        workspacePath: selectedPath,
        userDataPath: app.getPath("userData"),
      });
      const workspacePath = settings.selectedWorkspacePath ?? selectedPath;
      cacheMenuSessions([]);
      publishCodexStatus(window, { state: "idle", workspacePath });
      logPetDebugEvent("workspace:selected", { workspacePath });
      window.webContents.send("pet:menu:action", { type: "workspace-selected", workspacePath });
      void refreshRecentSessionsInBackground(window);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("workspace:select-error", { currentWorkspacePath, error: message });
      publishCodexStatus(window, { state: "failed", workspacePath: currentWorkspacePath, error: message });
    }
    return;
  }
  if (action.type === "switch-workspace") {
    const currentWorkspacePath = resolveCurrentWorkspacePath();
    const requestedWorkspacePath = action.workspacePath.trim();
    window.webContents.send("pet:menu:action", action);
    try {
      if (!requestedWorkspacePath) {
        throw new Error("Workspace path is required");
      }
      if (!fs.statSync(requestedWorkspacePath).isDirectory()) {
        throw new Error("Selected workspace is not a directory");
      }
      const settings = writeSelectedWorkspacePath({
        workspacePath: action.workspacePath,
        userDataPath: app.getPath("userData"),
      });
      const workspacePath = settings.selectedWorkspacePath ?? requestedWorkspacePath;
      cacheMenuSessions([]);
      publishCodexStatus(window, { state: "idle", workspacePath });
      logPetDebugEvent("workspace:switched", { workspacePath });
      window.webContents.send("pet:menu:action", { type: "workspace-selected", workspacePath });
      void refreshRecentSessionsInBackground(window);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("workspace:switch-error", {
        currentWorkspacePath,
        requestedWorkspacePath,
        error: message,
      });
      publishCodexStatus(window, { state: "failed", workspacePath: currentWorkspacePath, error: message });
    }
    return;
  }
  if (action.type === "interaction-mode") {
    publishInteractionMode(window, normalizeInteractionMode(action.mode));
    window.webContents.send("pet:menu:action", { type: "interaction-mode", mode: currentInteractionMode });
    return;
  }
  if (action.type === "send-prompt") {
    window.webContents.send("pet:menu:action", action);
    return;
  }
  if (action.type === "new-session") {
    const workspacePath = resolveCurrentWorkspacePath();
    const launchedAt = Date.now();
    publishCodexStatus(window, { state: "starting", workspacePath, source: "terminal" });
    try {
      const result =
        currentAgent === "claude"
          ? launchNewClaudeSession({ workspacePath })
          : launchNewCodexSession({ workspacePath });
      logPetDebugEvent(`${currentAgent}-launch:new-session`, result);
      publishCodexStatus(window, {
        state: "launched",
        workspacePath: result.workspacePath,
        commandLine: result.commandLine,
        source: "terminal",
      });
      cacheActiveSessionWindow({
        workspacePath: result.workspacePath,
        userDataDir: result.userDataDir,
        agent: currentAgent,
      });
      startCodexSessionOutputWatch(window, result.workspacePath, {
        minModifiedAtMs: launchedAt - 1000,
        userDataDir: result.userDataDir,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent(`${currentAgent}-launch:new-session-error`, { workspacePath, error: message });
      publishCodexStatus(window, { state: "failed", workspacePath, error: message, source: "terminal" });
    }
    window.webContents.send("pet:menu:action", action);
    return;
  }
  if (action.type === "restore-session") {
    const session = lastMenuSessionsByPetId.get(action.petSessionId);
    const workspacePath = session?.workspace_path || resolveCurrentWorkspacePath();
    const codexSessionId = session?.codex_session_id?.trim();
    const title = session ? sessionTitle(session) : "Codex session";
    if (!codexSessionId) {
      const message = "Codex session metadata is missing";
      logPetDebugEvent("codex-launch:restore-session-error", { petSessionId: action.petSessionId, error: message });
      publishCodexStatus(window, { state: "failed", workspacePath, sessionTitle: title, error: message, source: "terminal" });
      window.webContents.send("pet:menu:action", action);
      return;
    }
    publishCodexStatus(window, { state: "resuming", workspacePath, sessionTitle: title, codexSessionId, source: "terminal" });
    try {
      const result =
        currentAgent === "claude"
          ? resumeClaudeSession({ claudeSessionId: codexSessionId, workspacePath })
          : resumeCodexSession({ codexSessionId, workspacePath });
      logPetDebugEvent(`${currentAgent}-launch:restore-session`, result);
      cacheActiveSessionWindow({
        workspacePath: result.workspacePath,
        userDataDir: result.userDataDir,
        petSessionId: action.petSessionId,
        codexSessionId,
        agent: currentAgent,
      });
      publishCodexStatus(window, {
        state: "running",
        workspacePath: result.workspacePath,
        sessionTitle: title,
        codexSessionId,
        commandLine: result.commandLine,
        lastOutput: session ? sessionLastOutput(session) : undefined,
        source: "terminal",
      });
      startCodexSessionOutputWatch(window, result.workspacePath, {
        minModifiedAtMs: Date.now() - 1000,
        codexSessionId,
        userDataDir: result.userDataDir,
      });
      if (session && shouldUpsertSessionsToApi()) {
        const payload = payloadFromMenuSession(session, "running");
        if (payload) {
          void upsertDesktopPetSession(payload).catch((error: Error) =>
            logPetDebugEvent("codex-session:restore-upsert-error", { petSessionId: action.petSessionId, error: error.message }),
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent(`${currentAgent}-launch:restore-session-error`, {
        petSessionId: action.petSessionId,
        codexSessionId,
        workspacePath,
        error: message,
      });
      publishCodexStatus(window, { state: "failed", workspacePath, sessionTitle: title, codexSessionId, error: message, source: "terminal" });
    }
    window.webContents.send("pet:menu:action", action);
    return;
  }
  if (action.type === "focus-active-session") {
    try {
      const { workspacePath, userDataDir } = focusActiveSessionWindow(window, action.petSessionId);
      const result = focusVscodeWorkspace({ workspacePath, userDataDir });
      logPetDebugEvent("codex-launch:focus-active-session", { ...result, petSessionId: action.petSessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("codex-launch:focus-active-session-error", { petSessionId: action.petSessionId, error: message });
    }
    window.webContents.send("pet:menu:action", action);
    return;
  }
  if (action.type === "more-sessions") {
    window.webContents.send("pet:menu:action", { type: "more-sessions", sessions: [] });
    try {
      const sessions = await listRecentSessions(50);
      cacheMenuSessions(sessions);
      logPetDebugEvent("codex-session:more-sessions", { sessions: sessions.length });
      window.webContents.send("pet:menu:action", { type: "more-sessions", sessions });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const workspacePath = resolveCurrentWorkspacePath();
      logPetDebugEvent("codex-session:more-sessions-error", { workspacePath, error: message });
      publishCodexStatus(window, { state: "failed", workspacePath, error: message });
    }
    return;
  }
  if (action.type === "focus-vscode") {
    const workspacePath = resolveCurrentWorkspacePath();
    try {
      const result = focusVscodeWorkspace({ workspacePath });
      logPetDebugEvent("codex-launch:focus-vscode", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("codex-launch:focus-vscode-error", { workspacePath, error: message });
      publishCodexStatus(window, { state: "failed", workspacePath, error: message });
    }
    window.webContents.send("pet:menu:action", action);
    return;
  }
  if (action.type === "notification-detail") {
    currentNotificationProfile = normalizeNotificationProfile(action.profile);
    persistPetPreferences({ notificationProfile: currentNotificationProfile });
  }
  if (action.type === "menu-language") {
    currentMenuLanguage = normalizeMenuLanguage(action.language);
    persistPetPreferences({ menuLanguage: currentMenuLanguage });
  }
  if (action.type === "always-on-top") {
    currentAlwaysOnTop = Boolean(action.enabled);
    persistPetPreferences({ alwaysOnTop: currentAlwaysOnTop });
    applyPetAlwaysOnTop(window, currentAlwaysOnTop);
    logPetDebugEvent("window-top:changed", { enabled: currentAlwaysOnTop });
    window.webContents.send("pet:menu:action", { type: "always-on-top", enabled: currentAlwaysOnTop });
    return;
  }
  if (action.type === "agent") {
    currentAgent = normalizePetAgent(action.agent);
    persistPetPreferences({ agent: currentAgent });
    cacheMenuSessions([]);
    publishCodexStatus(window, { state: "idle", workspacePath: resolveCurrentWorkspacePath() });
    logPetDebugEvent("agent:changed", { agent: currentAgent });
    window.webContents.send("pet:agent:changed", currentAgent);
    window.webContents.send("pet:menu:action", { type: "agent", agent: currentAgent });
    void refreshRecentSessionsInBackground(window);
    return;
  }
  if (action.type === "close") {
    window.close();
    return;
  }
  window.webContents.send("pet:menu:action", action);
}

async function listRecentSessions(limit = 10): Promise<PetMenuSession[]> {
  const workspacePath = resolveCurrentWorkspacePath();
  let localSessions: PetMenuSession[] = [];
  try {
    localSessions = await syncLocalCodexSessions(workspacePath, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-session:sync-error", { workspacePath, error: message });
  }

  if (!shouldUpsertSessionsToApi()) {
    cacheMenuSessions(localSessions);
    return localSessions;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/desktop-pet/sessions?limit=${limit}`, {
      headers: { "x-user-id": menuUserId },
    });
    if (!response.ok) throw new Error(`sessions failed: ${response.status}`);
    const payload = (await response.json()) as { sessions?: PetMenuSession[] };
    lastApiAvailable = true;
    const sessions = mergeSessions(payload.sessions || [], localSessions, limit);
    cacheMenuSessions(sessions);
    return sessions;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-session:list-error", { workspacePath, error: message });
    lastApiAvailable = false;
    cacheMenuSessions(localSessions);
    return localSessions;
  }
}

async function openPetContextMenu(
  window: BrowserWindow,
  input?: ContextMenuPositionInput,
  source: ContextMenuPopupSource = "native",
) {
  const now = Date.now();
  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  const resolvedPosition = resolveContextMenuPosition({
    input: input ?? { space: "screen", point: cursor },
    bounds,
  });
  if (!resolvedPosition) {
    const ignoredScreenPosition = input?.space === "screen" ? input.point : cursor;
    lastMenuPopup = { atMs: now, source, position: ignoredScreenPosition };
    logPetDebugEvent("context-menu:ignored-outside-window", { source, input, cursor, bounds });
    return;
  }
  if (
    shouldSuppressDuplicateContextMenuPopup({
      nowMs: now,
      source,
      position: resolvedPosition.screenPosition,
      lastPopup: lastMenuPopup,
      lastMenuClosedAtMs: lastContextMenuClosedAtMs,
      menuActive: contextMenuActive,
    })
  ) {
    logPetDebugEvent("context-menu:deduped", { source, input, resolvedPosition, menuActive: contextMenuActive });
    return;
  }
  lastMenuPopup = { atMs: now, source, position: resolvedPosition.screenPosition };
  contextMenuActive = true;
  logPetDebugEvent("context-menu:open", { source, input, cursor, bounds, resolvedPosition });
  try {
    const sessions = listImmediateMenuSessions();
    const selectedWorkspacePath = resolveCurrentWorkspacePath();
    if (sessions[0]) publishCodexStatusForSession(window, sessions[0]);
    const menu = Menu.buildFromTemplate(
      toElectronMenuTemplate(
        buildPetMenuModel({
          interactionMode: currentInteractionMode,
          notificationProfile: currentNotificationProfile,
          menuLanguage: currentMenuLanguage,
          alwaysOnTop: currentAlwaysOnTop,
          selectedWorkspacePath,
          sessions,
          activeWorkspaces: buildActiveWorkspaceSummaries(sessions),
          apiAvailable: lastApiAvailable,
          agent: currentAgent,
        }),
        (action) => void dispatchMenuAction(window, action),
      ),
    );
    logPetDebugEvent("context-menu:popup", { position: resolvedPosition.popupPosition, sessions: sessions.length });
    menu.popup({
      window,
      ...resolvedPosition.popupPosition,
      callback: () => {
        contextMenuActive = false;
        lastContextMenuClosedAtMs = Date.now();
        logPetDebugEvent("context-menu:closed");
      },
    });
    void refreshRecentSessionsInBackground(window);
  } catch (error) {
    contextMenuActive = false;
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("context-menu:error", { source, input, error: message });
  }
}

function startPetWindowDrag(window: BrowserWindow, source: WindowDragSource) {
  const activeDrag = windowDragState.get(window);
  if (!shouldAcceptWindowDragStart(activeDrag?.source, source)) {
    logPetDebugEvent("window-drag:start-ignored", { source, activeSource: activeDrag?.source });
    return;
  }
  windowDragState.set(window, {
    originBounds: window.getBounds(),
    originCursor: screen.getCursorScreenPoint(),
    source,
  });
  logPetDebugEvent("window-drag:start", { source, ...(windowDragState.get(window) ?? {}) });
}

function movePetWindowDrag(window: BrowserWindow, source: WindowDragSource) {
  const dragState = windowDragState.get(window);
  if (!dragState) return;
  if (!shouldApplyWindowDragMove(dragState.source, source)) {
    logPetDebugEvent("window-drag:move-ignored", { source, activeSource: dragState.source });
    return;
  }
  const bounds = calculateDraggedWindowBounds({
    ...dragState,
    currentCursor: screen.getCursorScreenPoint(),
  });
  window.setBounds(bounds);
  logPetDebugEvent("window-drag:move", { source, bounds });
}

function endPetWindowDrag(window: BrowserWindow, source: WindowDragSource) {
  const dragState = windowDragState.get(window);
  if (!dragState) return;
  const bounds = calculateEndedWindowDragBounds({
    currentBounds: window.getBounds(),
    originBounds: dragState.originBounds,
  });
  window.setBounds(bounds);
  logPetDebugEvent("window-drag:end", { source, activeSource: dragState.source, bounds });
  windowDragState.delete(window);
  persistPetWindowBounds(window);
}

function installNativeMouseHooks(window: BrowserWindow) {
  if (process.platform !== "win32") return;

  window.hookWindowMessage(WM_RBUTTONUP, () => {
    const position = screen.getCursorScreenPoint();
    logPetDebugEvent("native-mouse:right-button-up", { position });
    void openPetContextMenu(window, { space: "screen", point: position }, "native");
  });

  window.hookWindowMessage(WM_LBUTTONDOWN, () => {
    logPetDebugEvent("native-mouse:left-button-down", { interactionMode: currentInteractionMode });
    if (
      !shouldStartNativeWindowDrag({
        interactionMode: currentInteractionMode,
        contextMenuActive,
        lastContextMenuClosedAtMs,
      })
    ) {
      logPetDebugEvent("window-drag:native-start-suppressed", {
        interactionMode: currentInteractionMode,
        contextMenuActive,
        lastContextMenuClosedAtMs,
      });
      return;
    }
    startPetWindowDrag(window, "native");
  });

  window.hookWindowMessage(WM_MOUSEMOVE, () => {
    movePetWindowDrag(window, "native");
  });

  window.hookWindowMessage(WM_LBUTTONUP, () => {
    endPetWindowDrag(window, "native");
  });
}

async function createPetWindow() {
  logPetDebugEvent("app:start", { isDev, devRendererUrl, debugEventsLogPath });
  const cleaned = cleanupStaleVscodeUserDataDirs();
  if (cleaned.removed.length) {
    logPetDebugEvent("vscode-user-data:cleanup", { removed: cleaned.removed.length, scanned: cleaned.scanned });
  }
  const settings = applyPersistedPetPreferences();
  const displayWorkAreas = screen.getAllDisplays().map((display) => display.workArea);
  const windowOptions = createPetBrowserWindowOptions(path.join(__dirname, "preload.cjs"), settings.windowBounds, displayWorkAreas);
  if (
    settings.windowBounds &&
    (windowOptions.x !== settings.windowBounds.x || windowOptions.y !== settings.windowBounds.y)
  ) {
    logPetDebugEvent("window-bounds:restored-to-visible-area", {
      savedBounds: settings.windowBounds,
      restoredBounds: { x: windowOptions.x, y: windowOptions.y, width: windowOptions.width, height: windowOptions.height },
      displayWorkAreas,
    });
  }
  const window = new BrowserWindow(windowOptions);

  void refreshApiRuntimeStatus();
  applyPetAlwaysOnTop(window, currentAlwaysOnTop);
  installNativeMouseHooks(window);
  window.on("close", () => {
    stopCodexSessionOutputWatch(window, "window-close");
    persistPetWindowBounds(window);
  });
  window.on("system-context-menu", (event, point) => {
    event.preventDefault();
    logPetDebugEvent("context-menu:system-event", { point });
    openPetContextMenu(window, { space: "screen", point: screen.screenToDipPoint(point) }, "system");
  });
  window.webContents.on("context-menu", (_event, params) => {
    logPetDebugEvent("context-menu:webcontents-event", { x: params.x, y: params.y });
    openPetContextMenu(window, { space: "window", point: { x: params.x, y: params.y } }, "webcontents");
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logPetDebugEvent("renderer:console", { level, message, line, sourceId });
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logPetDebugEvent("renderer:did-fail-load", { errorCode, errorDescription, validatedURL });
  });
  window.webContents.on("did-finish-load", () => {
    logPetDebugEvent("renderer:did-finish-load", { url: window.webContents.getURL() });
    logRendererDomState(window, "did-finish-load");
    setTimeout(() => logRendererDomState(window, "after-1500ms"), 1500);
    void refreshRecentSessionsInBackground(window);
  });
  if (isDev) {
    await window.loadURL(devRendererUrl);
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("pet:runtime-info", () => ({
  apiBaseUrl,
  apiRuntimeStatus: currentApiRuntimeStatus,
}));

ipcMain.handle("pet:interaction-mode:get", () => currentInteractionMode);
ipcMain.handle("pet:interaction-mode:set", (event, nextMode: unknown) => {
  const mode = normalizeInteractionMode(nextMode);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    publishInteractionMode(window, mode);
  } else {
    currentInteractionMode = mode;
  }
  return currentInteractionMode;
});

ipcMain.handle("pet:menu:open-context", async (event, position: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  const rendererPosition = normalizeRendererMenuPosition(position);
  const input = rendererPosition ? { space: "window", point: rendererPosition } satisfies ContextMenuPositionInput : undefined;
  logPetDebugEvent("context-menu:ipc", { input });
  await openPetContextMenu(window, input, "renderer");
  return true;
});

ipcMain.handle("pet:notification-profile:get", () => currentNotificationProfile);
ipcMain.handle("pet:agent:get", () => currentAgent);
ipcMain.handle("pet:codex-status:get", () => currentCodexStatus);
ipcMain.handle("pet:clipboard:write-text", (_event, text: unknown) => {
  const value = typeof text === "string" ? text : "";
  if (!value.trim()) return false;
  clipboard.writeText(value);
  logPetDebugEvent("clipboard:write", { length: value.length });
  return true;
});
ipcMain.handle("pet:api-runtime:get", () => currentApiRuntimeStatus);
ipcMain.handle("pet:api-runtime:retry", () => refreshApiRuntimeStatus());

ipcMain.handle("pet:vscode:focus", async (event, options: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  const requestedWorkspacePath =
    options && typeof options === "object" && typeof (options as { workspacePath?: unknown }).workspacePath === "string"
      ? (options as { workspacePath: string }).workspacePath.trim()
      : "";
  const workspacePath = requestedWorkspacePath || resolveCurrentWorkspacePath();
  try {
    const result = focusVscodeWorkspace({ workspacePath });
    logPetDebugEvent("codex-launch:focus-vscode", { ...result, requestedWorkspacePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-launch:focus-vscode-error", { workspacePath, requestedWorkspacePath, error: message });
    publishCodexStatus(window, { state: "failed", workspacePath, error: message, source: "terminal" });
    throw error;
  }
  return true;
});

ipcMain.handle("pet:sessions:restore", async (event, petSessionId: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const selectedPetSessionId = typeof petSessionId === "string" ? petSessionId.trim() : "";
  if (!window || !selectedPetSessionId) return false;
  await dispatchMenuAction(window, { type: "restore-session", petSessionId: selectedPetSessionId });
  return true;
});

ipcMain.handle("pet:sessions:focus-active", async (event, petSessionId: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const selectedPetSessionId = typeof petSessionId === "string" ? petSessionId.trim() : "";
  if (!window || !selectedPetSessionId) return false;
  const { workspacePath, userDataDir } = focusActiveSessionWindow(window, selectedPetSessionId);
  try {
    const result = focusVscodeWorkspace({ workspacePath, userDataDir });
    logPetDebugEvent("codex-launch:focus-active-session", { ...result, petSessionId: selectedPetSessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-launch:focus-active-session-error", { petSessionId: selectedPetSessionId, error: message });
    publishCodexStatus(window, { state: "failed", workspacePath, error: message, source: "terminal" });
    throw error;
  }
  return true;
});

async function decideCodexApprovalFromPet(
  window: BrowserWindow,
  options: {
    codexSessionId: string;
    approvalId: string;
    decision: CodexRelayDecision;
  },
) {
  const relayClient = codexRelayForWindow(window);
  await relayClient.decideApproval({
    sessionId: options.codexSessionId,
    approvalId: options.approvalId,
    decision: options.decision,
  });
  const remainingApprovals = (currentCodexStatus.pendingApprovals ?? []).filter((approval) => approval.id !== options.approvalId);
  publishCodexStatus(window, {
    ...currentCodexStatus,
    state: remainingApprovals.length > 0 ? "waiting_approval" : "running",
    pendingApprovals: remainingApprovals,
    lastOutput: options.decision === "approve_once" ? "Approval submitted: approve once" : "Approval submitted: deny",
    source: "app-server-relay",
  });
  window.webContents.send("pet:menu:action", {
    type: "approval-decided",
    approvalId: options.approvalId,
    decision: options.decision,
  });
}

ipcMain.handle("pet:approval:decide", async (event, options: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  const payload = options && typeof options === "object" ? (options as Record<string, unknown>) : {};
  const codexSessionId = typeof payload.codexSessionId === "string" ? payload.codexSessionId.trim() : "";
  const approvalId = typeof payload.approvalId === "string" ? payload.approvalId.trim() : "";
  const decision = payload.decision === "approve_once" || payload.decision === "deny" ? payload.decision : null;
  if (!codexSessionId) throw new Error("codexSessionId is required");
  if (!approvalId) throw new Error("approvalId is required");
  if (!decision) throw new Error("Unsupported Codex approval decision");
  try {
    await decideCodexApprovalFromPet(window, { codexSessionId, approvalId, decision });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-relay:approval-error", { codexSessionId, approvalId, decision, error: message });
    publishCodexStatus(window, { ...currentCodexStatus, state: "failed", error: message });
    throw error;
  }
});

ipcMain.handle("pet:prompt:send", async (event, prompt: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  const workspacePath = resolveCurrentWorkspacePath();
  const sentAt = Date.now();
  const promptText = typeof prompt === "string" ? prompt : "";
  if (shouldUseCodexRelay()) {
    try {
      await codexRelayForWindow(window).sendPrompt({
        workspacePath,
        prompt: promptText,
      });
      logPetDebugEvent("codex-relay:send-prompt", { workspacePath });
      window.webContents.send("pet:menu:action", { type: "prompt-sent", source: "app-server-relay" });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("codex-relay:send-prompt-fallback", { workspacePath, error: message });
    }
  }
  // Without the VSCode helper there is no way to inject text into a running
  // terminal. The prompt itself becomes the copyable command line: the user
  // pastes it into the active agent session in their VSCode window.
  const trimmedPrompt = promptText.trim();
  if (!trimmedPrompt) return false;
  logPetDebugEvent("pet-prompt:copy-command", { agent: currentAgent, workspacePath });
  publishCodexStatus(window, {
    ...currentCodexStatus,
    state: "running",
    workspacePath,
    commandLine: trimmedPrompt,
    source: currentAgent === "claude" ? "claude-jsonl" : "terminal",
  });
  startCodexSessionOutputWatch(window, workspacePath, { minModifiedAtMs: sentAt - 1000 });
  window.webContents.send("pet:menu:action", { type: "prompt-sent" });
  return true;
});

ipcMain.on("pet:renderer-error", (event, payload: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const eventPayload =
    payload && typeof payload === "object"
      ? (payload as CrashEventPayload)
      : { message: String(payload) };
  logPetCrashEvent("renderer:error", {
    ...eventPayload,
    webContentsId: event.sender.id,
    url: window && !window.isDestroyed() ? window.webContents.getURL() : event.sender.getURL(),
  });
});

ipcMain.on("pet:window-drag:start", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  startPetWindowDrag(window, "ipc");
});

ipcMain.on("pet:window-drag:move", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  movePetWindowDrag(window, "ipc");
});

ipcMain.on("pet:window-drag:end", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  endPetWindowDrag(window, "ipc");
});

app.whenReady().then(createPetWindow);
app.on("window-all-closed", () => app.quit());
