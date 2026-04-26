import assert from "node:assert/strict";

import {
  buildAutoFavoriteInteraction,
  buildAutoplayResumeInteraction,
  createDefaultFavoriteLoopInteraction,
} from "../src/features/mapping/vmdPreview.js";
import { resolveActionConfig, resolvePlaybackPlan } from "../src/features/mapping/resolveAction.js";
import { buildTraceHeaders } from "../src/lib/trace.js";

function run() {
  {
    const resolved = resolveActionConfig({
      slot: "happy",
      userMappings: {
        happy: { kind: "procedural", value: "cheer" },
      },
      defaultMappings: {
        happy: { kind: "procedural", value: "wave" },
      },
    });
    assert.equal(resolved.kind, "procedural");
    assert.equal(resolved.value, "cheer");
  }

  {
    const resolved = resolvePlaybackPlan({
      slot: "happy",
      action: "wave",
      userMappings: {
        happy: { kind: "vmd", value: "missing-asset-id" },
      },
      defaultMappings: {},
      assetIndex: {},
    });
    assert.equal(resolved.mode, "procedural");
    assert.equal(resolved.action, "wave");
  }

  {
    const resolved = resolvePlaybackPlan({
      slot: "happy",
      action: "wave",
      motionPlan: {
        sequence: [
          { template: "greet_wave", duration_ms: 1200, intensity: 0.8 },
          { template: "listen_lean", duration_ms: 1800, intensity: 0.4 },
        ],
      },
      userMappings: {},
      defaultMappings: {},
      assetIndex: {},
    });
    assert.equal(resolved.mode, "procedural");
    assert.deepEqual(resolved.sequence, [
      { action: "wave", durationMs: 1200, intensity: 0.8, template: "greet_wave" },
      { action: "lean_in", durationMs: 1800, intensity: 0.4, template: "listen_lean" },
    ]);
  }

  {
    const loopInteraction = createDefaultFavoriteLoopInteraction([
      { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
      { display_name: "wave.vmd", filename: "wave.vmd", slot: "happy", url: "/wave.vmd" },
      { display_name: "nod.vmd", filename: "nod.vmd", slot: "happy", url: "/nod.vmd" },
    ]);
    assert.deepEqual(loopInteraction, {
      emotion: "happy",
      action: "idle",
      mode: "vmd",
      vmdUrl: "/wave.vmd",
      vmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
      standbyVmdUrl: "/standby.vmd",
      loopMode: "random",
      playbackRate: 1.2,
      sequence: [],
    });
  }

  {
    const loopInteraction = createDefaultFavoriteLoopInteraction([
      { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
    ]);
    assert.deepEqual(loopInteraction, {
      emotion: "neutral",
      action: "idle",
      mode: "vmd",
      vmdUrl: "/standby.vmd",
      vmdLoopUrls: [],
      standbyVmdUrl: "/standby.vmd",
      loopMode: "random",
      playbackRate: 1.2,
      sequence: [],
    });
  }

  {
    const autoInteraction = buildAutoFavoriteInteraction([
      { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
      { display_name: "wave.vmd", filename: "wave.vmd", slot: "happy", url: "/wave.vmd" },
      { display_name: "nod.vmd", filename: "nod.vmd", slot: "happy", url: "/nod.vmd" },
    ]);
    assert.deepEqual(autoInteraction, {
      emotion: "happy",
      action: "idle",
      mode: "vmd",
      vmdUrl: "/wave.vmd",
      vmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
      standbyVmdUrl: "/standby.vmd",
      loopMode: "random",
      playbackRate: 1.2,
      sequence: [],
    });
  }

  {
    const resumeInteraction = buildAutoplayResumeInteraction([
      { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
      { display_name: "wave.vmd", filename: "wave.vmd", slot: "happy", url: "/wave.vmd" },
      { display_name: "nod.vmd", filename: "nod.vmd", slot: "happy", url: "/nod.vmd" },
    ]);
    assert.deepEqual(resumeInteraction, {
      emotion: "happy",
      action: "idle",
      mode: "vmd",
      vmdUrl: "/standby.vmd",
      vmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
      standbyVmdUrl: "/standby.vmd",
      loopMode: "random",
      playbackRate: 1.2,
      sequence: [],
    });
  }

  {
    const resumeInteraction = buildAutoplayResumeInteraction([
      { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
    ]);
    assert.deepEqual(resumeInteraction, {
      emotion: "neutral",
      action: "idle",
      mode: "vmd",
      vmdUrl: "/standby.vmd",
      vmdLoopUrls: [],
      standbyVmdUrl: "/standby.vmd",
      loopMode: "random",
      playbackRate: 1.2,
      sequence: [],
    });
  }

  {
    const headers = buildTraceHeaders("trace-fixed", "u1");
    assert.equal(headers["x-trace-id"], "trace-fixed");
    assert.equal(headers["x-user-id"], "u1");
  }

  {
    const headers = buildTraceHeaders("", "u2");
    assert.ok(headers["x-trace-id"]);
    assert.equal(headers["x-user-id"], "u2");
  }

  console.log("basic checks passed");
}

run();
