const EMPTY_CONFIG = { kind: "procedural", value: "idle" };

const MOTION_TEMPLATE_LIBRARY = {
  agree_nod: { kind: "procedural", value: "nod", durationMs: 1000, intensity: 0.6 },
  celebrate_big: { kind: "procedural", value: "cheer", durationMs: 1800, intensity: 0.9 },
  comfort_lean: { kind: "procedural", value: "comfort", durationMs: 1600, intensity: 0.65 },
  disagree_headshake: { kind: "procedural", value: "headshake", durationMs: 1300, intensity: 0.7 },
  greet_wave: { kind: "procedural", value: "wave", durationMs: 1600, intensity: 0.7 },
  listen_lean: { kind: "procedural", value: "lean_in", durationMs: 1800, intensity: 0.45 },
  shy_look_away: { kind: "procedural", value: "look_away", durationMs: 1500, intensity: 0.55 },
  thinking_tilt: { kind: "procedural", value: "think", durationMs: 1700, intensity: 0.6 },
};

export function resolveActionConfig({ slot, userMappings, defaultMappings }) {
  if (slot && userMappings && userMappings[slot]) return userMappings[slot];
  if (slot && defaultMappings && defaultMappings[slot]) return defaultMappings[slot];
  return EMPTY_CONFIG;
}

function resolveTemplateConfig({ template, userMappings, defaultMappings }) {
  if (template && userMappings && userMappings[template]) return userMappings[template];
  if (template && defaultMappings && defaultMappings[template]) return defaultMappings[template];
  return MOTION_TEMPLATE_LIBRARY[template] || null;
}

function resolveMotionSequence({ motionPlan, userMappings, defaultMappings, assetIndex }) {
  if (!motionPlan?.sequence?.length) return null;

  const proceduralSteps = [];
  for (const step of motionPlan.sequence) {
    const template = step?.template;
    if (!template) continue;
    const config = resolveTemplateConfig({ template, userMappings, defaultMappings });
    if (!config) continue;

    if (config.kind === "vmd") {
      const asset = assetIndex?.[config.value];
      if (asset?.url && motionPlan.sequence.length === 1) {
        return { mode: "vmd", url: asset.url, assetId: config.value };
      }
      continue;
    }

    const fallback = MOTION_TEMPLATE_LIBRARY[template] || MOTION_TEMPLATE_LIBRARY.agree_nod;
    proceduralSteps.push({
      template,
      action: config.value || fallback.value,
      durationMs: Number(step.duration_ms) || fallback.durationMs,
      intensity: Number(step.intensity) || fallback.intensity,
    });
  }

  if (!proceduralSteps.length) return null;
  return {
    mode: "procedural",
    action: proceduralSteps[proceduralSteps.length - 1].action,
    sequence: proceduralSteps,
  };
}

export function resolvePlaybackPlan({
  slot,
  action,
  motionPlan,
  userMappings,
  defaultMappings,
  assetIndex,
}) {
  const resolvedMotion = resolveMotionSequence({
    motionPlan,
    userMappings,
    defaultMappings,
    assetIndex,
  });
  if (resolvedMotion) {
    return resolvedMotion;
  }

  const config = resolveActionConfig({ slot, userMappings, defaultMappings });
  if (config.kind === "vmd") {
    const asset = assetIndex?.[config.value];
    if (asset?.url) {
      return { mode: "vmd", url: asset.url, assetId: config.value };
    }
  }
  return {
    mode: "procedural",
    action: config.kind === "procedural" ? config.value || action || "idle" : action || "idle",
    sequence: [],
  };
}
