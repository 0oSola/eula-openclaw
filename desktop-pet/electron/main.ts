import { BrowserWindow, Menu, app, ipcMain, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toWindowMenuPosition, type ScreenPoint } from "./contextMenuPosition.js";
import {
  DEFAULT_INTERACTION_MODE,
  type PetInteractionMode,
  normalizeInteractionMode,
} from "./interactionMode.js";
import {
  buildPetMenuModel,
  normalizeNotificationProfile,
  type NotificationProfile,
  type PetMenuAction,
  type PetMenuItemModel,
  type PetMenuSession,
} from "./petMenuModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const devRendererUrl =
  process.env.MMD_PET_RENDERER_URL ?? `http://127.0.0.1:${process.env.MMD_PET_DEV_PORT ?? "5174"}`;
const apiBaseUrl = process.env.MMD_PET_API_BASE_URL ?? "http://127.0.0.1:8000";
const menuUserId = process.env.MMD_PET_USER_ID ?? "admin-1";
let currentInteractionMode: PetInteractionMode = DEFAULT_INTERACTION_MODE;
let currentNotificationProfile: NotificationProfile = "medium";
let lastApiAvailable = true;

function publishInteractionMode(window: BrowserWindow, mode: PetInteractionMode) {
  currentInteractionMode = mode;
  window.webContents.send("pet:interaction-mode:changed", currentInteractionMode);
}

function dispatchMenuAction(window: BrowserWindow, action: PetMenuAction) {
  if (action.type === "interaction-mode") {
    publishInteractionMode(window, action.mode);
    return;
  }
  if (action.type === "notification-detail") {
    currentNotificationProfile = normalizeNotificationProfile(action.profile);
  }
  if (action.type === "close") {
    window.close();
    return;
  }
  window.webContents.send("pet:menu:action", action);
}

function toElectronMenuTemplate(window: BrowserWindow, items: PetMenuItemModel[]): Electron.MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.type === "separator") {
      return { type: "separator" };
    }
    return {
      label: item.label,
      type: item.type === "radio" ? "radio" : "normal",
      checked: item.checked,
      enabled: item.enabled !== false,
      submenu: item.submenu ? toElectronMenuTemplate(window, item.submenu) : undefined,
      click: item.action ? () => dispatchMenuAction(window, item.action!) : undefined,
    };
  });
}

async function listRecentSessions(): Promise<PetMenuSession[]> {
  try {
    const response = await fetch(`${apiBaseUrl}/desktop-pet/sessions?limit=10`, {
      headers: { "x-user-id": menuUserId },
    });
    if (!response.ok) throw new Error(`sessions failed: ${response.status}`);
    const payload = (await response.json()) as { sessions?: PetMenuSession[] };
    lastApiAvailable = true;
    return payload.sessions || [];
  } catch {
    lastApiAvailable = false;
    return [];
  }
}

async function openPetContextMenu(window: BrowserWindow, position?: ScreenPoint) {
  const sessions = await listRecentSessions();
  const menu = Menu.buildFromTemplate(
    toElectronMenuTemplate(
      window,
      buildPetMenuModel({
        interactionMode: currentInteractionMode,
        notificationProfile: currentNotificationProfile,
        sessions,
        apiAvailable: lastApiAvailable,
      }),
    ),
  );
  menu.popup({ window, ...(position ?? {}) });
}

async function createPetWindow() {
  const window = new BrowserWindow({
    width: 320,
    height: 420,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setAlwaysOnTop(true, "floating");
  window.on("system-context-menu", (event, point) => {
    event.preventDefault();
    openPetContextMenu(window, toWindowMenuPosition(screen.screenToDipPoint(point), window.getBounds()));
  });
  window.webContents.on("context-menu", (_event, params) => openPetContextMenu(window, { x: params.x, y: params.y }));
  if (isDev) {
    await window.loadURL(devRendererUrl);
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("pet:runtime-info", () => ({
  apiBaseUrl,
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

ipcMain.handle("pet:menu:open-context", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  await openPetContextMenu(window);
  return true;
});

ipcMain.handle("pet:notification-profile:get", () => currentNotificationProfile);

app.whenReady().then(createPetWindow);
app.on("window-all-closed", () => app.quit());
