import assert from "node:assert/strict";

import {
  buildAutoFavoriteInteraction,
  buildAutoplayResumeInteraction,
  createDefaultFavoriteLoopInteraction,
  createVmdPreviewInteraction,
} from "../src/features/mapping/vmdPreview.js";

const interaction = createVmdPreviewInteraction({
  asset_id: "asset-1",
  user_id: "u1",
  slot: "happy",
  filename: "wave.vmd",
  size_bytes: 1234,
  created_at: "2026-04-17T10:00:00Z",
  url: "/assets/vmd/file/asset-1",
});

assert.deepEqual(interaction, {
  emotion: "happy",
  action: "idle",
  mode: "vmd",
  vmdUrl: "/assets/vmd/file/asset-1",
  sequence: [],
});

assert.deepEqual(
  createDefaultFavoriteLoopInteraction([
    { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
    { display_name: "wave.vmd", filename: "wave.vmd", slot: "happy", url: "/wave.vmd" },
    { display_name: "nod.vmd", filename: "nod.vmd", slot: "happy", url: "/nod.vmd" },
  ]),
  {
    emotion: "happy",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/wave.vmd",
    vmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
    standbyVmdUrl: "/standby.vmd",
    loopMode: "random",
    playbackRate: 1.2,
    sequence: [],
  },
);

assert.deepEqual(
  createDefaultFavoriteLoopInteraction([
    { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
  ]),
  {
    emotion: "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/standby.vmd",
    vmdLoopUrls: [],
    standbyVmdUrl: "/standby.vmd",
    loopMode: "random",
    playbackRate: 1.2,
    sequence: [],
  },
);

assert.deepEqual(
  buildAutoFavoriteInteraction([
    { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
    { display_name: "wave.vmd", filename: "wave.vmd", slot: "happy", url: "/wave.vmd" },
    { display_name: "nod.vmd", filename: "nod.vmd", slot: "happy", url: "/nod.vmd" },
  ]),
  {
    emotion: "happy",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/wave.vmd",
    vmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
    standbyVmdUrl: "/standby.vmd",
    loopMode: "random",
    playbackRate: 1.2,
    sequence: [],
  },
);

assert.deepEqual(
  buildAutoplayResumeInteraction([
    { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
    { display_name: "wave.vmd", filename: "wave.vmd", slot: "happy", url: "/wave.vmd" },
    { display_name: "nod.vmd", filename: "nod.vmd", slot: "happy", url: "/nod.vmd" },
  ]),
  {
    emotion: "happy",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/standby.vmd",
    vmdLoopUrls: ["/wave.vmd", "/nod.vmd"],
    standbyVmdUrl: "/standby.vmd",
    loopMode: "random",
    playbackRate: 1.2,
    sequence: [],
  },
);

assert.deepEqual(
  buildAutoplayResumeInteraction([
    { display_name: "杩涘満寰呮満.vmd", filename: "杩涘満寰呮満.vmd", slot: "neutral", url: "/standby.vmd" },
  ]),
  {
    emotion: "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/standby.vmd",
    vmdLoopUrls: [],
    standbyVmdUrl: "/standby.vmd",
    loopMode: "random",
    playbackRate: 1.2,
    sequence: [],
  },
);

console.log("vmd preview checks passed");
