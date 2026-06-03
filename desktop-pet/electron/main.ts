import { BrowserWindow, Menu, app, ipcMain, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_INTERACTION_MODE,
  INTERACTION_MODE_LABELS,
  type PetInteractionMode,
  normalizeInteractionMode,
} from "./interactionMode.js";
import { getDraggedWindowPosition, type WindowDragState } from "./windowDrag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const devRendererUrl =
  process.env.MMD_PET_RENDERER_URL ?? `http://127.0.0.1:${process.env.MMD_PET_DEV_PORT ?? "5174"}`;
let currentInteractionMode: PetInteractionMode = DEFAULT_INTERACTION_MODE;
let activeWindowDrag: (WindowDragState & { windowId: number }) | null = null;

function publishInteractionMode(window: BrowserWindow, mode: PetInteractionMode) {
  currentInteractionMode = mode;
  window.webContents.send("pet:interaction-mode:changed", currentInteractionMode);
}

function openPetContextMenu(window: BrowserWindow) {
  const menu = Menu.buildFromTemplate([
    {
      label: INTERACTION_MODE_LABELS["window-drag"],
      type: "radio",
      checked: currentInteractionMode === "window-drag",
      click: () => publishInteractionMode(window, "window-drag"),
    },
    {
      label: INTERACTION_MODE_LABELS["camera-adjust"],
      type: "radio",
      checked: currentInteractionMode === "camera-adjust",
      click: () => publishInteractionMode(window, "camera-adjust"),
    },
  ]);
  menu.popup({ window });
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
  window.webContents.on("context-menu", () => openPetContextMenu(window));
  if (isDev) {
    await window.loadURL(devRendererUrl);
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("pet:runtime-info", () => ({
  apiBaseUrl: "http://127.0.0.1:8000",
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

ipcMain.handle("pet:window-drag:start", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || currentInteractionMode !== "window-drag") return false;
  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  activeWindowDrag = {
    windowId: window.id,
    startCursor: { x: cursor.x, y: cursor.y },
    startWindow: { x: bounds.x, y: bounds.y },
  };
  return true;
});

ipcMain.handle("pet:window-drag:move", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !activeWindowDrag || activeWindowDrag.windowId !== window.id) return null;
  const cursor = screen.getCursorScreenPoint();
  const nextPosition = getDraggedWindowPosition(activeWindowDrag, { x: cursor.x, y: cursor.y });
  window.setPosition(nextPosition.x, nextPosition.y, false);
  return nextPosition;
});

ipcMain.handle("pet:window-drag:end", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !activeWindowDrag || activeWindowDrag.windowId !== window.id) return false;
  activeWindowDrag = null;
  return true;
});

app.whenReady().then(createPetWindow);
app.on("window-all-closed", () => app.quit());
