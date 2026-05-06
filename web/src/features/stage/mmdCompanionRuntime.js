import * as THREE from "three";
import {
  EffectComposer,
  MMDAnimationHelper,
  MMDLoader,
  OrbitControls,
  RenderPass,
  ShaderPass,
  UnrealBloomPass,
} from "three-stdlib";

const FIXED_EMOTION_MORPH_HINTS = {
  happy: ["smile", "happy", "\u7b11", "\u5fae\u7b11", "\u7b11\u3044"],
  sad: ["sad", "sorrow", "\u60b2", "\u96be\u8fc7", "\u60b2\u3057\u3044"],
  caring: ["soft", "gentle", "smile", "\u6e29\u67d4", "\u5173\u5fc3"],
  neutral: [],
  thinking: [],
  excited: ["smile", "happy", "excited", "\u5f00\u5fc3", "\u9ad8\u5174"],
};

const FIXED_FACE_MATERIAL_HINTS = [
  "face",
  "eye",
  "brow",
  "eyelash",
  "mouth",
  "lip",
  "cheek",
  "\u8138",
  "\u9762",
  "\u76ee",
  "\u773c",
  "\u7709",
  "\u776b\u6bdb",
  "\u53e3",
  "\u5634",
  "\u9854",
];

const FIXED_SKIN_MATERIAL_HINTS = [
  "skin",
  "body",
  "neck",
  "hand",
  "arm",
  "leg",
  "\u808c",
  "\u4f53",
  "\u8eab\u4f53",
  "\u9888",
  "\u8116",
  "\u624b",
  "\u8155",
  "\u817f",
];

const FIXED_HAIR_MATERIAL_HINTS = [
  "hair",
  "bang",
  "strand",
  "fringe",
  "ponytail",
  "tail",
  "\u9aea",
  "\u524d\u9aea",
  "\u6a2a\u9aea",
  "\u5f8c\u9aea",
  "\u5934\u53d1",
  "\u5218\u6d77",
];

const FIXED_CLOTH_MATERIAL_HINTS = [
  "skirt",
  "dress",
  "cloth",
  "cape",
  "cloak",
  "ribbon",
  "frill",
  "sleeve",
  "scarf",
  "veil",
  "\u670d",
  "\u88d9",
  "\u5e26",
  "\u8896",
  "\u62ab\u98ce",
  "\u56f4\u5dfe",
];

const FIXED_MORPH_HINTS = {
  smile: ["smile", "happy", "\u7b11", "\u5fae\u7b11"],
  sad: ["sad", "\u60b2", "\u60b2\u4f24"],
  blink: ["blink", "\u307e\u3070\u305f\u304d", "\u77ac\u304d", "\u7728\u773c"],
  mouthA: ["a", "mouth_a", "\u3042"],
  mouthI: ["i", "mouth_i", "\u3044"],
  mouthU: ["u", "mouth_u", "\u3046"],
};

const FIXED_EXPRESSION_MORPH_NAMES = {
  smirk: ["\u306b\u3084\u308a"],
  mouthSmile: ["\u53e3\u89d2\u4e0a\u3052"],
  mouthFrown: ["\u53e3\u89d2\u4e0b\u3052"],
  mouthWide: ["\u30ef"],
  joy: ["\u559c\u3073"],
  softSmile: ["\u306b\u3053\u308a"],
  troubled: ["\u56f0\u308b"],
  serious: ["\u771f\u9762\u76ee"],
  glare: ["\u3058\u3068\u76ee", "\u30b8\u30c8\u76ee"],
  surprised: ["\u3073\u3063\u304f\u308a"],
  angry: ["\u6012\u308a"],
};

const FIXED_VMD_ANCHOR_BONE_HINTS = [
  ["allparent", "\u5168\u3066\u306e\u89aa"],
  ["center", "\u30bb\u30f3\u30bf\u30fc"],
  ["groove", "\u30b0\u30eb\u30fc\u30d6"],
];

const LOWER_BODY_BONE_HINTS = [
  "center",
  "groove",
  "waist",
  "hip",
  "pelvis",
  "lowerbody",
  "leg",
  "knee",
  "ankle",
  "toe",
  "foot",
  "ik",
  "ikparent",
  "ik parent",
  "\u30bb\u30f3\u30bf\u30fc",
  "\u30b0\u30eb\u30fc\u30d6",
  "\u8170",
  "\u4e0b\u534a\u8eab",
  "\u5de6\u8db3",
  "\u53f3\u8db3",
  "\u5de6\u3072\u3056",
  "\u53f3\u3072\u3056",
  "\u5de6\u8db3\u9996",
  "\u53f3\u8db3\u9996",
  "\u5de6\u3064\u307e\u5148",
  "\u53f3\u3064\u307e\u5148",
  "\uff29\uff2b\u89aa",
  "\u3064\u307e\u5148\uff29\uff2b",
];

// Legacy mojibake hint tables were replaced with ASCII-safe Unicode escapes above.

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

const VMD_TRANSITION_FADE_SECONDS = 0.5;
const STAGE_CANVAS_ASPECT_RATIO = 3 / 4;
const BREATHING_CYCLE_SECONDS = 4.2;

const MIO_REFERENCE_EULA_RENDER_PROFILE = Object.freeze({
  name: "mio_reference_eula_heroic_soft_blue",
  sourceReference: "companion screenshot target for Eula-like MMD rendering",
  intent: {
    look: "clean anime toon with luminous blue ambient fill",
    priorities: [
      "bright readable face",
      "soft skin shading without oily specular hotspots",
      "cool blue hair and cloth separation",
      "controlled white-cyan highlights instead of gray shading",
      "clear silhouette over the bright sky-ocean background",
    ],
  },
  lighting: {
    ambientIntensity: 0.98,
    hemisphereIntensity: 0.88,
    keyIntensity: 1.34,
    fillIntensity: 0.82,
    rimIntensity: 0.44,
    keyColor: "#ffffff",
    fillColor: "#b6deff",
    rimColor: "#d8f0ff",
  },
  toonRamp: {
    stops: ["#667da6", "#b7cae8", "#f5fbff"],
  },
  materialTuning: {
    alphaTest: 0.5,
    face: { shininess: 9, specular: 0.16, emissiveIntensity: 0.08, envMapIntensity: 0.02 },
    skin: { shininess: 11, specular: 0.2, emissiveIntensity: 0.06, envMapIntensity: 0.02 },
    hair: { shininess: 18, specular: 0.48, emissiveIntensity: 0.03, envMapIntensity: 0.04 },
    cloth: { shininess: 15, specular: 0.34, emissiveIntensity: 0.02, envMapIntensity: 0.03 },
    metal: { shininess: 36, specular: 0.78, emissiveIntensity: 0.02, envMapIntensity: 0.08 },
    default: { shininess: 18, specular: 0.38, emissiveIntensity: 0.02, envMapIntensity: 0.03 },
  },
  suppression: {
    hideProject2Masks: true,
    hideHeadFxGlow: true,
    keepExplicitGlowPurple: true,
  },
});

const smooth = (current, target, lambda, dt) => THREE.MathUtils.damp(current, target, lambda, dt);

function isKnownMmdParserConsoleError(args) {
  const text = args
    .map((value) => {
      if (typeof value === "string") return value;
      if (value instanceof Error) return `${value.message}\n${value.stack || ""}`;
      return "";
    })
    .join("\n");
  return /three-stdlib[\\/].*mmdparser|CharsetEncoder\.s2u|DataViewEx\.getSjisStringsAsUnicode|parseMorph|parseVmd/i.test(text);
}

function loadAnimationSilently(loader, url, target) {
  return new Promise((resolve, reject) => {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      if (isKnownMmdParserConsoleError(args)) return;
      originalConsoleError(...args);
    };

    const restore = () => {
      console.error = originalConsoleError;
    };

    loader.loadAnimation(
      url,
      target,
      (clip) => {
        restore();
        resolve(clip);
      },
      undefined,
      (error) => {
        restore();
        reject(error);
      },
    );
  });
}

function cloneCameraSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    ...snapshot,
    position: Array.isArray(snapshot.position) ? [...snapshot.position] : [0, 0, 0],
    target: Array.isArray(snapshot.target) ? [...snapshot.target] : [0, 0, 0],
  };
}

const STAGE_PRESENTATION_PRESETS = {
  classic: {
    background: null,
    fog: null,
    camera: {
      fov: 33,
      position: [-2.075385, 0.017334, 46.985286],
      target: [-2.075385, -2.771828, 0.642287],
      minDistance: 6,
      maxDistance: 60,
      maxPolarAngle: Math.PI * 0.46,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.78 },
      hemisphere: { sky: "#f4f8ff", ground: "#5a6270", intensity: 0.6 },
      key: { color: 0xffffff, intensity: 1.42, position: [-14, 20, 28] },
      fill: { color: 0xffffff, intensity: 0.5, position: [16, 10, 18] },
      rim: { color: 0xffffff, intensity: 0.36, position: [-10, 14, -18] },
    },
    shadowMapType: THREE.PCFShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.2,
    },
    outline: { enabled: false, color: "#1b2130", opacity: 0.88, scale: 1.025 },
    backdrop: { enabled: false },
    postfx: { enabled: false },
  },
  "hero-shot": {
    background: "#061630",
    fog: null,
    camera: {
      fov: 33,
      position: [-2.075385, 0.017334, 46.985286],
      target: [-2.075385, -2.771828, 0.642287],
      minDistance: 6,
      maxDistance: 60,
      maxPolarAngle: Math.PI * 0.41,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.66 },
      hemisphere: { sky: "#d8e8ff", ground: "#26364d", intensity: 0.54 },
      key: { color: "#fff1dc", intensity: 1.42, position: [-11, 18, 21] },
      fill: { color: "#c3dcff", intensity: 0.42, position: [13, 9, 17] },
      rim: { color: "#d6f3ff", intensity: 0.54, position: [-8, 13, -16] },
    },
    shadowMapType: THREE.PCFShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 36,
      y: -12,
      opacity: 0.02,
      glow: {
        enabled: true,
        size: [24, 24],
        color: "#63c8ff",
        opacity: 0.14,
        position: [0, -11.96, -1.1],
      },
      rings: {
        enabled: true,
        size: [27, 27],
        color: "#d7f2ff",
        opacity: 0.32,
        position: [0, -11.94, -1],
      },
      contactShadow: {
        enabled: true,
        size: [11.2, 7.1],
        opacity: 0.16,
        position: [0, -11.98, 0.2],
      },
    },
    outline: { enabled: true, color: "#20304a", opacity: 0.94, scale: 1.04 },
    backdrop: {
      enabled: true,
      panelSize: [48, 44],
      panelColorTop: "#2c7ca8",
      panelColorBottom: "#123a62",
      panelOpacity: 0.68,
      panelPosition: [0, 6.8, -20],
      haloSize: [18, 18],
      haloColor: "#8ff0ff",
      haloOpacity: 0.36,
      haloPosition: [0, 8.6, -18.3],
      ringSize: [23, 23],
      ringColor: "#e2fbff",
      ringOpacity: 0.58,
      ringPosition: [0, 7.3, -19],
    },
    postfx: {
      enabled: true,
      bloomStrength: 0.12,
      bloomRadius: 0.2,
      bloomThreshold: 0.66,
      grade: {
        exposure: 1,
        contrast: 1.1,
        saturation: 1.12,
        warmth: 0.03,
        shadowLift: 0.01,
      },
    },
  },
  genshin: {
    background: null,
    fog: null,
    camera: {
      fov: 33,
      position: [-2.075385, 0.017334, 46.985286],
      target: [-2.075385, -2.771828, 0.642287],
      minDistance: 6,
      maxDistance: 60,
      maxPolarAngle: Math.PI * 0.5,
      locked: false,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.8 },
      hemisphere: { sky: "#ffffff", ground: "#333333", intensity: 0.6 },
      key: { color: "#ffffff", intensity: 1.2, position: [-15, 20, 30] },
      fill: { color: "#ffffff", intensity: 0.5, position: [15, 10, -20] },
      rim: { color: "#ffffff", intensity: 0, position: [0, 0, 0] },
    },
    shadowMapType: THREE.PCFSoftShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.2,
    },
    outline: { enabled: false, color: "#2a3142", opacity: 0.92, scale: 1.03 },
    backdrop: { enabled: false },
    postfx: { enabled: false },
  },
  "mio-reference": {
    background: null,
    fog: null,
    camera: {
      fov: 32,
      position: [0, 9.2, 21.6],
      target: [0, 7.9, 0],
      minDistance: 8,
      maxDistance: 40,
      maxPolarAngle: Math.PI * 0.48,
      locked: false,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: "#f7fbff", intensity: MIO_REFERENCE_EULA_RENDER_PROFILE.lighting.ambientIntensity },
      hemisphere: {
        sky: "#dff3ff",
        ground: "#13284b",
        intensity: MIO_REFERENCE_EULA_RENDER_PROFILE.lighting.hemisphereIntensity,
      },
      key: {
        color: MIO_REFERENCE_EULA_RENDER_PROFILE.lighting.keyColor,
        intensity: MIO_REFERENCE_EULA_RENDER_PROFILE.lighting.keyIntensity,
        position: [-11, 18, 24],
      },
      fill: {
        color: MIO_REFERENCE_EULA_RENDER_PROFILE.lighting.fillColor,
        intensity: MIO_REFERENCE_EULA_RENDER_PROFILE.lighting.fillIntensity,
        position: [12, 11, 18],
      },
      rim: {
        color: MIO_REFERENCE_EULA_RENDER_PROFILE.lighting.rimColor,
        intensity: MIO_REFERENCE_EULA_RENDER_PROFILE.lighting.rimIntensity,
        position: [0, 14, -18],
      },
    },
    shadowMapType: THREE.PCFSoftShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 44,
      y: -9.75,
      opacity: 0.04,
      contactShadow: {
        enabled: true,
        size: [10.4, 6.8],
        opacity: 0.12,
        position: [0, -9.73, 0.2],
      },
    },
    outline: { enabled: false, color: "#27496d", opacity: 0.9, scale: 1.03 },
    backdrop: { enabled: false },
    postfx: { enabled: false },
  },
};

function cloneStagePresentationConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function readFiniteNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function readVectorTuple(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  const next = value.map((item) => Number(item));
  if (next.some((item) => !Number.isFinite(item))) return [...fallback];
  return next;
}

function roundCameraNumber(value) {
  return Number(Number(value).toFixed(6));
}

export function normalizeMmdCameraSnapshot(snapshot, fallbackCamera = STAGE_PRESENTATION_PRESETS.genshin.camera) {
  return {
    fov: readFiniteNumber(snapshot?.fov, fallbackCamera.fov),
    position: readVectorTuple(snapshot?.position, fallbackCamera.position),
    target: readVectorTuple(snapshot?.target, fallbackCamera.target),
    locked: typeof snapshot?.locked === "boolean" ? snapshot.locked : Boolean(fallbackCamera.locked),
  };
}

function applyCameraSnapshotToPresentation(presentation, snapshot) {
  if (!snapshot) return presentation;
  const camera = normalizeMmdCameraSnapshot(snapshot, presentation.camera);
  presentation.camera = {
    ...presentation.camera,
    ...camera,
  };
  return presentation;
}

export function getStagePresentationConfig(pipeline = "classic") {
  return cloneStagePresentationConfig(STAGE_PRESENTATION_PRESETS[pipeline] || STAGE_PRESENTATION_PRESETS.classic);
}

export function fitModelToPresentation(mesh, presentation = getStagePresentationConfig("classic")) {
  if (!(mesh instanceof THREE.Object3D)) return null;

  mesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(mesh);
  if (bounds.isEmpty()) return null;

  const size = bounds.getSize(new THREE.Vector3());
  const targetHeight = Math.max(0.001, Number(presentation?.character?.targetHeight) || size.y || 1);
  const height = Math.max(0.001, size.y || 1);
  const scale = targetHeight / height;

  mesh.scale.multiplyScalar(scale);
  mesh.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(mesh);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  const floorY = Number(presentation?.floor?.y);
  const targetFloorY = Number.isFinite(floorY) ? floorY : 0;

  mesh.position.x -= center.x;
  mesh.position.z -= center.z;
  mesh.position.y += targetFloorY - scaledBounds.min.y;
  mesh.updateMatrixWorld(true);

  return {
    scale,
    floorY: targetFloorY,
  };
}

export function pickNextLoopMotionUrl(urls, currentUrl, randomValue = Math.random()) {
  const uniqueUrls = Array.from(new Set((Array.isArray(urls) ? urls : []).filter(Boolean)));
  if (!uniqueUrls.length) return "";
  if (uniqueUrls.length === 1) return uniqueUrls[0];

  const candidates = currentUrl ? uniqueUrls.filter((url) => url !== currentUrl) : uniqueUrls;
  const pool = candidates.length ? candidates : uniqueUrls;
  const clamped = Math.min(0.999999, Math.max(0, Number(randomValue) || 0));
  const index = Math.floor(clamped * pool.length);
  return pool[index] || pool[0] || "";
}

export function pickSequentialLoopMotionUrl(urls, currentUrl) {
  const uniqueUrls = Array.from(new Set((Array.isArray(urls) ? urls : []).filter(Boolean)));
  if (!uniqueUrls.length) return "";
  if (!currentUrl) return uniqueUrls[0];
  const currentIndex = uniqueUrls.indexOf(currentUrl);
  if (currentIndex === -1) return uniqueUrls[0];
  return uniqueUrls[(currentIndex + 1) % uniqueUrls.length] || uniqueUrls[0] || "";
}

function resolveVmdLoopPhase({ url, loopUrls, standbyUrl, resumePhase }) {
  if (resumePhase === "standby" || resumePhase === "standby-only" || resumePhase === "loop") {
    return resumePhase;
  }
  if (standbyUrl && url === standbyUrl) {
    return loopUrls.length ? "standby" : "standby-only";
  }
  return "loop";
}

function pickLoopMotionUrl(urls, currentUrl, loopMode) {
  if (loopMode === "sequential") return pickSequentialLoopMotionUrl(urls, currentUrl);
  return pickNextLoopMotionUrl(urls, currentUrl);
}

/**
 * @param {any} runtime
 * @param {{
 *   speaking?: boolean,
 *   interaction?: {
 *     mode?: string,
 *     vmdUrl?: string,
 *     vmdLoopUrls?: string[],
 *     standbyVmdUrl?: string,
 *     loopGapMs?: number,
 *     loopMode?: string,
 *     vmdLoopEmotionByUrl?: Record<string, string>,
 *     lockLowerBody?: boolean,
 *     disableCrossfade?: boolean,
 *     playbackRate?: number
 *   },
 *   resolveUrl?: (url: string) => string
 * }} [options]
 */
export function applyStageRuntimeState(runtime, { speaking = false, interaction, resolveUrl = (url) => url } = {}) {
  if (!runtime) return;
  runtime.setSpeaking?.(speaking);
  if (!interaction) return;
  if (interaction.mode === "vmd" && interaction.vmdUrl) {
    const loopUrls = Array.isArray(interaction.vmdLoopUrls)
      ? interaction.vmdLoopUrls.map((url) => resolveUrl(url))
      : undefined;
    const standbyUrl = interaction.standbyVmdUrl ? resolveUrl(interaction.standbyVmdUrl) : "";
    const loopOptions = {
      standbyUrl,
      loopGapMs: interaction.loopGapMs,
      loopMode: interaction.loopMode,
    };
    if (interaction.lockLowerBody) loopOptions.lockLowerBody = true;
    if (interaction.disableCrossfade) loopOptions.disableCrossfade = true;
    if (interaction.vmdLoopEmotionByUrl) {
      loopOptions.emotionByUrl = Object.fromEntries(
        Object.entries(interaction.vmdLoopEmotionByUrl).map(([url, emotion]) => [resolveUrl(url), emotion]),
      );
    }
    runtime.applyInteraction?.(interaction);
    runtime.playVmd?.(resolveUrl(interaction.vmdUrl), interaction.playbackRate, loopUrls, loopOptions);
    return;
  }
  runtime.applyInteraction?.(interaction);
}

export function clipAnimatesBone(clip, bone) {
  if (!clip?.tracks?.length || !bone?.name) return false;
  const boneName = `${bone.name}`;
  return clip.tracks.some((track) => `${track?.name || ""}`.includes(`bones[${boneName}]`));
}

export function resetBonesNotAnimatedByClip(baseBoneTransforms = [], clip) {
  for (const entry of baseBoneTransforms || []) {
    const bone = entry?.bone;
    if (!bone || clipAnimatesBone(clip, bone)) continue;
    if (entry.position) bone.position?.copy?.(entry.position);
    if (entry.quaternion) bone.quaternion?.copy?.(entry.quaternion);
    if (entry.scale) bone.scale?.copy?.(entry.scale);
  }
}

export function isLowerBodyBoneName(name) {
  const lowerName = `${name || ""}`.toLowerCase();
  return LOWER_BODY_BONE_HINTS.some((hint) => lowerName.includes(hint.toLowerCase()));
}

export function resetLowerBodyBonesToBase(baseBoneTransforms = []) {
  for (const entry of baseBoneTransforms || []) {
    const bone = entry?.bone;
    if (!bone || !isLowerBodyBoneName(bone.name)) continue;
    if (entry.position) bone.position?.copy?.(entry.position);
    if (entry.quaternion) bone.quaternion?.copy?.(entry.quaternion);
    if (entry.scale) bone.scale?.copy?.(entry.scale);
  }
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

  if (metalHints.some((hint) => text.includes(hint))) return "metal";
  if (FIXED_FACE_MATERIAL_HINTS.some((hint) => text.includes(hint))) return "face";
  if (FIXED_SKIN_MATERIAL_HINTS.some((hint) => text.includes(hint))) return "skin";
  if (FIXED_HAIR_MATERIAL_HINTS.some((hint) => text.includes(hint))) return "hair";
  if (FIXED_CLOTH_MATERIAL_HINTS.some((hint) => text.includes(hint))) return "cloth";
  return "default";
}

function createToonRampTexture(pipeline = "classic") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  if (pipeline === "hero-shot") {
    gradient.addColorStop(0, "#4d5365");
    gradient.addColorStop(0.45, "#4d5365");
    gradient.addColorStop(0.46, "#92a0b8");
    gradient.addColorStop(0.76, "#92a0b8");
    gradient.addColorStop(0.77, "#eef7ff");
  } else if (pipeline === "mio-reference") {
    gradient.addColorStop(0, MIO_REFERENCE_EULA_RENDER_PROFILE.toonRamp.stops[0]);
    gradient.addColorStop(0.32, MIO_REFERENCE_EULA_RENDER_PROFILE.toonRamp.stops[1]);
    gradient.addColorStop(0.74, MIO_REFERENCE_EULA_RENDER_PROFILE.toonRamp.stops[2]);
  } else if (pipeline === "genshin") {
    gradient.addColorStop(0, "#505050");
    gradient.addColorStop(0.3, "#b4b4b4");
    gradient.addColorStop(0.7, "#ffffff");
  } else {
    gradient.addColorStop(0, "#505050");
    gradient.addColorStop(0.3, "#b4b4b4");
    gradient.addColorStop(0.7, "#ffffff");
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function primeMMDMaterial(material) {
  if (!material) return;
  const profile = inferMaterialProfile(material);

  if ("fog" in material) material.fog = false;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
  if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  const needsCutout =
    Boolean(material.transparent) ||
    (typeof material.opacity === "number" && material.opacity < 1) ||
    Boolean(material.alphaMap);

  return { needsCutout, profile };
}

function cleanLegacyMMDMaterialFlags(material) {
  if (!material) return;
  if ("skinning" in material) delete material.skinning;
  if ("morphTargets" in material) delete material.morphTargets;
}

function finalizeMMDMaterial(material, rampTexture) {
  if ("gradientMap" in material && rampTexture && !material.gradientMap) {
    material.gradientMap = rampTexture;
  }

  material.needsUpdate = true;
}

const GENSHIN_GLOW_HINTS = ["glow", "emissive", "purple", "fx"];
const GENSHIN_MASK_HINTS = ["mask", "face mask", "mouth mask"];

function normalizeGenshinMaterialName(materialName = "") {
  return `${materialName}`.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isGenshinGlowMaterial(materialName = "") {
  const name = normalizeGenshinMaterialName(materialName);
  const tokens = name.split(" ").filter(Boolean);
  const hasExplicitGlow = GENSHIN_GLOW_HINTS.slice(0, 2).some((hint) => tokens.includes(hint));
  const hasPurpleFx = tokens.includes("purple") && tokens.includes("fx");
  return hasExplicitGlow || hasPurpleFx;
}

export function isGenshinSuppressedMaskMaterial(materialName = "") {
  const name = normalizeGenshinMaterialName(materialName);
  return GENSHIN_MASK_HINTS.some((hint) => name.includes(hint));
}

function getMaterialArray(material) {
  return (Array.isArray(material) ? material : [material]).filter(Boolean);
}

function pickOutlineProfile(materials) {
  const profiles = materials.map((material) => inferMaterialProfile(material));
  if (profiles.includes("face")) return "face";
  if (profiles.includes("skin")) return "skin";
  if (profiles.includes("hair")) return "hair";
  if (profiles.includes("cloth")) return "cloth";
  if (profiles.includes("metal")) return "metal";
  return "default";
}

function needsOutlineCutout(materials) {
  return materials.some((material) => {
    return (
      Boolean(material?.transparent) ||
      Boolean(material?.alphaMap) ||
      Boolean(material?.map) ||
      (typeof material?.opacity === "number" && material.opacity < 1)
    );
  });
}

function buildOutlineStyle(materials, presentation) {
  const profile = pickOutlineProfile(materials);
  const usesCutout = needsOutlineCutout(materials);
  const sourceMaterial = materials.find((material) => material?.map || material?.alphaMap || material?.alphaTest) || materials[0];
  const baseScale = presentation?.outline?.scale ?? 1.03;
  const baseOpacity = presentation?.outline?.opacity ?? 0.92;

  const profileStyle = {
    face: { scale: baseScale - 0.017, opacity: baseOpacity * 0.42 },
    skin: { scale: baseScale - 0.015, opacity: baseOpacity * 0.48 },
    hair: { scale: baseScale - 0.004, opacity: baseOpacity * 0.92 },
    cloth: { scale: baseScale - 0.008, opacity: baseOpacity * 0.82 },
    metal: { scale: baseScale - 0.01, opacity: baseOpacity * 0.76 },
    default: { scale: baseScale - 0.01, opacity: baseOpacity * 0.78 },
  }[profile];

  return {
    profile,
    usesCutout,
    sourceMaterial,
    scale: Math.max(1.004, profileStyle.scale),
    opacity: Math.min(1, Math.max(0.12, profileStyle.opacity)),
  };
}

function createVerticalGradientTexture(topColor, bottomColor) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, topColor);
  gradient.addColorStop(1, bottomColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createHaloTexture(color) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(256, 256, 20, 256, 256, 220);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.45, `${color}66`);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createConcentricRingTexture(color) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.globalAlpha = 0.88;

  const rings = [
    { radius: 405, width: 6 },
    { radius: 310, width: 3.5 },
    { radius: 220, width: 2.5 },
  ];

  for (const ring of rings) {
    ctx.beginPath();
    ctx.lineWidth = ring.width;
    ctx.arc(512, 512, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createContactShadowTexture() {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createRadialGradient(256, 256, 36, 256, 256, 236);
  gradient.addColorStop(0, "rgba(8, 15, 32, 0.78)");
  gradient.addColorStop(0.4, "rgba(8, 15, 32, 0.42)");
  gradient.addColorStop(1, "rgba(8, 15, 32, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createStarfieldTexture(color = "#d8f5ff") {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 140; index += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height * 0.92;
    const size = 1 + Math.random() * 2.4;
    const alpha = 0.25 + Math.random() * 0.7;
    ctx.beginPath();
    ctx.fillStyle = `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createWaterlineTexture(topColor, bottomColor) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, topColor);
  gradient.addColorStop(0.55, topColor);
  gradient.addColorStop(1, bottomColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(222, 247, 255, 0.26)";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.72;
  for (let row = 0; row < 9; row += 1) {
    const y = 48 + row * 42;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y + ((row % 2) ? 6 : -6));
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createColorGradeShader(grade = {}) {
  return {
    uniforms: {
      tDiffuse: { value: null },
      exposure: { value: grade.exposure ?? 1 },
      contrast: { value: grade.contrast ?? 1 },
      saturation: { value: grade.saturation ?? 1 },
      warmth: { value: grade.warmth ?? 0 },
      shadowLift: { value: grade.shadowLift ?? 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float exposure;
      uniform float contrast;
      uniform float saturation;
      uniform float warmth;
      uniform float shadowLift;
      varying vec2 vUv;

      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        vec3 color = texel.rgb * exposure;
        color = (color - 0.5) * contrast + 0.5;
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luminance), color, saturation);
        color.r += warmth;
        color.b -= warmth * 0.7;
        color = max(color, vec3(shadowLift));
        gl_FragColor = vec4(color, texel.a);
      }
    `,
  };
}

export function tuneClassicMMDMaterial(material, rampTexture) {
  if (!material) return;
  const { needsCutout, profile } = primeMMDMaterial(material);

  if (needsCutout) material.alphaTest = Math.max(material.alphaTest || 0, 0.5);
  if (needsCutout || profile === "hair" || profile === "cloth") material.side = THREE.DoubleSide;

  if (profile === "face" || profile === "skin") {
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

  finalizeMMDMaterial(material, rampTexture);
}

export function tuneHeroShotMMDMaterial(material, rampTexture) {
  if (!material) return;
  const { needsCutout, profile } = primeMMDMaterial(material);

  if (needsCutout) material.alphaTest = Math.max(material.alphaTest || 0, 0.52);
  if (needsCutout || profile === "hair" || profile === "cloth") material.side = THREE.DoubleSide;

  const profileTuning = {
    face: { shininess: 8, specular: 0.14, emissiveIntensity: 0.26, envMapIntensity: 0.14 },
    skin: { shininess: 10, specular: 0.18, emissiveIntensity: 0.22, envMapIntensity: 0.16 },
    hair: { shininess: 16, specular: 0.46, emissiveIntensity: 0.14, envMapIntensity: 0.28 },
    cloth: { shininess: 13, specular: 0.28, emissiveIntensity: 0.06, envMapIntensity: 0.2 },
    metal: { shininess: 34, specular: 0.72, emissiveIntensity: 0.06, envMapIntensity: 0.44 },
    default: { shininess: 18, specular: 0.42, emissiveIntensity: 0.1, envMapIntensity: 0.22 },
  };
  const tuning = profileTuning[profile] || profileTuning.default;

  if ("shininess" in material && typeof material.shininess === "number") {
    material.shininess = Math.min(material.shininess, tuning.shininess);
  }
  if ("specular" in material && material.specular?.isColor) {
    material.specular.multiplyScalar(tuning.specular);
  }
  if ("emissiveIntensity" in material) material.emissiveIntensity = tuning.emissiveIntensity;
  if ("envMapIntensity" in material) material.envMapIntensity = tuning.envMapIntensity;

  finalizeMMDMaterial(material, rampTexture);
}

export function tuneGenshinMMDMaterial(material, rampTexture) {
  if (!material) return;
  const { profile } = primeMMDMaterial(material);
  const materialName = `${material.name || ""}`;
  const normalizedName = normalizeGenshinMaterialName(materialName);
  const isGlowMaterial = isGenshinGlowMaterial(materialName);
  const isHeadFxMaterial = isGlowMaterial && normalizedName.includes("head");

  cleanLegacyMMDMaterialFlags(material);

  material.alphaTest = Math.max(material.alphaTest || 0, 0.5);
  material.side = THREE.DoubleSide;

  if ("shininess" in material && typeof material.shininess === "number" && profile !== "metal") {
    material.shininess = Math.min(material.shininess, profile === "face" || profile === "skin" ? 18 : 26);
  }
  if ("specular" in material && material.specular?.isColor && profile !== "metal") {
    material.specular.multiplyScalar(profile === "face" || profile === "skin" ? 0.45 : 0.72);
  }
  if ("envMapIntensity" in material) material.envMapIntensity = 0;

  if (isGlowMaterial) {
    material.emissive?.setHex?.(0x9d00ff);
    if ("emissiveIntensity" in material) material.emissiveIntensity = 1;
  } else {
    material.emissive?.setHex?.(0x000000);
    if ("emissiveIntensity" in material) material.emissiveIntensity = 0;
  }

  if (isGenshinSuppressedMaskMaterial(materialName) || isHeadFxMaterial) {
    material.visible = false;
    material.transparent = true;
    material.opacity = 0;
  }

  finalizeMMDMaterial(material, rampTexture);
}

export function tuneMioReferenceMMDMaterial(material, rampTexture) {
  if (!material) return;
  const { profile } = primeMMDMaterial(material);
  const materialName = `${material.name || ""}`;
  const normalizedName = normalizeGenshinMaterialName(materialName);
  const isGlowMaterial = isGenshinGlowMaterial(materialName);
  const isHeadFxMaterial = isGlowMaterial && normalizedName.includes("head");
  const tuning = MIO_REFERENCE_EULA_RENDER_PROFILE.materialTuning[profile] || MIO_REFERENCE_EULA_RENDER_PROFILE.materialTuning.default;

  cleanLegacyMMDMaterialFlags(material);

  material.alphaTest = Math.max(material.alphaTest || 0, MIO_REFERENCE_EULA_RENDER_PROFILE.materialTuning.alphaTest);
  material.side = THREE.DoubleSide;

  if ("shininess" in material && typeof material.shininess === "number") {
    material.shininess = Math.min(material.shininess, tuning.shininess);
  }
  if ("specular" in material && material.specular?.isColor) {
    material.specular.multiplyScalar(tuning.specular);
  }
  if ("emissiveIntensity" in material) material.emissiveIntensity = tuning.emissiveIntensity;
  if ("envMapIntensity" in material) material.envMapIntensity = tuning.envMapIntensity;

  if (isGlowMaterial && MIO_REFERENCE_EULA_RENDER_PROFILE.suppression.keepExplicitGlowPurple) {
    material.emissive?.setHex?.(0xa7d8ff);
    if ("emissiveIntensity" in material) material.emissiveIntensity = Math.max(material.emissiveIntensity || 0, 0.2);
  } else {
    material.emissive?.setHex?.(0x000000);
  }

  if (
    (MIO_REFERENCE_EULA_RENDER_PROFILE.suppression.hideProject2Masks && isGenshinSuppressedMaskMaterial(materialName)) ||
    (MIO_REFERENCE_EULA_RENDER_PROFILE.suppression.hideHeadFxGlow && isHeadFxMaterial)
  ) {
    material.visible = false;
    material.transparent = true;
    material.opacity = 0;
  }

  finalizeMMDMaterial(material, rampTexture);
}

function tuneMaterialByPipeline(material, toonRampTexture, pipeline) {
  if (pipeline === "hero-shot") return tuneHeroShotMMDMaterial(material, toonRampTexture);
  if (pipeline === "mio-reference") return tuneMioReferenceMMDMaterial(material, toonRampTexture);
  if (pipeline === "genshin") return tuneGenshinMMDMaterial(material, toonRampTexture);
  return tuneClassicMMDMaterial(material, toonRampTexture);
}

function createOutlineMaterial(materials, presentation) {
  const outlineStyle = buildOutlineStyle(materials, presentation);
  const sourceMaterial = outlineStyle.sourceMaterial;
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: presentation.outline.color,
    side: THREE.BackSide,
    transparent: true,
    opacity: outlineStyle.opacity,
    depthWrite: false,
    toneMapped: false,
  });

  if (outlineStyle.usesCutout) {
    if (sourceMaterial?.map) outlineMaterial.map = sourceMaterial.map;
    if (sourceMaterial?.alphaMap) outlineMaterial.alphaMap = sourceMaterial.alphaMap;
    outlineMaterial.alphaTest = Math.max(sourceMaterial?.alphaTest || 0, 0.48);
  }

  return { outlineMaterial, outlineStyle };
}

function createInvisibleOutlineMaterial(presentation) {
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: presentation?.outline?.color ?? 0x000000,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  outlineMaterial.visible = false;
  return outlineMaterial;
}

function createSlotPreservingOutlineMaterials(sourceMaterials, presentation) {
  const visibleMaterials = sourceMaterials.filter((material) => material && material.visible !== false);
  const outlineStyle = buildOutlineStyle(visibleMaterials, presentation);
  const outlineMaterials = sourceMaterials.map((material) => {
    if (!material || material.visible === false) return createInvisibleOutlineMaterial(presentation);
    return createOutlineMaterial([material], presentation).outlineMaterial;
  });

  return { outlineMaterial: outlineMaterials, outlineStyle, outlineMaterials };
}

export class MMDCompanionRuntime {
  constructor({ container, statusElement, renderPipeline = "classic", cameraSnapshot = null }) {
    this.container = container;
    this.statusElement = statusElement;
    this.renderPipeline = renderPipeline;
    this.cameraSnapshot = cameraSnapshot;
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
    this.currentVmdPlaybackRate = 1;
    this.currentVmdLoopUrls = [];
    this.currentVmdStandbyUrl = "";
    this.currentVmdLoopGapMs = 0;
    this.currentVmdLoopMode = "random";
    this.currentVmdLoopPhase = "loop";
    this.currentVmdLockLowerBody = false;
    this.currentVmdDisableCrossfade = false;
    this.currentVmdEmotionByUrl = {};
    this.pendingVmdLoopUrl = "";
    this.lastPlayedLoopMotionUrl = "";
    this.currentVmdUrl = "";
    this.currentVmdStartedAt = 0;
    this.currentVmdDurationMs = 0;
    this.currentVmdAction = null;
    this.pendingVmdActionCleanups = [];
    this.isLoadingVmd = false;
    this.vmdLoadToken = 0;
    this.currentAction = null;
    this.currentSequence = null;
    this.activeEmotion = "neutral";
    this.activeAction = "idle";
    this.isSpeaking = false;
    this.destroyed = false;
    this.presentation = null;

    this.bones = {};
    this.baseBoneRotation = {};
    this.baseBoneTransforms = [];
    this.baseBoneTransformMap = new Map();
    this.vmdAnchorBones = [];
    this.animationBuildTarget = null;
    this.morphSlots = {};
    this.expressionMorphSlots = {};

    this.toonRampTexture = null;
    this.outlineObjects = [];
    this.outlineMaterials = [];
    this.backdropGroup = null;
    this.backdropTextures = [];
    this.floorGroup = null;
    this.floorTextures = [];
    this.composer = null;
    this.renderPass = null;
    this.colorGradePass = null;
    this.bloomPass = null;
    this.cameraLocked = false;
    this.resizeObserver = null;
  }

  setStatus(text) {
    if (this.statusElement) this.statusElement.textContent = text;
  }

  syncStageCanvasBox() {
    if (!this.container) return null;
    const stageElement = this.container.parentElement;
    const stageHeight = stageElement?.clientHeight || this.container.clientHeight || 0;
    if (stageHeight <= 0) return null;

    const stageWidth = stageElement?.clientWidth || this.container.clientWidth || 0;
    const coverWidth = Math.max(
      stageWidth,
      stageHeight * STAGE_CANVAS_ASPECT_RATIO,
    );
    const canvasWidth = Math.max(1, Math.round(coverWidth));
    const canvasHeight = Math.max(1, Math.round(canvasWidth / STAGE_CANVAS_ASPECT_RATIO));

    this.container.style.height = `${canvasHeight}px`;
    this.container.style.minHeight = `${canvasHeight}px`;
    this.container.style.maxHeight = "none";
    this.container.style.width = `${canvasWidth}px`;
    this.container.style.minWidth = `${canvasWidth}px`;
    this.container.style.maxWidth = "none";

    return {
      width: canvasWidth,
      height: canvasHeight,
    };
  }

  async init(modelUrl) {
    this.setupScene();
    this.bindResize();
    this.startRenderLoop();
    await this.loadModel(modelUrl);
  }

  setupScene() {
    const presentation = getStagePresentationConfig(this.renderPipeline);
    applyCameraSnapshotToPresentation(presentation, this.cameraSnapshot);
    this.presentation = presentation;
    this.scene = new THREE.Scene();
    this.scene.background = presentation.background ? new THREE.Color(presentation.background) : null;
    this.scene.fog = presentation.fog;

    this.setupRenderer(presentation);
    this.setupCamera(presentation);
    this.setupLights(presentation);
    this.setupFloor(presentation);
    this.setupBackdrop(presentation);
    this.setupVisualPipeline(presentation);
    this.setupPostprocessing(presentation);
  }

  setupRenderer(presentation) {
    const size = this.syncStageCanvasBox();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(size?.width || this.container.clientWidth, size?.height || this.container.clientHeight);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = presentation.shadowMapType;
    this.container.replaceChildren(this.renderer.domElement);

    this.toonRampTexture = createToonRampTexture(this.renderPipeline);
  }

  setupCamera(presentation) {
    this.camera = new THREE.PerspectiveCamera(presentation.camera.fov, 1, 0.1, 120);
    this.camera.position.fromArray(presentation.camera.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.fromArray(presentation.camera.target);
    const isCameraLocked = Boolean(presentation.camera.locked);
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = presentation.camera.minDistance;
    this.controls.maxDistance = presentation.camera.maxDistance;
    this.controls.maxPolarAngle = presentation.camera.maxPolarAngle;
    this.setCameraLocked(isCameraLocked);
  }

  setCameraLocked(locked) {
    if (!this.camera || !this.controls) return null;
    this.cameraLocked = Boolean(locked);
    this.controls.enabled = !this.cameraLocked;
    this.controls.enableRotate = !this.cameraLocked;
    this.controls.enablePan = !this.cameraLocked;
    this.controls.enableZoom = !this.cameraLocked;
    this.controls.enableDamping = !this.cameraLocked;
    if (this.cameraLocked) {
      this.camera.lookAt(this.controls.target);
    } else {
      this.controls.update();
    }
    return this.getCameraSnapshot();
  }

  getCameraSnapshot() {
    if (!this.camera || !this.controls) return null;
    return {
      fov: roundCameraNumber(this.camera.fov),
      position: this.camera.position.toArray().map(roundCameraNumber),
      target: this.controls.target.toArray().map(roundCameraNumber),
      locked: Boolean(this.cameraLocked),
    };
  }

  applyCameraSnapshot(snapshot, { locked } = {}) {
    if (!this.camera || !this.controls) return null;
    const camera = normalizeMmdCameraSnapshot(snapshot, this.presentation?.camera || STAGE_PRESENTATION_PRESETS.genshin.camera);
    this.cameraSnapshot = camera;
    if (this.presentation?.camera) {
      this.presentation.camera = {
        ...this.presentation.camera,
        ...camera,
      };
    }
    this.camera.fov = camera.fov;
    this.camera.position.fromArray(camera.position);
    this.controls.target.fromArray(camera.target);
    this.camera.updateProjectionMatrix();
    return this.setCameraLocked(locked ?? camera.locked);
  }

  resetCameraToDefault() {
    const presentation = getStagePresentationConfig(this.renderPipeline);
    this.cameraSnapshot = null;
    return this.applyCameraSnapshot(presentation.camera, { locked: presentation.camera.locked });
  }

  setupLights(presentation) {
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
  }

  setupFloor(presentation) {
    if (!Array.isArray(this.floorTextures)) this.floorTextures = [];
    this.disposeFloor();

    const floorGroup = new THREE.Group();
    floorGroup.name = `${this.renderPipeline}-stage-floor`;

    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(presentation.floor.size, presentation.floor.size),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: presentation.floor.opacity }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = presentation.floor.y;
    shadowCatcher.receiveShadow = true;
    floorGroup.add(shadowCatcher);

    if (presentation.floor.glow?.enabled) {
      const glowTexture = createHaloTexture(presentation.floor.glow.color);
      if (glowTexture) this.floorTextures.push(glowTexture);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.glow.size),
        new THREE.MeshBasicMaterial({
          map: glowTexture,
          transparent: true,
          opacity: presentation.floor.glow.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.fromArray(presentation.floor.glow.position);
      floorGroup.add(glow);
    }

    if (presentation.floor.rings?.enabled) {
      const ringTexture = createConcentricRingTexture(presentation.floor.rings.color);
      if (ringTexture) this.floorTextures.push(ringTexture);
      const rings = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.rings.size),
        new THREE.MeshBasicMaterial({
          map: ringTexture,
          transparent: true,
          opacity: presentation.floor.rings.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      rings.rotation.x = -Math.PI / 2;
      rings.position.fromArray(presentation.floor.rings.position);
      floorGroup.add(rings);
    }

    if (presentation.floor.contactShadow?.enabled) {
      const contactShadowTexture = createContactShadowTexture();
      if (contactShadowTexture) this.floorTextures.push(contactShadowTexture);
      const contactShadow = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.contactShadow.size),
        new THREE.MeshBasicMaterial({
          map: contactShadowTexture,
          transparent: true,
          opacity: presentation.floor.contactShadow.opacity,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      contactShadow.rotation.x = -Math.PI / 2;
      contactShadow.position.fromArray(presentation.floor.contactShadow.position);
      floorGroup.add(contactShadow);
    }

    if (presentation.floor.water?.enabled) {
      const waterTexture = createWaterlineTexture(
        presentation.floor.water.topColor,
        presentation.floor.water.bottomColor,
      );
      if (waterTexture) this.floorTextures.push(waterTexture);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.water.size),
        new THREE.MeshBasicMaterial({
          map: waterTexture,
          transparent: true,
          opacity: presentation.floor.water.opacity,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.fromArray(presentation.floor.water.position);
      floorGroup.add(water);
    }

    if (presentation.floor.horizonGlow?.enabled) {
      const horizonGlowTexture = createHaloTexture(presentation.floor.horizonGlow.color);
      if (horizonGlowTexture) this.floorTextures.push(horizonGlowTexture);
      const horizonGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.floor.horizonGlow.size),
        new THREE.MeshBasicMaterial({
          map: horizonGlowTexture,
          transparent: true,
          opacity: presentation.floor.horizonGlow.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      horizonGlow.rotation.x = -Math.PI / 2;
      horizonGlow.position.fromArray(presentation.floor.horizonGlow.position);
      floorGroup.add(horizonGlow);
    }

    this.floorGroup = floorGroup;
    this.scene.add(floorGroup);
  }

  setupBackdrop(presentation) {
    if (!Array.isArray(this.backdropTextures)) this.backdropTextures = [];
    this.disposeBackdrop();
    if (!presentation.backdrop?.enabled) return;

    const backdrop = new THREE.Group();
    backdrop.name = `${this.renderPipeline}-backdrop`;

    if (presentation.backdrop.panelSize) {
      const panelTexture = createVerticalGradientTexture(
        presentation.backdrop.panelColorTop,
        presentation.backdrop.panelColorBottom,
      );
      if (panelTexture) this.backdropTextures.push(panelTexture);
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.panelSize),
        new THREE.MeshBasicMaterial({
          map: panelTexture,
          transparent: true,
          opacity: presentation.backdrop.panelOpacity,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      panel.position.fromArray(presentation.backdrop.panelPosition);
      panel.renderOrder = -8;
      backdrop.add(panel);
    }

    if (presentation.backdrop.haloSize) {
      const haloTexture = createHaloTexture(presentation.backdrop.haloColor);
      if (haloTexture) this.backdropTextures.push(haloTexture);
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.haloSize),
        new THREE.MeshBasicMaterial({
          map: haloTexture,
          transparent: true,
          opacity: presentation.backdrop.haloOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      halo.position.fromArray(presentation.backdrop.haloPosition);
      halo.renderOrder = -4;
      backdrop.add(halo);
    }

    if (presentation.backdrop.ringSize) {
      const ringTexture = createConcentricRingTexture(presentation.backdrop.ringColor);
      if (ringTexture) this.backdropTextures.push(ringTexture);
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.ringSize),
        new THREE.MeshBasicMaterial({
          map: ringTexture,
          transparent: true,
          opacity: presentation.backdrop.ringOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      ring.position.fromArray(presentation.backdrop.ringPosition);
      ring.renderOrder = -3;
      backdrop.add(ring);
    }

    if (presentation.backdrop.skySize) {
      const skyTexture = createVerticalGradientTexture(
        presentation.backdrop.skyColorTop,
        presentation.backdrop.skyColorBottom,
      );
      if (skyTexture) this.backdropTextures.push(skyTexture);
      const sky = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.skySize),
        new THREE.MeshBasicMaterial({
          map: skyTexture,
          transparent: true,
          opacity: presentation.backdrop.skyOpacity ?? 1,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      sky.position.fromArray(presentation.backdrop.skyPosition);
      sky.renderOrder = -30;
      backdrop.add(sky);
    }

    if (presentation.backdrop.starfieldSize) {
      const starfieldTexture = createStarfieldTexture(presentation.backdrop.starfieldColor);
      if (starfieldTexture) this.backdropTextures.push(starfieldTexture);
      const starfield = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.starfieldSize),
        new THREE.MeshBasicMaterial({
          map: starfieldTexture,
          transparent: true,
          opacity: presentation.backdrop.starfieldOpacity ?? 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      starfield.position.fromArray(presentation.backdrop.starfieldPosition);
      starfield.renderOrder = -24;
      backdrop.add(starfield);
    }

    if (presentation.backdrop.nebulaSize) {
      const nebulaTexture = createHaloTexture(presentation.backdrop.nebulaColor);
      if (nebulaTexture) this.backdropTextures.push(nebulaTexture);
      const nebula = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.nebulaSize),
        new THREE.MeshBasicMaterial({
          map: nebulaTexture,
          transparent: true,
          opacity: presentation.backdrop.nebulaOpacity ?? 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      nebula.position.fromArray(presentation.backdrop.nebulaPosition);
      nebula.renderOrder = -18;
      backdrop.add(nebula);
    }

    if (presentation.backdrop.horizonSize) {
      const horizonTexture = createVerticalGradientTexture(
        presentation.backdrop.horizonColorTop,
        presentation.backdrop.horizonColorBottom,
      );
      if (horizonTexture) this.backdropTextures.push(horizonTexture);
      const horizon = new THREE.Mesh(
        new THREE.PlaneGeometry(...presentation.backdrop.horizonSize),
        new THREE.MeshBasicMaterial({
          map: horizonTexture,
          transparent: true,
          opacity: presentation.backdrop.horizonOpacity ?? 0.5,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      horizon.position.fromArray(presentation.backdrop.horizonPosition);
      horizon.renderOrder = -12;
      backdrop.add(horizon);
    }

    this.backdropGroup = backdrop;
    this.scene.add(backdrop);
  }

  setupVisualPipeline(presentation) {
    if (this.renderPipeline === "genshin" || this.renderPipeline === "mio-reference") {
      this.setupGenshinPipeline(presentation);
      return;
    }
    this.setupClassicPipeline(presentation);
  }

  setupClassicPipeline(_presentation) {}

  setupGenshinPipeline(_presentation) {}

  shouldUsePostFX(presentation = this.presentation) {
    return Boolean(presentation?.postfx?.enabled);
  }

  shouldUseBloom(presentation = this.presentation) {
    if (!presentation?.postfx?.enabled) return false;
    return Number(presentation.postfx.bloomStrength) > 0;
  }

  setupPostprocessing(presentation) {
    this.disposePostprocessing();
    if (!this.shouldUsePostFX(presentation)) return;
    if (!this.renderer?.getSize || !this.renderer?.getPixelRatio) return;

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    if (presentation.background == null) {
      this.renderPass.clearColor = 0x000000;
      this.renderPass.clearAlpha = 0;
    }
    this.composer.addPass(this.renderPass);

    this.colorGradePass = new ShaderPass(createColorGradeShader(presentation.postfx.grade));
    this.composer.addPass(this.colorGradePass);

    if (this.shouldUseBloom(presentation)) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this.container.clientWidth || 1, this.container.clientHeight || 1),
        presentation.postfx.bloomStrength,
        presentation.postfx.bloomRadius,
        presentation.postfx.bloomThreshold,
      );
      this.composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = null;
    }
  }

  bindResize() {
    this.handleResize = () => {
      if (!this.renderer || !this.camera || !this.container) return;
      const size = this.syncStageCanvasBox();
      const width = size?.width || this.container.clientWidth;
      const height = size?.height || this.container.clientHeight;
      if (width === 0 || height === 0) return;
      this.camera.aspect = STAGE_CANVAS_ASPECT_RATIO;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.composer?.setSize?.(width, height);
      this.bloomPass?.setSize?.(width, height);
    };
    window.addEventListener("resize", this.handleResize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize?.();
      });
      this.resizeObserver.observe(this.container);
      this.resizeObserver.observe(this.container.parentElement || this.container);
    }
    this.handleResize();
  }

  clearModel() {
    this.disposeCharacterOutline();
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
    this.currentClip = null;
    this.currentVmdLoopUrls = [];
    this.currentVmdStandbyUrl = "";
    this.currentVmdLoopGapMs = 0;
    this.currentVmdLoopMode = "random";
    this.currentVmdLoopPhase = "loop";
    this.currentVmdLockLowerBody = false;
    this.currentVmdDisableCrossfade = false;
    this.currentVmdEmotionByUrl = {};
    this.pendingVmdLoopUrl = "";
    this.lastPlayedLoopMotionUrl = "";
    this.currentVmdUrl = "";
    this.currentVmdStartedAt = 0;
    this.currentVmdDurationMs = 0;
    this.currentVmdAction = null;
    this.pendingVmdActionCleanups = [];
    this.isLoadingVmd = false;
    this.bones = {};
    this.baseBoneRotation = {};
    this.baseBoneTransforms = [];
    this.baseBoneTransformMap = new Map();
    this.vmdAnchorBones = [];
    this.animationBuildTarget = null;
    this.morphSlots = {};
  }

  async loadModel(modelUrl) {
    this.setStatus("Loading MMD model...");
    this.clearModel();
    const mesh = await new Promise((resolve, reject) => {
      this.loader.load(modelUrl, resolve, undefined, reject);
    });
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        tuneMaterialByPipeline(material, this.toonRampTexture, this.renderPipeline);
      }
    });
    fitModelToPresentation(mesh, this.presentation);
    this.scene.add(mesh);
    this.model = mesh;
    this.helper.add(mesh, { physics: this.hasPhysicsSupport });
    this.captureBones(mesh);
    if (this.presentation?.outline?.enabled) {
      this.attachCharacterOutline(mesh, this.presentation);
    }
    this.setStatus("Model ready.");
  }

  attachCharacterOutline(mesh, presentation = this.presentation) {
    this.disposeCharacterOutline();
    if (!presentation?.outline?.enabled) return;

    mesh.traverse((child) => {
      if (!child.isMesh) return;
      const isGenshinOutline = this.renderPipeline === "genshin" || this.renderPipeline === "mio-reference";
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const materials = getMaterialArray(child.material);
      if (isGenshinOutline && materials.length && materials.every((material) => material.visible === false)) return;
      const hasHiddenMaterialSlot =
        isGenshinOutline && Array.isArray(child.material) && sourceMaterials.some((material) => material?.visible === false);
      const { outlineMaterial, outlineStyle, outlineMaterials } = hasHiddenMaterialSlot
        ? createSlotPreservingOutlineMaterials(sourceMaterials, presentation)
        : { ...createOutlineMaterial(materials, presentation), outlineMaterials: null };
      this.outlineMaterials.push(...(outlineMaterials || [outlineMaterial]));

      let outlineMesh;
      if (child.isSkinnedMesh && child.skeleton) {
        outlineMesh = new THREE.SkinnedMesh(child.geometry, outlineMaterial);
        outlineMesh.bind(child.skeleton, child.bindMatrix);
        outlineMesh.bindMode = child.bindMode;
        outlineMesh.frustumCulled = false;
      } else {
        outlineMesh = new THREE.Mesh(child.geometry, outlineMaterial);
      }

      outlineMesh.name = `${child.name || "mesh"}__outline`;
      outlineMesh.position.copy(child.position);
      outlineMesh.quaternion.copy(child.quaternion);
      outlineMesh.scale.copy(child.scale).multiplyScalar(outlineStyle.scale);
      outlineMesh.renderOrder = (child.renderOrder || 0) - 1;

      const parent = child.parent || mesh;
      parent.add(outlineMesh);
      this.outlineObjects.push(outlineMesh);
    });
  }

  disposeCharacterOutline() {
    for (const outline of this.outlineObjects) {
      outline.parent?.remove(outline);
    }
    this.outlineObjects = [];
    for (const material of this.outlineMaterials) material.dispose?.();
    this.outlineMaterials = [];
  }

  disposeBackdrop() {
    if (!Array.isArray(this.backdropTextures)) this.backdropTextures = [];
    if (this.backdropGroup) {
      this.scene?.remove?.(this.backdropGroup);
      this.backdropGroup.traverse((child) => {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      });
    }
    this.backdropGroup = null;
    for (const texture of this.backdropTextures) texture.dispose?.();
    this.backdropTextures = [];
  }

  disposeFloor() {
    if (!Array.isArray(this.floorTextures)) this.floorTextures = [];
    if (this.floorGroup) {
      this.scene?.remove?.(this.floorGroup);
      this.floorGroup.traverse((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
        else child.material?.dispose?.();
      });
    }
    this.floorGroup = null;
    for (const texture of this.floorTextures) texture.dispose?.();
    this.floorTextures = [];
  }

  disposePostprocessing() {
    this.composer?.renderTarget1?.dispose?.();
    this.composer?.renderTarget2?.dispose?.();
    this.bloomPass = null;
    this.colorGradePass = null;
    this.renderPass = null;
    this.composer = null;
  }

  captureBones(mesh) {
    const bones = [];
    mesh.traverse((child) => {
      if (child.isBone) bones.push(child);
    });
    const normalizedBones = bones.map((bone) => ({
      bone,
      lowerName: bone.name.toLowerCase(),
    }));

    const findBone = (hints) => {
      const lowerHints = hints.map((hint) => hint.toLowerCase());
      const exactMatch = normalizedBones.find(({ lowerName }) => lowerHints.includes(lowerName));
      if (exactMatch) return exactMatch.bone;
      return normalizedBones.find(({ lowerName }) => lowerHints.some((hint) => lowerName.includes(hint)))?.bone;
    };

    this.bones = {
      upperBody: findBone(["upperbody", "spine", "chest", "\u4e0a\u534a\u8eab", "\u4e0a\u534a\u8eab2", "\u4e0a\u534a\u8eab3"]),
      neck: findBone(["neck", "\u9996"]),
      head: findBone(["head", "\u982d"]),
      leftArm: findBone(["leftarm", "arm_l", "l_shoulder", "\u5de6\u8155"]),
      rightArm: findBone(["rightarm", "arm_r", "r_shoulder", "\u53f3\u8155"]),
      leftElbow: findBone(["leftelbow", "forearm_l", "l_forearm", "\u5de6\u3072\u3058"]),
      rightElbow: findBone(["rightelbow", "forearm_r", "r_forearm", "\u53f3\u3072\u3058"]),
    };
    this.baseBoneTransforms = bones.map((bone) => ({
      bone,
      position: bone.position?.clone?.() || new THREE.Vector3(),
      quaternion: bone.quaternion?.clone?.() || new THREE.Quaternion(),
      scale: bone.scale?.clone?.() || new THREE.Vector3(1, 1, 1),
    }));
    this.baseBoneTransformMap = new Map(this.baseBoneTransforms.map((entry) => [entry.bone, entry]));
    this.vmdAnchorBones = Array.from(
      new Set(
        FIXED_VMD_ANCHOR_BONE_HINTS.map((hints) => findBone(hints)).filter(Boolean),
      ),
    );
    const animationBuildBones = this.baseBoneTransforms.map((entry) => ({
      name: entry.bone?.name || "",
      position: entry.position?.clone?.() || new THREE.Vector3(),
    }));
    const animationBuildBoneMap = new Map(animationBuildBones.map((bone) => [bone.name, bone]));
    this.animationBuildTarget = {
      skeleton: {
        bones: animationBuildBones,
        getBoneByName(name) {
          return animationBuildBoneMap.get(name) || null;
        },
      },
      morphTargetDictionary: { ...(mesh.morphTargetDictionary || {}) },
    };

    for (const [slot, bone] of Object.entries(this.bones)) {
      if (bone) this.baseBoneRotation[slot] = bone.rotation.clone();
    }

    const dict = mesh.morphTargetDictionary || {};
    this.morphSlots = {
      smile: this.findMorphIndex(dict, FIXED_MORPH_HINTS.smile),
      sad: this.findMorphIndex(dict, FIXED_MORPH_HINTS.sad),
      blink: this.findMorphIndex(dict, FIXED_MORPH_HINTS.blink),
      mouthA: this.findMorphIndex(dict, FIXED_MORPH_HINTS.mouthA),
      mouthI: this.findMorphIndex(dict, FIXED_MORPH_HINTS.mouthI),
      mouthU: this.findMorphIndex(dict, FIXED_MORPH_HINTS.mouthU),
    };
    this.expressionMorphSlots = Object.fromEntries(
      Object.entries(FIXED_EXPRESSION_MORPH_NAMES).map(([slot, names]) => [
        slot,
        names
          .map((name) => this.findMorphIndexExact(dict, name))
          .filter((index) => typeof index === "number"),
      ]),
    );
  }

  findMorphIndexExact(dictionary, hint) {
    const entry = Object.entries(dictionary).find(([name]) => name === hint);
    return entry ? entry[1] : undefined;
  }

  findMorphIndex(dictionary, hints) {
    const entries = Object.entries(dictionary);
    const lowerHints = hints.map((hint) => hint.toLowerCase());
    const exact = entries.find(([name]) => lowerHints.includes(name.toLowerCase()));
    if (exact) return exact[1];
    const found = entries.find(([name]) => lowerHints.some((hint) => name.toLowerCase().includes(hint)));
    return found ? found[1] : undefined;
  }

  resetToBasePose() {
    if (!this.model) return;
    this.model.pose?.();

    for (const entry of this.baseBoneTransforms || []) {
      if (!entry?.bone) continue;
      if (entry.position) entry.bone.position?.copy?.(entry.position);
      if (entry.quaternion) entry.bone.quaternion?.copy?.(entry.quaternion);
      if (entry.scale) entry.bone.scale?.copy?.(entry.scale);
    }

    for (const [slot, bone] of Object.entries(this.bones)) {
      if (!bone) continue;
      const base = this.baseBoneRotation[slot];
      if (!base) continue;
      bone.rotation.copy(base);
    }

    if (Array.isArray(this.model.morphTargetInfluences)) {
      for (let index = 0; index < this.model.morphTargetInfluences.length; index += 1) {
        this.model.morphTargetInfluences[index] = 0;
      }
    }
  }

  stabilizeVmdAnchorBones() {
    if (!this.model || !this.vmdAnchorBones.length) return;
    for (const bone of this.vmdAnchorBones) {
      const base = this.baseBoneTransformMap.get(bone);
      if (!base) continue;
      bone.position?.copy?.(base.position);
    }
    this.model.updateMatrixWorld?.(true);
  }

  getCurrentVmdMixer() {
    if (!this.model) return null;
    return this.helper?.objects?.get?.(this.model)?.mixer || null;
  }

  getVmdAction(clip, { create = false } = {}) {
    if (!clip || !this.model) return null;
    const mixer = this.getCurrentVmdMixer();
    if (!mixer) return null;
    const existingAction = mixer.existingAction?.(clip, this.model) || null;
    if (existingAction || !create) return existingAction;
    return mixer.clipAction?.(clip, this.model) || null;
  }

  scheduleVmdActionCleanup(clip, action, nowMs = performance.now()) {
    if (!clip || !action) return;
    this.pendingVmdActionCleanups = this.pendingVmdActionCleanups
      .filter((entry) => entry?.clip !== clip && entry?.action !== action)
      .concat({
        clip,
        action,
        cleanupAt: nowMs + VMD_TRANSITION_FADE_SECONDS * 1000,
      });
  }

  flushExpiredVmdActionCleanups(nowMs = performance.now()) {
    if (!this.pendingVmdActionCleanups.length || !this.model) return;
    const mixer = this.getCurrentVmdMixer();
    if (!mixer) return;

    const pendingEntries = [];
    for (const entry of this.pendingVmdActionCleanups) {
      if (!entry || nowMs < entry.cleanupAt) {
        pendingEntries.push(entry);
        continue;
      }

      if (entry.action !== this.currentVmdAction) {
        entry.action?.stopFading?.();
        entry.action?.stopWarping?.();
        entry.action?.stop?.();
      }

      if (entry.clip && entry.clip !== this.currentClip) {
        mixer.uncacheAction?.(entry.clip, this.model);
        mixer.uncacheClip?.(entry.clip);
      }
    }

    this.pendingVmdActionCleanups = pendingEntries;
  }

  resetBonesNotAnimatedByClip(clip) {
    resetBonesNotAnimatedByClip(this.baseBoneTransforms, clip);
    this.model?.updateMatrixWorld?.(true);
  }

  resetLowerBodyBonesToBase() {
    resetLowerBodyBonesToBase(this.baseBoneTransforms);
    this.model?.updateMatrixWorld?.(true);
  }

  transitionToVmdClip(previousClip, nextClip, startedAt = performance.now()) {
    if (!previousClip || !nextClip) return false;
    const previousAction = this.currentVmdAction || this.getVmdAction(previousClip);
    const nextAction = this.getVmdAction(nextClip, { create: true });
    if (!previousAction || !nextAction || typeof nextAction.crossFadeFrom !== "function") return false;

    nextAction.reset?.();
    nextAction.stopFading?.();
    nextAction.stopWarping?.();
    nextAction.setEffectiveTimeScale?.(1);
    nextAction.setEffectiveWeight?.(1);
    nextAction.play?.();

    previousAction.stopFading?.();
    previousAction.stopWarping?.();
    nextAction.crossFadeFrom(previousAction, VMD_TRANSITION_FADE_SECONDS, false);

    this.scheduleVmdActionCleanup(previousClip, previousAction, startedAt);
    this.currentClip = nextClip;
    this.currentVmdAction = nextAction;
    this.resetBonesNotAnimatedByClip(nextClip);
    if (this.currentVmdLockLowerBody) this.resetLowerBodyBonesToBase();
    return true;
  }

  shouldCrossfadeVmdTransition({ previousPhase = "loop", nextPhase = "loop", disableCrossfade = false } = {}) {
    if (disableCrossfade) return false;
    return Boolean(previousPhase && nextPhase);
  }

  async playVmd(url, playbackRate = 1, loopUrls = [], loopOptions = {}) {
    if (!this.model) return;
    const normalizedLoopUrls = Array.from(new Set((Array.isArray(loopUrls) ? loopUrls : []).filter(Boolean)));
    const standbyUrl = loopOptions?.standbyUrl || "";
    const emotionByUrl = loopOptions?.emotionByUrl || this.currentVmdEmotionByUrl || {};
    const loopGapMs = Math.max(0, Number(loopOptions?.loopGapMs) || 0);
    const loopMode = loopOptions?.loopMode === "sequential" ? "sequential" : "random";
    const hadActiveClip = Boolean(this.currentClip);
    const previousPhase = this.currentVmdLoopPhase || "loop";
    const nextPhase = resolveVmdLoopPhase({
      url,
      loopUrls: normalizedLoopUrls,
      standbyUrl,
      resumePhase: loopOptions?.resumePhase,
    });
    const loadToken = ++this.vmdLoadToken;
    try {
      this.isLoadingVmd = true;
      this.currentAction = null;
      this.currentSequence = null;
      this.currentVmdPlaybackRate = Math.max(0.1, Number(playbackRate) || 1);
      this.currentVmdLoopUrls = normalizedLoopUrls;
      this.currentVmdStandbyUrl = standbyUrl;
      this.currentVmdLoopGapMs = loopGapMs;
      this.currentVmdLoopMode = loopMode;
      this.currentVmdLoopPhase = nextPhase;
      this.currentVmdLockLowerBody = Boolean(loopOptions?.lockLowerBody);
      this.currentVmdDisableCrossfade = Boolean(loopOptions?.disableCrossfade);
      this.currentVmdEmotionByUrl = emotionByUrl;
      this.currentVmdUrl = url || "";
      if (emotionByUrl[this.currentVmdUrl]) this.activeEmotion = emotionByUrl[this.currentVmdUrl];
      this.activeAction = "idle";
      if (normalizedLoopUrls.includes(this.currentVmdUrl)) {
        this.lastPlayedLoopMotionUrl = this.currentVmdUrl;
      }
      this.currentVmdStartedAt = 0;
      this.currentVmdDurationMs = 0;
      const animationBuildTarget = this.animationBuildTarget || this.model;
      const clip = await loadAnimationSilently(this.loader, url, animationBuildTarget);
      if (this.destroyed || loadToken !== this.vmdLoadToken) return;
      const startedAt = performance.now();
      const shouldCrossfade = hadActiveClip && this.shouldCrossfadeVmdTransition({
        previousPhase,
        nextPhase,
        disableCrossfade: this.currentVmdDisableCrossfade,
      });
      if (!shouldCrossfade || !this.transitionToVmdClip(this.currentClip, clip, startedAt)) {
        this.resetToBasePose();
        try {
          this.helper.remove(this.model);
        } catch {
          // ignore stale helper state when starting the first VMD clip
        }
        this.currentClip = clip;
        this.helper.add(this.model, { animation: clip, physics: this.hasPhysicsSupport });
        this.currentVmdAction = this.getVmdAction(clip);
      }
      this.currentVmdStartedAt = startedAt;
      this.currentVmdDurationMs =
        Number(clip?.duration) > 0 ? (Number(clip.duration) / this.currentVmdPlaybackRate) * 1000 : 0;
      this.setStatus("Playing mapped VMD motion.");
    } catch (error) {
      if (error) {
        console.warn("[mmd-vmd] failed to parse motion", {
          url,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      this.setStatus("VMD playback failed, fallback to procedural.");
    } finally {
      if (loadToken === this.vmdLoadToken) this.isLoadingVmd = false;
    }
  }

  setSpeaking(flag) {
    this.isSpeaking = !!flag;
  }

  applyInteraction({ emotion = "neutral", action = "idle", sequence = [] }) {
    this.activeEmotion = emotion;
    this.activeAction = action;
    if (this.currentClip && this.model) {
      this.currentClip = null;
      this.currentVmdPlaybackRate = 1;
      this.currentVmdAction = null;
      this.pendingVmdActionCleanups = [];
      this.helper.remove(this.model);
      this.helper.add(this.model, { physics: this.hasPhysicsSupport });
    }
    this.resetToBasePose();
    this.currentVmdLoopUrls = [];
    this.currentVmdStandbyUrl = "";
    this.currentVmdLoopGapMs = 0;
    this.currentVmdLoopMode = "random";
    this.currentVmdLoopPhase = "loop";
    this.currentVmdLockLowerBody = false;
    this.currentVmdDisableCrossfade = false;
    this.currentVmdEmotionByUrl = {};
    this.pendingVmdLoopUrl = "";
    this.lastPlayedLoopMotionUrl = "";
    this.currentVmdUrl = "";
    this.currentVmdStartedAt = 0;
    this.currentVmdDurationMs = 0;
    this.currentVmdAction = null;
    this.pendingVmdActionCleanups = [];
    this.isLoadingVmd = false;
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

  updateVmdLoop(nowMs) {
    if (!this.currentClip || this.isLoadingVmd) return;
    const loopUrls = Array.from(new Set((Array.isArray(this.currentVmdLoopUrls) ? this.currentVmdLoopUrls : []).filter(Boolean)));
    const standbyUrl = this.currentVmdStandbyUrl || "";
    if (!loopUrls.length && !standbyUrl) return;
    if (!this.currentVmdStartedAt) return;
    const loopGapMs = Math.max(0, Number(this.currentVmdLoopGapMs) || 0);
    const loopStateOptions = {
      standbyUrl,
      loopGapMs,
      loopMode: this.currentVmdLoopMode,
    };
    if (this.currentVmdLockLowerBody) loopStateOptions.lockLowerBody = true;
    if (this.currentVmdDisableCrossfade) loopStateOptions.disableCrossfade = true;
    if (this.currentVmdEmotionByUrl && Object.keys(this.currentVmdEmotionByUrl).length) {
      loopStateOptions.emotionByUrl = this.currentVmdEmotionByUrl;
    }
    const elapsedMs = nowMs - this.currentVmdStartedAt;
    const measuredDurationMs = Math.max(0, Number(this.currentVmdDurationMs) || 0);
    if (measuredDurationMs > 0) {
      const transitionLeadMs = loopGapMs > 0 ? 0 : VMD_TRANSITION_FADE_SECONDS * 1000;
      const advanceAtMs = Math.max(0, measuredDurationMs - transitionLeadMs);
      if (elapsedMs < advanceAtMs + loopGapMs) return;
    } else {
      const canAdvanceWithoutDuration =
        loopUrls.length && (this.currentVmdLoopPhase === "loop" || this.currentVmdLoopPhase === "standby");
      if (!canAdvanceWithoutDuration || elapsedMs < loopGapMs) return;
    }

    if (standbyUrl && !loopUrls.length) {
      this.playVmd(standbyUrl, this.currentVmdPlaybackRate, [], {
        ...loopStateOptions,
        resumePhase: "standby-only",
      });
      return;
    }

    if (this.currentVmdLoopPhase === "loop" && standbyUrl) {
      this.playVmd(standbyUrl, this.currentVmdPlaybackRate, loopUrls, {
        ...loopStateOptions,
        resumePhase: "standby",
      });
      return;
    }

    const currentLoopAnchor = this.lastPlayedLoopMotionUrl || this.currentVmdUrl;
    const nextUrl = pickLoopMotionUrl(loopUrls, currentLoopAnchor, this.currentVmdLoopMode);
    if (!nextUrl) return;
    this.playVmd(nextUrl, this.currentVmdPlaybackRate, loopUrls, {
      ...loopStateOptions,
      resumePhase: "loop",
    });
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
          this.activeAction = step.action;
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

  getExpressionTargets() {
    const emotion = this.activeEmotion || "neutral";
    const action = this.activeAction || this.currentAction?.name || "idle";
    const targets = {
      smirk: 0,
      mouthSmile: 0,
      mouthFrown: 0,
      mouthWide: 0,
      joy: 0,
      softSmile: 0,
      troubled: 0,
      serious: 0,
      glare: 0,
      surprised: 0,
      angry: 0,
    };

    if (emotion === "happy" || action === "wave" || action === "nod") {
      Object.assign(targets, { mouthSmile: 0.46, smirk: 0.18, joy: 0.18, softSmile: 0.12 });
    } else if (emotion === "excited" || action === "cheer") {
      Object.assign(targets, { mouthSmile: 0.38, mouthWide: 0.26, joy: 0.32, surprised: 0.12 });
    } else if (emotion === "thinking" || action === "think") {
      Object.assign(targets, { serious: 0.28, glare: 0.14, mouthFrown: 0.08 });
    } else if (emotion === "caring" || action === "comfort" || action === "lean_in") {
      Object.assign(targets, { mouthSmile: 0.2, softSmile: 0.16, troubled: 0.16 });
    } else if (emotion === "sad" || action === "look_away") {
      Object.assign(targets, { troubled: 0.34, mouthFrown: 0.22 });
    } else if (action === "headshake") {
      Object.assign(targets, { serious: 0.24, mouthFrown: 0.12 });
    } else {
      Object.assign(targets, { mouthSmile: 0.08 });
    }

    return targets;
  }

  getBreathingOffsets(nowMs) {
    const phase = (nowMs / 1000) * ((Math.PI * 2) / BREATHING_CYCLE_SECONDS);
    const breathWave = Math.sin(phase);
    const breathLift = Math.max(0, breathWave);
    const speakingBoost = this.isSpeaking ? 1.3 : 1;
    const clipAttenuation = this.currentClip ? 0.92 : 1;
    const actionAttenuation = this.currentAction || this.currentSequence ? 0.72 : 1;
    const intensity = speakingBoost * clipAttenuation * actionAttenuation;
    const shoulderWave = Math.sin(phase - Math.PI * 0.18);

    return {
      upperBody: { x: (-0.08 - breathLift * 0.16) * intensity, z: breathWave * 0.022 * intensity },
      neck: { x: (-0.016 + breathLift * 0.05) * intensity, z: breathWave * 0.01 * intensity },
      head: { x: (0.008 + breathLift * 0.032) * intensity, z: breathWave * 0.014 * intensity },
      leftArm: { z: (-0.04 - shoulderWave * 0.055) * intensity, x: breathLift * 0.014 * intensity },
      rightArm: { z: (0.04 + shoulderWave * 0.055) * intensity, x: breathLift * 0.014 * intensity },
    };
  }

  updateBonePose(delta, nowMs) {
    const breathingPose = this.getBreathingOffsets(nowMs);
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
    for (const [slot, values] of Object.entries(breathingPose)) {
      targets[slot] = { ...targets[slot], ...values };
    }
    for (const [slot, values] of Object.entries(actionPose)) {
      targets[slot] = { ...targets[slot], ...values };
    }
    for (const [slot, bone] of Object.entries(this.bones)) {
      if (!bone) continue;
      const target = targets[slot] || { x: 0, y: 0, z: 0 };
      if (this.currentClip) {
        if (clipAnimatesBone(this.currentClip, bone)) {
          bone.rotation.x += target.x;
          bone.rotation.y += target.y;
          bone.rotation.z += target.z;
        } else {
          const base = this.baseBoneRotation[slot] || new THREE.Euler(0, 0, 0);
          bone.rotation.x = base.x + target.x;
          bone.rotation.y = base.y + target.y;
          bone.rotation.z = base.z + target.z;
        }
        continue;
      }
      const base = this.baseBoneRotation[slot] || new THREE.Euler(0, 0, 0);
      bone.rotation.x = smooth(bone.rotation.x, base.x + target.x, 9, delta);
      bone.rotation.y = smooth(bone.rotation.y, base.y + target.y, 9, delta);
      bone.rotation.z = smooth(bone.rotation.z, base.z + target.z, 9, delta);
    }
  }

  updateMorph(delta, nowMs) {
    if (!this.model?.morphTargetInfluences) return;
    const influences = this.model.morphTargetInfluences;
    const morphSlots = this.morphSlots || {};
    const expressionMorphSlots = this.expressionMorphSlots || {};
    const setMorph = (index, value) => {
      if (typeof index !== "number" || index >= influences.length) return;
      const current = typeof influences[index] === "number" ? influences[index] : 0;
      influences[index] = smooth(current, value, 12, delta);
    };

    setMorph(morphSlots.smile, 0);
    setMorph(morphSlots.sad, 0);

    setMorph(morphSlots.blink, 0);

    const expressionTargets = this.getExpressionTargets();
    for (const [slot, target] of Object.entries(expressionTargets)) {
      for (const index of expressionMorphSlots[slot] || []) {
        setMorph(index, target);
      }
    }

    const lipBase = this.isSpeaking ? 0.22 + Math.abs(Math.sin(nowMs * 0.021)) * 0.55 : 0;
    setMorph(morphSlots.mouthA, lipBase);
    setMorph(morphSlots.mouthI, this.isSpeaking ? lipBase * 0.5 : 0);
    setMorph(morphSlots.mouthU, this.isSpeaking ? lipBase * 0.34 : 0);
  }

  renderFrame() {
    if (this.destroyed) return;
    requestAnimationFrame(() => this.renderFrame());
    const delta = this.clock.getDelta();
    const nowMs = performance.now();
    this.updateVmdLoop(nowMs);
    const helperDelta = this.currentClip ? delta * this.currentVmdPlaybackRate : delta;
    this.helper.update(helperDelta);
    if (this.currentClip) {
      this.stabilizeVmdAnchorBones();
      this.resetBonesNotAnimatedByClip(this.currentClip);
      if (this.currentVmdLockLowerBody) this.resetLowerBodyBonesToBase();
    }
    this.updateBonePose(delta, nowMs);
    this.updateMorph(delta, nowMs);
    this.flushExpiredVmdActionCleanups(nowMs);
    this.controls?.update();
    this.renderScene();
  }

  startRenderLoop() {
    this.renderFrame();
  }

  renderScene() {
    if (this.shouldUsePostFX()) {
      this.composer?.render?.();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.destroyed = true;
    if (this.handleResize) window.removeEventListener("resize", this.handleResize);
    this.resizeObserver?.disconnect?.();
    this.resizeObserver = null;
    this.clearModel();
    this.disposeFloor();
    this.disposeBackdrop();
    this.disposePostprocessing();
    this.renderer?.dispose();
    this.toonRampTexture?.dispose?.();
  }
}
