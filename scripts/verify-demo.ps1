$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $projectRoot "web"
$stateFile = Join-Path $projectRoot ".runtime\dev-stack.json"
$failedSteps = New-Object System.Collections.Generic.List[string]

function Test-UsablePythonPath([string]$Path) {
  if (-not $Path) { return $false }
  if ($Path -match "WindowsApps\\python(?:3)?(?:\.exe)?$") { return $false }
  return (Test-Path $Path)
}

function Resolve-PythonExe() {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd -and (Test-UsablePythonPath $cmd.Source)) { return $cmd.Source }

  $pyCmd = Get-Command py -ErrorAction SilentlyContinue
  if ($pyCmd -and $pyCmd.Source) {
    try {
      $resolved = & $pyCmd.Source -c "import sys; print(sys.executable)"
      if ($LASTEXITCODE -eq 0) {
        $resolved = ($resolved | Select-Object -First 1).Trim()
        if (Test-UsablePythonPath $resolved) { return $resolved }
      }
    } catch {
    }
  }

  $pythonRoot = Join-Path $env:LocalAppData "Programs\Python"
  if (Test-Path $pythonRoot) {
    $candidate = Get-ChildItem -Path $pythonRoot -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
      Where-Object { Test-UsablePythonPath $_.FullName } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }

  throw "Python executable not found. Install Python first."
}

function Resolve-CommandPath([string[]]$Names, [string]$ErrorMessage) {
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
      return $cmd.Source
    }
  }

  throw $ErrorMessage
}

$python = Resolve-PythonExe
$node = Resolve-CommandPath -Names @("node.exe", "node") -ErrorMessage "Node.js executable not found. Install Node.js or add it to PATH."
$npx = Resolve-CommandPath -Names @("npx.cmd", "npx") -ErrorMessage "npx not found. Install Node.js or add it to PATH."

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
