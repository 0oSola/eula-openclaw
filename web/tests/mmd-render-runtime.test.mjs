import test from "node:test";
import assert from "node:assert/strict";

import * as THREE from "three";

import * as runtimeModule from "../src/features/stage/mmdCompanionRuntime.js";

const {
  applyStageRuntimeState,
  getStagePresentationConfig,
  MMDCompanionRuntime,
  pickNextLoopMotionUrl,
  pickSequentialLoopMotionUrl,
} = runtimeModule;

function makeRuntime(overrides = {}) {
  return Object.assign(Object.create(MMDCompanionRuntime.prototype), {
    statusElement: null,
    hasPhysicsSupport: false,
    scene: { add() {}, remove() {} },
    helper: { add() {}, remove() {}, update() {} },
    controls: { update() {} },
    renderer: {
      render() {},
      dispose() {},
      getPixelRatio() {
        return 1;
      },
      getSize(target) {
        target?.set?.(1, 1);
        return target;
      },
      setSize() {},
    },
    camera: {},
    clock: { getDelta: () => 1 / 60 },
    bones: {},
    baseBoneRotation: {},
    currentClip: null,
    currentVmdPlaybackRate: 1,
    currentVmdLoopUrls: [],
    currentVmdStandbyUrl: "",
    currentVmdLoopGapMs: 0,
    currentVmdLoopMode: "random",
    currentVmdLoopPhase: "loop",
    lastPlayedLoopMotionUrl: "",
    currentVmdUrl: "",
    currentVmdStartedAt: 0,
    currentVmdDurationMs: 0,
    isLoadingVmd: false,
    vmdLoadToken: 0,
    toonRampTexture: {},
    backdropTextures: [],
    outlineObjects: [],
    outlineMaterials: [],
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
    emissiveIntensity: 0,
    envMapIntensity: 0,
    specular: new THREE.Color(specular, specular, specular),
    shininess,
    map: { colorSpace: null },
    emissiveMap: { colorSpace: null },
    gradientMap: null,
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

function createCanvasContextStub() {
  return {
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    createRadialGradient() {
      return {
        addColorStop() {},
      };
    },
    beginPath() {},
    arc() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    fillRect() {},
    setLineDash() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    clearRect() {},
    set fillStyle(_value) {},
    set strokeStyle(_value) {},
    set lineWidth(_value) {},
    set shadowBlur(_value) {},
    set shadowColor(_value) {},
    set globalAlpha(_value) {},
  };
}

function withStubbedDocument(run) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return {
        width: 0,
        height: 0,
        getContext() {
          return createCanvasContextStub();
        },
      };
    },
  };

  try {
    return run();
  } finally {
    if (typeof originalDocument === "undefined") {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
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

test("stage presentation config supports classic, genshin, and unknown fallback pipelines", () => {
  const classic = getStagePresentationConfig("classic");
  const genshin = getStagePresentationConfig("genshin");
  const fallback = getStagePresentationConfig("unknown");

  assert.equal(classic.fog, null);
  assert.equal(classic.background, null);
  assert.equal(classic.camera.fov, 36);
  assert.deepEqual(classic.camera.position, [0, 9.6, 24]);
  assert.deepEqual(classic.camera.target, [0, 7.6, 0]);
  assert.equal(classic.floor.kind, "shadowCatcher");
  assert.equal(classic.floor.opacity, 0.24);
  assert.equal(classic.shadowMapType, THREE.PCFShadowMap);

  assert.equal(typeof genshin.background, "string");
  assert.equal(genshin.backdrop.enabled, true);
  assert.equal(genshin.floor.glow.enabled, true);
  assert.equal(genshin.floor.contactShadow.enabled, true);
  assert.notDeepEqual(genshin.camera.position, classic.camera.position);
  assert.notEqual(genshin.lights.ambient.intensity, classic.lights.ambient.intensity);
  assert.notEqual(genshin.floor.y, classic.floor.y);

  assert.deepEqual(fallback, classic);
});

test("runtime stores explicit and default render pipelines", () => {
  const classicRuntime = new MMDCompanionRuntime({
    container: { clientWidth: 1, clientHeight: 1, replaceChildren() {} },
    statusElement: null,
  });
  const genshinRuntime = new MMDCompanionRuntime({
    container: { clientWidth: 1, clientHeight: 1, replaceChildren() {} },
    statusElement: null,
    renderPipeline: "genshin",
  });

  assert.equal(classicRuntime.renderPipeline, "classic");
  assert.equal(genshinRuntime.renderPipeline, "genshin");
});

test("setupScene runs classic shared setup steps in order and dispatches the classic branch", () => {
  const calls = [];
  const runtime = makeRuntime({
    renderPipeline: "classic",
    setupRenderer(presentation) {
      calls.push(["renderer", presentation.camera.fov]);
    },
    setupCamera(presentation) {
      calls.push(["camera", presentation.camera.target.join(",")]);
    },
    setupLights(presentation) {
      calls.push(["lights", presentation.lights.ambient.intensity]);
    },
    setupFloor(presentation) {
      calls.push(["floor", presentation.floor.opacity]);
    },
    setupBackdrop(presentation) {
      calls.push(["backdrop", presentation.background]);
    },
    setupClassicPipeline(presentation) {
      calls.push(["classic", presentation.floor.y]);
    },
    setupGenshinPipeline() {
      calls.push(["genshin"]);
    },
    setupPostprocessing() {},
  });

  runtime.setupScene();

  assert.equal(runtime.scene.isScene, true);
  assert.equal(runtime.scene.background, null);
  assert.equal(runtime.scene.fog, null);
  assert.deepEqual(calls, [
    ["renderer", 36],
    ["camera", "0,7.6,0"],
    ["lights", 0.72],
    ["floor", 0.24],
    ["backdrop", null],
    ["classic", -10],
  ]);
});

test("setupScene dispatches the genshin branch after the shared setup steps", () => {
  const calls = [];
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    setupRenderer(presentation) {
      calls.push(["renderer", presentation.camera.fov]);
    },
    setupCamera(presentation) {
      calls.push(["camera", presentation.camera.target.join(",")]);
    },
    setupLights(presentation) {
      calls.push(["lights", presentation.lights.ambient.intensity]);
    },
    setupFloor(presentation) {
      calls.push(["floor", presentation.floor.opacity]);
    },
    setupBackdrop(presentation) {
      calls.push(["backdrop", presentation.background]);
    },
    setupClassicPipeline() {
      calls.push(["classic"]);
    },
    setupGenshinPipeline(presentation) {
      calls.push(["genshin", presentation.floor.y]);
    },
    setupPostprocessing() {},
  });

  runtime.setupScene();

  assert.equal(runtime.scene.isScene, true);
  assert.ok(runtime.scene.background?.isColor);
  assert.deepEqual(calls, [
    ["renderer", 30],
    ["camera", "0,7.1,0"],
    ["lights", 0.88],
    ["floor", 0.18],
    ["backdrop", "#081a35"],
    ["genshin", -9.2],
  ]);
});

test("classic and genshin material tuners diverge while preserving cutout safety", () => {
  const classic = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const genshin = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const classicRamp = { id: "classic-ramp" };
  const genshinRamp = { id: "genshin-ramp" };

  runtimeModule.tuneClassicMMDMaterial?.(classic, classicRamp);
  runtimeModule.tuneGenshinMMDMaterial?.(genshin, genshinRamp);

  assert.equal(classic.alphaTest, 0.5);
  assert.equal(classic.side, THREE.DoubleSide);
  assert.equal(classic.gradientMap, classicRamp);
  assert.equal(classic.shininess, 26);

  assert.ok(genshin.alphaTest >= 0.5);
  assert.equal(genshin.side, THREE.DoubleSide);
  assert.equal(genshin.gradientMap, genshinRamp);
  assert.notEqual(genshin.shininess, classic.shininess);
  assert.notEqual(genshin.specular.r, classic.specular.r);
  assert.notEqual(genshin.emissiveIntensity, classic.emissiveIntensity);
});

test("genshin material tuning preserves authored toon ramps and recognizes non-English hair profiles", () => {
  const existingGradientMap = { id: "authored-ramp" };
  const hair = makeMaterial({ name: "前髪", transparent: false, specular: 0.7, shininess: 40 });
  hair.gradientMap = existingGradientMap;

  runtimeModule.tuneGenshinMMDMaterial?.(hair, { id: "generated-ramp" });

  assert.equal(hair.gradientMap, existingGradientMap);
  assert.equal(hair.side, THREE.DoubleSide);
  assert.equal(hair.shininess, 14);
});

test("loadModel selects material tuning by renderPipeline", async () => {
  const classicMaterial = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const genshinMaterial = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });

  const classicRuntime = makeRuntime({ renderPipeline: "classic", toonRampTexture: { id: "classic-ramp" } });
  classicRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [classicMaterial] }));
    },
  };

  const genshinRuntime = makeRuntime({ renderPipeline: "genshin", toonRampTexture: { id: "genshin-ramp" } });
  genshinRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [genshinMaterial] }));
    },
  };

  await classicRuntime.loadModel("/classic-model.pmx");
  await genshinRuntime.loadModel("/genshin-model.pmx");

  assert.equal(classicMaterial.alphaTest, 0.5);
  assert.equal(classicMaterial.shininess, 26);
  assert.equal(classicMaterial.gradientMap.id, "classic-ramp");

  assert.ok(genshinMaterial.alphaTest >= 0.5);
  assert.equal(genshinMaterial.gradientMap.id, "genshin-ramp");
  assert.notEqual(genshinMaterial.shininess, classicMaterial.shininess);
  assert.notEqual(genshinMaterial.emissiveIntensity, classicMaterial.emissiveIntensity);
});

test("loadModel attaches character outline only for genshin pipeline", async () => {
  const classicCalls = [];
  const classicRuntime = makeRuntime({
    renderPipeline: "classic",
    toonRampTexture: { id: "classic-ramp" },
    attachCharacterOutline() {
      classicCalls.push("classic");
    },
    presentation: getStagePresentationConfig("classic"),
  });
  classicRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [makeMaterial({ name: "Hair Cloth", transparent: true })] }));
    },
  };

  const genshinCalls = [];
  const genshinRuntime = makeRuntime({
    renderPipeline: "genshin",
    toonRampTexture: { id: "genshin-ramp" },
    attachCharacterOutline() {
      genshinCalls.push("genshin");
    },
    presentation: getStagePresentationConfig("genshin"),
  });
  genshinRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [makeMaterial({ name: "Hair Cloth", transparent: true })] }));
    },
  };

  await classicRuntime.loadModel("/classic-model.pmx");
  await genshinRuntime.loadModel("/genshin-model.pmx");

  assert.deepEqual(classicCalls, []);
  assert.deepEqual(genshinCalls, ["genshin"]);
});

test("genshin outline respects cutout textures and uses gentler face silhouettes", () => {
  const runtime = makeRuntime({
    presentation: getStagePresentationConfig("genshin"),
  });

  const transparentMap = { id: "hair-map" };
  const faceMaterial = makeMaterial({ name: "Face Skin", transparent: false, shininess: 40 });
  const hairMaterial = makeMaterial({ name: "Hair", transparent: true, shininess: 40 });
  hairMaterial.map = transparentMap;
  hairMaterial.alphaTest = 0.58;

  const faceParent = { added: [], add(node) { this.added.push(node); }, remove() {} };
  const hairParent = { added: [], add(node) { this.added.push(node); }, remove() {} };

  const mesh = {
    traverse(visitor) {
      visitor({
        isMesh: true,
        isSkinnedMesh: false,
        geometry: new THREE.BufferGeometry(),
        material: faceMaterial,
        parent: faceParent,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
        renderOrder: 0,
        name: "face",
      });
      visitor({
        isMesh: true,
        isSkinnedMesh: false,
        geometry: new THREE.BufferGeometry(),
        material: hairMaterial,
        parent: hairParent,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
        renderOrder: 0,
        name: "hair",
      });
    },
  };

  runtime.attachCharacterOutline(mesh, getStagePresentationConfig("genshin"));

  assert.equal(runtime.outlineObjects.length, 2);
  const [faceOutline, hairOutline] = runtime.outlineObjects;
  assert.ok(faceOutline.scale.x < hairOutline.scale.x);
  assert.equal(hairOutline.material.map, transparentMap);
  assert.ok(hairOutline.material.alphaTest >= 0.5);
});

test("setupBackdrop stays disabled for classic but builds a layered genshin backdrop", () => {
  const classicAdds = [];
  const classicRuntime = makeRuntime({
    scene: { add(node) { classicAdds.push(node); }, remove() {} },
  });
  classicRuntime.setupBackdrop(getStagePresentationConfig("classic"));
  assert.equal(classicRuntime.backdropGroup, null);
  assert.deepEqual(classicAdds, []);

  withStubbedDocument(() => {
    const genshinAdds = [];
    const genshinRuntime = makeRuntime({
      scene: { add(node) { genshinAdds.push(node); }, remove() {} },
    });
    genshinRuntime.setupBackdrop(getStagePresentationConfig("genshin"));
    assert.equal(genshinAdds.length, 1);
    assert.ok(genshinRuntime.backdropGroup);
    assert.ok(genshinRuntime.backdropGroup.children.length >= 3);
    assert.equal(genshinRuntime.backdropTextures.length >= 3, true);
  });
});

test("setupFloor builds a layered genshin presentation floor with glow and contact shadow", () => {
  withStubbedDocument(() => {
    const adds = [];
    const runtime = makeRuntime({
      scene: { add(node) { adds.push(node); }, remove() {} },
    });

    runtime.setupFloor(getStagePresentationConfig("genshin"));

    assert.equal(adds.length, 1);
    assert.ok(runtime.floorGroup);
    assert.ok(runtime.floorGroup.children.length >= 4);
    assert.equal(runtime.floorTextures.length >= 2, true);
  });
});

test("renderScene chooses composer for genshin postfx and renderer for classic", () => {
  const classicCalls = [];
  const classicRuntime = makeRuntime({
    presentation: getStagePresentationConfig("classic"),
    renderer: {
      render() {
        classicCalls.push("renderer");
      },
    },
    composer: {
      render() {
        classicCalls.push("composer");
      },
    },
  });
  classicRuntime.renderScene();
  assert.deepEqual(classicCalls, ["renderer"]);

  const genshinCalls = [];
  const genshinPresentation = getStagePresentationConfig("genshin");
  const genshinRuntime = makeRuntime({
    presentation: genshinPresentation,
    renderer: {
      render() {
        genshinCalls.push("renderer");
      },
    },
    composer: {
      render() {
        genshinCalls.push("composer");
      },
    },
  });
  genshinRuntime.renderScene();
  assert.deepEqual(genshinCalls, ["composer"]);
});

test("stage presentation config returns fresh objects on every call", () => {
  const first = getStagePresentationConfig("classic");
  first.camera.position[0] = 999;
  first.lights.key.position[1] = 999;
  first.floor.opacity = 0.99;

  const second = getStagePresentationConfig("classic");
  const fallback = getStagePresentationConfig("unknown");

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(second, fallback);
  assert.deepEqual(second.camera.position, [0, 9.6, 24]);
  assert.deepEqual(second.lights.key.position, [-12, 18, 24]);
  assert.equal(second.floor.opacity, 0.24);
  assert.deepEqual(fallback, second);
});

test("stage runtime state applies current speaking and procedural interaction to recreated runtimes", () => {
  const calls = [];
  const interaction = { emotion: "happy", action: "nod", mode: "procedural" };
  const runtime = {
    setSpeaking(value) {
      calls.push(["speaking", value]);
    },
    applyInteraction(value) {
      calls.push(["interaction", value]);
    },
    playVmd(value) {
      calls.push(["vmd", value]);
    },
  };

  applyStageRuntimeState(runtime, {
    speaking: true,
    interaction,
    resolveUrl: (url) => `abs:${url}`,
  });

  assert.deepEqual(calls, [
    ["speaking", true],
    ["interaction", interaction],
  ]);
});

test("stage runtime state reapplies current VMD interaction to recreated runtimes", () => {
  const calls = [];
  const interaction = {
    emotion: "happy",
    action: "idle",
    mode: "vmd",
    vmdUrl: "/motions/wave.vmd",
    playbackRate: 1.5,
    vmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    standbyVmdUrl: "/motions/standby.vmd",
    loopGapMs: 240,
    loopMode: "sequential",
  };
  const runtime = {
    setSpeaking(value) {
      calls.push(["speaking", value]);
    },
    applyInteraction(value) {
      calls.push(["interaction", value]);
    },
    playVmd(value, playbackRate, vmdLoopUrls, loopOptions) {
      calls.push(["vmd", value, playbackRate, vmdLoopUrls, loopOptions]);
    },
  };

  applyStageRuntimeState(runtime, {
    speaking: false,
    interaction,
    resolveUrl: (url) => `abs:${url}`,
  });

  assert.deepEqual(calls, [
    ["speaking", false],
    ["interaction", interaction],
    [
      "vmd",
      "abs:/motions/wave.vmd",
      1.5,
      ["abs:/motions/idle-a.vmd", "abs:/motions/idle-b.vmd", "abs:/motions/idle-c.vmd"],
      {
        standbyUrl: "abs:/motions/standby.vmd",
        loopGapMs: 240,
        loopMode: "sequential",
      },
    ],
  ]);
});

test("pickNextLoopMotionUrl avoids immediately repeating the active loop motion", () => {
  const urls = ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"];

  assert.equal(pickNextLoopMotionUrl(urls, "/motions/idle-a.vmd", 0), "/motions/idle-b.vmd");
  assert.equal(pickNextLoopMotionUrl(urls, "/motions/idle-b.vmd", 0.99), "/motions/idle-c.vmd");
  assert.equal(pickNextLoopMotionUrl(["/motions/idle-a.vmd"], "/motions/idle-a.vmd", 0.4), "/motions/idle-a.vmd");
});

test("pickSequentialLoopMotionUrl advances in order and wraps around", () => {
  const urls = ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"];

  assert.equal(pickSequentialLoopMotionUrl(urls, ""), "/motions/idle-a.vmd");
  assert.equal(pickSequentialLoopMotionUrl(urls, "/motions/idle-a.vmd"), "/motions/idle-b.vmd");
  assert.equal(pickSequentialLoopMotionUrl(urls, "/motions/idle-c.vmd"), "/motions/idle-a.vmd");
});

test("shouldUsePostFX follows the active presentation config", () => {
  const classicRuntime = makeRuntime({ presentation: getStagePresentationConfig("classic") });
  const genshinRuntime = makeRuntime({ presentation: getStagePresentationConfig("genshin") });

  assert.equal(classicRuntime.shouldUsePostFX(), false);
  assert.equal(genshinRuntime.shouldUsePostFX(), true);
});

test("genshin bloom stays available when the stage uses an explicit backdrop pipeline", () => {
  const runtime = makeRuntime({ presentation: getStagePresentationConfig("genshin") });
  const genshinPresentation = getStagePresentationConfig("genshin");

  assert.equal(runtime.shouldUseBloom(genshinPresentation), true);
  assert.equal(runtime.shouldUseBloom(getStagePresentationConfig("classic")), false);
});

test("renderFrame accelerates active VMD clips without scaling procedural pose updates", async () => {
  const helperDeltas = [];
  const poseDeltas = [];
  const resetCalls = [];
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    clock: { getDelta: () => 0.25 },
    helper: {
      remove() {},
      add() {},
      update(delta) {
        helperDeltas.push(delta);
      },
    },
    controls: { update() {} },
    renderer: { render() {} },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad({ name: "motion-clip" });
      },
    },
    resetToBasePose() {
      resetCalls.push("reset");
    },
    updateBonePose(delta) {
      poseDeltas.push(delta);
    },
    updateMorph() {},
    renderScene() {},
  });

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    await runtime.playVmd("/motions/test.vmd", 1.5);
    runtime.renderFrame();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }

  assert.deepEqual(helperDeltas, [0.375]);
  assert.deepEqual(poseDeltas, [0.25]);
  assert.deepEqual(resetCalls, ["reset"]);
});

test("updateVmdLoop starts another built-in idle motion after the current clip duration elapses", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    currentVmdUrl: "/motions/idle-a.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  const originalMathRandom = Math.random;
  Math.random = () => 0;

  try {
    runtime.updateVmdLoop(1800);
  } finally {
    Math.random = originalMathRandom;
  }

  assert.deepEqual(playCalls, [[
    "/motions/idle-b.vmd",
    1.5,
    ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    {
      standbyUrl: "",
      loopGapMs: 0,
      loopMode: "random",
      resumePhase: "loop",
    },
  ]]);
});

test("updateVmdLoop waits for loopGapMs before transitioning to the next loop motion", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd"],
    currentVmdLoopGapMs: 200,
    currentVmdUrl: "/motions/idle-a.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url) {
      playCalls.push(url);
    },
  });

  runtime.updateVmdLoop(1900);
  runtime.updateVmdLoop(2000);

  assert.deepEqual(playCalls, ["/motions/idle-b.vmd"]);
});

test("updateVmdLoop transitions from a loop motion into standby before resuming favorites", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd"],
    currentVmdStandbyUrl: "/motions/standby.vmd",
    currentVmdLoopMode: "random",
    currentVmdLoopPhase: "loop",
    currentVmdUrl: "/motions/idle-a.vmd",
    lastPlayedLoopMotionUrl: "/motions/idle-a.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  runtime.updateVmdLoop(1800);

  assert.deepEqual(playCalls, [[
    "/motions/standby.vmd",
    1.5,
    ["/motions/idle-a.vmd", "/motions/idle-b.vmd"],
    {
      standbyUrl: "/motions/standby.vmd",
      loopGapMs: 0,
      loopMode: "random",
      resumePhase: "standby",
    },
  ]]);
});

test("updateVmdLoop replays standby when only a standby favorite exists", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: [],
    currentVmdStandbyUrl: "/motions/standby.vmd",
    currentVmdLoopMode: "random",
    currentVmdLoopPhase: "standby-only",
    currentVmdUrl: "/motions/standby.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  runtime.updateVmdLoop(1800);

  assert.deepEqual(playCalls, [[
    "/motions/standby.vmd",
    1.5,
    [],
    {
      standbyUrl: "/motions/standby.vmd",
      loopGapMs: 0,
      loopMode: "random",
      resumePhase: "standby-only",
    },
  ]]);
});

test("updateVmdLoop uses the last played loop motion as the sequential anchor after standby", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "motion-clip", duration: 1.2 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    currentVmdStandbyUrl: "/motions/standby.vmd",
    currentVmdLoopMode: "sequential",
    currentVmdLoopPhase: "standby",
    currentVmdUrl: "/motions/standby.vmd",
    lastPlayedLoopMotionUrl: "/motions/idle-b.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 750,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  runtime.updateVmdLoop(1800);

  assert.deepEqual(playCalls, [[
    "/motions/idle-c.vmd",
    1.5,
    ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    {
      standbyUrl: "/motions/standby.vmd",
      loopGapMs: 0,
      loopMode: "sequential",
      resumePhase: "loop",
    },
  ]]);
});

test("idle pose keeps natural standing bone offsets", () => {
  const runtime = makeRuntime();

  assert.deepEqual(runtime.getOffsetsForAction("idle", 1, 1), {});
  assert.deepEqual(runtime.getActionOffsets(1000), {});
});
