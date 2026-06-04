# MMD Codex Pet VSCode Helper

This helper extension runs desktop-pet Codex requests inside a VSCode integrated terminal named `Codex Pet`.

desktop-pet writes a workspace-local request file:

```text
<workspace>/.codex-pet/vscode-terminal-request.json
```

The helper watches that file after VSCode opens the workspace. If the request is fresh, it creates or reuses the integrated terminal and runs either `codex` or `codex resume --cd <workspace> <session_id>`. The request file is deleted after execution; stale requests older than five minutes are ignored and removed.

## Development Mode

This is the default mode. desktop-pet starts VSCode with:

```text
code --reuse-window --extensionDevelopmentPath <desktop-pet/vscode-helper> <workspace>
```

Use this while developing the helper or running from the repo.

## Installed Mode

For regular use, install the helper once:

```powershell
desktop-pet/scripts/install-vscode-helper.ps1 -Force
```

Then start desktop-pet with:

```powershell
$env:MMD_PET_VSCODE_HELPER_MODE = "installed"
```

In installed mode, desktop-pet opens VSCode without `--extensionDevelopmentPath`:

```text
code --reuse-window <workspace>
```

The installed extension is responsible for reading the pending terminal request. If the helper is not installed or disabled, VSCode still opens the workspace, but the Codex terminal request will remain in `.codex-pet/vscode-terminal-request.json` until a helper processes it or it becomes stale.

## Environment

- `MMD_PET_VSCODE_HELPER_MODE=development|installed`
- `MMD_PET_VSCODE_CLI` overrides the `code` executable.
- `MMD_PET_VSCODE_HELPER_EXTENSION_PATH` overrides the development helper path.
- `MMD_PET_CODEX_CLI` overrides the terminal command, defaulting to `codex`.
