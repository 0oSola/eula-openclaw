import { BrowserWindow, Menu, app, ipcMain, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toWindowMenuPosition, type ScreenPoint } from "./contextMenuPosition.js";
import {
  DEFAULT_INTERACTION_MODE,
  INTERACTION_MODE_LABELS,
  type PetInteractionMode,
  normalizeInteractionMode,
} from "./interactionMode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const devRendererUrl =
  process.env.MMD_PET_RENDERER_URL ?? `http://127.0.0.1:${process.env.MMD_PET_DEV_PORT ?? "5174"}`;
let currentInteractionMode: PetInteractionMode = DEFAULT_INTERACTION_MODE;

function publishInteractionMode(window: BrowserWindow, mode: PetInteractionMode) {
  currentInteractionMode = mode;
  window.webContents.send("pet:interaction-mode:changed", currentInteractionMode);
}

function openPetContextMenu(window: BrowserWindow, position?: ScreenPoint) {
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

app.whenReady().then(createPetWindow);
app.on("window-all-closed", () => app.quit());
