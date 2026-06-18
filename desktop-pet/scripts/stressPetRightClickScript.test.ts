import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop pet Windows input scripts", () => {
  it.each(["stress-pet-right-click.ps1", "self-test-pet-input.ps1"])(
    "%s closes Pet menus without sending global Escape to the active command line",
    (scriptName) => {
      const script = readFileSync(path.resolve(__dirname, scriptName), "utf8");

      expect(script).not.toContain("keybd_event");
      expect(script).toContain("PostMessage");
      expect(script).toContain("WM_CANCELMODE");
      expect(script).toContain("Close-PetContextMenu $hwnd");
    },
  );

  it("supports a bounded screen-edge right-click acceptance run", () => {
    const script = readFileSync(path.resolve(__dirname, "stress-pet-right-click.ps1"), "utf8");

    expect(script).toContain("EdgePlacement");
    expect(script).toContain("BottomRight");
    expect(script).toContain("SetWindowPos");
    expect(script).toContain("MaxWindowDriftPx");
    expect(script).toContain("contextMenuPopupCount");
    expect(script).toContain("contextMenuClosedCount");
    expect(script).toMatch(/throw "desktop-pet window moved too far/);
    expect(script).toMatch(/throw "desktop-pet context menu did not open/);
  });

  it("brings the Pet window above other desktop windows before sending physical clicks", () => {
    const script = readFileSync(path.resolve(__dirname, "stress-pet-right-click.ps1"), "utf8");

    expect(script).toContain("HWND_TOPMOST");
    expect(script).toContain("Bring-PetWindowToFront $hwnd");
    expect(script).toContain("foreground-after-topmost");
  });

  it("traces which desktop window receives each physical right-click point", () => {
    const script = readFileSync(path.resolve(__dirname, "stress-pet-right-click.ps1"), "utf8");

    expect(script).toContain("WindowFromPoint");
    expect(script).toContain("GetAncestor");
    expect(script).toContain("GetWindowThreadProcessId");
    expect(script).toContain("Trace-ClickHitTarget");
    expect(script).toContain("hit-test:");
    expect(script).toContain("Trace-WindowHitGrid");
    expect(script).toContain("hit-grid:");
  });

  it("waits for each native context menu to close before sending the next physical right-click", () => {
    const script = readFileSync(path.resolve(__dirname, "stress-pet-right-click.ps1"), "utf8");

    expect(script).toContain("Wait-ContextMenuPopupCount");
    expect(script).toContain("Wait-ContextMenuClosedCount");
    expect(script).toContain("context-menu-popup-observed:");
    expect(script).toContain("context-menu-close-observed:");
    expect(script).toContain("sequential-click-retry:");
    expect(script).toContain("Wait-ContextMenuClosedCount ($index + 1) $initialLogLineCount");
  });

  it.each(["stress-pet-right-click.ps1", "self-test-pet-input.ps1"])(
    "%s requires explicit opt-in before controlling the real mouse",
    (scriptName) => {
      const script = readFileSync(path.resolve(__dirname, scriptName), "utf8");

      expect(script).toContain("[switch]$AllowMouseControl");
      expect(script).toContain("if (-not $AllowMouseControl)");
      expect(script).toContain("-AllowMouseControl");
    },
  );

  it.each(["stress-pet-right-click.ps1", "self-test-pet-input.ps1"])(
    "%s restores the user's cursor and Pet window after physical input",
    (scriptName) => {
      const script = readFileSync(path.resolve(__dirname, scriptName), "utf8");

      expect(script).toContain("GetCursorPos");
      expect(script).toContain("Restore-TestCursorPosition");
      expect(script).toContain("Release-TestMouseButtons");
      expect(script).toContain("Restore-PetWindowRect");
      expect(script).toContain("finally");
    },
  );
});

describe("desktop pet acceptance coverage documents", () => {
  const casesPath = path.resolve(__dirname, "../../docs/test-cases/desktop-pet-interaction-cases.md");
  const checklistPath = path.resolve(__dirname, "desktop-pet-manual-acceptance.md");

  it("does not leave pending interaction coverage markers in the test case matrix", () => {
    const cases = readFileSync(casesPath, "utf8");

    expect(cases).not.toMatch(/待补(?: E2E)?/);
  });

  it("marks PET-INT-024 and PET-INT-025 with runnable script or fixed checklist coverage", () => {
    const cases = readFileSync(casesPath, "utf8");

    expect(cases).toMatch(
      /\| PET-INT-024 \|[^\n]*\| 已覆盖脚本 \| `desktop-pet\/scripts\/stress-pet-right-click\.ps1`, `desktop-pet\/scripts\/desktop-pet-manual-acceptance\.md` \|/,
    );
    expect(cases).toMatch(
      /\| PET-INT-025 \|[^\n]*\| 已覆盖清单 \| `desktop-pet\/scripts\/desktop-pet-manual-acceptance\.md` \|/,
    );
  });

  it("keeps a fixed manual acceptance checklist for the remaining real-device flows", () => {
    const checklist = readFileSync(checklistPath, "utf8");

    for (const requiredText of [
      "PET-INT-024",
      "PET-INT-025",
      "启动",
      "右键",
      "拖动",
      "相机",
      "同步",
      "Codex 新建",
      "Codex 恢复",
      "stress-pet-right-click.ps1 -AllowMouseControl -EdgePlacement BottomRight",
      "Adjust Camera",
      "Drag Whole App",
      "重启恢复",
    ]) {
      expect(checklist).toContain(requiredText);
    }
  });
});

describe("desktop pet startup script", () => {
  const scriptPath = path.resolve(__dirname, "../start-pet.ps1");

  it("lives in the desktop-pet working directory and starts renderer/electron in the background", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("$PSScriptRoot");
    expect(script).toContain("npm run dev");
    expect(script).toContain("electron.exe");
    expect(script).toContain("Start-Process");
    expect(script).toContain("-WindowStyle Hidden");
    expect(script).toContain("MMD_PET_RENDERER_URL");
    expect(script).toContain("MMD_PET_DEBUG_EVENTS_LOG");
  });

  it("restarts an existing Pet window by default and reuses it only when requested", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain("[switch]$ForceNew");
    expect(script).toContain("[switch]$ReuseExisting");
    expect(script).toContain("Get-DesktopPetMainProcess");
    expect(script).toContain("Get-CimInstance Win32_Process");
    expect(script).toContain("desktop-pet\\\\node_modules\\\\electron\\\\dist\\\\electron\\.exe");
    expect(script).toContain("--type=");
    expect(script).toContain("if ($existingPet -and $ReuseExisting)");
    expect(script).toContain("Stop-DesktopPetMainProcesses");
  });

  it("prints key-value startup status for scripts and humans", () => {
    const script = readFileSync(scriptPath, "utf8");

    expect(script).toContain('Write-Output "status=already-running"');
    expect(script).toContain('Write-Output "status=restarting"');
    expect(script).toContain('Write-Output "status=started"');
    expect(script).toContain('Write-Output "stoppedElectronPids=');
    expect(script).toContain('Write-Output "electronPid=');
    expect(script).toContain('Write-Output "rendererUrl=');
  });
});
