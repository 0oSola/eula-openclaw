import * as THREE from "three";
import { MMDAnimationHelper, MMDLoader, OrbitControls } from "three-stdlib";

export const DEFAULT_MODEL_URL =
  "/assets/mmd/miku/miku_v2.pmd";
export const DEFAULT_MOTION_URL =
  "/assets/mmd/vmds/wavefile_v2.vmd";

const EMOTION_MORPH_HINTS = {
  happy: ["笑", "にこ", "smile"],
  sad: ["困", "悲", "sad"],
  caring: ["優", "困", "smile"],
  neutral: [],
  thinking: [],
  excited: ["笑", "にこ", "smile"]
};

const ACTION_DURATION = {
  idle: 0,
  nod: 1200,
  wave: 1800,
  think: 1800,
  cheer: 1600,
  comfort: 1400
};

const smooth = (current, target, lambda, dt) => THREE.MathUtils.damp(current, target, lambda, dt);

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
  if (material.alphaTest > 0) material.side = THREE.DoubleSide;

  if ("shininess" in material && typeof material.shininess === "number") {
    material.shininess = Math.min(material.shininess, 22);
  }
  if ("specular" in material && material.specular?.isColor) {
    material.specular.multiplyScalar(0.55);
  }

  if ("gradientMap" in material && rampTexture) {
    material.gradientMap = rampTexture;
  }

  material.needsUpdate = true;
}

export class MMDCompanion {
  constructor({ container, statusElement }) {
    this.container = container;
    this.statusElement = statusElement;
    this.clock = new THREE.Clock();
    this.loader = new MMDLoader();
    this.loader.crossOrigin = "anonymous";
    this.helper = new MMDAnimationHelper({ afterglow: 1.2 });

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.model = null;

    this.bones = {};
    this.baseBoneRotation = {};
    this.morphSlots = {};
    this.activeEmotion = "neutral";
    this.currentAction = null;
    this.isSpeaking = false;
    this.destroyed = false;

    this.toonRampTexture = null;
  }

  setStatus(text) {
    if (this.statusElement) this.statusElement.textContent = text;
  }

  async init({ modelUrl = DEFAULT_MODEL_URL, motionUrl = "" } = {}) {
    this.setupScene();
    this.bindResize();
    this.startRenderLoop();
    await this.loadModel({ modelUrl, motionUrl });
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#05111d");
    this.scene.fog = new THREE.Fog("#05111d", 18, 42);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    this.camera.position.set(0, 10, 28);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.replaceChildren(this.renderer.domElement);

    this.toonRampTexture = createToonRampTexture();

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const hemisphereLight = new THREE.HemisphereLight("#9ce6ff", "#0d1f2f", 0.6);
    this.scene.add(hemisphereLight);

    const keyLight = new THREE.DirectionalLight("#ffffff", 1.25);
    keyLight.position.set(-15, 20, 30);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#ffffff", 0.55);
    fillLight.position.set(15, 10, -20);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight("#ffffff", 0.45);
    rimLight.position.set(-15, 10, -20);
    this.scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(18, 64),
      new THREE.MeshStandardMaterial({
        color: "#0e2435",
        roughness: 0.93,
        metalness: 0.05
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -10;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 6, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 16;
    this.controls.maxDistance = 34;
    this.controls.maxPolarAngle = Math.PI * 0.48;
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
      // no-op: helper may not have this mesh registered when load failed midway
    }
    this.scene.remove(this.model);
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose?.());
        } else {
          child.material?.dispose?.();
        }
      }
    });
    this.model = null;
    this.bones = {};
    this.baseBoneRotation = {};
    this.morphSlots = {};
  }

  async loadModel({ modelUrl, motionUrl }) {
    this.setStatus("正在加载 MMD 模型...");
    this.clearModel();

    const mesh = await new Promise((resolve, reject) => {
      this.loader.load(
        modelUrl,
        (loadedMesh) => resolve(loadedMesh),
        undefined,
        (error) => reject(error)
      );
    }).catch((error) => {
      this.setStatus("模型加载失败，请检查 URL 或网络权限。");
      throw error;
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

    if (motionUrl?.trim()) {
      try {
        const animation = await new Promise((resolve, reject) => {
          this.loader.loadAnimation(
            motionUrl.trim(),
            mesh,
            (clip) => resolve(clip),
            undefined,
            (error) => reject(error)
          );
        });
        this.helper.add(mesh, { animation, physics: true });
      } catch {
        this.helper.add(mesh, { physics: true });
      }
    } else {
      this.helper.add(mesh, { physics: true });
    }

    this.captureRigSlots(mesh);
    this.setStatus("模型已就绪，开始聊天吧。");
  }

  captureRigSlots(mesh) {
    const bones = [];
    mesh.traverse((child) => {
      if (child.isBone) bones.push(child);
    });

    const findBone = (hints) => {
      const lowerHints = hints.map((hint) => hint.toLowerCase());
      return bones.find((bone) =>
        lowerHints.some((hint) => bone.name.toLowerCase().includes(hint))
      );
    };

    this.bones = {
      upperBody: findBone(["上半身", "spine", "upperbody", "chest"]),
      neck: findBone(["首", "neck"]),
      head: findBone(["頭", "head"]),
      leftArm: findBone(["左腕", "leftarm", "arm_l", "l_shoulder"]),
      rightArm: findBone(["右腕", "rightarm", "arm_r", "r_shoulder"]),
      leftElbow: findBone(["左ひじ", "leftelbow", "forearm_l", "l_forearm"]),
      rightElbow: findBone(["右ひじ", "rightelbow", "forearm_r", "r_forearm"])
    };

    for (const [slot, bone] of Object.entries(this.bones)) {
      if (bone) this.baseBoneRotation[slot] = bone.rotation.clone();
    }

    const dict = mesh.morphTargetDictionary || {};
    this.morphSlots = {
      smile: this.findMorphIndex(dict, ["笑", "にこ", "smile"]),
      sad: this.findMorphIndex(dict, ["悲", "困", "sad"]),
      blink: this.findMorphIndex(dict, ["まばたき", "blink"]),
      mouthA: this.findMorphIndex(dict, ["あ", "mouth_a", "a"]),
      mouthI: this.findMorphIndex(dict, ["い", "mouth_i", "i"]),
      mouthU: this.findMorphIndex(dict, ["う", "mouth_u", "u"])
    };
  }

  findMorphIndex(dictionary, hints) {
    const entries = Object.entries(dictionary);
    const lowerHints = hints.map((hint) => hint.toLowerCase());
    const found = entries.find(([name]) =>
      lowerHints.some((hint) => name.toLowerCase().includes(hint))
    );
    return found ? found[1] : undefined;
  }

  setSpeaking(flag) {
    this.isSpeaking = !!flag;
  }

  reactToUserMessage(message) {
    if (!message?.trim()) return;
    if (/[?？]/.test(message)) {
      this.applyInteraction({ emotion: "thinking", action: "think" });
      return;
    }
    this.applyInteraction({ emotion: "neutral", action: "idle" });
  }

  applyInteraction({ emotion = "neutral", action = "idle" }) {
    this.activeEmotion = emotion;
    const duration = ACTION_DURATION[action] ?? ACTION_DURATION.idle;
    this.currentAction = duration
      ? { name: action, startedAt: performance.now(), duration }
      : null;
  }

  getActionOffsets(nowMs) {
    if (!this.currentAction) return {};

    const elapsed = nowMs - this.currentAction.startedAt;
    if (elapsed > this.currentAction.duration) {
      this.currentAction = null;
      return {};
    }

    const t = elapsed / 1000;
    switch (this.currentAction.name) {
      case "nod":
        return { head: { x: Math.sin(t * 8.5) * 0.24 } };
      case "wave":
        return {
          rightArm: { z: -0.9, x: -0.15 + Math.sin(t * 9) * 0.18 },
          rightElbow: { z: -0.45 + Math.sin(t * 9) * 0.16 }
        };
      case "think":
        return { head: { y: 0.28, x: -0.1 }, leftArm: { z: 0.26 }, rightArm: { z: -0.06 } };
      case "cheer":
        return {
          leftArm: { x: -1.2 + Math.sin(t * 10) * 0.08, z: 0.26 },
          rightArm: { x: -1.2 + Math.sin(t * 10) * 0.08, z: -0.26 }
        };
      case "comfort":
        return { head: { x: 0.22, y: -0.12 }, upperBody: { x: 0.08 } };
      default:
        return {};
    }
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
      rightElbow: { x: 0, y: 0, z: 0 }
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
      if (typeof index !== "number") return;
      influences[index] = smooth(influences[index], value, 12, delta);
    };

    const hints = EMOTION_MORPH_HINTS[this.activeEmotion] || [];
    const shouldSmile = hints.includes("smile") || hints.includes("笑") || hints.includes("にこ");
    const shouldSad = hints.includes("sad") || hints.includes("悲") || hints.includes("困");

    setMorph(this.morphSlots.smile, shouldSmile ? 0.75 : 0.06);
    setMorph(this.morphSlots.sad, shouldSad ? 0.7 : 0.0);

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
