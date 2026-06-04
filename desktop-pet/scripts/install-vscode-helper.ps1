param(
  [string]$CodeUserExtensionsPath = (Join-Path $env:USERPROFILE ".vscode\extensions"),
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopPetRoot = Resolve-Path (Join-Path $scriptDir "..")
$helperSource = Join-Path $desktopPetRoot "vscode-helper"
$manifestPath = Join-Path $helperSource "package.json"

if (-not (Test-Path $manifestPath)) {
  throw "VSCode helper manifest not found: $manifestPath"
}

$manifest = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
$extensionDirName = "$($manifest.publisher).$($manifest.name)-$($manifest.version)"
$targetDir = Join-Path $CodeUserExtensionsPath $extensionDirName

if ((Test-Path $targetDir) -and -not $Force) {
  throw "VSCode helper already installed at $targetDir. Re-run with -Force to replace it."
}

if (Test-Path $targetDir) {
  Remove-Item -LiteralPath $targetDir -Recurse -Force
}

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
Copy-Item -Path (Join-Path $helperSource "*") -Destination $targetDir -Recurse -Force

Write-Output "Installed MMD Codex Pet VSCode helper to $targetDir"
Write-Output "Set MMD_PET_VSCODE_HELPER_MODE=installed before starting desktop-pet."
