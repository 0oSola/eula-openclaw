import { BrowserWindow, app, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const devRendererUrl =
  process.env.MMD_PET_RENDERER_URL ?? `http://127.0.0.1:${process.env.MMD_PET_DEV_PORT ?? "5174"}`;

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
  if (isDev) {
    await window.loadURL(devRendererUrl);
  } else {
    await window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

ipcMain.handle("pet:runtime-info", () => ({
  apiBaseUrl: "http://127.0.0.1:8000",
}));

app.whenReady().then(createPetWindow);
app.on("window-all-closed", () => app.quit());
