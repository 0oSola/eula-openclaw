import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Electron preload module format", () => {
  it("uses a CommonJS preload file because Electron loads preload scripts outside ESM", () => {
    const electronDir = path.resolve(__dirname);
    const mainSource = readFileSync(path.join(electronDir, "main.ts"), "utf8");

    expect(existsSync(path.join(electronDir, "preload.cts"))).toBe(true);
    expect(mainSource).toContain('path.join(__dirname, "preload.cjs")');
  });

  it("exposes a prompt sender through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");

    expect(preloadSource).toContain("prompt:");
    expect(preloadSource).toContain('"pet:prompt:send"');
  });

  it("exposes VSCode focus through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(preloadSource).toContain("vscode:");
    expect(preloadSource).toContain('"pet:vscode:focus"');
    expect(mainSource).toContain('"pet:vscode:focus"');
  });

  it("exposes API runtime retry and change events through the protected preload bridge", () => {
    const preloadSource = readFileSync(path.resolve(__dirname, "preload.cts"), "utf8");

    expect(preloadSource).toContain("apiRuntime:");
    expect(preloadSource).toContain('"pet:api-runtime:get"');
    expect(preloadSource).toContain('"pet:api-runtime:retry"');
    expect(preloadSource).toContain('"pet:api-runtime:changed"');
  });
});
