import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoplayResumeInteraction,
  buildAutoFavoriteInteraction,
  createIdleVmdFallbackInteraction,
  createVmdPreviewInteraction,
  createDefaultFavoriteLoopInteraction,
  excludeCompanionUnsafeAssets,
} from "../src/features/mapping/vmdPreview.js";

function makeAsset(filename, companionSafe = true, category = "") {
  return {
    asset_id: filename.replace(/\.vmd$/i, ""),
    filename,
    display_name: filename,
    slot: "neutral",
    url: `/assets/vmd/file/${filename}`,
    favorite_relative_path: category ? `usage/vmd/Eula[动作]/${category}/${filename}` : undefined,
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

test("autoplay resume starts from a random favorite motion instead of the fixed first asset", () => {
  const first = makeAsset("idle-a.vmd", true);
  const middle = makeAsset("idle-b.vmd", true);
  const last = makeAsset("idle-c.vmd", true);

  const interaction = buildAutoplayResumeInteraction([first, middle, last], { randomValue: 0.8 });

  assert.equal(interaction.vmdUrl, last.url);
  assert.deepEqual(interaction.vmdLoopUrls, [first.url, middle.url, last.url]);
  assert.equal(interaction.loopMode, "random");
});

test("favorite autoplay prefers the categorized idle loop pool", () => {
  const answer = makeAsset("answer.vmd", true, "04_answering_explain");
  const firstIdle = makeAsset("idle-a.vmd", true, "00_idle_loop");
  const secondIdle = makeAsset("idle-b.vmd", true, "00_idle_loop");
  const strong = makeAsset("strong.vmd", true, "06_strong_personality");

  const interaction = buildAutoFavoriteInteraction([answer, firstIdle, secondIdle, strong], { randomValue: 0.9 });

  assert.equal(interaction.vmdUrl, secondIdle.url);
  assert.deepEqual(interaction.vmdLoopUrls, [firstIdle.url, secondIdle.url]);
});

test("idle VMD fallback chooses idle loop motions before legacy safe favorites", () => {
  const answer = makeAsset("answer.vmd", true, "04_answering_explain");
  const firstIdle = makeAsset("idle-a.vmd", true, "00_idle_loop");
  const secondIdle = makeAsset("idle-b.vmd", true, "00_idle_loop");

  const fallback = createIdleVmdFallbackInteraction([answer, firstIdle, secondIdle], {
    emotion: "thinking",
    randomValue: 0.75,
  });

  assert.equal(fallback.activeVmdAssetId, "idle-b");
  assert.equal(fallback.interaction.vmdUrl, secondIdle.url);
  assert.deepEqual(fallback.interaction.vmdLoopUrls, []);
  assert.deepEqual(fallback.interaction.vmdLoopEmotionByUrl, { [secondIdle.url]: "thinking" });
});
