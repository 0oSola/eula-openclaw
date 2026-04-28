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

const FIXED_VMD_ANCHOR_BONE_HINTS = [
  ["allparent", "\u5168\u3066\u306e\u89aa"],
  ["center", "\u30bb\u30f3\u30bf\u30fc"],
  ["groove", "\u30b0\u30eb\u30fc\u30d6"],
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

const VMD_TRANSITION_FADE_SECONDS = 0.24;

const smooth = (current, target, lambda, dt) => THREE.MathUtils.damp(current, target, lambda, dt);

const STAGE_PRESENTATION_PRESETS = {
  classic: {
    background: null,
    fog: null,
    camera: {
      fov: 33,
      position: [0, 9.2, 21.6],
      target: [0, 7.9, 0],
      minDistance: 13,
      maxDistance: 27,
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
      fov: 31,
      position: [0, 8.8, 20.4],
      target: [0, 7.45, 0],
      minDistance: 12,
      maxDistance: 25,
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
    background: "#081a35",
    fog: null,
    camera: {
      fov: 30,
      position: [0, 8.9, 20.5],
      target: [0, 7.1, 0],
      minDistance: 12,
      maxDistance: 26,
      maxPolarAngle: Math.PI * 0.42,
    },
    character: {
      targetHeight: 19.5,
    },
    lights: {
      ambient: { color: 0xffffff, intensity: 0.88 },
      hemisphere: { sky: "#dbe9ff", ground: "#41516a", intensity: 0.68 },
      key: { color: "#fff0d6", intensity: 1.56, position: [-10, 19, 20] },
      fill: { color: "#bfd8ff", intensity: 0.58, position: [12, 10, 14] },
      rim: { color: "#f1f6ff", intensity: 0.46, position: [-8, 14, -16] },
    },
    shadowMapType: THREE.PCFShadowMap,
    floor: {
      kind: "shadowCatcher",
      size: 38,
      y: -9.2,
      opacity: 0.18,
      glow: {
        enabled: true,
        size: [30, 30],
        color: "#66c8ff",
        opacity: 0.28,
        position: [0, -9.05, -1.8],
      },
      rings: {
        enabled: true,
        size: [34, 34],
        color: "#d6f2ff",
        opacity: 0.72,
        position: [0, -9.02, -1.6],
      },
      contactShadow: {
        enabled: true,
        size: [11.8, 7.6],
        opacity: 0.34,
        position: [0, -9.16, 0.4],
      },
    },
    outline: { enabled: true, color: "#2a3142", opacity: 0.92, scale: 1.03 },
    backdrop: {
      enabled: true,
      panelSize: [52, 34],
      panelColorTop: "#4e82cf",
      panelColorBottom: "#102646",
      panelOpacity: 0.52,
      panelPosition: [0, 8.5, -20],
      haloSize: [24, 24],
      haloColor: "#9ad8ff",
      haloOpacity: 0.34,
      haloPosition: [0, 8.8, -18],
      ringSize: [28, 28],
      ringColor: "#d5f1ff",
      ringOpacity: 0.56,
      ringPosition: [0, 7.2, -19],
    },
    postfx: {
      enabled: true,
      bloomStrength: 0.18,
      bloomRadius: 0.24,
      bloomThreshold: 0.56,
      grade: {
        exposure: 1.02,
        contrast: 1.05,
        saturation: 1.06,
        warmth: 0.03,
        shadowLift: 0.02,
      },
    },
  },
};

function cloneStagePresentationConfig(config) {
  return {
    background: config.background,
    fog: config.fog,
    camera: {
      ...config.camera,
      position: [...config.camera.position],
      target: [...config.camera.target],
    },
    character: config.character ? { ...config.character } : null,
    lights: {
      ambient: { ...config.lights.ambient },
      hemisphere: { ...config.lights.hemisphere },
      key: { ...config.lights.key, position: [...config.lights.key.position] },
      fill: { ...config.lights.fill, position: [...config.lights.fill.position] },
      rim: { ...config.lights.rim, position: [...config.lights.rim.position] },
    },
    shadowMapType: config.shadowMapType,
    floor: {
      ...config.floor,
      glow: config.floor.glow
        ? {
            ...config.floor.glow,
            size: config.floor.glow.size ? [...config.floor.glow.size] : undefined,
            position: config.floor.glow.position ? [...config.floor.glow.position] : undefined,
          }
        : undefined,
      rings: config.floor.rings
        ? {
            ...config.floor.rings,
            size: config.floor.rings.size ? [...config.floor.rings.size] : undefined,
            position: config.floor.rings.position ? [...config.floor.rings.position] : undefined,
          }
        : undefined,
      contactShadow: config.floor.contactShadow
        ? {
            ...config.floor.contactShadow,
            size: config.floor.contactShadow.size ? [...config.floor.contactShadow.size] : undefined,
            position: config.floor.contactShadow.position ? [...config.floor.contactShadow.position] : undefined,
          }
        : undefined,
    },
    outline: config.outline ? { ...config.outline } : null,
    backdrop: config.backdrop
      ? {
          ...config.backdrop,
          panelSize: config.backdrop.panelSize ? [...config.backdrop.panelSize] : undefined,
          panelPosition: config.backdrop.panelPosition ? [...config.backdrop.panelPosition] : undefined,
          haloSize: config.backdrop.haloSize ? [...config.backdrop.haloSize] : undefined,
          haloPosition: config.backdrop.haloPosition ? [...config.backdrop.haloPosition] : undefined,
          ringSize: config.backdrop.ringSize ? [...config.backdrop.ringSize] : undefined,
          ringPosition: config.backdrop.ringPosition ? [...config.backdrop.ringPosition] : undefined,
        }
      : null,
    postfx: config.postfx
      ? {
          ...config.postfx,
          grade: config.postfx.grade ? { ...config.postfx.grade } : undefined,
        }
      : null,
  };
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
    runtime.applyInteraction?.(interaction);
    runtime.playVmd?.(resolveUrl(interaction.vmdUrl), interaction.playbackRate, loopUrls, {
      standbyUrl,
      loopGapMs: interaction.loopGapMs,
      loopMode: interaction.loopMode,
    });
    return;
  }
  runtime.applyInteraction?.(interaction);
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
  } else if (pipeline === "genshin") {
    gradient.addColorStop(0, "#383838");
    gradient.addColorStop(0.43, "#383838");
    gradient.addColorStop(0.44, "#8d8d8d");
    gradient.addColorStop(0.72, "#8d8d8d");
    gradient.addColorStop(0.73, "#ffffff");
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

  if (material.color) material.color.multiplyScalar(1.12);
  if (material.emissive) material.emissive.multiplyScalar(1.05);
  if ("envMapIntensity" in material) material.envMapIntensity = 0.45;
  if ("emissiveIntensity" in material) material.emissiveIntensity = 0.24;

  const needsCutout =
    Boolean(material.transparent) ||
    (typeof material.opacity === "number" && material.opacity < 1) ||
    Boolean(material.alphaMap);

  return { needsCutout, profile };
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
  return GENSHIN_MASK_HINTS.includes(name);
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
  const { needsCutout, profile } = primeMMDMaterial(material);
  const materialName = `${material.name || ""}`;

  if (needsCutout) material.alphaTest = Math.max(material.alphaTest || 0, 0.58);
  if (needsCutout || profile === "hair" || profile === "cloth") material.side = THREE.DoubleSide;

  const profileTuning = {
    face: { shininess: 10, specular: 0.18, emissiveIntensity: 0.32, envMapIntensity: 0.18 },
    skin: { shininess: 12, specular: 0.24, emissiveIntensity: 0.28, envMapIntensity: 0.2 },
    hair: { shininess: 14, specular: 0.42, emissiveIntensity: 0.14, envMapIntensity: 0.24 },
    cloth: { shininess: 12, specular: 0.38, emissiveIntensity: 0.12, envMapIntensity: 0.2 },
    metal: { shininess: 42, specular: 0.88, emissiveIntensity: 0.1, envMapIntensity: 0.52 },
    default: { shininess: 18, specular: 0.5, emissiveIntensity: 0.14, envMapIntensity: 0.24 },
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

  if (isGenshinGlowMaterial(materialName)) {
    material.emissive?.setHex?.(0x9d00ff);
    if ("emissiveIntensity" in material) {
      material.emissiveIntensity = Math.max(material.emissiveIntensity || 0, 0.75);
    }
  }

  if (isGenshinSuppressedMaskMaterial(materialName)) {
    material.visible = false;
    material.transparent = true;
    material.opacity = 0;
  }

  finalizeMMDMaterial(material, rampTexture);
}

function tuneMaterialByPipeline(material, toonRampTexture, pipeline) {
  if (pipeline === "hero-shot") return tuneHeroShotMMDMaterial(material, toonRampTexture);
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
  constructor({ container, statusElement, renderPipeline = "classic" }) {
    this.container = container;
    this.statusElement = statusElement;
    this.renderPipeline = renderPipeline;
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
    const presentation = getStagePresentationConfig(this.renderPipeline);
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
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
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = presentation.camera.minDistance;
    this.controls.maxDistance = presentation.camera.maxDistance;
    this.controls.maxPolarAngle = presentation.camera.maxPolarAngle;
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

    this.floorGroup = floorGroup;
    this.scene.add(floorGroup);
  }

  setupBackdrop(presentation) {
    if (!Array.isArray(this.backdropTextures)) this.backdropTextures = [];
    this.disposeBackdrop();
    if (!presentation.backdrop?.enabled) return;

    const backdrop = new THREE.Group();
    backdrop.name = "genshin-backdrop";

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
    backdrop.add(panel);

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
    backdrop.add(halo);

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
    backdrop.add(ring);

    this.backdropGroup = backdrop;
    this.scene.add(backdrop);
  }

  setupVisualPipeline(presentation) {
    if (this.renderPipeline === "genshin") {
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
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (width === 0 || height === 0) return;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.composer?.setSize?.(width, height);
      this.bloomPass?.setSize?.(width, height);
    };
    window.addEventListener("resize", this.handleResize);
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
      const isGenshinOutline = this.renderPipeline === "genshin";
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
      upperBody: findBone(["upperbody", "spine", "chest"]),
      neck: findBone(["neck"]),
      head: findBone(["head"]),
      leftArm: findBone(["leftarm", "arm_l", "l_shoulder"]),
      rightArm: findBone(["rightarm", "arm_r", "r_shoulder"]),
      leftElbow: findBone(["leftelbow", "forearm_l", "l_forearm"]),
      rightElbow: findBone(["rightelbow", "forearm_r", "r_forearm"]),
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
    return true;
  }

  shouldCrossfadeVmdTransition({ previousPhase = "loop", nextPhase = "loop" } = {}) {
    return previousPhase === "loop" && (nextPhase === "standby" || nextPhase === "standby-only");
  }

  async playVmd(url, playbackRate = 1, loopUrls = [], loopOptions = {}) {
    if (!this.model) return;
    const normalizedLoopUrls = Array.from(new Set((Array.isArray(loopUrls) ? loopUrls : []).filter(Boolean)));
    const standbyUrl = loopOptions?.standbyUrl || "";
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
      this.currentVmdUrl = url || "";
      if (normalizedLoopUrls.includes(this.currentVmdUrl)) {
        this.lastPlayedLoopMotionUrl = this.currentVmdUrl;
      }
      this.currentVmdStartedAt = 0;
      this.currentVmdDurationMs = 0;
      const animationBuildTarget = this.animationBuildTarget || this.model;
      const clip = await new Promise((resolve, reject) => {
        this.loader.loadAnimation(url, animationBuildTarget, resolve, undefined, reject);
      });
      if (this.destroyed || loadToken !== this.vmdLoadToken) return;
      const startedAt = performance.now();
      const shouldCrossfade = hadActiveClip && this.shouldCrossfadeVmdTransition({ previousPhase, nextPhase });
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
    } catch {
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
    const elapsedMs = nowMs - this.currentVmdStartedAt;
    const measuredDurationMs = Math.max(0, Number(this.currentVmdDurationMs) || 0);
    if (measuredDurationMs > 0) {
      if (elapsedMs < measuredDurationMs + loopGapMs) return;
    } else {
      const canAdvanceWithoutDuration =
        loopUrls.length && (this.currentVmdLoopPhase === "loop" || this.currentVmdLoopPhase === "standby");
      if (!canAdvanceWithoutDuration || elapsedMs < loopGapMs) return;
    }

    if (standbyUrl && !loopUrls.length) {
      this.playVmd(standbyUrl, this.currentVmdPlaybackRate, [], {
        standbyUrl,
        loopGapMs,
        loopMode: this.currentVmdLoopMode,
        resumePhase: "standby-only",
      });
      return;
    }

    if (this.currentVmdLoopPhase === "loop" && standbyUrl) {
      this.playVmd(standbyUrl, this.currentVmdPlaybackRate, loopUrls, {
        standbyUrl,
        loopGapMs,
        loopMode: this.currentVmdLoopMode,
        resumePhase: "standby",
      });
      return;
    }

    const currentLoopAnchor = this.lastPlayedLoopMotionUrl || this.currentVmdUrl;
    const nextUrl = pickLoopMotionUrl(loopUrls, currentLoopAnchor, this.currentVmdLoopMode);
    if (!nextUrl) return;
    this.playVmd(nextUrl, this.currentVmdPlaybackRate, loopUrls, {
      standbyUrl,
      loopGapMs,
      loopMode: this.currentVmdLoopMode,
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

    const hints = FIXED_EMOTION_MORPH_HINTS[this.activeEmotion] || [];
    const shouldSmile = hints.includes("smile") || hints.includes("happy") || hints.includes("\u7b11");
    const shouldSad = hints.includes("sad") || hints.includes("sorrow") || hints.includes("\u60b2");

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
    this.updateVmdLoop(nowMs);
    const helperDelta = this.currentClip ? delta * this.currentVmdPlaybackRate : delta;
    this.helper.update(helperDelta);
    if (this.currentClip) {
      this.stabilizeVmdAnchorBones();
    }
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
    this.clearModel();
    this.disposeFloor();
    this.disposeBackdrop();
    this.disposePostprocessing();
    this.renderer?.dispose();
    this.toonRampTexture?.dispose?.();
  }
}
