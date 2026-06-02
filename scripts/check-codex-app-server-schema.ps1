param(
  [string]$CodexBin = $(if ($env:CODEX_BIN) { $env:CODEX_BIN } else { "codex" }),
  [switch]$AutoUpdate
)

$ErrorActionPreference = "Stop"

function Test-Truthy([object]$Value) {
  if ($null -eq $Value) { return $false }
  $text = [string]$Value
  $text = $text.Trim().ToLowerInvariant()
  return $text -in @("1", "true", "yes", "on")
}

function Read-DotEnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $value = $null
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $name, $raw = $trimmed.Split("=", 2)
    if ($name.Trim() -eq $Key) {
      $value = $raw.Trim().Trim('"').Trim("'")
    }
  }
  return $value
}

function Get-ConfigValue([string]$Key, [string]$Default = "") {
  $envValue = [Environment]::GetEnvironmentVariable($Key)
  if ($envValue) { return $envValue }
  $fileValue = Read-DotEnvValue -Path $script:ApiEnvPath -Key $Key
  if ($fileValue) { return $fileValue }
  return $Default
}

function Read-Manifest([string]$Path) {
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Codex schema manifest is unreadable: $Path"
  }
}

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ApiEnvPath = Join-Path $ProjectRoot "api\.env"
$interactiveEnabled = Test-Truthy (Get-ConfigValue -Key "CODEX_INTERACTIVE_ENABLED" -Default "false")
$codexBinExplicit = $PSBoundParameters.ContainsKey("CodexBin")
if (-not $codexBinExplicit) {
  $CodexBin = Get-ConfigValue -Key "CODEX_BIN" -Default $CodexBin
}

if (-not $interactiveEnabled) {
  Write-Host "[INFO] Codex schema preflight skipped because CODEX_INTERACTIVE_ENABLED is not true."
  exit 0
}

$apiSchemaRoot = Join-Path $ProjectRoot "api\app\codex_schema\generated"
$webSchemaRoot = Join-Path $ProjectRoot "web\src\codex-schema\generated"
$apiManifestPath = Join-Path $apiSchemaRoot "manifest.json"
$webManifestPath = Join-Path $webSchemaRoot "manifest.json"
$requiredFiles = @(
  (Join-Path $apiSchemaRoot "codex_app_server_protocol.schemas.json"),
  (Join-Path $apiSchemaRoot "codex_app_server_protocol.v2.schemas.json"),
  (Join-Path $webSchemaRoot "index.ts"),
  $apiManifestPath,
  $webManifestPath
)

$missing = @()
foreach ($path in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $path)) {
    $missing += $path
  }
}

try {
  $installedVersion = (& $CodexBin --version).Trim()
} catch {
  throw "Codex interactive is enabled, but Codex CLI could not be executed with '$CodexBin'."
}
if (-not $installedVersion) {
  throw "Codex interactive is enabled, but '$CodexBin --version' returned no version."
}

$reasons = @()
if ($missing.Count -gt 0) {
  $reasons += "missing schema files: $($missing -join ', ')"
} else {
  $apiManifest = Read-Manifest $apiManifestPath
  $webManifest = Read-Manifest $webManifestPath
  if ($apiManifest.codex_cli_version -ne $installedVersion) {
    $reasons += "API schema pinned to $($apiManifest.codex_cli_version), installed CLI is $installedVersion"
  }
  if ($webManifest.codex_cli_version -ne $installedVersion) {
    $reasons += "Web schema pinned to $($webManifest.codex_cli_version), installed CLI is $installedVersion"
  }
}

$allowAutoUpdate = $AutoUpdate -or (Test-Truthy $env:CODEX_SCHEMA_AUTO_UPDATE)
if ($reasons.Count -gt 0) {
  if ($allowAutoUpdate) {
    Write-Host "[WARN] Codex schema pin mismatch; regenerating because CODEX_SCHEMA_AUTO_UPDATE is true."
    Write-Host "[WARN] $($reasons -join '; ')"
    & (Join-Path $ProjectRoot "scripts\generate-codex-app-server-schema.ps1") -CodexBin $CodexBin
    exit $LASTEXITCODE
  }

  throw "Codex schema pin mismatch: $($reasons -join '; '). Run scripts\generate-codex-app-server-schema.ps1 or set CODEX_SCHEMA_AUTO_UPDATE=true for dev auto-update."
}

Write-Host "[INFO] Codex schema preflight passed for $installedVersion."
