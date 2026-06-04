import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Desktop Pet App integration wiring", () => {
  it("uses Codex status helpers for notification detail, approval fallback, and MMD status motion", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("formatCodexStatusNotification");
    expect(source).toContain("buildApprovalFallback");
    expect(source).toContain("getCodexStatusPresentation");
    expect(source).toContain("buildCodexStatusPetStageResolution");
    expect(source).toContain("codexStatusInteraction");
    expect(source).toContain("approvalFallback");
  });

  it("observes API runtime status and retries MMD state loading when API becomes available", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("apiRuntimeStatus");
    expect(source).toContain("onChanged((status) =>");
    expect(source).toContain("if (status?.available) loadPetState();");
    expect(source).toContain("retryApiRuntime");
    expect(source).toContain("API unavailable");
  });

  it("wires explicit main-site sync to reload shared MMD config and remount the stage", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain('action.type === "sync-main-site"');
    expect(source).toContain("loadPetState({ syncFeedback: true })");
    expect(source).toContain("setStageReloadRevision((revision) => revision + 1)");
  });

  it("starts and recovers the MMD stage through the pet autoplay idle state", () => {
    const source = readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

    expect(source).toContain("buildPetAutoplayIdleState");
    expect(source).toContain("petAutoplayIdleState");
    expect(source).toContain("setStageInteractionState(petAutoplayIdleState)");
    expect(source).toContain("buildPetStageClickInteractionState(clickAction)");
    expect(source).toContain('stageInteractionState.source === "stage-click"');
  });
});
