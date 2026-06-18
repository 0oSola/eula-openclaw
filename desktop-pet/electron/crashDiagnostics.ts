import fs from "node:fs";
import path from "node:path";

type CrashDiagnosticsEnv = Record<string, string | undefined>;

export type CrashDiagnosticsPaths = {
  eventsLogPath: string;
  crashDumpsDir: string;
};

export type CrashEventPayload = Record<string, unknown>;

const MAX_DIAGNOSTIC_TEXT_LENGTH = 4000;

function cleanPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function truncateDiagnosticText(value: string): string {
  if (value.length <= MAX_DIAGNOSTIC_TEXT_LENGTH) return value;
  return `${value.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH - 3)}...`;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toJsonSafe(value: unknown): unknown {
  if (value instanceof Error) return serializeCrashError(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonSafe(item)]),
    );
  }
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  return value;
}

export function resolveCrashDiagnosticsPaths(options: {
  cwd: string;
  env: CrashDiagnosticsEnv;
}): CrashDiagnosticsPaths {
  return {
    eventsLogPath:
      cleanPath(options.env.MMD_PET_CRASH_EVENTS_LOG) ??
      path.resolve(options.cwd, ".codex-pet", "logs", "crash-events.ndjson"),
    crashDumpsDir:
      cleanPath(options.env.MMD_PET_CRASH_DUMPS_DIR) ??
      path.resolve(options.cwd, ".codex-pet", "crash-dumps"),
  };
}

export function serializeCrashError(error: unknown): CrashEventPayload {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncateDiagnosticText(error.message),
      stack: error.stack ? truncateDiagnosticText(error.stack) : undefined,
    };
  }
  return {
    message: truncateDiagnosticText(stringifyUnknown(error)),
  };
}

export function writePetCrashEvent(options: {
  eventsLogPath: string;
  type: string;
  payload?: CrashEventPayload;
  now?: () => Date;
}) {
  const at = (options.now ?? (() => new Date()))().toISOString();
  const payload = toJsonSafe(options.payload ?? {}) as CrashEventPayload;
  const event = { at, type: options.type, ...payload };

  fs.mkdirSync(path.dirname(options.eventsLogPath), { recursive: true });
  fs.appendFileSync(options.eventsLogPath, `${JSON.stringify(event)}\n`, "utf8");
}
