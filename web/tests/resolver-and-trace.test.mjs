import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveActionConfig,
  resolvePlaybackPlan,
  shouldUseIdleVmdFallbackForUnmatchedMotion,
} from "../src/features/mapping/resolveAction.js";
import { buildTraceHeaders } from "../src/lib/trace.js";

test("resolveActionConfig uses user override before default mapping", () => {
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
});

test("resolvePlaybackPlan falls back to procedural when VMD metadata missing", () => {
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
});

test("resolvePlaybackPlan defaults to idle standing pose when no mapping or action exists", () => {
  const resolved = resolvePlaybackPlan({
    slot: "neutral",
    action: "",
    userMappings: {},
    defaultMappings: {},
    assetIndex: {},
  });

  assert.equal(resolved.mode, "procedural");
  assert.equal(resolved.action, "idle");
  assert.deepEqual(resolved.sequence, []);
});

test("resolvePlaybackPlan expands known motion templates into procedural sequence", () => {
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
});

test("resolvePlaybackPlan can route a motion template to mapped VMD asset", () => {
  const resolved = resolvePlaybackPlan({
    slot: "happy",
    action: "wave",
    motionPlan: {
      sequence: [{ template: "celebrate_big", duration_ms: 2400, intensity: 1 }],
    },
    userMappings: {
      celebrate_big: { kind: "vmd", value: "celebrate-vmd" },
    },
    defaultMappings: {},
    assetIndex: {
      "celebrate-vmd": { url: "/assets/vmd/celebrate.vmd" },
    },
  });

  assert.equal(resolved.mode, "vmd");
  assert.equal(resolved.url, "/assets/vmd/celebrate.vmd");
  assert.equal(resolved.assetId, "celebrate-vmd");
});

test("shouldUseIdleVmdFallbackForUnmatchedMotion detects missed custom motion keys but not procedural actions", () => {
  assert.equal(
    shouldUseIdleVmdFallbackForUnmatchedMotion({
      motionResolution: {
        status: "fallback_idle",
        source_action: "411a73ef-3169-400a-9f32-d193d171e65c",
        fallback_reason: "no_candidate_matched",
      },
      action: "411a73ef-3169-400a-9f32-d193d171e65c",
    }),
    true,
  );

  assert.equal(
    shouldUseIdleVmdFallbackForUnmatchedMotion({
      motionResolution: {
        status: "fallback_idle",
        source_action: "comfort",
        fallback_reason: "no_candidate_matched",
      },
      action: "comfort",
    }),
    false,
  );
});

test("buildTraceHeaders preserves provided trace id", () => {
  const headers = buildTraceHeaders("trace-fixed", "u1");
  assert.equal(headers["x-trace-id"], "trace-fixed");
  assert.equal(headers["x-user-id"], "u1");
});

test("buildTraceHeaders generates trace id when not provided", () => {
  const headers = buildTraceHeaders("", "u2");
  assert.ok(headers["x-trace-id"]);
  assert.equal(headers["x-user-id"], "u2");
});
