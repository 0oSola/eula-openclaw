$ErrorActionPreference = "Stop"

$python = "C:\Users\KSG\AppData\Local\Programs\Python\Python312\python.exe"
$node = "C:\Program Files\cursor\resources\app\resources\helpers\node.exe"
$npx = "C:\nvm4w\nodejs\npx.cmd"
$projectRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $projectRoot "web"
$stateFile = Join-Path $projectRoot ".runtime\dev-stack.json"
$failedSteps = New-Object System.Collections.Generic.List[string]

function Test-PortAvailable([int]$Port) {
  $matches = netstat -ano | Select-String ":$Port "
  return $matches.Count -eq 0
}

function Get-VerifyPorts() {
  $candidates = @(
    @{ Api = 8110; Web = 3110 },
    @{ Api = 8130; Web = 3130 },
    @{ Api = 8140; Web = 3140 }
  )

  foreach ($candidate in $candidates) {
    if ((Test-PortAvailable $candidate.Api) -and (Test-PortAvailable $candidate.Web)) {
      return $candidate
    }
  }

  throw "No free verify port pair found."
}

$ports = Get-VerifyPorts
$stackStarted = $false

function Add-StepFailure([string]$StepName) {
  if (-not $failedSteps.Contains($StepName)) {
    $failedSteps.Add($StepName) | Out-Null
  }
}

try {
  Write-Host "[1/4] Running API tests..."
  & $python -m pytest -c api/pytest.ini api/tests -q
  if ($LASTEXITCODE -ne 0) {
    Add-StepFailure "api-tests"
  }

  Write-Host "[2/4] Running web basic checks..."
  & $node (Join-Path $webDir "tests\run-basic-checks.mjs")
  if ($LASTEXITCODE -ne 0) {
    Add-StepFailure "web-basic-checks"
  }

  if (Test-Path $stateFile) {
    Write-Host "[3/4] Stopping tracked dev stack before verification..."
    powershell -File (Join-Path $projectRoot "scripts\dev-stack.ps1") -Action stop
    if ($LASTEXITCODE -ne 0) {
      Add-StepFailure "verify-stack-stop"
    }
  }

  if (Test-Path (Join-Path $webDir ".next")) {
    Remove-Item -LiteralPath (Join-Path $webDir ".next") -Recurse -Force
  }

  Write-Host "[3/4] Starting clean verify stack on API $($ports.Api) / Web $($ports.Web)..."
  powershell -File (Join-Path $projectRoot "scripts\dev-stack.ps1") -Action start -ApiPort $ports.Api -WebPort $ports.Web
  if ($LASTEXITCODE -eq 0) {
    $stackStarted = $true
  } else {
    Add-StepFailure "verify-stack-start"
  }

  if ($stackStarted) {
    Write-Host "[4/4] Running Playwright frontend smoke tests..."
    Push-Location $webDir
    try {
      $env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:$($ports.Web)"
      & $npx playwright test --config=playwright.config.ts --reporter=list
      if ($LASTEXITCODE -ne 0) {
        Add-StepFailure "playwright"
      }
    } finally {
      Remove-Item Env:\PLAYWRIGHT_BASE_URL -ErrorAction SilentlyContinue
      Pop-Location
    }
  } else {
    Write-Host "[4/4] Skipping Playwright because verify stack failed to start."
  }

  if ($failedSteps.Count -gt 0) {
    Write-Host "[DONE] Verification completed with failures: $($failedSteps -join ', ')"
    exit 1
  }

  Write-Host "[DONE] Verification complete."
} finally {
  if ($stackStarted) {
    powershell -File (Join-Path $projectRoot "scripts\dev-stack.ps1") -Action stop
  }
}
