param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start",
  [int]$ApiPort = 8100,
  [int]$WebPort = 3100,
  [string]$AdminUserIds = "admin-1"
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
  Write-Host "[INFO] $Message"
}

function Write-WarnLine([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-ErrorLine([string]$Message) {
  Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Resolve-PythonExe {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $known = "C:\Users\KSG\AppData\Local\Programs\Python\Python312\python.exe"
  if (Test-Path $known) { return $known }
  throw "Python executable not found. Install Python or add it to PATH."
}

function Resolve-NpmCmd {
  foreach ($name in @("npm.cmd", "npm")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
  }

  $candidates = @(
    "C:\nvm4w\nodejs\npm.cmd",
    "C:\Program Files\nodejs\npm.cmd"
  )
  foreach ($candidate in $candidates) {
    try {
      if ([System.IO.File]::Exists($candidate)) { return $candidate }
    } catch {
      continue
    }
  }

  # In some locked-down environments, Get-Command / file probing may fail due to ACLs,
  # but `Start-Process npm ...` can still work via PATH resolution.
  Write-WarnLine "npm.cmd not resolved via Get-Command or known paths; falling back to 'npm' and relying on PATH."
  return "npm"
}

function Get-ListeningProcessId([int]$Port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    return $conn.OwningProcess
  } catch {
    return $null
  }
}

function Set-EnvValueInFile([string]$FilePath, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $FilePath) {
    $lines = Get-Content -Path $FilePath
  }
  $filtered = @()
  foreach ($line in $lines) {
    if ($line -notmatch "^$([regex]::Escape($Key))=") {
      $filtered += $line
    }
  }
  $filtered += "$Key=$Value"
  $filtered | Set-Content -Path $FilePath -Encoding UTF8
}

function Wait-Http([string]$Url, [int]$MaxAttempts = 40, [int]$SleepMs = 500) {
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds $SleepMs
      continue
    }
    Start-Sleep -Milliseconds $SleepMs
  }
  return $false
}

function Read-State([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  try {
    return (Get-Content -Path $Path -Raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Stop-TrackedProcess([int]$ProcessId, [string]$Name) {
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $proc) {
    Write-WarnLine "$Name process $ProcessId already stopped."
    return
  }
  Stop-Process -Id $ProcessId -Force
  Write-Info "$Name process stopped. pid=$ProcessId"
}

function New-LogPaths([string]$RuntimeDir, [string]$Prefix) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  return @{
    out = Join-Path $RuntimeDir "$Prefix.$stamp.out.log"
    err = Join-Path $RuntimeDir "$Prefix.$stamp.err.log"
  }
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$StateFile = Join-Path $RuntimeDir "dev-stack.json"

if (-not (Test-Path $RuntimeDir)) {
  New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
}

switch ($Action) {
  "start" {
    $existing = Read-State $StateFile
    if ($existing) {
      $apiProc = Get-Process -Id ([int]$existing.api.pid) -ErrorAction SilentlyContinue
      $webProc = Get-Process -Id ([int]$existing.web.pid) -ErrorAction SilentlyContinue
      if ($apiProc -or $webProc) {
        Write-ErrorLine "Detected running stack from state file. Run: powershell -File scripts/dev-stack.ps1 -Action stop"
        exit 1
      }
    }

    $apiPortPid = Get-ListeningProcessId $ApiPort
    if ($apiPortPid) {
      Write-ErrorLine "Port $ApiPort is in use by pid=$apiPortPid. Choose another port or free it first."
      exit 1
    }
    $webPortPid = Get-ListeningProcessId $WebPort
    if ($webPortPid) {
      Write-ErrorLine "Port $WebPort is in use by pid=$webPortPid. Choose another port or free it first."
      exit 1
    }

    $pythonExe = Resolve-PythonExe
    $npmCmd = Resolve-NpmCmd

    $apiEnv = Join-Path $ProjectRoot "api\.env"
    $apiEnvExample = Join-Path $ProjectRoot "api\.env.example"
    if (-not (Test-Path $apiEnv) -and (Test-Path $apiEnvExample)) {
      Copy-Item -Path $apiEnvExample -Destination $apiEnv
      Write-Info "Created api/.env from .env.example"
    }

    $webEnvLocal = Join-Path $ProjectRoot "web\.env.local"
    Set-EnvValueInFile -FilePath $webEnvLocal -Key "NEXT_PUBLIC_API_BASE_URL" -Value "http://127.0.0.1:$ApiPort"
    Write-Info "Updated web/.env.local NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:$ApiPort"

    Set-EnvValueInFile -FilePath $apiEnv -Key "ADMIN_USER_IDS" -Value $AdminUserIds
    Write-Info "Updated api/.env ADMIN_USER_IDS=$AdminUserIds"

    $apiLogs = New-LogPaths -RuntimeDir $RuntimeDir -Prefix "api"
    $webLogs = New-LogPaths -RuntimeDir $RuntimeDir -Prefix "web"

    Write-Info "Starting API on port $ApiPort ..."
    $apiProcess = Start-Process `
      -FilePath $pythonExe `
      -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$ApiPort" `
      -WorkingDirectory (Join-Path $ProjectRoot "api") `
      -RedirectStandardOutput $apiLogs.out `
      -RedirectStandardError $apiLogs.err `
      -PassThru

    Write-Info "Starting Web on port $WebPort ..."
    $webProcess = Start-Process `
      -FilePath $npmCmd `
      -ArgumentList "--prefix", "web", "run", "dev", "--", "-p", "$WebPort" `
      -WorkingDirectory $ProjectRoot `
      -RedirectStandardOutput $webLogs.out `
      -RedirectStandardError $webLogs.err `
      -PassThru

    $apiReady = Wait-Http -Url "http://127.0.0.1:$ApiPort/healthz" -MaxAttempts 30 -SleepMs 400
    $webReady = Wait-Http -Url "http://127.0.0.1:$WebPort" -MaxAttempts 80 -SleepMs 400

    $state = @{
      started_at = (Get-Date).ToString("o")
      api = @{
        pid  = $apiProcess.Id
        port = $ApiPort
        url  = "http://127.0.0.1:$ApiPort"
        log_out = $apiLogs.out
        log_err = $apiLogs.err
      }
      web = @{
        pid  = $webProcess.Id
        port = $WebPort
        url  = "http://127.0.0.1:$WebPort"
        log_out = $webLogs.out
        log_err = $webLogs.err
      }
    }
    $state | ConvertTo-Json -Depth 6 | Set-Content -Path $StateFile -Encoding UTF8

    if (-not $apiReady -or -not $webReady) {
      Write-WarnLine "Service startup incomplete."
      Write-WarnLine "apiReady=$apiReady webReady=$webReady"
      Write-WarnLine "Check logs:"
      Write-WarnLine "  $($apiLogs.err)"
      Write-WarnLine "  $($webLogs.err)"
      exit 1
    }

    Write-Info "Dev stack started successfully."
    Write-Host "API: http://127.0.0.1:$ApiPort   pid=$($apiProcess.Id)"
    Write-Host "WEB: http://127.0.0.1:$WebPort   pid=$($webProcess.Id)"
    Write-Host "State: $StateFile"
  }

  "stop" {
    $state = Read-State $StateFile
    if (-not $state) {
      Write-WarnLine "No state file found. Nothing to stop."
      exit 0
    }

    Stop-TrackedProcess -ProcessId ([int]$state.api.pid) -Name "API"
    Stop-TrackedProcess -ProcessId ([int]$state.web.pid) -Name "WEB"

    Remove-Item -Path $StateFile -Force -ErrorAction SilentlyContinue
    Write-Info "State file removed."
  }

  "status" {
    $state = Read-State $StateFile
    if (-not $state) {
      Write-WarnLine "No running stack state found."
      exit 0
    }

    $apiProc = Get-Process -Id ([int]$state.api.pid) -ErrorAction SilentlyContinue
    $webProc = Get-Process -Id ([int]$state.web.pid) -ErrorAction SilentlyContinue
    $apiHttp = Wait-Http -Url "$($state.api.url)/healthz" -MaxAttempts 1 -SleepMs 0
    $webHttp = Wait-Http -Url "$($state.web.url)" -MaxAttempts 1 -SleepMs 0

    Write-Host "API: pid=$($state.api.pid) running=$([bool]$apiProc) http=$apiHttp url=$($state.api.url)"
    Write-Host "WEB: pid=$($state.web.pid) running=$([bool]$webProc) http=$webHttp url=$($state.web.url)"
    Write-Host "StartedAt: $($state.started_at)"
    Write-Host "Logs:"
    Write-Host "  $($state.api.log_out)"
    Write-Host "  $($state.api.log_err)"
    Write-Host "  $($state.web.log_out)"
    Write-Host "  $($state.web.log_err)"
  }
}

