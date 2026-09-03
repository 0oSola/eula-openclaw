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

export const V14D_HAIR_CAPTURE_TIME_EPSILON = 1e-6;

function finite(value) {
  return Number.isFinite(Number(value));
}

function closeEnough(a, b, epsilon) {
  return finite(a) && finite(b) && Math.abs(Number(a) - Number(b)) <= epsilon;
}

/**
 * 校验一份原子 Hair triUV 证据：像素图和材质/triUV 读回必须来自同一个
 * captureId、同一 currentSeconds/currentFrame 和同一画布尺寸。
 * 该函数保持无副作用，供真实验收和时间推进负测共同使用。
 */
export function validateV14dHairAtomicEvidence({ pixel, triUv, epsilon = V14D_HAIR_CAPTURE_TIME_EPSILON } = {}) {
  const issues = [];
  const pixelId = pixel?.captureId;
  const triUvId = triUv?.captureId;
  if (pixelId == null || triUvId == null || pixelId !== triUvId) issues.push("captureId mismatch");
  if (!closeEnough(pixel?.currentSeconds, triUv?.currentSeconds, epsilon)) issues.push("currentSeconds mismatch");
  if (!closeEnough(pixel?.currentFrame, triUv?.currentFrame, epsilon)) issues.push("currentFrame mismatch");
  if (Number(pixel?.width) !== Number(triUv?.width) || Number(pixel?.height) !== Number(triUv?.height)) {
    issues.push("canvas size mismatch");
  }
  return { ok: issues.length === 0, issues };
}

/**
 * 校验 original/V1 两份原子证据使用同一冻结 VMD 时间/帧。
 * 这是跨变体 A/B 的必要条件，不由“尺寸相同”替代。
 */
export function validateV14dHairCapturePair({ original, v1, epsilon = V14D_HAIR_CAPTURE_TIME_EPSILON } = {}) {
  const originalAtomic = validateV14dHairAtomicEvidence({
    pixel: original?.pixel,
    triUv: original?.triUv,
    epsilon,
  });
  const v1Atomic = validateV14dHairAtomicEvidence({
    pixel: v1?.pixel,
    triUv: v1?.triUv,
    epsilon,
  });
  const issues = [
    ...originalAtomic.issues.map((issue) => "original: " + issue),
    ...v1Atomic.issues.map((issue) => "v1: " + issue),
  ];
  if (!closeEnough(original?.pixel?.currentSeconds, v1?.pixel?.currentSeconds, epsilon)) {
    issues.push("original/v1 currentSeconds mismatch");
  }
  if (!closeEnough(original?.pixel?.currentFrame, v1?.pixel?.currentFrame, epsilon)) {
    issues.push("original/v1 currentFrame mismatch");
  }
  const originalName = original?.pixel?.animationName;
  const v1Name = v1?.pixel?.animationName;
  if (originalName && v1Name && originalName !== v1Name) issues.push("original/v1 animationName mismatch");
  return {
    ok: issues.length === 0,
    issues,
    original: originalAtomic,
    v1: v1Atomic,
  };
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
