import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { createV14dGameAppearanceAdapter } from "../src/features/stage/v14dGameAppearanceAdapter.js";
import { getStagePresentationConfig } from "../src/features/stage/mmdCompanionRuntime.js";
import { V14D_GAME_DEFAULT_SETTINGS } from "../src/features/stage/v14dGameAppearanceAssets.js";

const validManifest = {
  id: "fixture-v14d-game",
  available: true,
  sourceManifestSha256: "fixture-source-sha256",
  model: {
    url: "/assets/v14d-game/model/GirlsFrontline%20KoledaDefault.pmx",
    relativePath: "克莱妲原皮/GirlsFrontline KoledaDefault.pmx",
    sha256: "fixture-model-sha256",
  },
  textures: [
    { key: "body-normal", url: "/assets/v14d-game/body-normal", sha256: "body-normal-sha256", kind: "normal", materialHints: ["body"] },
    { key: "hair-specular", url: "/assets/v14d-game/hair-specular", sha256: "hair-specular-sha256", kind: "specular", materialHints: ["hair"] },
  ],
  ocio: {
    processor: { url: "/assets/v14d-game/processor", sha256: "processor-sha256" },
    shader: { url: "/assets/v14d-game/shader", sha256: "shader-sha256" },
    lut0: { url: "/assets/v14d-game/lut0", sha256: "lut0-sha256" },
    lut1: { url: "/assets/v14d-game/lut1", sha256: "lut1-sha256" },
  },
  lights: Array.from({ length: 6 }, (_, index) => ({
    name: `fixture-light-${index}`,
    type: "AREA",
    shape: "DISK",
    color: [1, 1, 1],
    size: 2,
    sizeY: 2,
    power: 10,
    matrix: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ],
  })),
};

function createFixtureModel() {
  const bodyMaterial = new THREE.MeshStandardMaterial({ name: "BodySkin" });
  const hairMaterial = new THREE.MeshStandardMaterial({ name: "HairA" });
  const eyesPlusMaterial = new THREE.MeshStandardMaterial({ name: "Eyes+" });
  const body = { name: "Body", material: bodyMaterial };
  const hair = { name: "HairA", material: hairMaterial };
  const eyesPlus = { name: "Eyes+", material: eyesPlusMaterial, visible: true };
  const cape = { name: "Cth1-Cape", material: [], visible: false };
  const nodes = [body, hair, eyesPlus, cape];
  return {
    name: "GirlsFrontline KoledaDefault",
    userData: {},
    traverse(callback) {
      nodes.forEach(callback);
    },
    nodes,
    bodyMaterial,
    hairMaterial,
    eyesPlusMaterial,
    cape,
  };
}

test("v14d-game 未安装时提供明确 idle 状态和独立默认配置", () => {
  const adapter = createV14dGameAppearanceAdapter();

  const status = adapter.getStatus();
  assert.equal(status.pipeline, "v14d-game");
  assert.equal(status.phase, "idle");
  assert.equal(status.installed, false);
  assert.equal(status.realAppearanceAvailable, false);
  assert.equal(status.label, "V14D 游戏外观未安装");
  assert.deepEqual(status.settings, V14D_GAME_DEFAULT_SETTINGS);
  assert.equal(status.manifestId, null);
});

test("v14d-game 明确拒绝非 Koleda 模型，不静默替换", async () => {
  const adapter = createV14dGameAppearanceAdapter({ manifest: validManifest });
  const status = await adapter.install({ model: { name: "OtherCharacter" }, modelUrl: "/models/other.pmx" });

  assert.equal(status.phase, "unsupported");
  assert.equal(status.realAppearanceAvailable, false);
  assert.match(status.reason, /Koleda|克莱妲/);
});

test("v14d-game 有效清单可安装材质并在 release 后恢复", async () => {
  const model = createFixtureModel();
  const loadedTextures = [];
  const adapter = createV14dGameAppearanceAdapter({
    manifest: validManifest,
    textureLoader: {
      async loadAsync(url) {
        const texture = new THREE.Texture();
        texture.userData = { url };
        texture.dispose = () => {
          texture.userData.disposed = true;
        };
        loadedTextures.push(texture);
        return texture;
      },
    },
  });
  const originalBodyMap = model.bodyMaterial.map;
  const originalHairVisible = model.hairMaterial.visible;
  const originalEyesVisible = model.eyesPlusMaterial.visible;

  const status = await adapter.install({
    model,
    modelUrl: "http://127.0.0.1/assets/v14d-game/model/GirlsFrontline%20KoledaDefault.pmx",
  });

  assert.equal(status.phase, "ready");
  assert.equal(status.realAppearanceAvailable, true);
  assert.equal(status.installed, true);
  assert.deepEqual(status.resources.textures, ["body-normal", "hair-specular"]);
  assert.equal(model.bodyMaterial.normalMap, loadedTextures[0]);
  assert.equal(model.hairMaterial.userData.v14dGameSpecularTextureKey, "hair-specular");
  assert.equal(model.eyesPlusMaterial.visible, false);
  assert.equal(model.cape.visible, true);

  const released = adapter.release();
  assert.equal(released.phase, "idle");
  assert.equal(released.installed, false);
  assert.equal(model.bodyMaterial.map, originalBodyMap);
  assert.equal(model.hairMaterial.visible, originalHairVisible);
  assert.equal(model.eyesPlusMaterial.visible, originalEyesVisible);
  assert.equal(model.cape.visible, false);
  assert.equal(loadedTextures.every((texture) => texture.userData.disposed === true), true);
});

test("v14d-game 缺少 OCIO 或资源身份时进入明确 unavailable", async () => {
  const adapter = createV14dGameAppearanceAdapter({
    manifest: { ...validManifest, ocio: { ...validManifest.ocio, lut1: null } },
    textureLoader: { async loadAsync() { return new THREE.Texture(); } },
  });
  const status = await adapter.install({
    model: { name: "KoledaDefault", traverse() {} },
    modelUrl: "/models/KoledaDefault.pmx",
  });

  assert.equal(status.phase, "unavailable");
  assert.equal(status.realAppearanceAvailable, false);
  assert.match(status.reason, /OCIO|lut1/);
});

test("v14d-game 使用独立舞台配置，且旧 classic 配置保持不变", () => {
  const game = getStagePresentationConfig("v14d-game");
  const classic = getStagePresentationConfig("classic");

  assert.equal(game.appearance.phase, "idle");
  assert.equal(game.appearance.realAppearanceAvailable, false);
  assert.equal(game.appearance.label, "V14D 游戏外观未安装");
  assert.equal(game.background, null);
  assert.equal(game.outline.enabled, false);
  assert.equal(game.postfx.enabled, false);
  assert.notDeepEqual(game, classic);
});
