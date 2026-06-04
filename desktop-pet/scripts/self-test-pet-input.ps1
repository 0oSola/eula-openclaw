param(
  [string]$LogPath = "D:\workspace\MMD project\.worktrees\desktop-mmd-codex-pet\desktop-pet-debug-events.ndjson",
  [switch]$AllowMouseControl,
  [switch]$KeepPetWindowPlacement
)

$ErrorActionPreference = "Stop"

if (-not $AllowMouseControl) {
  throw "This script sends real mouse input and drags the Pet window. Re-run with -AllowMouseControl from an idle desktop session."
}

$mainProcess = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "electron.exe" -and
    $_.CommandLine -match 'desktop-pet\\node_modules\\electron\\dist\\electron\.exe" \.'
  } |
  Select-Object -First 1

if (-not $mainProcess) {
  throw "desktop-pet Electron main process was not found."
}

$code = @"
using System;
using System.Runtime.InteropServices;
public static class PetInputSelfTest {
  public const uint WM_CANCELMODE = 0x001F;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint VK_ESCAPE = 0x1B;
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, UIntPtr wParam, IntPtr lParam);
  public const uint SWP_NOZORDER = 0x0004;
  public const uint SWP_NOACTIVATE = 0x0010;
}
"@

Add-Type -TypeDefinition $code

function Get-TestCursorPosition {
  $point = New-Object PetInputSelfTest+POINT
  [PetInputSelfTest]::GetCursorPos([ref]$point) | Out-Null
  return $point
}

function Restore-TestCursorPosition($point) {
  if (-not $point) { return }
  [PetInputSelfTest]::SetCursorPos($point.X, $point.Y) | Out-Null
}

function Release-TestMouseButtons {
  [PetInputSelfTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  [PetInputSelfTest]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
}

function Restore-PetWindowRect([IntPtr]$targetHwnd, $rect) {
  if ($targetHwnd -eq [IntPtr]::Zero -or -not $rect -or $KeepPetWindowPlacement) { return }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  [PetInputSelfTest]::SetWindowPos(
    $targetHwnd,
    [IntPtr]::Zero,
    $rect.Left,
    $rect.Top,
    $width,
    $height,
    [PetInputSelfTest]::SWP_NOZORDER -bor [PetInputSelfTest]::SWP_NOACTIVATE
  ) | Out-Null
}

function Close-PetContextMenu([IntPtr]$targetHwnd) {
  [PetInputSelfTest]::PostMessage(
    $targetHwnd,
    [PetInputSelfTest]::WM_CANCELMODE,
    [UIntPtr]::Zero,
    [IntPtr]::Zero
  ) | Out-Null
  Start-Sleep -Milliseconds 40
  [PetInputSelfTest]::PostMessage(
    $targetHwnd,
    [PetInputSelfTest]::WM_KEYDOWN,
    [UIntPtr]([PetInputSelfTest]::VK_ESCAPE),
    [IntPtr]::Zero
  ) | Out-Null
  Start-Sleep -Milliseconds 40
  [PetInputSelfTest]::PostMessage(
    $targetHwnd,
    [PetInputSelfTest]::WM_KEYUP,
    [UIntPtr]([PetInputSelfTest]::VK_ESCAPE),
    [IntPtr]::Zero
  ) | Out-Null
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

  $before = New-Object PetInputSelfTest+RECT
  [PetInputSelfTest]::GetWindowRect($hwnd, [ref]$before) | Out-Null
  $originalWindowRect = $before
  $cx = [int](($before.Left + $before.Right) / 2)
  $cy = [int](($before.Top + $before.Bottom) / 2)

  [PetInputSelfTest]::SetForegroundWindow($hwnd) | Out-Null
  Start-Sleep -Milliseconds 250

  [PetInputSelfTest]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 100
  [PetInputSelfTest]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [PetInputSelfTest]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 700
  Close-PetContextMenu $hwnd
  Start-Sleep -Milliseconds 250

  [PetInputSelfTest]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 100
  [PetInputSelfTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
  [PetInputSelfTest]::SetCursorPos($cx + 70, $cy + 40) | Out-Null
  [PetInputSelfTest]::mouse_event(0x0001, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 180
  [PetInputSelfTest]::SetCursorPos($cx + 100, $cy + 60) | Out-Null
  [PetInputSelfTest]::mouse_event(0x0001, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
  [PetInputSelfTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 700

  $after = New-Object PetInputSelfTest+RECT
  [PetInputSelfTest]::GetWindowRect($hwnd, [ref]$after) | Out-Null

  [pscustomobject]@{
    processId = $mainProcess.ProcessId
    before = "$($before.Left),$($before.Top),$($before.Right),$($before.Bottom)"
    after = "$($after.Left),$($after.Top),$($after.Right),$($after.Bottom)"
    movedX = $after.Left - $before.Left
    movedY = $after.Top - $before.Top
    restoredWindow = -not $KeepPetWindowPlacement
    restoredCursor = $true
    log = if (Test-Path -LiteralPath $LogPath) { @(Get-Content -LiteralPath $LogPath) } else { @() }
  } | ConvertTo-Json -Depth 8
} finally {
  Release-TestMouseButtons
  if ($hwnd -ne [IntPtr]::Zero) {
    Close-PetContextMenu $hwnd
    Restore-PetWindowRect $hwnd $originalWindowRect
  }
  Restore-TestCursorPosition $originalCursor
}
