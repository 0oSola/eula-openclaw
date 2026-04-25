export const BUILT_IN_VMD_PLAYBACK_RATE = 1.5;

export const BUILT_IN_IDLE_PRESETS = {
  oneesan_idle_loop: {
    key: "oneesan_idle_loop",
    label: "Oneesan Idle Loop",
    archetypeKey: "oneesan",
    archetypeLabel: "御姐体型",
    playbackRate: BUILT_IN_VMD_PLAYBACK_RATE,
    motionHints: [
      "smelling something in the air",
      "shy idle animation",
      "crossed arms look around confident",
    ],
  },
};

export const BUILT_IN_CHARACTER_ARCHETYPES = {
  oneesan: {
    key: "oneesan",
    label: "御姐体型",
    defaultIdlePresetKey: "oneesan_idle_loop",
    modelHints: [
      "eula",
      "\u4f18\u83c8",
      "\u6d7c\u6a38\u8ecc",
      "339146e6e418d79e85a515b26414c0b0",
    ],
  },
};

function normalizeText(value) {
  return `${value || ""}`.trim().toLowerCase();
}

function describeModel(model) {
  return [model?.name, model?.label, model?.relative_path].map(normalizeText).join(" ");
}

function describeMotion(motion) {
  return [motion?.name, motion?.label, motion?.relative_path].map(normalizeText).join(" ");
}

export function isEulaModel(model) {
  const text = describeModel(model);
  return BUILT_IN_CHARACTER_ARCHETYPES.oneesan.modelHints.some((hint) => text.includes(hint));
}

export function resolveCharacterArchetypeForModel(model) {
  const text = describeModel(model);
  return Object.values(BUILT_IN_CHARACTER_ARCHETYPES).find((archetype) =>
    archetype.modelHints.some((hint) => text.includes(hint)),
  );
}

export function resolveBuiltInIdlePreset(key, motions) {
  const preset = BUILT_IN_IDLE_PRESETS[key];
  if (!preset || !Array.isArray(motions)) return null;

  const resolvedMotions = preset.motionHints
    .map((hint) => motions.find((motion) => describeMotion(motion).includes(hint)))
    .filter(Boolean);

  if (resolvedMotions.length !== preset.motionHints.length) return null;

  return {
    key: preset.key,
    label: preset.label,
    archetypeKey: preset.archetypeKey,
    archetypeLabel: preset.archetypeLabel,
    playbackRate: preset.playbackRate,
    motions: resolvedMotions,
  };
}

export function resolveDefaultBuiltInMotionPresetForModel(model, motions) {
  const archetype = resolveCharacterArchetypeForModel(model);
  if (!archetype) return null;
  const preset = resolveBuiltInIdlePreset(archetype.defaultIdlePresetKey, motions);
  if (!preset) return null;
  return {
    ...preset,
    archetypeKey: archetype.key,
    archetypeLabel: archetype.label,
  };
}

export function pickMotionFromPreset(preset, randomValue = Math.random()) {
  if (!preset?.motions?.length) return null;
  const clamped = Math.min(0.999999, Math.max(0, Number(randomValue) || 0));
  const index = Math.floor(clamped * preset.motions.length);
  return preset.motions[index] || preset.motions[0] || null;
}
