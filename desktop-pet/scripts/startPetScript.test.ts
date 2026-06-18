import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("start-pet script", () => {
  it("auto-detects the dev-stack API URL when -ApiBaseUrl is omitted", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "start-pet.ps1"), "utf8");

    expect(source).toContain("function Resolve-DefaultApiBaseUrl");
    expect(source).toContain(".runtime\\dev-stack.json");
    expect(source).toContain("MMD_PET_API_BASE_URL");
    expect(source).toContain("$resolvedApiBaseUrl = Resolve-DefaultApiBaseUrl");
    expect(source).toContain("$env:MMD_PET_API_BASE_URL = $resolvedApiBaseUrl");
  });

  it("starts only background helpers hidden, not the interactive Electron pet window", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "start-pet.ps1"), "utf8");
    const hiddenHelperBlock = source.slice(
      source.indexOf("function Start-HiddenPowerShell"),
      source.indexOf("function Get-DesktopPetMainProcesses"),
    );
    const electronLaunchBlock = source.slice(
      source.indexOf("$electronProcess = Start-Process"),
      source.indexOf("} finally {"),
    );

    expect(hiddenHelperBlock).toContain("-WindowStyle Hidden");
    expect(electronLaunchBlock).toContain("$electronProcess = Start-Process");
    expect(electronLaunchBlock).not.toContain("-WindowStyle Hidden");
  });
});
