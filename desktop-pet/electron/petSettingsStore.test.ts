import { describe, expect, it, vi } from "vitest";

import { readPetSettings, resolveSelectedWorkspacePath, writePetSettings, writeSelectedWorkspacePath } from "./petSettingsStore.js";

describe("desktop pet settings store", () => {
  function createMemoryFs(initialFiles: Record<string, string> = {}) {
    const files = new Map(Object.entries(initialFiles));
    return {
      fs: {
        existsSync: vi.fn((filePath: string) => files.has(filePath)),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn((filePath: string) => files.get(filePath) ?? ""),
        writeFileSync: vi.fn((filePath: string, value: string) => {
          files.set(filePath, value);
        }),
      },
      files,
    };
  }

  it("resolves the persisted workspace before the environment default", () => {
    const memory = createMemoryFs({
      "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json": JSON.stringify({
        selectedWorkspacePath: "D:\\workspace\\Selected project",
      }),
    });

    expect(
      resolveSelectedWorkspacePath({
        cwd: "D:\\workspace\\MMD project\\desktop-pet",
        env: { MMD_PET_WORKSPACE_PATH: "D:\\workspace\\Env project" },
        userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
        fs: memory.fs,
      }),
    ).toBe("D:\\workspace\\Selected project");
  });

  it("falls back to the launcher workspace when settings are missing", () => {
    const memory = createMemoryFs();

    expect(
      resolveSelectedWorkspacePath({
        cwd: "D:\\workspace\\MMD project\\desktop-pet",
        env: {},
        userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
        fs: memory.fs,
      }),
    ).toBe("D:\\workspace\\MMD project");
  });

  it("writes a selected workspace into Electron userData", () => {
    const memory = createMemoryFs();

    const settings = writeSelectedWorkspacePath({
      workspacePath: "D:\\workspace\\MMD project",
      userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
      fs: memory.fs,
    });

    expect(settings.selectedWorkspacePath).toBe("D:\\workspace\\MMD project");
    expect(memory.fs.mkdirSync).toHaveBeenCalledWith("C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet", {
      recursive: true,
    });
    expect(JSON.parse(memory.files.get("C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json") ?? "{}")).toEqual({
      selectedWorkspacePath: "D:\\workspace\\MMD project",
    });
  });

  it("reads persisted menu language, notification detail, always-on-top, and fixed window bounds", () => {
    const memory = createMemoryFs({
      "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json": JSON.stringify({
        selectedWorkspacePath: "D:\\workspace\\MMD project",
        menuLanguage: "zh-CN",
        notificationProfile: "high",
        alwaysOnTop: false,
        windowBounds: { x: 104, y: 208, width: 999, height: 111 },
      }),
    });

    expect(
      readPetSettings({
        userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
        fs: memory.fs,
      }),
    ).toEqual({
      selectedWorkspacePath: "D:\\workspace\\MMD project",
      menuLanguage: "zh-CN",
      notificationProfile: "high",
      alwaysOnTop: false,
      windowBounds: { x: 104, y: 208, width: 320, height: 420 },
    });
  });

  it("migrates legacy workspace-only settings without inventing new preference values", () => {
    const memory = createMemoryFs({
      "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json": JSON.stringify({
        selectedWorkspacePath: "D:\\workspace\\MMD project",
      }),
    });

    expect(
      readPetSettings({
        userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
        fs: memory.fs,
      }),
    ).toEqual({
      selectedWorkspacePath: "D:\\workspace\\MMD project",
    });
  });

  it("drops invalid preference values while keeping valid persisted settings", () => {
    const memory = createMemoryFs({
      "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json": JSON.stringify({
        selectedWorkspacePath: "D:\\workspace\\MMD project",
        menuLanguage: "fr",
        notificationProfile: "verbose",
        alwaysOnTop: "yes",
        windowBounds: { x: "left", y: 10, width: 320, height: 420 },
      }),
    });

    expect(
      readPetSettings({
        userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
        fs: memory.fs,
      }),
    ).toEqual({
      selectedWorkspacePath: "D:\\workspace\\MMD project",
    });
  });

  it("merges selected workspace writes with existing persisted preferences", () => {
    const memory = createMemoryFs({
      "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json": JSON.stringify({
        menuLanguage: "zh-CN",
        notificationProfile: "low",
        alwaysOnTop: false,
        windowBounds: { x: 12, y: 34, width: 320, height: 420 },
      }),
    });

    const settings = writeSelectedWorkspacePath({
      workspacePath: "D:\\workspace\\MMD project",
      userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
      fs: memory.fs,
    });

    expect(settings).toEqual({
      selectedWorkspacePath: "D:\\workspace\\MMD project",
      menuLanguage: "zh-CN",
      notificationProfile: "low",
      alwaysOnTop: false,
      windowBounds: { x: 12, y: 34, width: 320, height: 420 },
    });
    expect(JSON.parse(memory.files.get("C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json") ?? "{}")).toEqual(settings);
  });

  it("merges preference writes and normalizes saved window bounds to the fixed pet size", () => {
    const memory = createMemoryFs({
      "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json": JSON.stringify({
        selectedWorkspacePath: "D:\\workspace\\MMD project",
      }),
    });

    const settings = writePetSettings({
      userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
      fs: memory.fs,
      patch: {
        menuLanguage: "en",
        notificationProfile: "high",
        alwaysOnTop: false,
        windowBounds: { x: 450, y: 260, width: 10, height: 20 },
      },
    });

    expect(settings).toEqual({
      selectedWorkspacePath: "D:\\workspace\\MMD project",
      menuLanguage: "en",
      notificationProfile: "high",
      alwaysOnTop: false,
      windowBounds: { x: 450, y: 260, width: 320, height: 420 },
    });
  });

  it("ignores corrupt settings files", () => {
    const memory = createMemoryFs({
      "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet\\pet-settings.json": "{",
    });

    expect(
      readPetSettings({
        userDataPath: "C:\\Users\\KSG\\AppData\\Roaming\\mmd-codex-desktop-pet",
        fs: memory.fs,
      }),
    ).toEqual({});
  });
});
