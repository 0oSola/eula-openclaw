$ErrorActionPreference = 'Stop'

$root = 'D:\workspace\MMD project'
$node = 'C:\Program Files\nodejs\node.exe'
$port = 3101
$webUrl = "http://127.0.0.1:$port"
$vmd = 'imgToAction/outputs/vmd/eula_thinking_elegant_reference_v12_single_raise.vmd'
$frames = '0,30,36,42,48,54,60,90,120,178'
$front45Camera = '{"fov":33,"position":[30.703903,0.017334,33.421575],"target":[-2.075385,-2.771828,0.642287],"locked":true}'
$rightSideCamera = '{"fov":33,"position":[62,0.017334,0.642287],"target":[-2.075385,-2.771828,0.642287],"locked":true}'

function Stop-ProcessTree {
  param([int]$ProcessId)
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Invoke-Probe {
  param(
    [string]$Name,
    [string]$OutDir,
    [string]$CameraJson = ''
  )

  $args = @(
    'imgToAction/tools/render-vmd-pose-check.mjs',
    '--web-url', $webUrl,
    '--vmd', $vmd,
    '--out', $OutDir,
    '--frames', $frames,
    '--hold-start-frame', '60',
    '--contact-pass-pixels', '80',
    '--title', $Name
  )
  if ($CameraJson) {
    $args += @('--camera', $CameraJson.Replace('"', '\"'))
  }

  Write-Output "Running probe: $Name"
  & $node @args
  if ($LASTEXITCODE -ne 0) {
    throw "Probe failed: $Name"
  }
}

Set-Location $root

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $node
$psi.WorkingDirectory = $root
$psi.Arguments = '"web\scripts\run-next.mjs" dev --port 3101'
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$server = [System.Diagnostics.Process]::Start($psi)

try {
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $response = Invoke-WebRequest -Uri "$webUrl/mmd-calibration-render" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  if (-not $ready) {
    Stop-ProcessTree -ProcessId $server.Id
    $stdout = $server.StandardOutput.ReadToEnd()
    $stderr = $server.StandardError.ReadToEnd()
    throw "Next server did not become ready. stdout=$stdout stderr=$stderr"
  }

  Write-Output "Next ready at $webUrl"
  Invoke-Probe -Name 'v12 single raise dense default' -OutDir 'imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_default'
  Invoke-Probe -Name 'v12 single raise dense front45' -OutDir 'imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_front45' -CameraJson $front45Camera
  Invoke-Probe -Name 'v12 single raise dense right side' -OutDir 'imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_right_side' -CameraJson $rightSideCamera
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-ProcessTree -ProcessId $server.Id
  }
}
