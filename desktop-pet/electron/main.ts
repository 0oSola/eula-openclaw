import { BrowserWindow, Menu, app, dialog, ipcMain, screen } from "electron";
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
import { focusVscodeWorkspace, launchNewCodexSession, resumeCodexSession, sendCodexPrompt } from "./codexLauncher.js";
import {
  buildDesktopPetSessionPayload,
  resolveCodexHome,
  scanRecentCodexSessionFiles,
  type CodexSessionStatus,
  type DesktopPetSessionPayload,
} from "./codexSessionFiles.js";
import { toElectronMenuTemplate } from "./electronMenuTemplate.js";
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
  buildPetMenuModel,
  normalizeMenuLanguage,
  normalizeNotificationProfile,
  type MenuLanguage,
  type NotificationProfile,
  type PetMenuAction,
  type PetMenuSession,
} from "./petMenuModel.js";
import { applyPetAlwaysOnTop } from "./petAlwaysOnTop.js";
import { readPetSettings, resolveSelectedWorkspacePath, writePetSettings, writeSelectedWorkspacePath } from "./petSettingsStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const devRendererUrl =
  process.env.MMD_PET_RENDERER_URL ?? `http://127.0.0.1:${process.env.MMD_PET_DEV_PORT ?? "5174"}`;
const apiBaseUrl = process.env.MMD_PET_API_BASE_URL ?? "http://127.0.0.1:8000";
const menuUserId = process.env.MMD_PET_USER_ID ?? "admin-1";
const debugEventsEnabled = process.env.MMD_PET_DEBUG_EVENTS === "1";
const debugEventsLogPath = process.env.MMD_PET_DEBUG_EVENTS_LOG ?? path.join(process.cwd(), "desktop-pet-debug-events.ndjson");
let currentInteractionMode: PetInteractionMode = DEFAULT_INTERACTION_MODE;
let currentNotificationProfile: NotificationProfile = "medium";
let currentMenuLanguage: MenuLanguage = "en";
let currentAlwaysOnTop = true;
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
  error?: string;
  updatedAt?: string;
};
let currentCodexStatus: CodexPetStatus = { state: "idle" };
let currentApiRuntimeStatus: ApiRuntimeStatus | null = null;
let lastApiAvailable = true;
let lastMenuPopup: ContextMenuPopupRecord | undefined;
let contextMenuActive = false;
let lastContextMenuClosedAtMs: number | undefined;
let lastMenuSessionsByPetId = new Map<string, PetMenuSession>();
const windowDragState = new WeakMap<BrowserWindow, WindowDragSession>();

function logPetDebugEvent(type: string, payload: Record<string, unknown> = {}) {
  if (!debugEventsEnabled) return;
  fs.appendFileSync(debugEventsLogPath, `${JSON.stringify({ at: new Date().toISOString(), type, ...payload })}\n`, "utf8");
}

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
  window.webContents.send("pet:codex-status:changed", currentCodexStatus);
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
  });
}

async function syncLocalCodexSessions(workspacePath: string, limit = 10): Promise<PetMenuSession[]> {
  const local = readLocalCodexSessions(workspacePath, limit);
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
  options: { minModifiedAtMs?: number } = {},
) {
  try {
    const local = readLocalCodexSessions(workspacePath);
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
    const latest = local.find((item) => {
      if (!options.minModifiedAtMs) return true;
      return Date.parse(item.fileModifiedAt) >= options.minModifiedAtMs;
    });
    if (latest) publishCodexStatusForSession(window, latest.menuSession);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-session:refresh-error", { workspacePath, error: message });
  }
}

function scheduleCodexSessionRefresh(window: BrowserWindow, workspacePath: string, minModifiedAtMs: number) {
  for (const delayMs of [1500, 5000, 12000]) {
    setTimeout(() => {
      if (!window.isDestroyed()) {
        void refreshAndPublishLocalCodexStatus(window, workspacePath, { minModifiedAtMs: minModifiedAtMs - 1000 });
      }
    }, delayMs);
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
    publishCodexStatus(window, { state: "starting", workspacePath });
    try {
      const result = launchNewCodexSession({ workspacePath });
      logPetDebugEvent("codex-launch:new-session", result);
      publishCodexStatus(window, { state: "launched", workspacePath: result.workspacePath });
      scheduleCodexSessionRefresh(window, result.workspacePath, launchedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("codex-launch:new-session-error", { workspacePath, error: message });
      publishCodexStatus(window, { state: "failed", workspacePath, error: message });
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
      publishCodexStatus(window, { state: "failed", workspacePath, sessionTitle: title, error: message });
      window.webContents.send("pet:menu:action", action);
      return;
    }
    publishCodexStatus(window, { state: "resuming", workspacePath, sessionTitle: title, codexSessionId });
    try {
      const result = resumeCodexSession({ codexSessionId, workspacePath });
      logPetDebugEvent("codex-launch:restore-session", result);
      publishCodexStatus(window, {
        state: "running",
        workspacePath: result.workspacePath,
        sessionTitle: title,
        codexSessionId: result.codexSessionId,
      });
      if (session) {
        const payload = payloadFromMenuSession(session, "running");
        if (payload) {
          void upsertDesktopPetSession(payload).catch((error: Error) =>
            logPetDebugEvent("codex-session:restore-upsert-error", { petSessionId: action.petSessionId, error: error.message }),
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logPetDebugEvent("codex-launch:restore-session-error", {
        petSessionId: action.petSessionId,
        codexSessionId,
        workspacePath,
        error: message,
      });
      publishCodexStatus(window, { state: "failed", workspacePath, sessionTitle: title, codexSessionId, error: message });
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
      publishCodexStatus(window, { state: "vscode-opened", workspacePath: result.workspacePath });
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
          apiAvailable: lastApiAvailable,
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
  const settings = applyPersistedPetPreferences();
  const window = new BrowserWindow(createPetBrowserWindowOptions(path.join(__dirname, "preload.cjs"), settings.windowBounds));

  void refreshApiRuntimeStatus();
  applyPetAlwaysOnTop(window, currentAlwaysOnTop);
  installNativeMouseHooks(window);
  window.on("close", () => persistPetWindowBounds(window));
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
ipcMain.handle("pet:codex-status:get", () => currentCodexStatus);
ipcMain.handle("pet:api-runtime:get", () => currentApiRuntimeStatus);
ipcMain.handle("pet:api-runtime:retry", () => refreshApiRuntimeStatus());

ipcMain.handle("pet:vscode:focus", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  await dispatchMenuAction(window, { type: "focus-vscode" });
  return true;
});

ipcMain.handle("pet:sessions:restore", async (event, petSessionId: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const selectedPetSessionId = typeof petSessionId === "string" ? petSessionId.trim() : "";
  if (!window || !selectedPetSessionId) return false;
  await dispatchMenuAction(window, { type: "restore-session", petSessionId: selectedPetSessionId });
  return true;
});

ipcMain.handle("pet:prompt:send", async (event, prompt: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  const workspacePath = resolveCurrentWorkspacePath();
  const sentAt = Date.now();
  try {
    const result = sendCodexPrompt({
      workspacePath,
      prompt: typeof prompt === "string" ? prompt : "",
    });
    logPetDebugEvent("codex-launch:send-prompt", { workspacePath: result.workspacePath });
    publishCodexStatus(window, { state: "running", workspacePath: result.workspacePath });
    scheduleCodexSessionRefresh(window, result.workspacePath, sentAt);
    window.webContents.send("pet:menu:action", { type: "prompt-sent" });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logPetDebugEvent("codex-launch:send-prompt-error", { workspacePath, error: message });
    publishCodexStatus(window, { state: "failed", workspacePath, error: message });
    throw error;
  }
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
