import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveCrashDiagnosticsPaths,
  serializeCrashError,
  writePetCrashEvent,
} from "./crashDiagnostics";

describe("Pet crash diagnostics", () => {
  it("defaults crash logs and dumps under the desktop-pet working directory", () => {
    const paths = resolveCrashDiagnosticsPaths({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      env: {},
    });

    expect(paths.eventsLogPath).toBe(
      path.resolve("D:\\workspace\\MMD project\\desktop-pet\\.codex-pet\\logs\\crash-events.ndjson"),
    );
    expect(paths.crashDumpsDir).toBe(
      path.resolve("D:\\workspace\\MMD project\\desktop-pet\\.codex-pet\\crash-dumps"),
    );
  });

  it("honors explicit crash diagnostics paths from env", () => {
    const paths = resolveCrashDiagnosticsPaths({
      cwd: "D:\\workspace\\MMD project\\desktop-pet",
      env: {
        MMD_PET_CRASH_EVENTS_LOG: "D:\\tmp\\pet-crashes.ndjson",
        MMD_PET_CRASH_DUMPS_DIR: "D:\\tmp\\pet-dumps",
      },
    });

    expect(paths.eventsLogPath).toBe(path.resolve("D:\\tmp\\pet-crashes.ndjson"));
    expect(paths.crashDumpsDir).toBe(path.resolve("D:\\tmp\\pet-dumps"));
  });

  it("appends crash events as NDJSON and creates the parent directory", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "pet-crash-"));
    try {
      const eventsLogPath = path.join(tempDir, "nested", "crash-events.ndjson");

      writePetCrashEvent({
        eventsLogPath,
        type: "renderer:gone",
        payload: { reason: "crashed", exitCode: 133 },
        now: () => new Date("2026-06-05T06:00:00.000Z"),
      });

      const event = JSON.parse(readFileSync(eventsLogPath, "utf8").trim()) as Record<string, unknown>;
      expect(event).toMatchObject({
        at: "2026-06-05T06:00:00.000Z",
        type: "renderer:gone",
        reason: "crashed",
        exitCode: 133,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("serializes Error objects and non-error reasons for crash logs", () => {
    const error = new Error("boom");
    const serializedError = serializeCrashError(error);
    const serializedReason = serializeCrashError({ code: "GPU_LOST" });

    expect(serializedError).toMatchObject({ name: "Error", message: "boom" });
    expect(String(serializedError.stack)).toContain("boom");
    expect(serializedReason).toEqual({ message: '{"code":"GPU_LOST"}' });
  });
});
