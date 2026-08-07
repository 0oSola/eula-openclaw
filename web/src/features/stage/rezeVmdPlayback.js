/**
 * 播放局部骨骼 VMD 时保留当前姿势。
 *
 * reze-engine 的 Model.show()/play() 会先 resetAllBones()；对只含少量骨骼轨道
 * 的动作会把未覆盖的骨骼重置到 PMX 绑定 T 姿势。已有动作姿势时，直接切换
 * animationState 可让引擎只覆盖 VMD 实际包含的骨骼轨道。
 */
export function playRezeVmd(model, name, { preserveCurrentPose = false } = {}) {
  if (preserveCurrentPose && model?.animationState?.show && model?.animationState?.play) {
    model.animationState.show(name);
    return model.animationState.play(name, { loop: false });
  }

  model.show(name);
  return model.play(name, { loop: false });
}

/**
 * 在剪辑自然结束后回到 PMX 绑定姿势（T 形待机），而不是停在最后一帧。
 *
 * 复用引擎自己的 resetAllBones()/resetAllMorphs() + clearAnimation() 组合：
 * clearAnimation() 先解除逐帧姿势重放，随后 reset 才能真正生效。该辅助只应在
 * 「不再有后续 VMD」的收尾路径调用；后续还有 VMD 要接播时保持当前姿势。
 */
export function resetRezeModelToBindPose(model) {
  if (!model?.animationState) return;
  model.animationState.clear?.();
  model.resetAllBones?.();
  model.resetAllMorphs?.();
}

export function setRezeVmdCompletionHandler(model, onEnd) {
  if (!model?.animationState?.setOnEnd) return false;
  model.animationState.setOnEnd(onEnd);
  return true;
}
