import * as THREE from "three";
import { MMDAnimationHelper, MMDLoader, OrbitControls } from "three-stdlib";

const EMOTION_MORPH_HINTS = {
  happy: ["笑", "にこ", "smile"],
  sad: ["悲", "困", "sad"],
  caring: ["優", "穏", "smile"],
  neutral: [],
  thinking: [],
  excited: ["笑", "にこ", "smile"],
};

const ACTION_DURATION = {
  idle: 0,
  nod: 1200,
  wave: 1800,
  think: 1800,
  cheer: 1600,
  comfort: 1400,
  lean_in: 1600,
  look_away: 1500,
  headshake: 1300,
};

const smooth = (current, target, lambda, dt) => THREE.MathUtils.damp(current, target, lambda, dt);

export function getStagePresentationConfig() {
  return {
    background: "#15171c",
    fog: null,
    camera: {
      fov: 36,
      position: [0, 9.6, 24],
      target: [0, 7.6, 0],
      minDistance: 14,
      maxDistance: 30,
      maxPolarAngle: Math.PI * 0.46,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.72 },
      hemisphere: { sky: "#f4f8ff", ground: "#5a6270", intensity: 0.52 },
      key: { color: 0xffffff, intensity: 1.32, position: [-12, 18, 24] },
      fill: { color: 0xffffff, intensity: 0.42, position: [14, 8, 16] },
      rim: { color: 0xffffff, intensity: 0.32, position: [-10, 12, -18] },
    },
    shadowMapType: THREE.PCFShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -10,
      opacity: 0.24,
    },
  };
}

function describeMaterial(material) {
  return [
    material?.name,
    material?.map?.name,
    material?.alphaMap?.name,
    material?.userData?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferMaterialProfile(material) {
  const text = describeMaterial(material);
  const metalHints = ["metal", "armor", "steel", "blade", "weapon", "gun", "mecha", "buckle"];
  const skinHints = ["skin", "face", "body", "cheek", "neck", "hand", "arm", "leg"];
  const thinClothHints = [
    "skirt",
    "dress",
    "cloth",
    "cape",
    "cloak",
    "ribbon",
    "frill",
    "sleeve",
    "hair",
    "bang",
    "strand",
  ];

  if (metalHints.some((hint) => text.includes(hint))) return "metal";
  if (skinHints.some((hint) => text.includes(hint))) return "skin";
  if (thinClothHints.some((hint) => text.includes(hint))) return "thin";
  return "default";
}

function createToonRampTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0, "#505050");
  gradient.addColorStop(0.3, "#b4b4b4");
  gradient.addColorStop(0.7, "#ffffff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function tuneMMDMaterial(material, rampTexture) {
  if (!material) return;
  const profile = inferMaterialProfile(material);

  if ("fog" in material) material.fog = false;

  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
  if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  if (material.color) material.color.multiplyScalar(1.12);
  if (material.emissive) material.emissive.multiplyScalar(1.05);
  if ("envMapIntensity" in material) material.envMapIntensity = 0.45;
  if ("emissiveIntensity" in material) material.emissiveIntensity = 0.24;

  const needsCutout =
    Boolean(material.transparent) ||
    (typeof material.opacity === "number" && material.opacity < 1) ||
    Boolean(material.alphaMap);

  if (needsCutout) material.alphaTest = Math.max(material.alphaTest || 0, 0.5);
  if (needsCutout || profile === "thin") material.side = THREE.DoubleSide;

  if (profile === "skin") {
    if ("shininess" in material && typeof material.shininess === "number") {
      material.shininess = Math.min(material.shininess, 18);
    }
    if ("specular" in material && material.specular?.isColor) {
      material.specular.multiplyScalar(0.45);
    }
    if ("emissiveIntensity" in material) material.emissiveIntensity = 0.16;
  } else if (profile !== "metal") {
    if ("shininess" in material && typeof material.shininess === "number") {
      material.shininess = Math.min(material.shininess, 26);
    }
    if ("specular" in material && material.specular?.isColor) {
      material.specular.multiplyScalar(0.72);
    }
  }

  if ("gradientMap" in material && rampTexture) {
    material.gradientMap = rampTexture;
  }

  material.needsUpdate = true;
}

export class MMDCompanionRuntime {
  constructor({ container, statusElement }) {
    this.container = container;
    this.statusElement = statusElement;
    this.clock = new THREE.Clock();
    this.loader = new MMDLoader();
    this.loader.crossOrigin = "anonymous";
    this.helper = new MMDAnimationHelper({ afterglow: 1.1 });
    this.hasPhysicsSupport = typeof globalThis.Ammo !== "undefined";

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.model = null;
    this.currentClip = null;
    this.currentAction = null;
    this.currentSequence = null;
    this.activeEmotion = "neutral";
    this.isSpeaking = false;
    this.destroyed = false;

    this.bones = {};
    this.baseBoneRotation = {};
    this.morphSlots = {};

    this.toonRampTexture = null;
  }

  setStatus(text) {
    if (this.statusElement) this.statusElement.textContent = text;
  }

  async init(modelUrl) {
    this.setupScene();
    this.bindResize();
    this.startRenderLoop();
    await this.loadModel(modelUrl);
  }

  setupScene() {
    const presentation = getStagePresentationConfig();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(presentation.background);
    this.scene.fog = presentation.fog;

    this.camera = new THREE.PerspectiveCamera(presentation.camera.fov, 1, 0.1, 120);
    this.camera.position.fromArray(presentation.camera.position);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = presentation.shadowMapType;
    this.container.replaceChildren(this.renderer.domElement);

    this.toonRampTexture = createToonRampTexture();

    this.scene.add(new THREE.AmbientLight(presentation.lights.ambient.color, presentation.lights.ambient.intensity));
    this.scene.add(
      new THREE.HemisphereLight(
        presentation.lights.hemisphere.sky,
        presentation.lights.hemisphere.ground,
        presentation.lights.hemisphere.intensity,
      ),
    );

    const key = new THREE.DirectionalLight(presentation.lights.key.color, presentation.lights.key.intensity);
    key.position.fromArray(presentation.lights.key.position);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.normalBias = 0.012;
    key.shadow.bias = -0.00025;
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -14;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(presentation.lights.fill.color, presentation.lights.fill.intensity);
    fill.position.fromArray(presentation.lights.fill.position);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(presentation.lights.rim.color, presentation.lights.rim.intensity);
    rim.position.fromArray(presentation.lights.rim.position);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(presentation.floor.size, presentation.floor.size),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: presentation.floor.opacity }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = presentation.floor.y;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.fromArray(presentation.camera.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = presentation.camera.minDistance;
    this.controls.maxDistance = presentation.camera.maxDistance;
    this.controls.maxPolarAngle = presentation.camera.maxPolarAngle;
  }

  bindResize() {
    this.handleResize = () => {
      if (!this.renderer || !this.camera || !this.container) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (width === 0 || height === 0) return;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    };
    window.addEventListener("resize", this.handleResize);
    this.handleResize();
  }

  clearModel() {
    if (!this.model) return;
    try {
      this.helper.remove(this.model);
    } catch {
      // ignore removal errors
    }
    this.scene.remove(this.model);
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
        else child.material?.dispose?.();
      }
    });
    this.model = null;
    this.bones = {};
    this.baseBoneRotation = {};
    this.morphSlots = {};
  }

  async loadModel(modelUrl) {
    this.setStatus("Loading MMD model...");
    this.clearModel();
    const mesh = await new Promise((resolve, reject) => {
      this.loader.load(modelUrl, resolve, undefined, reject);
    });
    mesh.position.set(0, -10, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) tuneMMDMaterial(material, this.toonRampTexture);
    });
    this.scene.add(mesh);
    this.model = mesh;
    this.helper.add(mesh, { physics: this.hasPhysicsSupport });
    this.captureBones(mesh);
    this.setStatus("Model ready.");
  }

  captureBones(mesh) {
    const bones = [];
    mesh.traverse((child) => {
      if (child.isBone) bones.push(child);
    });

    const findBone = (hints) => {
      const lowerHints = hints.map((hint) => hint.toLowerCase());
      return bones.find((bone) => lowerHints.some((hint) => bone.name.toLowerCase().includes(hint)));
    };

    this.bones = {
      upperBody: findBone(["upperbody", "spine", "chest"]),
      neck: findBone(["neck"]),
      head: findBone(["head"]),
      leftArm: findBone(["leftarm", "arm_l", "l_shoulder"]),
      rightArm: findBone(["rightarm", "arm_r", "r_shoulder"]),
      leftElbow: findBone(["leftelbow", "forearm_l", "l_forearm"]),
      rightElbow: findBone(["rightelbow", "forearm_r", "r_forearm"]),
    };

    for (const [slot, bone] of Object.entries(this.bones)) {
      if (bone) this.baseBoneRotation[slot] = bone.rotation.clone();
    }

    const dict = mesh.morphTargetDictionary || {};
    this.morphSlots = {
      smile: this.findMorphIndex(dict, ["笑", "にこ", "smile"]),
      sad: this.findMorphIndex(dict, ["悲", "困", "sad"]),
      blink: this.findMorphIndex(dict, ["まばたき", "blink"]),
      mouthA: this.findMorphIndex(dict, ["あ", "mouth_a"]),
      mouthI: this.findMorphIndex(dict, ["い", "mouth_i"]),
      mouthU: this.findMorphIndex(dict, ["う", "mouth_u"]),
    };
  }

  findMorphIndex(dictionary, hints) {
    const entries = Object.entries(dictionary);
    const lowerHints = hints.map((hint) => hint.toLowerCase());
    const exact = entries.find(([name]) => lowerHints.includes(name.toLowerCase()));
    if (exact) return exact[1];
    const found = entries.find(([name]) => lowerHints.some((hint) => name.toLowerCase().includes(hint)));
    return found ? found[1] : undefined;
  }

  async playVmd(url) {
    if (!this.model) return;
    try {
      this.currentAction = null;
      this.currentSequence = null;
      if (this.currentClip) {
        this.helper.remove(this.model);
        this.helper.add(this.model, { physics: this.hasPhysicsSupport });
      }
      const clip = await new Promise((resolve, reject) => {
        this.loader.loadAnimation(url, this.model, resolve, undefined, reject);
      });
      this.currentClip = clip;
      this.helper.remove(this.model);
      this.helper.add(this.model, { animation: clip, physics: this.hasPhysicsSupport });
      this.setStatus("Playing mapped VMD motion.");
    } catch {
      this.setStatus("VMD playback failed, fallback to procedural.");
    }
  }

  setSpeaking(flag) {
    this.isSpeaking = !!flag;
  }

  applyInteraction({ emotion = "neutral", action = "idle", sequence = [] }) {
    this.activeEmotion = emotion;
    if (this.currentClip && this.model) {
      this.currentClip = null;
      this.helper.remove(this.model);
      this.helper.add(this.model, { physics: this.hasPhysicsSupport });
    }
    if (Array.isArray(sequence) && sequence.length) {
      this.currentSequence = {
        startedAt: performance.now(),
        steps: sequence
          .filter((step) => step?.action)
          .map((step) => ({
            action: step.action,
            durationMs: Number(step.durationMs) || ACTION_DURATION[step.action] || ACTION_DURATION.idle,
            intensity: Number(step.intensity) || 0.6,
          })),
      };
      this.currentAction = null;
      return;
    }
    this.currentSequence = null;
    const duration = ACTION_DURATION[action] ?? ACTION_DURATION.idle;
    this.currentAction = duration ? { name: action, startedAt: performance.now(), duration } : null;
  }

  getOffsetsForAction(action, t, intensity = 1) {
    switch (action) {
      case "nod":
        return { head: { x: Math.sin(t * 8.5) * 0.24 * intensity } };
      case "wave":
        return {
          rightArm: { z: -0.9 * intensity, x: -0.15 + Math.sin(t * 9) * 0.18 * intensity },
          rightElbow: { z: -0.45 + Math.sin(t * 9) * 0.16 * intensity },
        };
      case "think":
        return {
          head: { y: 0.28 * intensity, x: -0.1 * intensity },
          leftArm: { z: 0.26 * intensity },
          rightArm: { z: -0.06 * intensity },
        };
      case "cheer":
        return {
          leftArm: { x: -1.2 + Math.sin(t * 10) * 0.08 * intensity, z: 0.26 * intensity },
          rightArm: { x: -1.2 + Math.sin(t * 10) * 0.08 * intensity, z: -0.26 * intensity },
        };
      case "comfort":
        return { head: { x: 0.22 * intensity, y: -0.12 * intensity }, upperBody: { x: 0.08 * intensity } };
      case "lean_in":
        return { upperBody: { x: 0.18 * intensity }, head: { x: 0.1 * intensity } };
      case "look_away":
        return { head: { y: 0.34 * intensity }, neck: { y: 0.2 * intensity }, upperBody: { y: 0.08 * intensity } };
      case "headshake":
        return { head: { y: Math.sin(t * 9) * 0.25 * intensity } };
      default:
        return {};
    }
  }

  getActionOffsets(nowMs) {
    if (this.currentSequence?.steps?.length) {
      const elapsed = nowMs - this.currentSequence.startedAt;
      let cursor = 0;
      for (const step of this.currentSequence.steps) {
        const stepEnd = cursor + step.durationMs;
        if (elapsed <= stepEnd) {
          return this.getOffsetsForAction(step.action, (elapsed - cursor) / 1000, step.intensity);
        }
        cursor = stepEnd;
      }
      this.currentSequence = null;
      return {};
    }

    if (!this.currentAction) return {};
    const elapsed = nowMs - this.currentAction.startedAt;
    if (elapsed > this.currentAction.duration) {
      this.currentAction = null;
      return {};
    }
    return this.getOffsetsForAction(this.currentAction.name, elapsed / 1000, 1);
  }

  updateBonePose(delta, nowMs) {
    const actionPose = this.getActionOffsets(nowMs);
    const targets = {
      upperBody: { x: 0, y: 0, z: 0 },
      head: { x: 0, y: 0, z: 0 },
      neck: { x: 0, y: 0, z: 0 },
      leftArm: { x: 0, y: 0, z: 0 },
      rightArm: { x: 0, y: 0, z: 0 },
      leftElbow: { x: 0, y: 0, z: 0 },
      rightElbow: { x: 0, y: 0, z: 0 },
    };
    for (const [slot, values] of Object.entries(actionPose)) {
      targets[slot] = { ...targets[slot], ...values };
    }
    for (const [slot, bone] of Object.entries(this.bones)) {
      if (!bone) continue;
      const base = this.baseBoneRotation[slot] || new THREE.Euler(0, 0, 0);
      const target = targets[slot] || { x: 0, y: 0, z: 0 };
      bone.rotation.x = smooth(bone.rotation.x, base.x + target.x, 9, delta);
      bone.rotation.y = smooth(bone.rotation.y, base.y + target.y, 9, delta);
      bone.rotation.z = smooth(bone.rotation.z, base.z + target.z, 9, delta);
    }
  }

  updateMorph(delta, nowMs) {
    if (!this.model?.morphTargetInfluences) return;
    const influences = this.model.morphTargetInfluences;
    const setMorph = (index, value) => {
      if (typeof index !== "number" || index >= influences.length) return;
      const current = typeof influences[index] === "number" ? influences[index] : 0;
      influences[index] = smooth(current, value, 12, delta);
    };

    const hints = EMOTION_MORPH_HINTS[this.activeEmotion] || [];
    const shouldSmile = hints.includes("smile") || hints.includes("笑") || hints.includes("にこ");
    const shouldSad = hints.includes("sad") || hints.includes("悲") || hints.includes("困");

    setMorph(this.morphSlots.smile, shouldSmile ? 0.75 : 0.06);
    setMorph(this.morphSlots.sad, shouldSad ? 0.7 : 0);

    const blinkValue = Math.pow(Math.max(0, Math.sin(nowMs * 0.0051)), 20) * 0.9;
    setMorph(this.morphSlots.blink, blinkValue);

    const lipBase = this.isSpeaking ? 0.22 + Math.abs(Math.sin(nowMs * 0.021)) * 0.55 : 0;
    setMorph(this.morphSlots.mouthA, lipBase);
    setMorph(this.morphSlots.mouthI, this.isSpeaking ? lipBase * 0.5 : 0);
    setMorph(this.morphSlots.mouthU, this.isSpeaking ? lipBase * 0.34 : 0);
  }

  renderFrame() {
    if (this.destroyed) return;
    requestAnimationFrame(() => this.renderFrame());
    const delta = this.clock.getDelta();
    const nowMs = performance.now();
    this.helper.update(delta);
    this.updateBonePose(delta, nowMs);
    this.updateMorph(delta, nowMs);
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  startRenderLoop() {
    this.renderFrame();
  }

  dispose() {
    this.destroyed = true;
    if (this.handleResize) window.removeEventListener("resize", this.handleResize);
    this.clearModel();
    this.renderer?.dispose();
    this.toonRampTexture?.dispose?.();
  }
}









