import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three";

import { getStagePresentationConfig, MMDCompanionRuntime } from "../src/features/stage/mmdCompanionRuntime.js";

function makeRuntime(overrides = {}) {
  return Object.assign(Object.create(MMDCompanionRuntime.prototype), {
    statusElement: null,
    hasPhysicsSupport: false,
    scene: { add() {}, remove() {} },
    helper: { add() {}, remove() {}, update() {} },
    controls: { update() {} },
    renderer: { render() {}, dispose() {} },
    camera: {},
    clock: { getDelta: () => 1 / 60 },
    bones: {},
    baseBoneRotation: {},
    toonRampTexture: {},
    setStatus() {},
    clearModel() {},
    ...overrides,
  });
}

function makeMaterial({
  name,
  transparent = false,
  opacity = 1,
  alphaMap = null,
  shininess = 80,
  specular = 1,
  side = THREE.FrontSide,
} = {}) {
  return {
    name,
    transparent,
    opacity,
    alphaMap,
    alphaTest: 0,
    side,
    color: new THREE.Color(1, 1, 1),
    emissive: new THREE.Color(0.1, 0.1, 0.1),
    specular: new THREE.Color(specular, specular, specular),
    shininess,
    map: { colorSpace: null },
    emissiveMap: { colorSpace: null },
    needsUpdate: false,
  };
}

function makeMesh({ materials, bones = [], morphTargetDictionary = {} }) {
  const meshNodes = materials.map((material) => ({
    isMesh: true,
    castShadow: false,
    receiveShadow: false,
    material,
  }));

  return {
    position: { set() {} },
    castShadow: false,
    receiveShadow: false,
    morphTargetDictionary,
    traverse(visitor) {
      for (const node of meshNodes) visitor(node);
      for (const bone of bones) visitor(bone);
    },
  };
}

test("loadModel makes thin garments double-sided and preserves metal highlights", async () => {
  const skin = makeMaterial({ name: "Face Skin", shininess: 80, specular: 1 });
  const metal = makeMaterial({ name: "Armor Metal", shininess: 80, specular: 1 });
  const skirt = makeMaterial({ name: "Skirt Cloth", shininess: 40, specular: 0.7 });

  const runtime = makeRuntime();
  runtime.loader = {
    load(_url, onLoad) {
      onLoad(
        makeMesh({
          materials: [skin, metal, skirt],
          bones: [{ isBone: true, name: "head", rotation: new THREE.Euler(0, 0, 0) }],
        }),
      );
    },
  };

  await runtime.loadModel("/fake-model.pmx");

  assert.equal(skirt.side, THREE.DoubleSide);
  assert.ok(skin.shininess < 80);
  assert.equal(metal.shininess, 80);
  assert.ok(skin.specular.r < 1);
  assert.equal(metal.specular.r, 1);
});

test("captureBones also records common morph slots for face animation", () => {
  const runtime = makeRuntime();
  const mesh = makeMesh({
    materials: [],
    bones: [{ isBone: true, name: "head", rotation: new THREE.Euler(0, 0, 0) }],
    morphTargetDictionary: {
      smile: 0,
      sad: 1,
      blink: 2,
      mouth_a: 3,
      mouth_i: 4,
      mouth_u: 5,
    },
  });

  runtime.captureBones(mesh);

  assert.deepEqual(runtime.morphSlots, {
    smile: 0,
    sad: 1,
    blink: 2,
    mouthA: 3,
    mouthI: 4,
    mouthU: 5,
  });
});

test("renderFrame updates morph influences when the model is speaking", () => {
  const runtime = makeRuntime({
    model: { morphTargetInfluences: [0, 0, 0, 0, 0, 0] },
    morphSlots: { smile: 0, sad: 1, blink: 2, mouthA: 3, mouthI: 4, mouthU: 5 },
    activeEmotion: "happy",
    isSpeaking: true,
  });

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    runtime.renderFrame();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }

  assert.ok(runtime.model.morphTargetInfluences[0] > 0);
  assert.ok(runtime.model.morphTargetInfluences[3] > 0);
});

test("stage presentation config matches showcase-style framing", () => {
  const config = getStagePresentationConfig();

  assert.equal(config.fog, null);
  assert.equal(config.background, "#15171c");
  assert.equal(config.camera.fov, 36);
  assert.deepEqual(config.camera.position, [0, 9.6, 24]);
  assert.deepEqual(config.camera.target, [0, 7.6, 0]);
  assert.equal(config.floor.kind, "shadowCatcher");
  assert.equal(config.floor.opacity, 0.24);
  assert.equal(config.shadowMapType, THREE.PCFShadowMap);
});

test("idle pose keeps natural standing bone offsets", () => {
  const runtime = makeRuntime();

  assert.deepEqual(runtime.getOffsetsForAction("idle", 1, 1), {});
  assert.deepEqual(runtime.getActionOffsets(1000), {});
});
