import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VMD_PLAYBACK_RATE,
  BUILT_IN_VMD_PLAYBACK_RATE,
  pickMotionFromPreset,
  resolveDefaultBuiltInMotionPresetForModel,
} from "../src/features/stage/builtInMotionPreferences.js";

function makeOneesanMotions() {
  return [
    {
      name: "Smelling Something in the Air.vmd",
      label: "Smelling Something in the Air",
      relative_path:
        "vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle Animations Pack - Copy/Air Scent Idle Animation/Smelling Something in the Air.vmd",
      url: "/assets/mmd/vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle%20Animations%20Pack%20-%20Copy/Air%20Scent%20Idle%20Animation/Smelling%20Something%20in%20the%20Air.vmd",
    },
    {
      name: "Shy.vmd",
      label: "Shy",
      relative_path:
        "vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle Animations Pack - Copy/Shy Idle Animation/Shy.vmd",
      url: "/assets/mmd/vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle%20Animations%20Pack%20-%20Copy/Shy%20Idle%20Animation/Shy.vmd",
    },
    {
      name: "Crossed Arms Look Around Confident.vmd",
      label: "Crossed Arms Look Around Confident",
      relative_path:
        "vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle Animations Pack - Copy/Confident Idle Animation/Crossed Arms Look Around Confident.vmd",
      url: "/assets/mmd/vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle%20Animations%20Pack%20-%20Copy/Confident%20Idle%20Animation/Crossed%20Arms%20Look%20Around%20Confident.vmd",
    },
  ];
}

test("Eula resolves to the reusable oneesan idle preset when the full motion set is available", () => {
  const model = {
    name: "优菈.pmx",
    label: "优菈_by_原神",
    relative_path: "优菈_by_原神/优菈.pmx",
  };
  const motions = makeOneesanMotions();

  const preset = resolveDefaultBuiltInMotionPresetForModel(model, motions);

  assert.ok(preset);
  assert.equal(preset.key, "oneesan_idle_loop");
  assert.equal(preset.archetypeKey, "oneesan");
  assert.equal(preset.archetypeLabel, "御姐体型");
  assert.equal(preset.playbackRate, BUILT_IN_VMD_PLAYBACK_RATE);
  assert.deepEqual(
    preset.motions.map((motion) => motion.label),
    ["Smelling Something in the Air", "Shy", "Crossed Arms Look Around Confident"],
  );
});

test("non-Eula models do not get the oneesan idle preset by default", () => {
  const model = {
    name: "GirlsFrontline NemesisGnosisDefault.pmx",
    label: "纳美西丝·衍光原皮",
    relative_path: "纳美西丝·衍光原皮/GirlsFrontline NemesisGnosisDefault.pmx",
  };

  assert.equal(resolveDefaultBuiltInMotionPresetForModel(model, makeOneesanMotions()), null);
});

test("pickMotionFromPreset deterministically selects motions from the reusable preset", () => {
  const preset = {
    motions: makeOneesanMotions(),
  };

  assert.equal(pickMotionFromPreset(preset, 0)?.label, "Smelling Something in the Air");
  assert.equal(pickMotionFromPreset(preset, 0.4)?.label, "Shy");
  assert.equal(pickMotionFromPreset(preset, 0.8)?.label, "Crossed Arms Look Around Confident");
});

test("built-in motions stay faster while generic VMD playback stays at normal speed", () => {
  assert.equal(DEFAULT_VMD_PLAYBACK_RATE, 1);
  assert.equal(BUILT_IN_VMD_PLAYBACK_RATE, 1.8);
  assert.ok(BUILT_IN_VMD_PLAYBACK_RATE > DEFAULT_VMD_PLAYBACK_RATE);
});
