const path = require("node:path");

const REQUEST_RELATIVE_PATH = path.join(".codex-pet", "vscode-terminal-request.json");
const DEFAULT_TERMINAL_NAME = "Codex Pet";
const REQUEST_TTL_MS = 5 * 60 * 1000;

function requestPathForWorkspace(workspacePath) {
  return path.join(workspacePath, REQUEST_RELATIVE_PATH);
}

function parseTerminalRequest(raw) {
  const request = JSON.parse(raw);
  if (!request || typeof request !== "object") return null;
  if (typeof request.id !== "string" || !request.id.trim()) return null;
  if (typeof request.commandLine !== "string" || !request.commandLine.trim()) return null;
  return request;
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

function handleWorkspaceRequest({ vscode, fs, workspacePath, handledRequestIds, nowMs = Date.now() }) {
  const requestPath = requestPathForWorkspace(workspacePath);
  if (!fs.existsSync(requestPath)) return null;

  const request = parseTerminalRequest(fs.readFileSync(requestPath, "utf8"));
  if (!request || handledRequestIds.has(request.id)) return null;
  if (isRequestExpired(request, nowMs)) {
    handledRequestIds.add(request.id);
    deleteRequestFile(fs, requestPath);
    return null;
  }

  const terminalName = request.terminalName || DEFAULT_TERMINAL_NAME;
  const terminal =
    findTerminal(vscode, terminalName) ||
    vscode.window.createTerminal({
      name: terminalName,
      cwd: request.workspacePath || workspacePath,
    });
  terminal.show(true);
  terminal.sendText(request.commandLine, true);
  handledRequestIds.add(request.id);
  deleteRequestFile(fs, requestPath);
  return request;
}

function handleAllWorkspaceRequests({ vscode, fs, handledRequestIds }) {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  const handled = [];
  for (const folder of workspaceFolders) {
    const request = handleWorkspaceRequest({
      vscode,
      fs,
      workspacePath: folder.uri.fsPath,
      handledRequestIds,
    });
    if (request) handled.push(request);
  }
  return handled;
}

module.exports = {
  DEFAULT_TERMINAL_NAME,
  REQUEST_RELATIVE_PATH,
  REQUEST_TTL_MS,
  handleAllWorkspaceRequests,
  handleWorkspaceRequest,
  parseTerminalRequest,
  requestPathForWorkspace,
};
