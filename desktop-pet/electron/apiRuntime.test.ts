import { describe, expect, it, vi } from "vitest";

import { ensureApiRuntime } from "./apiRuntime";

describe("desktop pet API runtime helper", () => {
  function createRuntimeFs() {
    return {
      mkdirSync: vi.fn(),
      openSync: vi.fn((filePath: string) => (filePath.endsWith(".out.log") ? 101 : 102)),
    };
  }

  it("returns structured unavailable status when health fetch fails and autostart is disabled", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const spawn = vi.fn();

    const result = await ensureApiRuntime({
      apiBaseUrl: "http://127.0.0.1:8000",
      env: {},
      fetch,
      spawn,
      fs: createRuntimeFs(),
      now: () => new Date("2026-06-04T00:00:00.000Z"),
      sleep: async () => undefined,
    });

    expect(result).toMatchObject({
      state: "unavailable",
      available: false,
      apiBaseUrl: "http://127.0.0.1:8000",
      healthUrl: "http://127.0.0.1:8000/healthz",
      reason: "fetch_failed",
      attempts: 1,
      started: false,
      checkedAt: "2026-06-04T00:00:00.000Z",
    });
    expect(result.error).toContain("fetch failed");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("treats non-ok health responses as unavailable without spawning by default", async () => {
    const result = await ensureApiRuntime({
      apiBaseUrl: "http://127.0.0.1:8000/",
      env: {},
      fetch: vi.fn(async () => ({ ok: false, status: 503 })),
      spawn: vi.fn(),
      fs: createRuntimeFs(),
      now: () => new Date("2026-06-04T00:00:01.000Z"),
      sleep: async () => undefined,
    });

    expect(result).toMatchObject({
      state: "unavailable",
      available: false,
      healthUrl: "http://127.0.0.1:8000/healthz",
      reason: "bad_status",
      statusCode: 503,
      attempts: 1,
      started: false,
    });
  });

  it("spawns the configured API start command hidden in the background and retries health", async () => {
    const runtimeFs = createRuntimeFs();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connect ECONNREFUSED 127.0.0.1:8000"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const sleep = vi.fn(async () => undefined);

    const result = await ensureApiRuntime({
      apiBaseUrl: "http://127.0.0.1:8000",
      cwd: "D:\\workspace\\MMD project",
      env: {
        MMD_PET_API_AUTOSTART: "1",
        MMD_PET_API_START_COMMAND: '"D:\\workspace\\MMD project\\scripts\\start api.ps1" --port 8000',
        MMD_PET_API_LOG_DIR: "D:\\workspace\\MMD project\\.codex-pet\\api logs",
      },
      platform: "win32",
      fetch,
      spawn,
      fs: runtimeFs,
      now: () => new Date("2026-06-04T00:00:02.000Z"),
      sleep,
      retryDelayMs: 25,
      maxAttempts: 2,
    });

    expect(runtimeFs.mkdirSync).toHaveBeenCalledWith("D:\\workspace\\MMD project\\.codex-pet\\api logs", {
      recursive: true,
    });
    expect(runtimeFs.openSync).toHaveBeenCalledWith(
      "D:\\workspace\\MMD project\\.codex-pet\\api logs\\api-runtime.out.log",
      "a",
    );
    expect(runtimeFs.openSync).toHaveBeenCalledWith(
      "D:\\workspace\\MMD project\\.codex-pet\\api logs\\api-runtime.err.log",
      "a",
    );
    expect(spawn).toHaveBeenCalledWith(
      '"D:\\workspace\\MMD project\\scripts\\start api.ps1" --port 8000',
      [],
      {
        cwd: "D:\\workspace\\MMD project",
        detached: true,
        shell: true,
        stdio: ["ignore", 101, 102],
        windowsHide: true,
      },
    );
    expect(sleep).toHaveBeenCalledWith(25);
    expect(result).toMatchObject({
      state: "available",
      available: true,
      apiBaseUrl: "http://127.0.0.1:8000",
      attempts: 2,
      started: true,
      logPaths: {
        stdout: "D:\\workspace\\MMD project\\.codex-pet\\api logs\\api-runtime.out.log",
        stderr: "D:\\workspace\\MMD project\\.codex-pet\\api logs\\api-runtime.err.log",
      },
    });
  });

  it("reports autostart as not configured when enabled without a start command", async () => {
    const result = await ensureApiRuntime({
      apiBaseUrl: "http://127.0.0.1:8000",
      env: { MMD_PET_API_AUTOSTART: "1" },
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      spawn: vi.fn(),
      fs: createRuntimeFs(),
      now: () => new Date("2026-06-04T00:00:03.000Z"),
      sleep: async () => undefined,
    });

    expect(result).toMatchObject({
      state: "unavailable",
      available: false,
      reason: "fetch_failed",
      started: false,
      autostart: {
        enabled: true,
        attempted: false,
        reason: "missing_command",
      },
    });
  });
});
