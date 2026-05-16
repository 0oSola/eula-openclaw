export const STAGE_ACTION_ERROR_RECOVERY_DELAY_MS = 3000;

/**
 * @param {{
 *   previousTimerId?: any,
 *   recover?: () => void,
 *   delayMs?: number,
 *   setTimeoutFn?: (callback: () => void, delayMs: number) => any,
 *   clearTimeoutFn?: (timerId: any) => void
 * }} [options]
 * @returns {any}
 */
export function scheduleStageActionRecovery({
  previousTimerId = null,
  recover,
  delayMs = STAGE_ACTION_ERROR_RECOVERY_DELAY_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  if (previousTimerId !== null && previousTimerId !== undefined) {
    clearTimeoutFn(previousTimerId);
  }
  return setTimeoutFn(() => {
    recover?.();
  }, delayMs);
}

/**
 * @param {{
 *   autoplayResumeInteraction?: any,
 *   defaultInteraction?: any,
 *   autoplayAssetId?: string
 * }} [options]
 * @returns {{ interaction: any, source: "autoplay" | "default", activeVmdAssetId: string, pendingAutoResume: false }}
 */
export function resolveStageActionIdleRecovery({
  autoplayResumeInteraction = null,
  defaultInteraction = null,
  autoplayAssetId = "",
} = {}) {
  if (autoplayResumeInteraction) {
    return {
      interaction: autoplayResumeInteraction,
      source: "autoplay",
      activeVmdAssetId: autoplayAssetId || "",
      pendingAutoResume: false,
    };
  }

  return {
    interaction: defaultInteraction,
    source: "default",
    activeVmdAssetId: "",
    pendingAutoResume: false,
  };
}

/**
 * Normal action completion should always re-enter the model's autoplay idle
 * flow when favorite loop motions are available.
 *
 * @param {{
 *   pendingAutoResume?: boolean,
 *   autoplayResumeInteraction?: any,
 *   createAutoplayResumeInteraction?: () => any,
 *   defaultInteraction?: any,
 *   autoplayAssetId?: string,
 *   resolveAutoplayAssetId?: (interaction: any) => string
 * }} [options]
 * @returns {{ interaction: any, source: "autoplay" | "default", activeVmdAssetId: string, pendingAutoResume: false }}
 */
export function resolveStageActionCompletionRecovery({
  autoplayResumeInteraction = null,
  createAutoplayResumeInteraction,
  defaultInteraction = null,
  autoplayAssetId = "",
  resolveAutoplayAssetId,
} = {}) {
  const nextAutoplayResumeInteraction = createAutoplayResumeInteraction?.() || autoplayResumeInteraction;
  return resolveStageActionIdleRecovery({
    autoplayResumeInteraction: nextAutoplayResumeInteraction,
    defaultInteraction,
    autoplayAssetId: resolveAutoplayAssetId?.(nextAutoplayResumeInteraction) || autoplayAssetId,
  });
}
