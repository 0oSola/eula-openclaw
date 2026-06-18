# MMD Codex Pet VSCode Helper

This helper extension runs desktop-pet Codex requests inside a VSCode integrated terminal named `Codex Pet`.

desktop-pet writes both a workspace-local request file and a user-scoped
transient request pointer:

```text
<workspace>/.codex-pet/vscode-terminal-request.json
<os.tmpdir()>/mmd-codex-pet/vscode-terminal-request.json
```

Both files contain the same bounded JSON payload, including `workspacePath`.
The helper watches workspace-local files and also polls the transient pointer.
This matters because VSCode extension development host windows can load the
helper before any workspace folder is attached. If the request is fresh, the
helper creates or reuses the integrated terminal and runs either `codex` or
`codex resume --cd <workspace> <session_id>`. The local request and transient
pointer are deleted after execution; stale requests older than five minutes are
ignored and removed.

## Development Mode

This is the default mode. desktop-pet starts VSCode with:

```text
code --new-window --user-data-dir <temp>/mmd-pet-vscode-ud/<launch-id> --extensionDevelopmentPath <desktop-pet/vscode-helper> <workspace>
```

Use this while developing the helper or running from the repo. Development mode
opens a new VSCode window with an isolated user-data-dir and the helper
extension loaded. If that window has no workspace folders, the helper still
processes the pending terminal request through the transient pointer.

## Installed Mode

For regular use, install the helper once:

```powershell
desktop-pet/scripts/install-vscode-helper.ps1 -Force
```

Then start desktop-pet with:

```powershell
$env:MMD_PET_VSCODE_HELPER_MODE = "installed"
```

In installed mode, desktop-pet opens VSCode without `--extensionDevelopmentPath`.
New and resume requests open the target workspace in a new VSCode window:

```text
code --new-window --user-data-dir <temp>/mmd-pet-vscode-ud/<launch-id> <workspace>
```

The installed extension is responsible for reading the pending terminal request.
If the helper is not installed or disabled, VSCode still opens the workspace,
but the Codex terminal request will remain in `.codex-pet/vscode-terminal-request.json`
and the transient pointer until a helper processes it or it becomes stale.

## Diagnostics

The helper writes a VSCode output channel named `MMD Codex Pet Helper`. It logs
activation, workspace-folder visibility, and terminal request handling. The
corresponding file appears under VSCode's `logs/**/exthost/output_logging_*`
directory.

## Environment

- `MMD_PET_VSCODE_HELPER_MODE=development|installed`
- `MMD_PET_VSCODE_CLI` overrides the `code` executable.
- `MMD_PET_VSCODE_HELPER_EXTENSION_PATH` overrides the development helper path.
- `MMD_PET_CODEX_CLI` overrides the terminal command, defaulting to `codex`.
