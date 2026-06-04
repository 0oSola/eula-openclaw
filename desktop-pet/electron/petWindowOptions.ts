import type { BrowserWindowConstructorOptions } from "electron";

import {
  PET_WINDOW_SETTINGS_HEIGHT,
  PET_WINDOW_SETTINGS_WIDTH,
  type PetWindowBounds,
  normalizePetWindowBounds,
} from "./petSettingsStore.js";

const PET_WINDOW_WIDTH = PET_WINDOW_SETTINGS_WIDTH;
const PET_WINDOW_HEIGHT = PET_WINDOW_SETTINGS_HEIGHT;

export function createPetBrowserWindowOptions(
  preloadPath: string,
  savedBounds?: PetWindowBounds,
): BrowserWindowConstructorOptions {
  const bounds = normalizePetWindowBounds(savedBounds);
  return {
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    minWidth: PET_WINDOW_WIDTH,
    minHeight: PET_WINDOW_HEIGHT,
    maxWidth: PET_WINDOW_WIDTH,
    maxHeight: PET_WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}
