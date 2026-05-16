import test from "node:test";
import assert from "node:assert/strict";

let recoveryModule;
try {
  recoveryModule = await import("../src/features/stage/stageActionRecovery.js");
} catch (error) {
  assert.fail(`stage action recovery helper should be importable: ${error.message}`);
}

const {
  STAGE_ACTION_ERROR_RECOVERY_DELAY_MS,
  scheduleStageActionRecovery,
  resolveStageActionCompletionRecovery,
  resolveStageActionIdleRecovery,
} = recoveryModule;

test("scheduleStageActionRecovery waits 3 seconds before recovering", () => {
  const scheduled = [];
  const timerId = scheduleStageActionRecovery({
    recover() {},
    setTimeoutFn(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return 42;
    },
  });

  assert.equal(timerId, 42);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, STAGE_ACTION_ERROR_RECOVERY_DELAY_MS);
  assert.equal(scheduled[0].delayMs, 3000);
});

test("scheduleStageActionRecovery replaces any pending recovery timer", () => {
  const cleared = [];
  const timerId = scheduleStageActionRecovery({
    previousTimerId: 12,
    recover() {},
    clearTimeoutFn(timer) {
      cleared.push(timer);
    },
    setTimeoutFn() {
      return 13;
    },
  });

  assert.equal(timerId, 13);
  assert.deepEqual(cleared, [12]);
});

test("scheduleStageActionRecovery runs the recovery callback when the timer fires", () => {
  let scheduledCallback = null;
  let recoverCalls = 0;

  scheduleStageActionRecovery({
    recover() {
      recoverCalls += 1;
    },
    setTimeoutFn(callback) {
      scheduledCallback = callback;
      return 1;
    },
  });

  assert.equal(recoverCalls, 0);
  scheduledCallback();
  assert.equal(recoverCalls, 1);
});

test("resolveStageActionIdleRecovery resumes autoplay interaction when one exists", () => {
  const autoplayInteraction = {
    mode: "vmd",
    action: "idle",
    emotion: "neutral",
    vmdUrl: "/assets/vmd/file/idle-loop",
  };
  const defaultInteraction = {
    mode: "procedural",
    action: "idle",
    emotion: "neutral",
    vmdUrl: "",
  };

  assert.deepEqual(
    resolveStageActionIdleRecovery({
      autoplayResumeInteraction: autoplayInteraction,
      defaultInteraction,
      autoplayAssetId: "asset-idle-loop",
    }),
    {
      interaction: autoplayInteraction,
      source: "autoplay",
      activeVmdAssetId: "asset-idle-loop",
      pendingAutoResume: false,
    },
  );
});

test("resolveStageActionIdleRecovery falls back to procedural idle when no autoplay interaction exists", () => {
  const defaultInteraction = {
    mode: "procedural",
    action: "idle",
    emotion: "neutral",
    vmdUrl: "",
  };

  assert.deepEqual(
    resolveStageActionIdleRecovery({
      autoplayResumeInteraction: null,
      defaultInteraction,
      autoplayAssetId: "stale-chat-motion",
    }),
    {
      interaction: defaultInteraction,
      source: "default",
      activeVmdAssetId: "",
      pendingAutoResume: false,
    },
  );
});

test("resolveStageActionCompletionRecovery returns to favorite autoplay loop even when no resume flag is pending", () => {
  const favoriteLoopInteraction = {
    mode: "vmd",
    action: "idle",
    emotion: "happy",
    vmdUrl: "/assets/vmd/file/favorite-a",
    vmdLoopUrls: ["/assets/vmd/file/favorite-a", "/assets/vmd/file/favorite-b"],
    loopMode: "random",
  };
  const defaultInteraction = {
    mode: "procedural",
    action: "idle",
    emotion: "neutral",
    vmdUrl: "",
  };

  assert.deepEqual(
    resolveStageActionCompletionRecovery({
      pendingAutoResume: false,
      autoplayResumeInteraction: favoriteLoopInteraction,
      defaultInteraction,
      autoplayAssetId: "favorite-a",
    }),
    {
      interaction: favoriteLoopInteraction,
      source: "autoplay",
      activeVmdAssetId: "favorite-a",
      pendingAutoResume: false,
    },
  );
});

test("resolveStageActionCompletionRecovery uses a fresh autoplay interaction factory when provided", () => {
  const staleAutoplayInteraction = {
    mode: "vmd",
    action: "idle",
    emotion: "neutral",
    vmdUrl: "/assets/vmd/file/stale",
    vmdLoopUrls: ["/assets/vmd/file/stale"],
    loopMode: "random",
  };
  const freshAutoplayInteraction = {
    mode: "vmd",
    action: "idle",
    emotion: "happy",
    vmdUrl: "/assets/vmd/file/fresh",
    vmdLoopUrls: ["/assets/vmd/file/fresh", "/assets/vmd/file/next"],
    loopMode: "random",
  };
  const defaultInteraction = {
    mode: "procedural",
    action: "idle",
    emotion: "neutral",
    vmdUrl: "",
  };

  assert.deepEqual(
    resolveStageActionCompletionRecovery({
      autoplayResumeInteraction: staleAutoplayInteraction,
      createAutoplayResumeInteraction() {
        return freshAutoplayInteraction;
      },
      defaultInteraction,
      resolveAutoplayAssetId(interaction) {
        return interaction.vmdUrl.endsWith("/fresh") ? "fresh-id" : "";
      },
    }),
    {
      interaction: freshAutoplayInteraction,
      source: "autoplay",
      activeVmdAssetId: "fresh-id",
      pendingAutoResume: false,
    },
  );
});
