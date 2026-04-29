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
    baseBoneTransforms: [],
    baseBoneTransformMap: new Map(),
    vmdAnchorBones: [],
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
    currentVmdAction: null,
    pendingVmdActionCleanups: [],
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

function createProject2PoseMesh() {
  const mesh = new THREE.Group();
  const hip = new THREE.Bone();
  hip.name = "Hip";
  const chest = new THREE.Bone();
  chest.name = "Chest";
  const leftLeg = new THREE.Bone();
  leftLeg.name = "LeftLeg";
  const leftKnee = new THREE.Bone();
  leftKnee.name = "LeftKnee";
  const leftShoulder = new THREE.Bone();
  leftShoulder.name = "LeftShoulder";
  const rightShoulder = new THREE.Bone();
  rightShoulder.name = "RightShoulder";
  const leftArm = new THREE.Bone();
  leftArm.name = "LeftArm";
  const rightArm = new THREE.Bone();
  rightArm.name = "RightArm";
  const leftElbow = new THREE.Bone();
  leftElbow.name = "LeftElbow";
  const rightElbow = new THREE.Bone();
  rightElbow.name = "RightElbow";

  mesh.add(hip);
  hip.add(chest);
  hip.add(leftLeg);
  leftLeg.add(leftKnee);
  chest.add(leftShoulder);
  chest.add(rightShoulder);
  leftShoulder.add(leftArm);
  rightShoulder.add(rightArm);
  leftArm.add(leftElbow);
  rightArm.add(rightElbow);

  const bones = [hip, chest, leftLeg, leftKnee, leftShoulder, rightShoulder, leftArm, rightArm, leftElbow, rightElbow];
  mesh.skeleton = {
    bones,
    getBoneByName(name) {
      return bones.find((bone) => bone.name === name) || null;
    },
    update() {},
  };

  return {
    mesh,
    bones: {
      hip,
      chest,
      leftLeg,
      leftKnee,
      leftShoulder,
      rightShoulder,
      leftArm,
      rightArm,
      leftElbow,
      rightElbow,
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

function createOrbitDomStub() {
  const rootNode = {
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getRootNode() {
      return rootNode;
    },
  };
}

function assertVectorLikeClose(actualValues, expectedValues, epsilon = 1e-9) {
  assert.equal(actualValues.length, expectedValues.length);
  actualValues.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedValues[index]) <= epsilon, `index ${index}: ${value} != ${expectedValues[index]}`);
  });
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

test("resetToBasePose restores unmapped bones when the model root has no pose() helper", () => {
  const runtime = makeRuntime();
  const head = new THREE.Bone();
  head.name = "head";
  head.rotation.set(0.1, 0.2, 0.3);
  const leftLeg = new THREE.Bone();
  leftLeg.name = "leftLeg";
  leftLeg.rotation.set(-0.25, 0.35, 0.45);
  leftLeg.position.set(1, 2, 3);

  const mesh = {
    morphTargetDictionary: {},
    morphTargetInfluences: [0.6],
    traverse(visitor) {
      visitor(head);
      visitor(leftLeg);
    },
  };

  runtime.model = mesh;
  runtime.captureBones(mesh);

  head.rotation.set(0.9, 0.8, 0.7);
  leftLeg.rotation.set(0.6, -0.4, 0.2);
  leftLeg.position.set(8, 9, 10);

  runtime.resetToBasePose();

  assertVectorLikeClose([head.rotation.x, head.rotation.y, head.rotation.z], [0.1, 0.2, 0.3]);
  assertVectorLikeClose([leftLeg.rotation.x, leftLeg.rotation.y, leftLeg.rotation.z], [-0.25, 0.35, 0.45]);
  assertVectorLikeClose([leftLeg.position.x, leftLeg.position.y, leftLeg.position.z], [1, 2, 3]);
  assert.deepEqual(mesh.morphTargetInfluences, [0]);
});

test("renderFrame keeps classic morph influences untouched even when the model is speaking", () => {
  const runtime = makeRuntime({
    renderPipeline: "classic",
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

  assert.deepEqual(runtime.model.morphTargetInfluences, [0, 0, 0, 0, 0, 0]);
});

test("renderFrame keeps genshin morph influences untouched so runtime speaking stays classic-compatible", () => {
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    presentation: getStagePresentationConfig("genshin"),
    model: { morphTargetInfluences: [0] },
    isSpeaking: true,
  });

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    runtime.renderFrame();
    assert.equal(runtime.model.morphTargetInfluences[0], 0);

    runtime.isSpeaking = false;
    runtime.renderFrame();
    assert.equal(runtime.model.morphTargetInfluences[0], 0);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});

test("renderFrame restores only root transport anchors after helper updates", () => {
  const allParent = new THREE.Bone();
  allParent.name = "全ての親";
  allParent.position.set(0, 0, 0);
  const leftLegIk = new THREE.Bone();
  leftLegIk.name = "左足ＩＫ";
  leftLegIk.position.set(0, 0, 0);
  const finger = new THREE.Bone();
  finger.name = "右小指１";
  finger.position.set(0, 0, 0);

  const mesh = {
    morphTargetDictionary: {},
    morphTargetInfluences: [],
    traverse(visitor) {
      visitor(allParent);
      visitor(leftLegIk);
      visitor(finger);
    },
  };

  const runtime = makeRuntime({
    model: mesh,
    currentClip: { duration: 1 },
    helper: {
      update() {
        allParent.position.set(5, 0, 0);
        leftLegIk.position.set(2, 0, 0);
        finger.position.set(1, 0, 0);
      },
    },
  });
  runtime.captureBones(mesh);

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;

  try {
    runtime.renderFrame();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }

  assertVectorLikeClose([allParent.position.x, allParent.position.y, allParent.position.z], [0, 0, 0]);
  assertVectorLikeClose([leftLegIk.position.x, leftLegIk.position.y, leftLegIk.position.z], [2, 0, 0]);
  assertVectorLikeClose([finger.position.x, finger.position.y, finger.position.z], [1, 0, 0]);
});

test("captureBones does not treat leg IK targets as fixed VMD anchors", () => {
  const leftLegIkParent = new THREE.Bone();
  leftLegIkParent.name = "左足IK親";
  leftLegIkParent.position.set(0, 0, 0);
  const leftLegIk = new THREE.Bone();
  leftLegIk.name = "左足ＩＫ";
  leftLegIk.position.set(0, 0, 0);

  const mesh = {
    morphTargetDictionary: {},
    morphTargetInfluences: [],
    traverse(visitor) {
      visitor(leftLegIkParent);
      visitor(leftLegIk);
    },
  };

  const runtime = makeRuntime({
    model: mesh,
  });
  runtime.captureBones(mesh);
  assert.equal(runtime.vmdAnchorBones.includes(leftLegIkParent), false);
  assert.equal(runtime.vmdAnchorBones.includes(leftLegIk), false);
});

test("playVmd builds clips against the captured base skeleton instead of the live animated mesh", async () => {
  const rightLegIk = new THREE.Bone();
  rightLegIk.name = "右足ＩＫ";
  rightLegIk.position.set(1, 2, 3);
  const mesh = {
    isSkinnedMesh: true,
    morphTargetDictionary: {},
    morphTargetInfluences: [],
    skeleton: {
      bones: [rightLegIk],
      getBoneByName(name) {
        return name === rightLegIk.name ? rightLegIk : null;
      },
    },
    traverse(visitor) {
      visitor(rightLegIk);
    },
  };

  const helperCalls = [];
  let loaderTarget = null;
  let loaderBasePosition = null;
  const runtime = makeRuntime({
    model: mesh,
    helper: {
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, object, onLoad) {
        loaderTarget = object;
        loaderBasePosition = object.skeleton.getBoneByName("右足ＩＫ").position.toArray();
        onLoad({ duration: 1 });
      },
    },
    renderScene() {},
  });
  runtime.captureBones(mesh);
  rightLegIk.position.set(10, 20, 30);

  await runtime.playVmd("/motions/test.vmd", 1);

  assert.notEqual(loaderTarget, mesh);
  assert.deepEqual(loaderBasePosition, [1, 2, 3]);
  assert.deepEqual(helperCalls, [
    ["remove", mesh],
    ["add", mesh, true, false],
  ]);
});

test("stage presentation config keeps classic untouched while genshin now reuses the transparent classic framing", () => {
  const classic = getStagePresentationConfig("classic");
  const genshin = getStagePresentationConfig("genshin");
  const fallback = getStagePresentationConfig("unknown");

  assert.equal(classic.fog, null);
  assert.equal(classic.background, null);
  assert.equal(classic.camera.fov, 33);
  assert.deepEqual(classic.camera.position, [0, 9.2, 21.6]);
  assert.deepEqual(classic.camera.target, [0, 7.9, 0]);
  assert.equal(classic.character.targetHeight, 19.5);
  assert.equal(classic.floor.kind, "shadowCatcher");
  assert.equal(classic.floor.opacity, 0.2);
  assert.equal(classic.shadowMapType, THREE.PCFShadowMap);

  assert.equal(genshin.background, null);
  assert.equal(genshin.camera.fov, classic.camera.fov);
  assert.deepEqual(genshin.camera.position, classic.camera.position);
  assert.deepEqual(genshin.camera.target, classic.camera.target);
  assert.equal(genshin.camera.locked, false);
  assert.equal(genshin.backdrop.enabled, false);
  assert.equal(genshin.outline.enabled, false);
  assert.equal(genshin.postfx.enabled, false);
  assert.equal(genshin.lights.ambient.intensity, 0.8);
  assert.equal(genshin.lights.hemisphere.intensity, 0.6);
  assert.equal(genshin.lights.key.intensity, 1.2);
  assert.equal(genshin.lights.fill.intensity, 0.5);
  assert.equal(genshin.shadowMapType, THREE.PCFSoftShadowMap);
  assert.equal(genshin.floor.y, classic.floor.y);
  assert.equal(genshin.floor.opacity, classic.floor.opacity);

  assert.deepEqual(fallback, classic);
});

test("fitModelToPresentation recenters a loaded mesh on the stage floor and normalizes its height", () => {
  const presentation = getStagePresentationConfig("classic");
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 2), new THREE.MeshBasicMaterial());
  body.position.set(6, 5, -3);
  group.add(body);

  runtimeModule.fitModelToPresentation(group, presentation);

  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());

  assert.ok(Math.abs(bounds.min.y - presentation.floor.y) < 1e-6);
  assert.ok(Math.abs(center.x) < 1e-6);
  assert.ok(Math.abs(center.z) < 1e-6);
  assert.ok(Math.abs(size.y - presentation.character.targetHeight) < 1e-6);
});

test("stage presentation config supports hero-shot while preserving classic fallback", () => {
  const classic = getStagePresentationConfig("classic");
  const heroShot = getStagePresentationConfig("hero-shot");

  assert.equal(classic.camera.fov, 33);
  assert.notDeepEqual(heroShot.camera.position, classic.camera.position);
  assert.equal(heroShot.character.targetHeight, 19.5);
  assert.ok(heroShot.outline?.enabled);
  assert.ok(heroShot.backdrop?.enabled);
  assert.ok(heroShot.postfx?.enabled);
  assert.deepEqual(getStagePresentationConfig("unknown"), classic);
});

test("hero-shot presentation keeps portrait staging and lighting restrained", () => {
  const heroShot = getStagePresentationConfig("hero-shot");

  assert.ok(heroShot.camera.fov >= 30);
  assert.ok(heroShot.camera.fov <= 31);
  assert.ok(heroShot.camera.fov < getStagePresentationConfig("classic").camera.fov);
  assert.ok(heroShot.camera.position[2] <= 20.8);
  assert.ok(heroShot.floor.y <= -10.3);
  assert.ok(heroShot.floor.opacity <= 0.03);
  assert.ok(heroShot.lights.ambient.intensity <= 0.7);
  assert.ok(heroShot.lights.key.intensity <= 1.5);
  assert.ok(heroShot.backdrop.panelSize[1] >= 40);
  assert.ok(heroShot.backdrop.panelOpacity >= 0.58);
  assert.ok(heroShot.backdrop.ringOpacity >= 0.5);
  assert.notEqual(heroShot.backdrop.panelColorBottom, "#06162d");
  assert.ok(heroShot.outline.scale >= 1.038);
  assert.ok(heroShot.postfx.bloomStrength >= 0.1);
  assert.ok(heroShot.postfx.bloomStrength <= 0.16);
  assert.ok(heroShot.postfx.grade.contrast >= 1.08);
  assert.ok(heroShot.postfx.grade.saturation >= 1.1);
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
    ["renderer", 33],
    ["camera", "0,7.9,0"],
    ["lights", 0.78],
    ["floor", 0.2],
    ["backdrop", null],
    ["classic", -9.75],
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
  assert.equal(runtime.scene.background, null);
  assert.deepEqual(calls, [
    ["renderer", 33],
    ["camera", "0,7.9,0"],
    ["lights", 0.8],
    ["floor", 0.2],
    ["backdrop", null],
    ["genshin", -9.75],
  ]);
});

test("setupCamera keeps genshin at the screenshot MMD framing without locking controls by default", () => {
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    renderer: { domElement: createOrbitDomStub() },
  });

  runtime.setupCamera(getStagePresentationConfig("genshin"));

  assertVectorLikeClose(runtime.camera.position.toArray(), [0, 9.2, 21.6]);
  assertVectorLikeClose(runtime.controls.target.toArray(), [0, 7.9, 0]);
  assert.equal(runtime.controls.enabled, true);
  assert.equal(runtime.controls.enableRotate, true);
  assert.equal(runtime.controls.enablePan, true);
  assert.equal(runtime.controls.enableZoom, true);
});

test("runtime camera controls can be unlocked, moved, captured, and locked again", () => {
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    renderer: { domElement: createOrbitDomStub() },
  });

  runtime.setupCamera(getStagePresentationConfig("genshin"));
  runtime.setCameraLocked(false);

  assert.equal(runtime.controls.enabled, true);
  assert.equal(runtime.controls.enableRotate, true);
  assert.equal(runtime.controls.enablePan, true);
  assert.equal(runtime.controls.enableZoom, true);
  assertVectorLikeClose(runtime.camera.position.toArray(), [0, 9.2, 21.6]);

  runtime.camera.fov = 37;
  runtime.camera.position.set(1, 2, 3);
  runtime.controls.target.set(4, 5, 6);

  const snapshot = runtime.getCameraSnapshot();
  assert.deepEqual(snapshot, {
    fov: 37,
    position: [1, 2, 3],
    target: [4, 5, 6],
    locked: false,
  });

  const lockedSnapshot = runtime.setCameraLocked(true);
  assert.deepEqual(lockedSnapshot, {
    fov: 37,
    position: [1, 2, 3],
    target: [4, 5, 6],
    locked: true,
  });
  assert.equal(runtime.controls.enabled, false);
});

test("setupScene applies a saved genshin camera snapshot before camera setup", () => {
  const calls = [];
  const runtime = makeRuntime({
    renderPipeline: "genshin",
    cameraSnapshot: {
      fov: 38,
      position: [2, 8, 19],
      target: [0.5, 7.25, -0.4],
      locked: true,
    },
    setupRenderer() {},
    setupCamera(presentation) {
      calls.push(["camera", presentation.camera.fov, presentation.camera.position, presentation.camera.target, presentation.camera.locked]);
    },
    setupLights() {},
    setupFloor() {},
    setupBackdrop() {},
    setupGenshinPipeline() {},
    setupPostprocessing() {},
  });

  runtime.setupScene();

  assert.deepEqual(calls, [["camera", 38, [2, 8, 19], [0.5, 7.25, -0.4], true]]);
});

test("genshin material tuning keeps texture color space, cutout safety, and clears ordinary emissive lift", () => {
  const material = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const ramp = { id: "genshin-ramp" };

  runtimeModule.tuneGenshinMMDMaterial?.(material, ramp);

  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.emissiveMap.colorSpace, THREE.SRGBColorSpace);
  assert.equal(material.alphaTest, 0.5);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.gradientMap, ramp);
  assert.equal(material.emissive.getHex(), 0x000000);
});

test("genshin material tuning boosts explicit glow materials without changing classic glow policy", () => {
  const classic = makeMaterial({ name: "purple glow fx", shininess: 20 });
  const genshin = makeMaterial({ name: "purple glow fx", shininess: 20 });
  const classicRamp = { id: "classic-ramp" };
  const genshinRamp = { id: "genshin-ramp" };

  runtimeModule.tuneClassicMMDMaterial?.(classic, classicRamp);
  runtimeModule.tuneGenshinMMDMaterial?.(genshin, genshinRamp);

  assert.notEqual(classic.emissive.getHex(), 0x9d00ff);
  assert.equal(genshin.emissive.getHex(), 0x9d00ff);
  assert.equal(genshin.emissiveIntensity, 1);
  assert.equal(genshin.gradientMap.id, "genshin-ramp");
});

test("genshin glow detection requires explicit glow or purple fx material names", () => {
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("purple glow fx"), true);
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("emissive aura"), true);
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("nonemissive cloth"), false);
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("purple cloth"), false);
  assert.equal(runtimeModule.isGenshinGlowMaterial?.("fx dress"), false);
});

test("classic material tuning remains separate from genshin emissive cleanup policy", () => {
  const classic = makeMaterial({ name: "Glow FX" });
  const genshin = makeMaterial({ name: "Face Skin" });
  const classicRamp = { id: "classic-ramp" };
  const genshinRamp = { id: "genshin-ramp" };

  runtimeModule.tuneClassicMMDMaterial?.(classic, classicRamp);
  runtimeModule.tuneGenshinMMDMaterial?.(genshin, genshinRamp);

  assert.notEqual(classic.emissive.getHex(), 0x000000);
  assert.equal(genshin.emissive.getHex(), 0x000000);
  assert.equal(classic.gradientMap.id, "classic-ramp");
  assert.equal(genshin.gradientMap.id, "genshin-ramp");
});

test("genshin mask detection follows the broader project2 mask suppression rule", () => {
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("face skin"), false);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("eye lash"), false);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("surface mask"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("tengu mask"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("mask ornament"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("face mask ornament"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("face mask"), true);
  assert.equal(runtimeModule.isGenshinSuppressedMaskMaterial?.("mouth mask"), true);
});

test("genshin material tuning suppresses broad project2-style mask materials", () => {
  const mask = makeMaterial({ name: "face mask" });
  const ornament = makeMaterial({ name: "mask ornament" });

  runtimeModule.tuneGenshinMMDMaterial?.(mask, { id: "genshin-ramp" });
  runtimeModule.tuneGenshinMMDMaterial?.(ornament, { id: "genshin-ramp" });

  assert.equal(mask.visible, false);
  assert.equal(mask.transparent, true);
  assert.equal(mask.opacity, 0);
  assert.equal(ornament.visible, false);
  assert.equal(ornament.opacity, 0);
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

  assert.equal(genshin.alphaTest, 0.5);
  assert.equal(genshin.side, THREE.DoubleSide);
  assert.equal(genshin.gradientMap, genshinRamp);
  assert.equal(genshin.emissive.getHex(), 0x000000);
});

test("genshin material tuning preserves authored toon ramps while keeping hair presentation readable", () => {
  const existingGradientMap = { id: "authored-ramp" };
  const hair = makeMaterial({ name: "前髪", transparent: false, specular: 0.7, shininess: 40 });
  hair.gradientMap = existingGradientMap;

  runtimeModule.tuneGenshinMMDMaterial?.(hair, { id: "generated-ramp" });

  assert.equal(hair.gradientMap, existingGradientMap);
  assert.equal(hair.side, THREE.DoubleSide);
  assert.equal(hair.emissive.getHex(), 0x000000);
});

test("hero-shot material tuning differs from classic while preserving alpha safety", () => {
  const classic = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const hero = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const classicRamp = { id: "classic-ramp" };
  const heroRamp = { id: "hero-shot-ramp" };

  runtimeModule.tuneClassicMMDMaterial?.(classic, classicRamp);
  runtimeModule.tuneHeroShotMMDMaterial?.(hero, heroRamp);

  assert.ok(classic.alphaTest >= 0.48);
  assert.ok(hero.alphaTest >= 0.48);
  assert.notEqual(hero.emissiveIntensity, classic.emissiveIntensity);
  assert.equal(hero.gradientMap, heroRamp);
});

test("hero-shot keeps face shading softer than generic cloth shading", () => {
  const face = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const cloth = makeMaterial({ name: "Cape Cloth", transparent: true, specular: 1, shininess: 80 });
  const heroRamp = { id: "hero-shot-ramp" };

  runtimeModule.tuneHeroShotMMDMaterial?.(face, heroRamp);
  runtimeModule.tuneHeroShotMMDMaterial?.(cloth, heroRamp);

  assert.ok(face.alphaTest >= 0.48);
  assert.ok(cloth.alphaTest >= 0.48);
  assert.ok(face.shininess < cloth.shininess);
  assert.ok(face.emissiveIntensity > cloth.emissiveIntensity);
  assert.ok(face.envMapIntensity < cloth.envMapIntensity);
});

test("hero-shot face material lift stays below overexposure range", () => {
  const face = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

  runtimeModule.tuneHeroShotMMDMaterial?.(face, { id: "hero-shot-ramp" });

  assert.ok(face.emissiveIntensity >= 0.24);
  assert.ok(face.emissiveIntensity <= 0.3);
  assert.ok(face.specular.r <= 0.16);
  assert.ok(face.envMapIntensity <= 0.18);
});

test("loadModel selects material tuning by renderPipeline", async () => {
  const classicMaterial = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const genshinMaterial = makeMaterial({ name: "Hair Cloth", transparent: true, specular: 0.7, shininess: 40 });
  const heroShotMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

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

  const heroShotRuntime = makeRuntime({ renderPipeline: "hero-shot", toonRampTexture: { id: "hero-shot-ramp" } });
  heroShotRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [heroShotMaterial] }));
    },
  };

  await classicRuntime.loadModel("/classic-model.pmx");
  await genshinRuntime.loadModel("/genshin-model.pmx");
  await heroShotRuntime.loadModel("/hero-shot-model.pmx");

  assert.equal(classicMaterial.alphaTest, 0.5);
  assert.equal(classicMaterial.shininess, 26);
  assert.equal(classicMaterial.gradientMap.id, "classic-ramp");

  assert.equal(genshinMaterial.alphaTest, 0.5);
  assert.equal(genshinMaterial.side, THREE.DoubleSide);
  assert.equal(genshinMaterial.gradientMap.id, "genshin-ramp");
  assert.equal(genshinMaterial.emissive.getHex(), 0x000000);

  assert.ok(heroShotMaterial.alphaTest >= 0.48);
  assert.equal(heroShotMaterial.gradientMap.id, "hero-shot-ramp");
  assert.notEqual(heroShotMaterial.shininess, classicMaterial.shininess);
  assert.notEqual(heroShotMaterial.emissiveIntensity, classicMaterial.emissiveIntensity);
});

test("loadModel routes hero-shot face materials through hero-shot tuning instead of classic tuning", async () => {
  const classicFaceMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });
  const heroShotFaceMaterial = makeMaterial({ name: "Face Skin", transparent: true, specular: 1, shininess: 80 });

  const classicRuntime = makeRuntime({ renderPipeline: "classic", toonRampTexture: { id: "classic-ramp" } });
  classicRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [classicFaceMaterial] }));
    },
  };

  const heroShotRuntime = makeRuntime({ renderPipeline: "hero-shot", toonRampTexture: { id: "hero-shot-ramp" } });
  heroShotRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [heroShotFaceMaterial] }));
    },
  };

  await classicRuntime.loadModel("/classic-face-model.pmx");
  await heroShotRuntime.loadModel("/hero-shot-face-model.pmx");

  assert.notEqual(heroShotFaceMaterial.shininess, classicFaceMaterial.shininess);
  assert.notEqual(heroShotFaceMaterial.emissiveIntensity, classicFaceMaterial.emissiveIntensity);
});

test("loadModel keeps outline disabled for classic and genshin while preserving hero-shot outline support", async () => {
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

  const heroShotCalls = [];
  const heroShotRuntime = makeRuntime({
    renderPipeline: "hero-shot",
    toonRampTexture: { id: "hero-shot-ramp" },
    attachCharacterOutline() {
      heroShotCalls.push("hero-shot");
    },
    presentation: getStagePresentationConfig("hero-shot"),
  });
  heroShotRuntime.loader = {
    load(_url, onLoad) {
      onLoad(makeMesh({ materials: [makeMaterial({ name: "Hair Cloth", transparent: true })] }));
    },
  };

  await classicRuntime.loadModel("/classic-model.pmx");
  await genshinRuntime.loadModel("/genshin-model.pmx");
  await heroShotRuntime.loadModel("/hero-shot-model.pmx");

  assert.deepEqual(classicCalls, []);
  assert.deepEqual(genshinCalls, []);
  assert.deepEqual(heroShotCalls, ["hero-shot"]);
});

test("non-genshin outlines keep hidden source material slots on the existing shared path", () => {
  const runtime = makeRuntime({
    renderPipeline: "hero-shot",
    presentation: getStagePresentationConfig("hero-shot"),
  });
  const visibleMaterial = makeMaterial({ name: "Hair" });
  const hiddenMaterial = makeMaterial({ name: "face mask" });
  hiddenMaterial.visible = false;
  const parent = { added: [], add(node) { this.added.push(node); }, remove() {} };

  runtime.attachCharacterOutline(
    {
      traverse(visitor) {
        visitor({
          isMesh: true,
          isSkinnedMesh: false,
          geometry: new THREE.BufferGeometry(),
          material: [visibleMaterial, hiddenMaterial],
          parent,
          position: new THREE.Vector3(),
          quaternion: new THREE.Quaternion(),
          scale: new THREE.Vector3(1, 1, 1),
          renderOrder: 0,
          name: "hero-shot-mixed-face",
        });
      },
    },
    getStagePresentationConfig("hero-shot"),
  );

  assert.equal(runtime.outlineObjects.length, 1);
  assert.equal(parent.added.length, 1);
  assert.equal(Array.isArray(runtime.outlineObjects[0].material), false);
});

test("setupBackdrop stays disabled for classic and genshin once genshin follows project2 staging", () => {
  const classicAdds = [];
  const classicRuntime = makeRuntime({
    scene: { add(node) { classicAdds.push(node); }, remove() {} },
  });
  classicRuntime.setupBackdrop(getStagePresentationConfig("classic"));
  assert.equal(classicRuntime.backdropGroup, null);
  assert.deepEqual(classicAdds, []);

  const genshinAdds = [];
  const genshinRuntime = makeRuntime({
    scene: { add(node) { genshinAdds.push(node); }, remove() {} },
  });
  genshinRuntime.setupBackdrop(getStagePresentationConfig("genshin"));
  assert.equal(genshinRuntime.backdropGroup, null);
  assert.deepEqual(genshinAdds, []);
});

test("setupFloor keeps genshin to a plain shadow catcher without decorative stage layers", () => {
  withStubbedDocument(() => {
    const adds = [];
    const runtime = makeRuntime({
      scene: { add(node) { adds.push(node); }, remove() {} },
    });

    runtime.setupFloor(getStagePresentationConfig("genshin"));

    assert.equal(adds.length, 1);
    assert.ok(runtime.floorGroup);
    assert.equal(runtime.floorGroup.children.length, 1);
    assert.deepEqual(runtime.floorTextures, []);
  });
});

test("renderScene uses direct renderer for both classic and project2-style genshin", () => {
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
  assert.deepEqual(genshinCalls, ["renderer"]);
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
  assert.deepEqual(second.camera.position, [0, 9.2, 21.6]);
  assert.deepEqual(second.lights.key.position, [-14, 20, 28]);
  assert.equal(second.floor.opacity, 0.2);
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
  assert.equal(genshinRuntime.shouldUsePostFX(), false);
});

test("genshin bloom stays disabled when the project2-style stage bypasses postfx", () => {
  const runtime = makeRuntime({ presentation: getStagePresentationConfig("genshin") });
  const genshinPresentation = getStagePresentationConfig("genshin");

  assert.equal(runtime.shouldUseBloom(genshinPresentation), false);
  assert.equal(runtime.shouldUseBloom(getStagePresentationConfig("classic")), false);
});

test("loadModel keeps genshin base skeleton capture aligned with classic integration semantics", async () => {
  const classicAsset = createProject2PoseMesh();
  const genshinAsset = createProject2PoseMesh();

  const classicRuntime = makeRuntime({
    renderPipeline: "classic",
    presentation: getStagePresentationConfig("classic"),
    toonRampTexture: { id: "classic-ramp" },
  });
  classicRuntime.loader = {
    load(_url, onLoad) {
      onLoad(classicAsset.mesh);
    },
  };

  const genshinRuntime = makeRuntime({
    renderPipeline: "genshin",
    presentation: getStagePresentationConfig("genshin"),
    toonRampTexture: { id: "genshin-ramp" },
  });
  genshinRuntime.loader = {
    load(_url, onLoad) {
      onLoad(genshinAsset.mesh);
    },
  };

  await classicRuntime.loadModel("/classic-pose-model.pmx");
  await genshinRuntime.loadModel("/genshin-pose-model.pmx");

  assert.equal(classicAsset.bones.leftArm.rotation.z, 0);
  assert.equal(classicAsset.bones.rightArm.rotation.z, 0);
  assert.equal(classicRuntime.baseBoneRotation.leftArm.z, 0);
  assert.equal(classicRuntime.baseBoneRotation.rightArm.z, 0);

  assert.equal(genshinAsset.bones.hip.rotation.z, 0);
  assert.equal(genshinAsset.bones.chest.rotation.z, 0);
  assert.equal(genshinAsset.bones.leftLeg.rotation.z, 0);
  assert.equal(genshinAsset.bones.leftLeg.rotation.y, 0);
  assert.equal(genshinAsset.bones.leftKnee.rotation.x, 0);
  assert.equal(genshinAsset.bones.leftArm.rotation.z, 0);
  assert.equal(genshinAsset.bones.rightArm.rotation.z, 0);
  assert.equal(genshinRuntime.baseBoneRotation.leftArm.z, 0);
  assert.equal(genshinRuntime.baseBoneRotation.rightArm.z, 0);
  assert.ok(genshinRuntime.baseBoneTransformMap.get(genshinAsset.bones.leftKnee).quaternion.angleTo(genshinAsset.bones.leftKnee.quaternion) < 1e-9);
});

test("renderFrame accelerates active VMD clips without applying procedural pose updates", async () => {
  const helperDeltas = [];
  const poseDeltas = [];
  const morphCalls = [];
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
    updateMorph() {
      morphCalls.push("morph");
    },
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
  assert.deepEqual(poseDeltas, []);
  assert.deepEqual(morphCalls, []);
  assert.deepEqual(resetCalls, ["reset"]);
});

test("playVmd crossfades into the next VMD when mixer actions are available", async () => {
  const helperCalls = [];
  const actionCalls = [];
  const existingClip = { name: "existing-clip", duration: 1 };
  const replacementClip = { name: "standby-clip", duration: 1 };
  const existingAction = {
    stopFading() {
      actionCalls.push(["existing", "stopFading"]);
      return this;
    },
    stopWarping() {
      actionCalls.push(["existing", "stopWarping"]);
      return this;
    },
  };
  const nextAction = {
    reset() {
      actionCalls.push(["next", "reset"]);
      return this;
    },
    stopFading() {
      actionCalls.push(["next", "stopFading"]);
      return this;
    },
    stopWarping() {
      actionCalls.push(["next", "stopWarping"]);
      return this;
    },
    setEffectiveTimeScale(value) {
      actionCalls.push(["next", "timeScale", value]);
      return this;
    },
    setEffectiveWeight(value) {
      actionCalls.push(["next", "weight", value]);
      return this;
    },
    play() {
      actionCalls.push(["next", "play"]);
      return this;
    },
    crossFadeFrom(action, duration, warp) {
      actionCalls.push(["next", "crossFadeFrom", action, duration, warp]);
      return this;
    },
  };
  const mixer = {
    existingAction(clip) {
      if (clip === existingClip) return existingAction;
      return null;
    },
    clipAction(clip) {
      actionCalls.push(["mixer", "clipAction", clip]);
      return clip === replacementClip ? nextAction : null;
    },
  };
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    currentClip: existingClip,
    helper: {
      objects: {
        get(target) {
          if (target === model) return { mixer };
          return null;
        },
      },
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad(replacementClip);
      },
    },
    renderScene() {},
  });

  await runtime.playVmd("/motions/standby.vmd", 1, ["/motions/loop-a.vmd"], {
    standbyUrl: "/motions/standby.vmd",
    resumePhase: "standby",
  });

  assert.deepEqual(helperCalls, []);
  assert.deepEqual(actionCalls, [
    ["mixer", "clipAction", replacementClip],
    ["next", "reset"],
    ["next", "stopFading"],
    ["next", "stopWarping"],
    ["next", "timeScale", 1],
    ["next", "weight", 1],
    ["next", "play"],
    ["existing", "stopFading"],
    ["existing", "stopWarping"],
    ["next", "crossFadeFrom", existingAction, 0.24, false],
  ]);
  assert.equal(runtime.currentClip, replacementClip);
  assert.equal(runtime.currentVmdAction, nextAction);
  assert.equal(runtime.pendingVmdActionCleanups.length, 1);
  assert.equal(runtime.pendingVmdActionCleanups[0].clip, existingClip);
  assert.equal(runtime.pendingVmdActionCleanups[0].action, existingAction);
});

test("playVmd falls back to helper swapping when leaving standby for the next loop motion", async () => {
  const helperCalls = [];
  const actionCalls = [];
  const standbyClip = { name: "standby-clip", duration: 1 };
  const nextLoopClip = { name: "loop-clip", duration: 1 };
  const standbyAction = {
    stopFading() {
      actionCalls.push(["standby", "stopFading"]);
      return this;
    },
    stopWarping() {
      actionCalls.push(["standby", "stopWarping"]);
      return this;
    },
  };
  const mixer = {
    existingAction(clip) {
      if (clip === standbyClip) return standbyAction;
      return null;
    },
    clipAction(clip) {
      actionCalls.push(["mixer", "clipAction", clip]);
      return null;
    },
  };
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    currentClip: standbyClip,
    currentVmdLoopPhase: "standby",
    currentVmdAction: standbyAction,
    helper: {
      objects: {
        get(target) {
          if (target === model) return { mixer };
          return null;
        },
      },
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad(nextLoopClip);
      },
    },
    renderScene() {},
  });

  await runtime.playVmd("/motions/loop-b.vmd", 1, ["/motions/loop-a.vmd", "/motions/loop-b.vmd"], {
    standbyUrl: "/motions/standby.vmd",
    resumePhase: "loop",
  });

  assert.deepEqual(actionCalls, []);
  assert.deepEqual(helperCalls, [
    ["remove", model],
    ["add", model, true, false],
  ]);
  assert.equal(runtime.currentClip, nextLoopClip);
});

test("playVmd resets to the base pose before helper-swapping to a replacement VMD clip", async () => {
  const resetCalls = [];
  const helperCalls = [];
  const model = { isSkinnedMesh: true };
  const runtime = makeRuntime({
    model,
    currentClip: { name: "existing-clip", duration: 1 },
    helper: {
      remove(target) {
        helperCalls.push(["remove", target]);
      },
      add(target, options) {
        helperCalls.push(["add", target, Boolean(options?.animation), Boolean(options?.physics)]);
      },
      update() {},
    },
    loader: {
      loadAnimation(_url, _model, onLoad) {
        onLoad({ name: "replacement-clip", duration: 1 });
      },
    },
    resetToBasePose() {
      resetCalls.push("reset");
    },
    renderScene() {},
  });

  await runtime.playVmd("/motions/replacement.vmd", 1);

  assert.deepEqual(resetCalls, ["reset"]);
  assert.deepEqual(helperCalls, [
    ["remove", model],
    ["add", model, true, false],
  ]);
  assert.equal(runtime.currentClip?.name, "replacement-clip");
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

test("updateVmdLoop leaves zero-duration standby clips and resumes the next loop motion", () => {
  const playCalls = [];
  const runtime = makeRuntime({
    currentClip: { name: "standby-clip", duration: 0 },
    currentVmdPlaybackRate: 1.5,
    currentVmdLoopUrls: ["/motions/idle-a.vmd", "/motions/idle-b.vmd", "/motions/idle-c.vmd"],
    currentVmdStandbyUrl: "/motions/standby.vmd",
    currentVmdLoopMode: "sequential",
    currentVmdLoopPhase: "standby",
    currentVmdUrl: "/motions/standby.vmd",
    lastPlayedLoopMotionUrl: "/motions/idle-b.vmd",
    currentVmdStartedAt: 1000,
    currentVmdDurationMs: 0,
    isLoadingVmd: false,
    playVmd(url, playbackRate, loopUrls, loopOptions) {
      playCalls.push([url, playbackRate, loopUrls, loopOptions]);
    },
  });

  runtime.updateVmdLoop(1001);

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
