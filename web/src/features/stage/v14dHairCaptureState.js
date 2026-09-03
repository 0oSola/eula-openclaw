/**
 * Hair triUV 采集期间的运行时状态快照与恢复。
 *
 * 采集会暂时暂停模型并停止 reze-engine render loop；该模块把恢复语义
 * 保持为可单测的纯编排边界，避免诊断探针把生产播放状态重置到时间 0。
 */

function readProgress(model) {
  try {
    return typeof model?.getAnimationProgress === "function"
      ? model.getAnimationProgress()
      : null;
  } catch {
    return null;
  }
}

function isRenderLoopRunning(engine) {
  // reze-engine 没有公开 getter；animationFrameId 是其唯一运行态标记。
  const frameId = engine?.animationFrameId;
  return frameId !== null && frameId !== undefined;
}

export function captureV14dHairRuntimeState(model, engine) {
  const progress = readProgress(model);
  const currentSeconds = Number(progress?.current);
  const durationSeconds = Number(progress?.duration);
  return {
    animationName: progress?.animationName ?? null,
    currentSeconds: Number.isFinite(currentSeconds) ? currentSeconds : 0,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    looping: Boolean(progress?.looping),
    playing: Boolean(progress?.playing),
    paused: Boolean(progress?.paused),
    renderLoopRunning: isRenderLoopRunning(engine),
  };
}

/**
 * 恢复 captureV14dHairRuntimeState 的快照。
 *
 * playing 状态使用无参 play()，不会触发 Model.play(name) 的 resetAllBones；
 * 随后 seek 回原秒数。paused 状态保持暂停且只恢复时间；未播放/未暂停状态
 * 使用 stop()+seek() 保持时间与非播放状态。render loop 仅在采集前运行时重启。
 */
export function restoreV14dHairRuntimeState(model, engine, snapshot) {
  if (!snapshot || !model) return;
  const seconds = Number(snapshot.currentSeconds);
  const restoreSeconds = () => {
    if (Number.isFinite(seconds) && typeof model.seek === "function") model.seek(seconds);
  };
  try {
    if (snapshot.playing) {
      if (typeof model.play === "function") model.play();
      restoreSeconds();
    } else if (snapshot.paused) {
      restoreSeconds();
      if (typeof model.pause === "function") model.pause();
    } else {
      if (typeof model.stop === "function") model.stop();
      restoreSeconds();
    }
  } catch {
    // 采集失败不能因为恢复异常再次遮蔽原始证据；尽力恢复渲染循环。
  }
  if (snapshot.renderLoopRunning && typeof engine?.runRenderLoop === "function") {
    try { engine.runRenderLoop(); } catch { /* best effort */ }
  }
}
