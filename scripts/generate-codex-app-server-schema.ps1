param(
    [string]$CodexBin = $(if ($env:CODEX_BIN) { $env:CODEX_BIN } else { "codex" })
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$ApiOut = Join-Path $RepoRoot "api/app/codex_schema/generated"
$WebOut = Join-Path $RepoRoot "web/src/codex-schema/generated"

function Reset-GeneratedDirectory([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $repoPath = [System.IO.Path]::GetFullPath($RepoRoot)
    if (-not $fullPath.StartsWith($repoPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to write outside repository: $fullPath"
    }
    if (Test-Path -LiteralPath $fullPath) {
        Remove-Item -LiteralPath $fullPath -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
}

Reset-GeneratedDirectory $ApiOut
Reset-GeneratedDirectory $WebOut

& $CodexBin app-server generate-json-schema --experimental --out $ApiOut
& $CodexBin app-server generate-ts --experimental --out $WebOut

$version = (& $CodexBin --version).Trim()
$manifest = [ordered]@{
    codex_cli_version = $version
    generated_by = "scripts/generate-codex-app-server-schema.ps1"
    json_schema_command = "$CodexBin app-server generate-json-schema --experimental --out api/app/codex_schema/generated"
    typescript_command = "$CodexBin app-server generate-ts --experimental --out web/src/codex-schema/generated"
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $ApiOut "manifest.json"), $manifestJson + [Environment]::NewLine, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $WebOut "manifest.json"), $manifestJson + [Environment]::NewLine, $utf8NoBom)

Write-Host "Pinned Codex app-server schemas for $version"
