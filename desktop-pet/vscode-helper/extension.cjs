const fs = require("node:fs");
const vscode = require("vscode");

const { REQUEST_RELATIVE_PATH, handleAllWorkspaceRequests } = require("./extensionCore.cjs");

const handledRequestIds = new Set();

function runPendingRequests() {
  return handleAllWorkspaceRequests({ vscode, fs, handledRequestIds });
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("mmd-codex-pet.runPendingTerminalRequest", () => {
      runPendingRequests();
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher(`**/${REQUEST_RELATIVE_PATH.replaceAll("\\", "/")}`);
  const runSoon = () => setTimeout(runPendingRequests, 150);
  context.subscriptions.push(watcher);
  context.subscriptions.push(watcher.onDidCreate(runSoon));
  context.subscriptions.push(watcher.onDidChange(runSoon));

  runSoon();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
