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

  it("shows active workspaces in the context menu and switches the selected workspace from that submenu", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("buildActiveWorkspaceSummaries");
    expect(mainSource).toContain("activeWorkspaces: buildActiveWorkspaceSummaries(sessions)");
    expect(mainSource).toContain('if (action.type === "switch-workspace")');

    const switchBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "switch-workspace")'),
      mainSource.indexOf('if (action.type === "interaction-mode")'),
    );
    expect(switchBlock).toContain("writeSelectedWorkspacePath({");
    expect(switchBlock).toContain("workspacePath: action.workspacePath");
    expect(switchBlock).toContain('window.webContents.send("pet:menu:action", { type: "workspace-selected", workspacePath })');
  });

  it("focuses active sessions without running the restore-session launcher", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain('if (action.type === "focus-active-session")');
    expect(mainSource).toContain("focusActiveSessionWindow(window, action.petSessionId)");
    expect(mainSource).toContain('"pet:sessions:focus-active"');
    expect(mainSource).toContain("writeVscodeSessionWindowMarker");
    expect(mainSource).toContain("resolveVscodeSessionWindow");

    const focusActiveBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "focus-active-session")'),
      mainSource.indexOf('if (action.type === "more-sessions")'),
    );
    expect(focusActiveBlock).toContain("focusVscodeWorkspace({ workspacePath, userDataDir");
    expect(focusActiveBlock).not.toContain("resumeCodexSession(");
    expect(focusActiveBlock).not.toContain("resumeClaudeSession(");
    const resolveActiveBlock = mainSource.slice(
      mainSource.indexOf("function resolveActiveSessionWindow"),
      mainSource.indexOf("function focusActiveSessionWindow"),
    );
    expect(resolveActiveBlock).not.toContain("activeSessionWindowsByWorkspace.get");
    expect(resolveActiveBlock).toContain("resolveVscodeSessionWindow({");
    expect(resolveActiveBlock).toContain('if (resolvedWindow.source === "workspace-storage")');
    expect(resolveActiveBlock).toContain("focus-active-session-workspace-fallback");
    expect(mainSource).toContain("Active task window metadata is unavailable");
  });

  it("redacts main-process session title fallbacks before publishing status or payloads", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("function redactSensitiveText");
    expect(mainSource).toContain("return truncateText(redactSensitiveText(rawTitle), 80)");
  });

  it("prefers the Codex relay for Pet prompts and keeps the VSCode terminal fallback", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("CodexInteractiveRelayClient");
    expect(mainSource).toContain("shouldUseCodexRelay()");
    expect(mainSource).toContain("codexRelayForWindow(window).sendPrompt");
    expect(mainSource).toContain('"codex-relay:send-prompt-fallback"');
    // Prompt fallback no longer injects text through the helper terminal: when
    // the relay is unavailable, the prompt is surfaced as a copy-able command.
    expect(mainSource).toContain("commandLine: trimmedPrompt");
  });

  it("focuses VSCode without overwriting the current Codex status", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const menuFocusBlock = mainSource.slice(
      mainSource.indexOf('if (action.type === "focus-vscode")'),
      mainSource.indexOf('if (action.type === "notification-detail")'),
    );
    const ipcFocusBlock = mainSource.slice(
      mainSource.indexOf('ipcMain.handle("pet:vscode:focus"'),
      mainSource.indexOf('ipcMain.handle("pet:sessions:restore"'),
    );

    expect(menuFocusBlock).toContain("focusVscodeWorkspace({ workspacePath })");
    expect(ipcFocusBlock).toContain("focusVscodeWorkspace({ workspacePath })");
    expect(menuFocusBlock).not.toContain('state: "vscode-opened"');
    expect(ipcFocusBlock).not.toContain('state: "vscode-opened"');
  });

  it("installs crash diagnostics for renderer, child process, and main-process failures", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const crashDiagnosticsSource = readFileSync(path.resolve(__dirname, "crashDiagnostics.ts"), "utf8");

    expect(mainSource).toContain("crashReporter");
    expect(mainSource).toContain("installPetCrashDiagnostics();");
    expect(mainSource).toContain('app.on("render-process-gone"');
    expect(mainSource).toContain('app.on("child-process-gone"');
    expect(mainSource).toContain('process.on("uncaughtExceptionMonitor"');
    expect(mainSource).toContain('process.on("unhandledRejection"');
    expect(mainSource).toContain('ipcMain.on("pet:renderer-error"');
    expect(mainSource).toContain("resolveCrashDiagnosticsPaths");
    expect(crashDiagnosticsSource).toContain("crash-events.ndjson");
  });

  it("keeps watching VSCode terminal Codex sessions after launch so output reaches the Pet status card", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    expect(mainSource).toContain("const CODEX_SESSION_WATCH_INTERVAL_MS");
    expect(mainSource).toContain("const CODEX_SESSION_WATCH_MAX_DURATION_MS");
    expect(mainSource).toContain("function startCodexSessionOutputWatch");
    expect(mainSource).toContain("stopCodexSessionOutputWatch(window)");
    expect(mainSource).toContain('"codex-session:watch-stop"');
    expect(mainSource).toContain("startCodexSessionOutputWatch(window, result.workspacePath, {");
    expect(mainSource).toContain("startCodexSessionOutputWatch(window, result.workspacePath, {");
    expect(mainSource).toContain("codexSessionId,");
  });

  it("opens each session in a fresh VSCode window and surfaces the command to copy", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");

    // New model: each session opens VSCode with a throwaway --user-data-dir so the
    // same workspace gets a brand-new window every time, and the command the user
    // should run is published on the status card for copy-to-clipboard.
    expect(mainSource).toContain("commandLine: result.commandLine");
    expect(mainSource).toContain("cleanupStaleVscodeUserDataDirs(");
    expect(mainSource).toContain('ipcMain.handle("pet:clipboard:write-text"');
    expect(mainSource).not.toContain("scheduleVscodeTerminalRequestConsumptionCheck");
  });

  it("invalidates the transparent Pet window after Codex status updates so unfocused status cards repaint", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const publishBlock = mainSource.slice(
      mainSource.indexOf("function publishCodexStatus"),
      mainSource.indexOf("function relayModeFromEnv"),
    );

    expect(publishBlock).toContain('window.webContents.send("pet:codex-status:changed", currentCodexStatus)');
    expect(publishBlock).toContain("window.webContents.invalidate()");
  });

  it("refreshes recent sessions after the Pet renderer finishes loading so status does not depend on opening the context menu", () => {
    const mainSource = readFileSync(path.resolve(__dirname, "main.ts"), "utf8");
    const didFinishLoadBlock = mainSource.slice(
      mainSource.indexOf('window.webContents.on("did-finish-load"'),
      mainSource.indexOf("if (isDev)"),
    );

    expect(didFinishLoadBlock).toContain('logPetDebugEvent("renderer:did-finish-load"');
    expect(didFinishLoadBlock).toContain("void refreshRecentSessionsInBackground(window)");
  });
});
