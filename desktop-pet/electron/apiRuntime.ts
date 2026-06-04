import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import nodeFs from "node:fs";
import path from "node:path";

type RuntimeEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;
type RuntimeFs = Pick<typeof nodeFs, "mkdirSync" | "openSync">;
type RuntimeResponse = Pick<Response, "ok" | "status">;
type FetchFn = (url: string) => Promise<RuntimeResponse>;
type SpawnOptions = {
  cwd: string;
  detached: true;
  shell: true;
  stdio: ["ignore", number, number];
  windowsHide: true;
};
type SpawnFn = (command: string, args: [], options: SpawnOptions) => Pick<ChildProcess, "unref">;

export type ApiRuntimeFailureReason = "fetch_failed" | "bad_status";
export type ApiRuntimeAutostartReason = "disabled" | "missing_command" | "spawn_failed";

export type ApiRuntimeAutostartStatus = {
  enabled: boolean;
  attempted: boolean;
  reason?: ApiRuntimeAutostartReason;
  command?: string;
  error?: string;
};

export type ApiRuntimeLogPaths = {
  stdout: string;
  stderr: string;
};

export type ApiRuntimeStatus =
  | {
      state: "available";
      available: true;
      apiBaseUrl: string;
      healthUrl: string;
      attempts: number;
      started: boolean;
      checkedAt: string;
      autostart: ApiRuntimeAutostartStatus;
      logPaths?: ApiRuntimeLogPaths;
      statusCode?: number;
    }
  | {
      state: "unavailable";
      available: false;
      apiBaseUrl: string;
      healthUrl: string;
      reason: ApiRuntimeFailureReason;
      attempts: number;
      started: false;
      checkedAt: string;
      autostart: ApiRuntimeAutostartStatus;
      logPaths?: ApiRuntimeLogPaths;
      statusCode?: number;
      error: string;
    };

export type EnsureApiRuntimeOptions = {
  apiBaseUrl?: string;
  cwd?: string;
  env?: RuntimeEnv;
  fetch?: FetchFn;
  spawn?: SpawnFn;
  fs?: RuntimeFs;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
  retryDelayMs?: number;
  maxAttempts?: number;
};

type HealthProbeResult =
  | { ok: true; statusCode?: number }
  | { ok: false; reason: ApiRuntimeFailureReason; error: string; statusCode?: number };

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
const DEFAULT_RETRY_DELAY_MS = 750;
const DEFAULT_MAX_ATTEMPTS_AFTER_START = 5;

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/, "") || DEFAULT_API_BASE_URL;
}

export function resolveApiHealthUrl(apiBaseUrl: string): string {
  return `${normalizeApiBaseUrl(apiBaseUrl)}/healthz`;
}

function enabledByEnv(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function runtimeLogPaths(cwd: string, env: RuntimeEnv): ApiRuntimeLogPaths {
  const logDir = env.MMD_PET_API_LOG_DIR?.trim() || path.join(cwd, ".codex-pet", "api-runtime");
  return {
    stdout: path.join(logDir, "api-runtime.out.log"),
    stderr: path.join(logDir, "api-runtime.err.log"),
  };
}

async function probeHealth(fetch: FetchFn, healthUrl: string): Promise<HealthProbeResult> {
  try {
    const response = await fetch(healthUrl);
    if (!response.ok) {
      return {
        ok: false,
        reason: "bad_status",
        statusCode: response.status,
        error: `API health check returned ${response.status}`,
      };
    }
    return { ok: true, statusCode: response.status };
  } catch (error) {
    return {
      ok: false,
      reason: "fetch_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function unavailableStatus(options: {
  apiBaseUrl: string;
  healthUrl: string;
  checkedAt: string;
  attempts: number;
  failure: Extract<HealthProbeResult, { ok: false }>;
  autostart: ApiRuntimeAutostartStatus;
  logPaths?: ApiRuntimeLogPaths;
}): ApiRuntimeStatus {
  return {
    state: "unavailable",
    available: false,
    apiBaseUrl: options.apiBaseUrl,
    healthUrl: options.healthUrl,
    reason: options.failure.reason,
    attempts: options.attempts,
    started: false,
    checkedAt: options.checkedAt,
    autostart: options.autostart,
    logPaths: options.logPaths,
    statusCode: options.failure.statusCode,
    error: options.failure.error,
  };
}

export async function ensureApiRuntime(options: EnsureApiRuntimeOptions = {}): Promise<ApiRuntimeStatus> {
  const env = options.env ?? process.env;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl ?? env.MMD_PET_API_BASE_URL ?? DEFAULT_API_BASE_URL);
  const healthUrl = resolveApiHealthUrl(apiBaseUrl);
  const fetch = options.fetch ?? globalThis.fetch;
  const spawn = options.spawn ?? nodeSpawn;
  const fs = options.fs ?? nodeFs;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const autostartEnabled = enabledByEnv(env.MMD_PET_API_AUTOSTART);
  const checkedAt = now().toISOString();
  const initial = await probeHealth(fetch, healthUrl);

  if (initial.ok) {
    return {
      state: "available",
      available: true,
      apiBaseUrl,
      healthUrl,
      attempts: 1,
      started: false,
      checkedAt,
      statusCode: initial.statusCode,
      autostart: { enabled: autostartEnabled, attempted: false, reason: autostartEnabled ? undefined : "disabled" },
    };
  }

  if (!autostartEnabled) {
    return unavailableStatus({
      apiBaseUrl,
      healthUrl,
      checkedAt,
      attempts: 1,
      failure: initial,
      autostart: { enabled: false, attempted: false, reason: "disabled" },
    });
  }

  const command = env.MMD_PET_API_START_COMMAND?.trim();
  if (!command) {
    return unavailableStatus({
      apiBaseUrl,
      healthUrl,
      checkedAt,
      attempts: 1,
      failure: initial,
      autostart: { enabled: true, attempted: false, reason: "missing_command" },
    });
  }

  let logPaths: ApiRuntimeLogPaths | undefined;
  try {
    logPaths = runtimeLogPaths(cwd, env);
    const logDir = path.dirname(logPaths.stdout);
    fs.mkdirSync(logDir, { recursive: true });
    const stdoutFd = fs.openSync(logPaths.stdout, "a");
    const stderrFd = fs.openSync(logPaths.stderr, "a");
    const child = spawn(command, [], {
      cwd,
      detached: true,
      shell: true,
      stdio: ["ignore", stdoutFd, stderrFd],
      windowsHide: true,
    });
    child.unref?.();
  } catch (error) {
    return unavailableStatus({
      apiBaseUrl,
      healthUrl,
      checkedAt,
      attempts: 1,
      failure: {
        ok: false,
        reason: "fetch_failed",
        error: error instanceof Error ? error.message : String(error),
      },
      autostart: {
        enabled: true,
        attempted: true,
        reason: "spawn_failed",
        command,
        error: error instanceof Error ? error.message : String(error),
      },
      logPaths,
    });
  }

  let lastFailure = initial;
  const maxAttempts = Math.max(2, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS_AFTER_START);
  for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
    await sleep(retryDelayMs);
    const next = await probeHealth(fetch, healthUrl);
    if (next.ok) {
      return {
        state: "available",
        available: true,
        apiBaseUrl,
        healthUrl,
        attempts: attempt,
        started: true,
        checkedAt,
        statusCode: next.statusCode,
        autostart: { enabled: true, attempted: true, command },
        logPaths,
      };
    }
    lastFailure = next;
  }

  return unavailableStatus({
    apiBaseUrl,
    healthUrl,
    checkedAt,
    attempts: maxAttempts,
    failure: lastFailure,
    autostart: { enabled: true, attempted: true, command },
    logPaths,
  });
}
