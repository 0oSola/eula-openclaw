import assert from "node:assert/strict";

import { createVmdPreviewInteraction } from "../src/features/mapping/vmdPreview.js";

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

console.log("vmd preview checks passed");
