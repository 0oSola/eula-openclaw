import test from "node:test";
import assert from "node:assert/strict";

let machineModule;
try {
  machineModule = await import("../src/features/stage/stageInteractionMachine.js");
} catch (error) {
  assert.fail(`stage interaction machine should be importable: ${error.message}`);
}

const {
  clearStagePendingAutoResume,
  completeStageInteraction,
  createDefaultStageInteraction,
  markStageInteractionRecovering,
  recoverStageInteraction,
  resetStageInteraction,
  startAutoplayLoop,
  startChatInteraction,
  startStageClickInteraction,
  startManualPreview,
  updateStageActiveVmdAsset,
} = machineModule;

function vmdInteraction(url = "/assets/vmd/file/a") {
  return {
    emotion: "happy",
    action: "idle",
    mode: "vmd",
    vmdUrl: url,
    vmdLoopUrls: [url, "/assets/vmd/file/b"],
    vmdLoopEmotionByUrl: { [url]: "happy" },
    standbyVmdUrl: "",
    loopGapMs: 0,
    loopMode: "random",
    playbackRate: 1,
    sequence: [],
  };
}

function proceduralInteraction(action = "wave") {
  return {
    emotion: "happy",
    action,
    mode: "procedural",
    vmdUrl: "",
    vmdLoopUrls: [],
    vmdLoopEmotionByUrl: {},
    standbyVmdUrl: "",
    loopGapMs: 0,
    loopMode: "random",
    playbackRate: 1,
    sequence: [],
  };
}

test("resetStageInteraction returns explicit default idle state", () => {
  const defaultInteraction = createDefaultStageInteraction();

  assert.deepEqual(resetStageInteraction({ defaultInteraction }), {
    mode: "default_idle",
    source: "default",
    interaction: defaultInteraction,
    activeVmdAssetId: "",
    pendingAutoResume: false,
  });
});

test("startAutoplayLoop marks favorite VMD loop as the active stage state", () => {
  const interaction = vmdInteraction("/assets/vmd/file/favorite");

  assert.deepEqual(
    startAutoplayLoop({
      interaction,
      activeVmdAssetId: "favorite-id",
    }),
    {
      mode: "autoplay_loop",
      source: "autoplay",
      interaction,
      activeVmdAssetId: "favorite-id",
      pendingAutoResume: false,
    },
  );
});

test("manual preview keeps pending autoplay resume state separate from autoplay loop", () => {
  const interaction = vmdInteraction("/assets/vmd/file/preview");

  assert.deepEqual(
    startManualPreview({
      interaction,
      activeVmdAssetId: "preview-id",
      canAutoResume: true,
    }),
    {
      mode: "manual_preview",
      source: "manual-preview",
      interaction,
      activeVmdAssetId: "preview-id",
      pendingAutoResume: true,
    },
  );
});

test("chat interactions distinguish VMD actions from procedural actions", () => {
  assert.equal(
    startChatInteraction({
      interaction: vmdInteraction("/assets/vmd/file/chat"),
      activeVmdAssetId: "chat-vmd",
      canAutoResume: true,
    }).mode,
    "chat_vmd_action",
  );
  assert.equal(
    startChatInteraction({
      interaction: proceduralInteraction("nod"),
      activeVmdAssetId: "",
      canAutoResume: false,
    }).mode,
    "chat_procedural_action",
  );
});

test("click interactions distinguish VMD actions from procedural fallback actions", () => {
  assert.deepEqual(
    startStageClickInteraction({
      interaction: vmdInteraction("/assets/vmd/file/click"),
      activeVmdAssetId: "click-vmd",
      canAutoResume: true,
    }),
    {
      mode: "stage_click_vmd_action",
      source: "stage-click",
      interaction: vmdInteraction("/assets/vmd/file/click"),
      activeVmdAssetId: "click-vmd",
      pendingAutoResume: true,
    },
  );

  assert.equal(
    startStageClickInteraction({
      interaction: proceduralInteraction("wave"),
      activeVmdAssetId: "",
      canAutoResume: false,
    }).mode,
    "stage_click_procedural_action",
  );
});

test("completeStageInteraction returns to fresh autoplay when favorite loop is available", () => {
  const stale = vmdInteraction("/assets/vmd/file/stale");
  const fresh = vmdInteraction("/assets/vmd/file/fresh");
  const defaultInteraction = createDefaultStageInteraction();

  assert.deepEqual(
    completeStageInteraction({
      autoplayResumeInteraction: stale,
      createAutoplayResumeInteraction() {
        return fresh;
      },
      defaultInteraction,
      resolveAutoplayAssetId(interaction) {
        return interaction.vmdUrl.endsWith("/fresh") ? "fresh-id" : "";
      },
    }),
    {
      mode: "autoplay_loop",
      source: "autoplay",
      interaction: fresh,
      activeVmdAssetId: "fresh-id",
      pendingAutoResume: false,
    },
  );
});

test("recoverStageInteraction falls back to default idle when autoplay is unavailable", () => {
  const defaultInteraction = createDefaultStageInteraction();

  assert.deepEqual(
    recoverStageInteraction({
      autoplayResumeInteraction: null,
      defaultInteraction,
      autoplayAssetId: "stale",
    }),
    {
      mode: "default_idle",
      source: "default",
      interaction: defaultInteraction,
      activeVmdAssetId: "",
      pendingAutoResume: false,
    },
  );
});

test("recovering and lightweight updates preserve the current interaction", () => {
  const state = startChatInteraction({
    interaction: proceduralInteraction("think"),
    activeVmdAssetId: "",
    canAutoResume: true,
  });

  assert.deepEqual(markStageInteractionRecovering(state), { ...state, mode: "recovering" });
  assert.deepEqual(clearStagePendingAutoResume(state), { ...state, pendingAutoResume: false });
  assert.deepEqual(updateStageActiveVmdAsset(state, "asset-next"), { ...state, activeVmdAssetId: "asset-next" });
});
