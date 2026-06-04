param(
  [string]$LogPath = "D:\workspace\MMD project\.worktrees\desktop-mmd-codex-pet\desktop-pet-debug-events.ndjson",
  [int]$BurstClicks = 0,
  [int]$SequentialClicks = 20,
  [string]$TracePath = "",
  [ValidateSet("None", "Right", "Bottom", "BottomRight")]
  [string]$EdgePlacement = "None",
  [int]$EdgeMargin = 8,
  [int]$MaxWindowDriftPx = 16,
  [bool]$RequireContextMenuEvents = $true,
  [switch]$AllowMouseControl,
  [switch]$KeepPetWindowPlacement
)

$ErrorActionPreference = "Stop"

if (-not $AllowMouseControl) {
  throw "This script sends real mouse input and may move the Pet window. Re-run with -AllowMouseControl from an idle desktop session."
}

function Write-Trace([string]$message) {
  if (-not $TracePath) { return }
  Add-Content -LiteralPath $TracePath -Value "$(Get-Date -Format o) $message"
}

Write-Trace "start"

$mainProcess = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "electron.exe" -and
    $_.CommandLine -match 'desktop-pet\\node_modules\\electron\\dist\\electron\.exe" \.'
  } |
  Select-Object -First 1

if (-not $mainProcess) {
  throw "desktop-pet Electron main process was not found."
}
Write-Trace "process-found:$($mainProcess.ProcessId)"

$code = @"
using System;
using System.Runtime.InteropServices;
public static class PetRightClickStressTest {
  public const uint WM_CANCELMODE = 0x001F;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint VK_ESCAPE = 0x1B;
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, UIntPtr wParam, IntPtr lParam);
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOZORDER = 0x0004;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint GA_ROOT = 2;
}
"@

Add-Type -TypeDefinition $code
Add-Type -AssemblyName System.Windows.Forms
Write-Trace "add-type-complete"

function Get-TestCursorPosition {
  $point = New-Object PetRightClickStressTest+POINT
  [PetRightClickStressTest]::GetCursorPos([ref]$point) | Out-Null
  return $point
}

function Restore-TestCursorPosition($point) {
  if (-not $point) { return }
  [PetRightClickStressTest]::SetCursorPos($point.X, $point.Y) | Out-Null
  Write-Trace "cursor-restored:$($point.X),$($point.Y)"
}

function Release-TestMouseButtons {
  [PetRightClickStressTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  [PetRightClickStressTest]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
}

function Send-RightClick([int]$x, [int]$y) {
  [PetRightClickStressTest]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 40
  [PetRightClickStressTest]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [PetRightClickStressTest]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
}

function Format-Hwnd([IntPtr]$handle) {
  return "0x{0:X}" -f $handle.ToInt64()
}

function Resolve-ClickHitTarget([IntPtr]$targetHwnd, [int]$expectedProcessId, [int]$x, [int]$y) {
  $point = New-Object PetRightClickStressTest+POINT
  $point.X = $x
  $point.Y = $y
  $hitHwnd = [PetRightClickStressTest]::WindowFromPoint($point)
  $rootHwnd = [IntPtr]::Zero
  if ($hitHwnd -ne [IntPtr]::Zero) {
    $rootHwnd = [PetRightClickStressTest]::GetAncestor($hitHwnd, [PetRightClickStressTest]::GA_ROOT)
  }

  [uint32]$hitProcessId = 0
  if ($rootHwnd -ne [IntPtr]::Zero) {
    [PetRightClickStressTest]::GetWindowThreadProcessId($rootHwnd, [ref]$hitProcessId) | Out-Null
  }

  $matchesTarget = $rootHwnd -eq $targetHwnd
  $matchesProcess = [int]$hitProcessId -eq $expectedProcessId
  return [pscustomobject]@{
    hitHwnd = $hitHwnd
    rootHwnd = $rootHwnd
    processId = [int]$hitProcessId
    matchesTarget = $matchesTarget
    matchesProcess = $matchesProcess
  }
}

function Trace-ClickHitTarget([string]$phase, [IntPtr]$targetHwnd, [int]$expectedProcessId, [int]$x, [int]$y) {
  if (-not $TracePath) { return }

  $target = Resolve-ClickHitTarget $targetHwnd $expectedProcessId $x $y
  Write-Trace "hit-test:$phase x:$x y:$y hit:$(Format-Hwnd $target.hitHwnd) root:$(Format-Hwnd $target.rootHwnd) processId:$($target.processId) target:$(Format-Hwnd $targetHwnd) matchesTarget:$($target.matchesTarget) matchesProcess:$($target.matchesProcess)"
}

function Trace-WindowHitGrid([IntPtr]$targetHwnd, [int]$expectedProcessId, $rect) {
  if (-not $TracePath) { return }

  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  $xOffsets = @(24, [int]($width / 2), [Math]::Max(24, $width - 24))
  $yOffsets = @(24, [int]($height / 2), [Math]::Max(24, $height - 24))
  for ($row = 0; $row -lt $yOffsets.Count; $row += 1) {
    for ($column = 0; $column -lt $xOffsets.Count; $column += 1) {
      $x = $rect.Left + $xOffsets[$column]
      $y = $rect.Top + $yOffsets[$row]
      $target = Resolve-ClickHitTarget $targetHwnd $expectedProcessId $x $y
      Write-Trace "hit-grid:$row,$column x:$x y:$y hit:$(Format-Hwnd $target.hitHwnd) root:$(Format-Hwnd $target.rootHwnd) processId:$($target.processId) target:$(Format-Hwnd $targetHwnd) matchesTarget:$($target.matchesTarget) matchesProcess:$($target.matchesProcess)"
    }
  }
}

function Bring-PetWindowToFront([IntPtr]$targetHwnd) {
  $raised = [PetRightClickStressTest]::SetWindowPos(
    $targetHwnd,
    [PetRightClickStressTest]::HWND_TOPMOST,
    0,
    0,
    0,
    0,
    [PetRightClickStressTest]::SWP_NOMOVE -bor [PetRightClickStressTest]::SWP_NOSIZE
  )
  if (-not $raised) {
    throw "desktop-pet window could not be raised above other desktop windows."
  }
  Start-Sleep -Milliseconds 120
  $foreground = [PetRightClickStressTest]::SetForegroundWindow($targetHwnd)
  Write-Trace "foreground-after-topmost:$foreground"
  Start-Sleep -Milliseconds 250
}

function Close-PetContextMenu([IntPtr]$targetHwnd) {
  [PetRightClickStressTest]::PostMessage(
    $targetHwnd,
    [PetRightClickStressTest]::WM_CANCELMODE,
    [UIntPtr]::Zero,
    [IntPtr]::Zero
  ) | Out-Null
  Start-Sleep -Milliseconds 40
  [PetRightClickStressTest]::PostMessage(
    $targetHwnd,
    [PetRightClickStressTest]::WM_KEYDOWN,
    [UIntPtr]([PetRightClickStressTest]::VK_ESCAPE),
    [IntPtr]::Zero
  ) | Out-Null
  Start-Sleep -Milliseconds 40
  [PetRightClickStressTest]::PostMessage(
    $targetHwnd,
    [PetRightClickStressTest]::WM_KEYUP,
    [UIntPtr]([PetRightClickStressTest]::VK_ESCAPE),
    [IntPtr]::Zero
  ) | Out-Null
}

function Get-PetDebugLinesAfter([int]$initialLineCount) {
  if (-not (Test-Path -LiteralPath $LogPath)) { return @() }
  return @(Get-Content -LiteralPath $LogPath | Select-Object -Skip $initialLineCount)
}

function Wait-ContextMenuClosedCount([int]$expectedClosedCount, [int]$initialLineCount, [int]$timeoutMs = 3500) {
  if (-not $RequireContextMenuEvents) {
    Start-Sleep -Milliseconds 250
    return
  }

  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  do {
    $closedCount = @(
      Get-PetDebugLinesAfter $initialLineCount |
        Where-Object { $_ -match '"type":"context-menu:closed"' }
    ).Count
    if ($closedCount -ge $expectedClosedCount) {
      Write-Trace "context-menu-close-observed:$closedCount expected:$expectedClosedCount"
      Start-Sleep -Milliseconds 250
      return
    }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $deadline)

  throw "desktop-pet context menu close event was not observed before the next right-click: closed=$closedCount expectedAtLeast=$expectedClosedCount."
}

function Wait-ContextMenuPopupCount([int]$expectedPopupCount, [int]$initialLineCount, [int]$timeoutMs = 2500) {
  if (-not $RequireContextMenuEvents) {
    Start-Sleep -Milliseconds 550
    return $true
  }

  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  do {
    $popupCount = @(
      Get-PetDebugLinesAfter $initialLineCount |
        Where-Object { $_ -match '"type":"context-menu:popup"' }
    ).Count
    if ($popupCount -ge $expectedPopupCount) {
      Write-Trace "context-menu-popup-observed:$popupCount expected:$expectedPopupCount"
      return $true
    }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $deadline)

  Write-Trace "context-menu-popup-missing:$popupCount expected:$expectedPopupCount"
  return $false
}

function Assert-PetProcessAlive([int]$processId) {
  $alive = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $alive) {
    throw "desktop-pet Electron process exited during repeated right-click stress test."
  }
}

function Move-PetWindowToEdge([IntPtr]$targetHwnd, [string]$placement, [int]$margin) {
  if ($placement -eq "None") { return }

  $current = New-Object PetRightClickStressTest+RECT
  [PetRightClickStressTest]::GetWindowRect($targetHwnd, [ref]$current) | Out-Null
  $currentWidth = $current.Right - $current.Left
  $currentHeight = $current.Bottom - $current.Top
  $screen = [System.Windows.Forms.Screen]::FromHandle($targetHwnd)
  $workArea = $screen.WorkingArea

  $targetLeft = $current.Left
  $targetTop = $current.Top
  if ($placement -eq "Right" -or $placement -eq "BottomRight") {
    $targetLeft = [int]($workArea.Right - $currentWidth - $margin)
  }
  if ($placement -eq "Bottom" -or $placement -eq "BottomRight") {
    $targetTop = [int]($workArea.Bottom - $currentHeight - $margin)
  }

  Write-Trace "edge-placement:$placement target:$targetLeft,$targetTop work-area:$($workArea.Left),$($workArea.Top),$($workArea.Right),$($workArea.Bottom)"
  $moved = [PetRightClickStressTest]::SetWindowPos(
    $targetHwnd,
    [IntPtr]::Zero,
    $targetLeft,
    $targetTop,
    $currentWidth,
    $currentHeight,
    [PetRightClickStressTest]::SWP_NOZORDER -bor [PetRightClickStressTest]::SWP_NOACTIVATE
  )
  if (-not $moved) {
    throw "desktop-pet window could not be moved to $placement screen edge."
  }
  Start-Sleep -Milliseconds 250
}

function Restore-PetWindowRect([IntPtr]$targetHwnd, $rect) {
  if ($targetHwnd -eq [IntPtr]::Zero -or -not $rect -or $KeepPetWindowPlacement) { return }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  [PetRightClickStressTest]::SetWindowPos(
    $targetHwnd,
    [IntPtr]::Zero,
    $rect.Left,
    $rect.Top,
    $width,
    $height,
    [PetRightClickStressTest]::SWP_NOZORDER -bor [PetRightClickStressTest]::SWP_NOACTIVATE
  ) | Out-Null
  Write-Trace "window-restored:$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
}

function Assert-PetWindowStable($beforeRect, $afterRect, [int]$maxDriftPx) {
  $driftX = [Math]::Abs($afterRect.Left - $beforeRect.Left)
  $driftY = [Math]::Abs($afterRect.Top - $beforeRect.Top)
  $beforeWidth = $beforeRect.Right - $beforeRect.Left
  $beforeHeight = $beforeRect.Bottom - $beforeRect.Top
  $afterWidth = $afterRect.Right - $afterRect.Left
  $afterHeight = $afterRect.Bottom - $afterRect.Top

  if ($driftX -gt $maxDriftPx -or $driftY -gt $maxDriftPx) {
    throw "desktop-pet window moved too far during right-click stress test: drift=$driftX,$driftY max=$maxDriftPx."
  }
  if ([Math]::Abs($afterWidth - $beforeWidth) -gt 1 -or [Math]::Abs($afterHeight - $beforeHeight) -gt 1) {
    throw "desktop-pet window size changed during right-click stress test: before=$beforeWidth,$beforeHeight after=$afterWidth,$afterHeight."
  }
}

function Assert-ContextMenuEvents([int]$expectedSequentialClicks, [int]$popupCount, [int]$closedCount, [int]$errorCount) {
  if (-not $RequireContextMenuEvents) { return }
  if ($errorCount -gt 0) {
    throw "desktop-pet context menu emitted $errorCount error event(s) during right-click stress test."
  }
  if ($expectedSequentialClicks -gt 0 -and $popupCount -lt $expectedSequentialClicks) {
    throw "desktop-pet context menu did not open for every sequential right-click: popup=$popupCount expectedAtLeast=$expectedSequentialClicks."
  }
  if ($expectedSequentialClicks -gt 0 -and $closedCount -lt $expectedSequentialClicks) {
    throw "desktop-pet context menu did not close after every sequential right-click: closed=$closedCount expectedAtLeast=$expectedSequentialClicks."
  }
}

$originalCursor = Get-TestCursorPosition
$originalWindowRect = $null
$hwnd = [IntPtr]::Zero

try {
  $process = Get-Process -Id $mainProcess.ProcessId
  $hwnd = [IntPtr]$process.MainWindowHandle
  if ($hwnd -eq [IntPtr]::Zero) {
    throw "desktop-pet Electron main window handle was not found."
  }
  Write-Trace "window-handle:$hwnd"

  $originalWindowRect = New-Object PetRightClickStressTest+RECT
  [PetRightClickStressTest]::GetWindowRect($hwnd, [ref]$originalWindowRect) | Out-Null
  Write-Trace "window-rect-original:$($originalWindowRect.Left),$($originalWindowRect.Top),$($originalWindowRect.Right),$($originalWindowRect.Bottom)"

  Move-PetWindowToEdge $hwnd $EdgePlacement $EdgeMargin
  Bring-PetWindowToFront $hwnd

  $before = New-Object PetRightClickStressTest+RECT
  [PetRightClickStressTest]::GetWindowRect($hwnd, [ref]$before) | Out-Null
  Write-Trace "window-rect-before:$($before.Left),$($before.Top),$($before.Right),$($before.Bottom)"
  $width = $before.Right - $before.Left
  $height = $before.Bottom - $before.Top
  $initialLogLineCount = if (Test-Path -LiteralPath $LogPath) { @(Get-Content -LiteralPath $LogPath).Count } else { 0 }
  Write-Trace "initial-log-lines:$initialLogLineCount"
  Trace-WindowHitGrid $hwnd $mainProcess.ProcessId $before

  for ($index = 0; $index -lt $BurstClicks; $index += 1) {
    $x = $before.Left + [Math]::Min($width - 24, 48 + ($index * 19 % [Math]::Max(1, $width - 96)))
    $y = $before.Top + [Math]::Min($height - 24, 64 + ($index * 23 % [Math]::Max(1, $height - 128)))
    Trace-ClickHitTarget "burst-$index" $hwnd $mainProcess.ProcessId $x $y
    Send-RightClick $x $y
    Start-Sleep -Milliseconds 70
    Assert-PetProcessAlive $mainProcess.ProcessId
  }

  Close-PetContextMenu $hwnd
  Start-Sleep -Milliseconds 500
  Assert-PetProcessAlive $mainProcess.ProcessId

  for ($index = 0; $index -lt $SequentialClicks; $index += 1) {
    Write-Trace "sequential-click-start:$index"
    $safeWidth = [Math]::Max(1, $width - 96)
    $safeHeight = [Math]::Max(1, $height - 128)
    $x = $before.Left + [Math]::Min($width - 24, 48 + ($index * 31 % $safeWidth))
    $y = $before.Top + [Math]::Min($height - 24, 64 + ($index * 37 % $safeHeight))
    $opened = $false
    for ($attempt = 0; $attempt -lt 3 -and -not $opened; $attempt += 1) {
      if ($attempt -gt 0) {
        Write-Trace "sequential-click-retry:$index attempt:$attempt"
        Start-Sleep -Milliseconds 650
      }
      Trace-ClickHitTarget "sequential-$index-attempt-$attempt" $hwnd $mainProcess.ProcessId $x $y
      Send-RightClick $x $y
      Write-Trace "sequential-click-sent:$index attempt:$attempt"
      $opened = Wait-ContextMenuPopupCount ($index + 1) $initialLogLineCount
      Assert-PetProcessAlive $mainProcess.ProcessId
    }
    if (-not $opened) {
      throw "desktop-pet context menu popup event was not observed after retrying right-click $index."
    }
    Write-Trace "sequential-click-alive-after-popup:$index"
    Close-PetContextMenu $hwnd
    Write-Trace "sequential-click-menu-close-sent:$index"
    Wait-ContextMenuClosedCount ($index + 1) $initialLogLineCount
    Assert-PetProcessAlive $mainProcess.ProcessId
    Write-Trace "sequential-click-end:$index"
  }
  Start-Sleep -Milliseconds 300

  $after = New-Object PetRightClickStressTest+RECT
  [PetRightClickStressTest]::GetWindowRect($hwnd, [ref]$after) | Out-Null
  Write-Trace "window-rect-after:$($after.Left),$($after.Top),$($after.Right),$($after.Bottom)"
  $lines = Get-PetDebugLinesAfter $initialLogLineCount
  Write-Trace "log-read:$($lines.Count)"
  $contextMenuLines = @($lines | Where-Object { $_ -match '"type":"context-menu:' })
  Write-Trace "summary-ready"
  $recentContextMenuEvents = @($contextMenuLines | Select-Object -Last 30)

  $openCount = @($lines | Where-Object { $_ -match '"type":"context-menu:open"' }).Count
  $popupCount = @($lines | Where-Object { $_ -match '"type":"context-menu:popup"' }).Count
  $closedCount = @($lines | Where-Object { $_ -match '"type":"context-menu:closed"' }).Count
  $dedupedCount = @($lines | Where-Object { $_ -match '"type":"context-menu:deduped"' }).Count
  $errorCount = @($lines | Where-Object { $_ -match '"type":"context-menu:error"' }).Count

  Assert-PetWindowStable $before $after $MaxWindowDriftPx
  Assert-ContextMenuEvents $SequentialClicks $popupCount $closedCount $errorCount

  Write-Trace "output-start"
  Write-Output "processId=$($mainProcess.ProcessId)"
  Write-Output "burstClicks=$BurstClicks"
  Write-Output "sequentialClicks=$SequentialClicks"
  Write-Output "edgePlacement=$EdgePlacement"
  Write-Output "before=$($before.Left),$($before.Top),$($before.Right),$($before.Bottom)"
  Write-Output "after=$($after.Left),$($after.Top),$($after.Right),$($after.Bottom)"
  Write-Output "contextMenuOpenCount=$openCount"
  Write-Output "contextMenuPopupCount=$popupCount"
  Write-Output "contextMenuClosedCount=$closedCount"
  Write-Output "contextMenuDedupedCount=$dedupedCount"
  Write-Output "contextMenuErrorCount=$errorCount"
  Write-Output "recentContextMenuEvents:"
  $recentContextMenuEvents | ForEach-Object { Write-Output $_ }
  Write-Trace "output-complete"
} finally {
  Release-TestMouseButtons
  if ($hwnd -ne [IntPtr]::Zero) {
    Close-PetContextMenu $hwnd
    Restore-PetWindowRect $hwnd $originalWindowRect
  }
  Restore-TestCursorPosition $originalCursor
}
