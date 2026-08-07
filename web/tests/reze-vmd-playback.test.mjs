import assert from "node:assert/strict";
import test from "node:test";

import {
  playRezeVmd,
  resetRezeModelToBindPose,
  setRezeVmdCompletionHandler,
} from "../src/features/stage/rezeVmdPlayback.js";

test("局部 VMD 在已有姿势上播放时不调用会重置全部骨骼的 Model.play", () => {
  const calls = [];
  const model = {
    show() {
      calls.push("model.show");
    },
    play() {
      calls.push("model.play");
    },
    animationState: {
      show(name) {
        calls.push(`state.show:${name}`);
      },
      play(name, options) {
        calls.push(`state.play:${name}:${options.loop}`);
        return true;
      },
    },
  };

  const played = playRezeVmd(model, "cheer.vmd", { preserveCurrentPose: true });

  assert.equal(played, true);
  assert.deepEqual(calls, ["state.show:cheer.vmd", "state.play:cheer.vmd:false"]);
});

test("reze VMD 结束事件可转发给舞台状态机", () => {
  let registered;
  const model = {
    animationState: {
      setOnEnd(callback) {
        registered = callback;
      },
    },
  };
  const completed = [];

  assert.equal(setRezeVmdCompletionHandler(model, (name) => completed.push(name)), true);
  registered("cheer.vmd");
  assert.deepEqual(completed, ["cheer.vmd"]);
});

test("单次动作收尾会清掉活动剪辑并复原 PMX 绑定姿势", () => {
  const calls = [];
  const model = {
    animationState: {
      clear() {
        calls.push("animationState.clear");
      },
    },
    resetAllBones() {
      calls.push("resetAllBones");
    },
    resetAllMorphs() {
      calls.push("resetAllMorphs");
    },
  };

  resetRezeModelToBindPose(model);

  assert.deepEqual(calls, ["animationState.clear", "resetAllBones", "resetAllMorphs"]);
});
