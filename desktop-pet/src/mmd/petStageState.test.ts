import { describe, expect, it } from "vitest";

import {
  buildCodexStatusPetStageResolution,
  buildPetAutoplayIdleState,
  buildPetIdleInteraction,
  buildPetStageClickInteraction,
  buildPetStageKey,
  pickSelectedModel,
  resolvePetStageInteractionWithFallback,
  selectFavoriteVmdUrls,
  shouldReplayCodexStatusMotionOnCompletion,
} from "./petStageState";

const models = [
  { relative_path: "Eula/Eula.pmx", url: "/assets/mmd/Eula/Eula.pmx", display_name: "Eula" },
  { relative_path: "Ayaka/Ayaka.pmx", url: "/assets/mmd/Ayaka/Ayaka.pmx", display_name: "Ayaka" },
];

describe("pet stage state", () => {
  it("selects configured model when available", () => {
    expect(pickSelectedModel(models as any, "Ayaka/Ayaka.pmx")?.relative_path).toBe("Ayaka/Ayaka.pmx");
  });

  it("falls back to first model", () => {
    expect(pickSelectedModel(models as any, "Missing.pmx")?.relative_path).toBe("Eula/Eula.pmx");
  });

  it("skips tiny placeholder models when no configured model is selected", () => {
    expect(
      pickSelectedModel(
        [
          { relative_path: "Tiny/Tiny.pmx", url: "/assets/mmd/Tiny/Tiny.pmx", display_name: "Tiny", size_bytes: 3 },
          {
            relative_path: "Visible/Visible.pmx",
            url: "/assets/mmd/Visible/Visible.pmx",
            display_name: "Visible",
            size_bytes: 2048,
          },
        ] as any,
        null,
      )?.relative_path,
    ).toBe("Visible/Visible.pmx");
  });

  it("keeps only current model favorite vmd assets", () => {
    const urls = selectFavoriteVmdUrls(
      [
        { is_favorite: true, favorite_model_relative_path: "Eula/Eula.pmx", asset_id: "a" },
        { is_favorite: true, favorite_model_relative_path: "Ayaka/Ayaka.pmx", asset_id: "b" },
        { is_favorite: false, favorite_model_relative_path: "Eula/Eula.pmx", asset_id: "c" },
      ] as any,
      "Eula/Eula.pmx",
    );

    expect(urls).toEqual(["/assets/vmd/file/a"]);
  });

  it("builds pet idle vmd interaction with the same autoplay priority as the main site", () => {
    const interaction = buildPetIdleInteraction(
      [
        {
          is_favorite: true,
          favorite_model_relative_path: "Eula/Eula.pmx",
          asset_id: "fallback",
          url: "/assets/vmd/file/fallback",
          favorite_relative_path: "Eula/03_thinking_waiting/fallback.vmd",
          slot: "thinking",
        },
        {
          is_favorite: true,
          favorite_model_relative_path: "Eula/Eula.pmx",
          asset_id: "idle",
          url: "/assets/vmd/file/idle",
          favorite_relative_path: "Eula/00_idle_loop/idle.vmd",
          slot: "neutral",
        },
        {
          is_favorite: true,
          favorite_model_relative_path: "Ayaka/Ayaka.pmx",
          asset_id: "other-model",
          url: "/assets/vmd/file/other-model",
          favorite_relative_path: "Ayaka/00_idle_loop/idle.vmd",
        },
      ] as any,
      "Eula/Eula.pmx",
      (url) => `https://api.local${url}`,
    );

    expect(interaction).toMatchObject({
      action: "idle",
      mode: "vmd",
      vmdUrl: "https://api.local/assets/vmd/file/idle",
      vmdLoopUrls: ["https://api.local/assets/vmd/file/idle"],
      vmdLoopEmotionByUrl: {
        "https://api.local/assets/vmd/file/idle": "neutral",
      },
      loopMode: "random",
    });
    expect(interaction.playbackRate).toBeGreaterThan(0);
  });

  it("starts the pet stage in autoplay idle when favorite idle vmd assets are available", () => {
    const state = buildPetAutoplayIdleState(
      [
        {
          is_favorite: true,
          favorite_model_relative_path: "Eula/Eula.pmx",
          asset_id: "idle",
          url: "/assets/vmd/file/idle",
          favorite_relative_path: "Eula/00_idle_loop/idle.vmd",
          slot: "neutral",
        },
      ] as any,
      "Eula/Eula.pmx",
      (url) => `https://api.local${url}`,
    );

    expect(state).toMatchObject({
      source: "autoplay",
      activeVmdAssetId: "idle",
      interaction: {
        action: "idle",
        mode: "vmd",
        vmdUrl: "https://api.local/assets/vmd/file/idle",
        vmdLoopUrls: ["https://api.local/assets/vmd/file/idle"],
      },
    });
  });

  it("builds pet click interactions with the same click-reaction priority as the main site", () => {
    const clickAction = buildPetStageClickInteraction({
      assets: [
        {
          is_favorite: true,
          favorite_model_relative_path: "Eula/Eula.pmx",
          asset_id: "idle",
          url: "/assets/vmd/file/idle",
          favorite_relative_path: "Eula/00_idle_loop/idle.vmd",
          slot: "neutral",
        },
        {
          is_favorite: true,
          favorite_model_relative_path: "Eula/Eula.pmx",
          asset_id: "click",
          url: "/assets/vmd/file/click",
          favorite_relative_path: "Eula/02_greeting_social/wave.vmd",
          slot: "happy",
        },
        {
          is_favorite: true,
          favorite_model_relative_path: "Ayaka/Ayaka.pmx",
          asset_id: "other-model",
          url: "/assets/vmd/file/other-model",
          favorite_relative_path: "Ayaka/02_greeting_social/wave.vmd",
          slot: "happy",
        },
      ] as any,
      selectedModelPath: "Eula/Eula.pmx",
      resolveUrl: (url) => `https://api.local${url}`,
    });

    expect(clickAction).toMatchObject({
      activeVmdAssetId: "click",
      interaction: {
        action: "click_react",
        mode: "vmd",
        vmdUrl: "https://api.local/assets/vmd/file/click",
        vmdLoopUrls: [],
        vmdLoopEmotionByUrl: {
          "https://api.local/assets/vmd/file/click": "happy",
        },
      },
    });
  });

  it("does not repeat the previous click motion when another click reaction is available", () => {
    const clickAction = buildPetStageClickInteraction({
      assets: [
        {
          is_favorite: true,
          favorite_model_relative_path: "Eula/Eula.pmx",
          asset_id: "previous",
          url: "/assets/vmd/file/previous",
          favorite_relative_path: "Eula/02_greeting_social/wave.vmd",
          slot: "happy",
        },
        {
          is_favorite: true,
          favorite_model_relative_path: "Eula/Eula.pmx",
          asset_id: "next",
          url: "/assets/vmd/file/next",
          favorite_relative_path: "Eula/05_soft_emotion/nod.vmd",
          slot: "soft",
        },
      ] as any,
      selectedModelPath: "Eula/Eula.pmx",
      previousActiveVmdAssetId: "previous",
      randomValue: 0,
    });

    expect(clickAction.activeVmdAssetId).toBe("next");
    expect(clickAction.interaction.vmdUrl).toBe("/assets/vmd/file/next");
  });

  it("falls back to a procedural pet click interaction when no click VMD is available", () => {
    const clickAction = buildPetStageClickInteraction({
      assets: [],
      selectedModelPath: "Eula/Eula.pmx",
    });

    expect(clickAction).toMatchObject({
      activeVmdAssetId: "",
      interaction: {
        action: "wave",
        mode: "procedural",
      },
    });
  });

  it("builds a stage key that changes when explicit sync reloads", () => {
    expect(buildPetStageKey("Eula/Eula.pmx", "mio-reference", 0)).toBe("Eula/Eula.pmx::mio-reference::0");
    expect(buildPetStageKey("Eula/Eula.pmx", "mio-reference", 1)).toBe("Eula/Eula.pmx::mio-reference::1");
  });

  it("maps Codex motion intents to procedural status interactions", () => {
    expect(buildCodexStatusPetStageResolution({ motionIntent: "command", shouldInterruptIdle: true })).toMatchObject({
      priority: "codex-status",
      shouldApply: true,
      interaction: {
        mode: "procedural",
        emotion: "focused",
        action: "command_running",
      },
    });
    expect(buildCodexStatusPetStageResolution({ motionIntent: "approval", shouldInterruptIdle: true })).toMatchObject({
      priority: "codex-status",
      shouldApply: true,
      interaction: {
        mode: "procedural",
        emotion: "concerned",
        action: "approval_prompt",
      },
    });
  });

  it("uses the current favorite idle loop when a Codex status action has no playable hit", () => {
    const favoriteIdle = buildPetAutoplayIdleState(
      [
        {
          is_favorite: true,
          favorite_model_relative_path: "Eula/Eula.pmx",
          asset_id: "idle",
          url: "/assets/vmd/file/idle",
          favorite_relative_path: "Eula/00_idle_loop/idle.vmd",
          slot: "neutral",
        },
      ] as any,
      "Eula/Eula.pmx",
      (url) => `https://api.local${url}`,
    );
    const statusResolution = buildCodexStatusPetStageResolution({ motionIntent: "complete", shouldInterruptIdle: true });

    expect(
      resolvePetStageInteractionWithFallback(statusResolution.interaction, favoriteIdle.interaction),
    ).toEqual({
      interaction: favoriteIdle.interaction,
      fallbackApplied: true,
      reason: "unsupported-procedural-action",
    });
  });

  it("does not apply procedural idle when a Codex status action has no playable fallback", () => {
    const noFavoriteIdle = buildPetAutoplayIdleState([], "Eula/Eula.pmx");
    const statusResolution = buildCodexStatusPetStageResolution({ motionIntent: "complete", shouldInterruptIdle: true });

    expect(
      resolvePetStageInteractionWithFallback(statusResolution.interaction, noFavoriteIdle.interaction),
    ).toEqual({
      interaction: null,
      fallbackApplied: true,
      reason: "no-playable-fallback",
    });
  });

  it("keeps click reactions ahead of Codex status motions", () => {
    expect(
      buildCodexStatusPetStageResolution(
        { motionIntent: "failure", shouldInterruptIdle: true },
        { clickInteractionActive: true },
      ),
    ).toMatchObject({
      priority: "click-interaction",
      shouldApply: false,
      blockedBy: "click-interaction-active",
    });
  });

  it("replays active Codex status motions instead of falling back to idle after one procedural cycle", () => {
    expect(shouldReplayCodexStatusMotionOnCompletion("running")).toBe(true);
    expect(shouldReplayCodexStatusMotionOnCompletion("command_running")).toBe(true);
    expect(shouldReplayCodexStatusMotionOnCompletion("file_changed")).toBe(true);
    expect(shouldReplayCodexStatusMotionOnCompletion("waiting_approval")).toBe(true);

    expect(shouldReplayCodexStatusMotionOnCompletion("completed")).toBe(false);
    expect(shouldReplayCodexStatusMotionOnCompletion("failed")).toBe(false);
    expect(shouldReplayCodexStatusMotionOnCompletion("vscode-opened")).toBe(false);
  });
});
