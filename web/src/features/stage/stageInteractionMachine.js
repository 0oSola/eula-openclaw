import { DEFAULT_VMD_PLAYBACK_RATE } from "./builtInMotionPreferences.js";
import {
  resolveStageActionCompletionRecovery,
  resolveStageActionIdleRecovery,
} from "./stageActionRecovery.js";

export const STAGE_INTERACTION_MODES = Object.freeze({
  DEFAULT_IDLE: "default_idle",
  AUTOPLAY_LOOP: "autoplay_loop",
  MANUAL_PREVIEW: "manual_preview",
  CHAT_VMD_ACTION: "chat_vmd_action",
  CHAT_PROCEDURAL_ACTION: "chat_procedural_action",
  STAGE_CLICK_VMD_ACTION: "stage_click_vmd_action",
  STAGE_CLICK_PROCEDURAL_ACTION: "stage_click_procedural_action",
  RECOVERING: "recovering",
});

/** @returns {any} */
export function createDefaultStageInteraction() {
  return {
    emotion: "neutral",
    action: "idle",
    mode: "procedural",
    vmdUrl: "",
    vmdLoopUrls: [],
    vmdLoopEmotionByUrl: {},
    standbyVmdUrl: "",
    loopGapMs: 0,
    loopMode: "random",
    playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
    sequence: [],
  };
}

/** @param {any} source */
function modeForRecoveredSource(source) {
  return source === "autoplay" ? STAGE_INTERACTION_MODES.AUTOPLAY_LOOP : STAGE_INTERACTION_MODES.DEFAULT_IDLE;
}

/** @param {any} interaction */
function modeForChatInteraction(interaction) {
  return interaction?.mode === "vmd"
    ? STAGE_INTERACTION_MODES.CHAT_VMD_ACTION
    : STAGE_INTERACTION_MODES.CHAT_PROCEDURAL_ACTION;
}

/** @param {any} interaction */
function modeForStageClickInteraction(interaction) {
  return interaction?.mode === "vmd"
    ? STAGE_INTERACTION_MODES.STAGE_CLICK_VMD_ACTION
    : STAGE_INTERACTION_MODES.STAGE_CLICK_PROCEDURAL_ACTION;
}

/** @param {any} recoveredState */
function toStageInteractionState(recoveredState) {
  return {
    mode: modeForRecoveredSource(recoveredState.source),
    source: recoveredState.source,
    interaction: recoveredState.interaction,
    activeVmdAssetId: recoveredState.activeVmdAssetId,
    pendingAutoResume: false,
  };
}

/** @param {{ defaultInteraction?: any }} [options] */
export function resetStageInteraction({ defaultInteraction = createDefaultStageInteraction() } = {}) {
  return {
    mode: STAGE_INTERACTION_MODES.DEFAULT_IDLE,
    source: "default",
    interaction: defaultInteraction,
    activeVmdAssetId: "",
    pendingAutoResume: false,
  };
}

/** @param {{ interaction?: any, activeVmdAssetId?: string }} [options] */
export function startAutoplayLoop({ interaction, activeVmdAssetId = "" } = {}) {
  return {
    mode: STAGE_INTERACTION_MODES.AUTOPLAY_LOOP,
    source: "autoplay",
    interaction,
    activeVmdAssetId,
    pendingAutoResume: false,
  };
}

/** @param {{ interaction?: any, activeVmdAssetId?: string, canAutoResume?: boolean }} [options] */
export function startManualPreview({ interaction, activeVmdAssetId = "", canAutoResume = false } = {}) {
  return {
    mode: STAGE_INTERACTION_MODES.MANUAL_PREVIEW,
    source: "manual-preview",
    interaction,
    activeVmdAssetId,
    pendingAutoResume: Boolean(canAutoResume),
  };
}

/** @param {{ interaction?: any, activeVmdAssetId?: string, canAutoResume?: boolean }} [options] */
export function startChatInteraction({ interaction, activeVmdAssetId = "", canAutoResume = false } = {}) {
  return {
    mode: modeForChatInteraction(interaction),
    source: "chat",
    interaction,
    activeVmdAssetId,
    pendingAutoResume: Boolean(canAutoResume),
  };
}

/** @param {{ interaction?: any, activeVmdAssetId?: string, canAutoResume?: boolean }} [options] */
export function startStageClickInteraction({ interaction, activeVmdAssetId = "", canAutoResume = false } = {}) {
  return {
    mode: modeForStageClickInteraction(interaction),
    source: "stage-click",
    interaction,
    activeVmdAssetId,
    pendingAutoResume: Boolean(canAutoResume),
  };
}

/**
 * @param {{
 *   autoplayResumeInteraction?: any,
 *   defaultInteraction?: any,
 *   autoplayAssetId?: string
 * }} [options]
 */
export function recoverStageInteraction({
  autoplayResumeInteraction = null,
  defaultInteraction = createDefaultStageInteraction(),
  autoplayAssetId = "",
} = {}) {
  return toStageInteractionState(
    resolveStageActionIdleRecovery({
      autoplayResumeInteraction,
      defaultInteraction,
      autoplayAssetId,
    }),
  );
}

/**
 * @param {{
 *   autoplayResumeInteraction?: any,
 *   createAutoplayResumeInteraction?: () => any,
 *   defaultInteraction?: any,
 *   autoplayAssetId?: string,
 *   resolveAutoplayAssetId?: (interaction: any) => string
 * }} [options]
 */
export function completeStageInteraction({
  autoplayResumeInteraction = null,
  createAutoplayResumeInteraction,
  defaultInteraction = createDefaultStageInteraction(),
  autoplayAssetId = "",
  resolveAutoplayAssetId,
} = {}) {
  return toStageInteractionState(
    resolveStageActionCompletionRecovery({
      autoplayResumeInteraction,
      createAutoplayResumeInteraction,
      defaultInteraction,
      autoplayAssetId,
      resolveAutoplayAssetId,
    }),
  );
}

/** @param {any} state */
export function markStageInteractionRecovering(state) {
  return {
    ...state,
    mode: STAGE_INTERACTION_MODES.RECOVERING,
  };
}

/** @param {any} state */
export function clearStagePendingAutoResume(state) {
  return {
    ...state,
    pendingAutoResume: false,
  };
}

/** @param {any} state @param {string} [activeVmdAssetId] */
export function updateStageActiveVmdAsset(state, activeVmdAssetId = "") {
  return {
    ...state,
    activeVmdAssetId,
  };
}
