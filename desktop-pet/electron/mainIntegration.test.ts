import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron main runtime integration", () => {
  it("checks API runtime availability during startup and keeps fallback state current", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('from "./apiRuntime.js"');
    expect(mainSource).toContain("ensureApiRuntime({");
    expect(mainSource).toContain("lastApiAvailable = runtimeStatus.available");
    expect(mainSource).toContain("currentApiRuntimeStatus = runtimeStatus");
    expect(mainSource).toContain('"pet:api-runtime:changed"');
    expect(mainSource).toContain('"api-runtime:status"');
  });

  it("exposes API runtime retry and status through IPC", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("apiRuntimeStatus: currentApiRuntimeStatus");
    expect(mainSource).toContain('"pet:api-runtime:get"');
    expect(mainSource).toContain('"pet:api-runtime:retry"');
  });

  it("applies interaction-mode menu actions in the main process before notifying the renderer", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('if (action.type === "interaction-mode")');
    expect(mainSource).toContain("publishInteractionMode(window, normalizeInteractionMode(action.mode))");
    expect(mainSource).toContain('window.webContents.send("pet:menu:action", { type: "interaction-mode", mode: currentInteractionMode })');
  });

  it("redacts main-process session title fallbacks before publishing status or payloads", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("function redactSensitiveText");
    expect(mainSource).toContain("return truncateText(redactSensitiveText(rawTitle), 80)");
  });
});
