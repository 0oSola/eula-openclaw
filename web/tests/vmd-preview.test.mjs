import test from "node:test";
import assert from "node:assert/strict";

import {
  createVmdPreviewInteraction,
  createDefaultFavoriteLoopInteraction,
  excludeCompanionUnsafeAssets,
} from "../src/features/mapping/vmdPreview.js";

function makeAsset(filename, companionSafe = true) {
  return {
    filename,
    display_name: filename,
    slot: "neutral",
    url: `/assets/vmd/file/${filename}`,
    motion_profile: {
      lower_body_motion_score: companionSafe ? 0 : 1.2,
      lower_body_track_count: companionSafe ? 0 : 1,
      companion_safe: companionSafe,
    },
  };
}

test("favorite VMD autoplay excludes motions with heavy lower-body tracks", () => {
  const safe = makeAsset("upper-body.vmd", true);
  const unsafe = makeAsset("leg-lift.vmd", false);

  assert.deepEqual(excludeCompanionUnsafeAssets([unsafe, safe]), [safe]);

  const interaction = createDefaultFavoriteLoopInteraction([unsafe, safe]);
  assert.equal(interaction.vmdUrl, safe.url);
  assert.deepEqual(interaction.vmdLoopUrls, [safe.url]);
  assert.equal(interaction.lockLowerBody, undefined);
  assert.equal(interaction.disableCrossfade, undefined);
});

test("unsafe VMD preview enables companion playback guards", () => {
  const unsafe = makeAsset("leg-lift.vmd", false);
  const interaction = createVmdPreviewInteraction(unsafe);

  assert.equal(interaction.lockLowerBody, true);
  assert.equal(interaction.disableCrossfade, true);
});

test("safe VMD preview also uses standing playback guards", () => {
  const safe = makeAsset("upper-body.vmd", true);
  const interaction = createVmdPreviewInteraction(safe);

  assert.equal(interaction.lockLowerBody, true);
  assert.equal(interaction.disableCrossfade, true);
});

test("favorite VMD autoplay accepts legacy assets without motion profile", () => {
  const legacy = {
    filename: "legacy.vmd",
    display_name: "legacy.vmd",
    slot: "neutral",
    url: "/assets/vmd/file/legacy",
  };

  const interaction = createDefaultFavoriteLoopInteraction([legacy]);
  assert.equal(interaction.vmdUrl, legacy.url);
});
