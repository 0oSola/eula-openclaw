import assert from "node:assert/strict";
import test from "node:test";

import { createV14dGameAppearanceAdapter } from "../src/features/stage/v14dGameAppearanceAdapter.js";
import { getStagePresentationConfig } from "../src/features/stage/mmdCompanionRuntime.js";

test("v14d-game 准备态适配器提供明确状态并支持安装/释放", () => {
  const adapter = createV14dGameAppearanceAdapter();

  assert.deepEqual(adapter.getStatus(), {
    pipeline: "v14d-game",
    phase: "preparation",
    installed: false,
    realAppearanceAvailable: false,
    label: "接入准备：真实游戏外观未迁移",
  });

  assert.deepEqual(adapter.install({ model: { name: "fixture" } }), {
    pipeline: "v14d-game",
    phase: "preparation",
    installed: true,
    realAppearanceAvailable: false,
    label: "接入准备：真实游戏外观未迁移",
  });

  adapter.release();
  adapter.release();
  assert.equal(adapter.getStatus().installed, false);
});

test("v14d-game 使用显式准备态舞台配置而不是未知管线回退", () => {
  const preparation = getStagePresentationConfig("v14d-game");
  const classic = getStagePresentationConfig("classic");

  assert.equal(preparation.appearance.phase, "preparation");
  assert.equal(preparation.appearance.realAppearanceAvailable, false);
  assert.equal(preparation.appearance.label, "接入准备：真实游戏外观未迁移");
  assert.notDeepEqual(preparation, classic);
});
