const path = require("node:path");
const os = require("node:os");

const REQUEST_RELATIVE_PATH = path.join(".codex-pet", "vscode-terminal-request.json");
const GLOBAL_REQUEST_PATH = path.join(os.tmpdir(), "mmd-codex-pet", "vscode-terminal-request.json");
const DEFAULT_TERMINAL_NAME = "Codex Pet";
const REQUEST_TTL_MS = 5 * 60 * 1000;

function requestPathForWorkspace(workspacePath) {
  return path.join(workspacePath, REQUEST_RELATIVE_PATH);
}

function globalRequestPath() {
  return GLOBAL_REQUEST_PATH;
}

function parseTerminalRequest(raw) {
  const request = JSON.parse(raw);
  if (!request || typeof request !== "object") return null;
  if (typeof request.id !== "string" || !request.id.trim()) return null;
  if (typeof request.commandLine !== "string" || !request.commandLine.trim()) return null;
  return request;
}

function readTerminalRequest(fs, requestPath) {
  try {
    return parseTerminalRequest(fs.readFileSync(requestPath, "utf8"));
  } catch {
    return null;
  }
}

function findTerminal(vscode, terminalName) {
  return vscode.window.terminals.find((terminal) => terminal.name === terminalName) || null;
}

function deleteRequestFile(fs, requestPath) {
  try {
    fs.unlinkSync?.(requestPath);
  } catch {
    // Best-effort cleanup only. A failed delete should not block terminal launch.
  }
}

function isRequestExpired(request, nowMs) {
  if (typeof request.createdAt !== "string") return false;
  const createdAtMs = Date.parse(request.createdAt);
  return Number.isFinite(createdAtMs) && nowMs - createdAtMs > REQUEST_TTL_MS;
}

function deleteRequestFiles(fs, requestPaths) {
  for (const requestPath of requestPaths) {
    deleteRequestFile(fs, requestPath);
  }
}

function handleRequestFile({
  vscode,
  fs,
  requestPath,
  workspacePath,
  handledRequestIds,
  nowMs = Date.now(),
  log,
  cleanupPaths = [requestPath],
}) {
  if (!fs.existsSync(requestPath)) return null;

  const request = readTerminalRequest(fs, requestPath);
  if (!request) {
    log?.("terminal request unreadable", { requestPath, workspacePath });
    return null;
  }
  if (handledRequestIds.has(request.id)) {
    log?.("terminal request already handled", { requestPath, requestId: request.id, workspacePath });
    deleteRequestFiles(fs, cleanupPaths);
    return null;
  }
  if (isRequestExpired(request, nowMs)) {
    handledRequestIds.add(request.id);
    deleteRequestFiles(fs, cleanupPaths);
    log?.("terminal request expired", { requestPath, requestId: request.id, workspacePath });
    return null;
  }

  const cwd = request.workspacePath || workspacePath;
  const terminalName = request.terminalName || DEFAULT_TERMINAL_NAME;
  const terminal =
    findTerminal(vscode, terminalName) ||
    vscode.window.createTerminal({
      name: terminalName,
      cwd,
    });
  terminal.show(true);
  terminal.sendText(request.commandLine, true);
  handledRequestIds.add(request.id);
  deleteRequestFiles(fs, cleanupPaths);
  log?.("terminal request sent", { requestPath, requestId: request.id, workspacePath });
  return request;
}

function handleWorkspaceRequest({ vscode, fs, workspacePath, handledRequestIds, nowMs = Date.now(), log }) {
  const requestPath = requestPathForWorkspace(workspacePath);
  return handleRequestFile({
    vscode,
    fs,
    requestPath,
    workspacePath,
    handledRequestIds,
    nowMs,
    log,
  });
}

function handleGlobalRequest({ vscode, fs, handledRequestIds, nowMs = Date.now(), log }) {
  const requestPath = globalRequestPath();
  if (!fs.existsSync(requestPath)) return null;

  const request = readTerminalRequest(fs, requestPath);
  if (!request) {
    log?.("global terminal request unreadable", { requestPath });
    return null;
  }
  const workspacePath = typeof request.workspacePath === "string" && request.workspacePath.trim() ? request.workspacePath : null;
  if (!workspacePath) {
    log?.("global terminal request missing workspacePath", { requestPath, requestId: request.id });
    return null;
  }
  const workspaceRequestPath = requestPathForWorkspace(workspacePath);
  const workspaceRequest = fs.existsSync(workspaceRequestPath) ? readTerminalRequest(fs, workspaceRequestPath) : null;
  if (!workspaceRequest || workspaceRequest.id !== request.id) {
    log?.("global terminal request missing matching workspace request", {
      requestPath,
      requestId: request.id,
      workspacePath,
      workspaceRequestPath,
    });
    if (isRequestExpired(request, nowMs)) {
      deleteRequestFile(fs, requestPath);
    }
    return null;
  }

  return handleRequestFile({
    vscode,
    fs,
    requestPath,
    workspacePath,
    handledRequestIds,
    nowMs,
    log,
    cleanupPaths: [requestPath, workspaceRequestPath],
  });
}

function handleAllWorkspaceRequests({ vscode, fs, handledRequestIds, log }) {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const handled = [];
  for (const folder of workspaceFolders) {
    const request = handleWorkspaceRequest({
      vscode,
      fs,
      workspacePath: folder.uri.fsPath,
      handledRequestIds,
      log,
    });
    if (request) handled.push(request);
  }
  const globalRequest = handleGlobalRequest({
    vscode,
    fs,
    handledRequestIds,
    log,
  });
  if (globalRequest) handled.push(globalRequest);
  return handled;
}

module.exports = {
  DEFAULT_TERMINAL_NAME,
  GLOBAL_REQUEST_PATH,
  REQUEST_RELATIVE_PATH,
  REQUEST_TTL_MS,
  globalRequestPath,
  handleAllWorkspaceRequests,
  handleGlobalRequest,
  handleRequestFile,
  handleWorkspaceRequest,
  parseTerminalRequest,
  readTerminalRequest,
  requestPathForWorkspace,
};
