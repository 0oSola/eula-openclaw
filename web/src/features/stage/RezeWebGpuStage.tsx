"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  BODY_GRAPH,
  CLOTH_SMOOTH_GRAPH,
  DEFAULT_GRAPH,
  Engine,
  EYE_GRAPH,
  FACE_GRAPH,
  HAIR_GRAPH,
  METAL_GRAPH,
  Vec3,
  type ShaderGraph,
} from "reze-engine";

import type { MmdCameraSnapshot } from "@/lib/types";
import type { MMDStageHandle } from "@/features/stage/MMDStage";
import {
  type RezeBackgroundEffect,
  REZE_DESIGN_SCENE_DEFAULTS,
  REZE_K3_SCENE_DEFAULTS,
  REZE_SHINING_STARS_WGSL,
  resolveRezeGrade,
  type RezeGradePreset,
  type RezeSceneDebugSettings,
} from "@/features/stage/rezeDesignDefaults";
import { createRezeVmdRequestGuard } from "@/features/stage/rezeVmdRequestGuard.js";
import {
  applyRezeVmdIkPolicy,
  fetchRezeVmdIkPolicy,
  playRezeVmd,
  resetRezeModelToBindPose,
  setRezeVmdCompletionHandler,
} from "@/features/stage/rezeVmdPlayback.js";
import {
  isKoledaMaskMaterialName,
  isKoledaModelIdentifier,
  lockKoledaMorphWeights,
  selectKoledaClosedEyeMorphNames,
} from "@/features/stage/koledaDefaultAppearance.js";
import {
  analyzeV14dColorBaselineRois,
  createV14dColorBaselineResult,
  makeV14dLinearImage,
  measureV14dRoiActualMeans,
  readV14dCanvasDisplay,
  readV14dColorBaselineMaterialMask,
  readV14dColorBaselineResolveTargets,
  srgbToLinear,
  validateV14dColorBaselineScene,
  V14D_COLOR_BASELINE_CAMERA,
  V14D_COLOR_BASELINE_EPSILON,
  V14D_COLOR_BASELINE_FRAME,
  V14D_COLOR_BASELINE_FPS,
  V14D_COLOR_BASELINE_HEIGHT,
  V14D_COLOR_BASELINE_ROIS,
  V14D_COLOR_BASELINE_SECONDS,
  V14D_COLOR_BASELINE_WIDTH,
  type V14dAnimationEvidence,
  type V14dAnimationProgressEvidence,
  type V14dColorBaselineResult,
  type V14dNormalizedImage,
} from "@/features/stage/v14dColorBaseline";
import {
  V14D_FACE_MATERIAL_NAME,
  V14D_FACE_STATIC_AUTHORITY,
  V14D_BAKED_MATERIAL_MAP,
  V14D_FACE_STATIC_BLEND,
  V14D_FACE_STATIC_CAMERA,
  V14D_FACE_STATIC_DATASET,
  V14D_FACE_STATIC_FPS,
  V14D_FACE_STATIC_FRAME,
  V14D_FACE_STATIC_ROI_NORM,
  V14D_FACE_STATIC_SECONDS,
  V14D_FACE_STATIC_SIZE,
  V14D_FACE_STATIC_STATE,
  v14dFaceStaticFacePickId,
  v14dFaceStaticTextureName,
  type V14dFaceStaticAssetSource,
  type V14dFaceStaticMode,
} from "@/features/stage/v14dFaceStatic";

declare global {
  interface Window {
    __v14dColorBaseline?: {
      capture: () => Promise<V14dColorBaselineResult>;
      getResult: () => V14dColorBaselineResult | null;
    };
    __v14dFaceStatic?: {
      capture: () => Promise<V14dFaceStaticCapture>;
      exportFaceMaskPng: () => Promise<string | null>;
      exportFaceUvPng: () => Promise<{
        png: string;
        width: number;
        height: number;
        faceMaterialId: number;
        uv: Float32Array;
        faceMask: Uint8Array;
      } | null>;
      /** 导出当前模式的 pre-tonemap HDR（线性、未过 composite tonemap/grade/gamma）
       *  逐像素浮点 RGB 与 Face mask，供 UV-direct Gate 用同口径线性值对账。 */
      exportFaceHdrFloat: () => Promise<{
        width: number;
        height: number;
        faceMaterialId: number;
        rgb: Float32Array;
        faceMask: Uint8Array;
      } | null>;
    };
    /** faceStatic 注入的权威资产集（File 形式，引擎 files 变体局部解析）。 */
    __v14dFaceStaticAssets?: V14dFaceStaticAssetSource;
  }
}

export type V14dFaceStaticCapture = {
  mode: V14dFaceStaticMode;
  frame: number;
  state: number;
  blend: number;
  cameraLocked: boolean;
  paused: boolean;
  texture: string;
  width: number;
  height: number;
  /** Face 材质名映射推导出的 pick ID；门控失败时为 null，不硬编码。 */
  faceMaterialId: number | null;
  faceMaterialName: string;
  /** 权威资产门控是否通过（PMX/VMD/派生纹理可追溯）。 */
  authorityOk: boolean;
  roi: { px: [number, number, number, number]; samples: number; faceSamples: number };
  /** 脸部 ROI (Face 材质 ID + 模型覆盖 + 深度前景) 的显示 sRGB 与线性均值。 */
  meanSrgb: [number, number, number] | null;
  meanLinear: [number, number, number] | null;
  error?: string;
};

type RezeStageProps = {
  modelUrl: string;
  modelIdentifier?: string;
  localModelImport?: {
    revision: number;
    files: File[];
    pmxFile: File;
  } | null;
  interaction: {
    mode?: "procedural" | "vmd";
    vmdUrl?: string;
    vmdLoopUrls?: string[];
    vmdLoopEmotionByUrl?: Record<string, string>;
    standbyVmdUrl?: string;
    loopGapMs?: number;
    loopMode?: "random" | "sequential";
    lockLowerBody?: boolean;
    disableCrossfade?: boolean;
    playbackRate?: number;
    vmdRequestId?: number;
  };
  backgroundEffect?: RezeBackgroundEffect;
  grade?: RezeGradePreset;
  gradeIntensity?: number;
  sceneSettings?: RezeSceneDebugSettings;
  /**
   * WebGPU 管线的默认场景。reze-k3 用明亮中性光（与 companion 页面一致），
   * reze-design 保持紫调舞台；上层显式传入 sceneSettings 时此预设被覆盖。
   */
  scenePreset?: "reze-design" | "reze-k3";
  /** 仅用于 V14D 材质迁移取证；默认关闭，不改变生产渲染路径。 */
  v14dUnlitDiagnostic?: boolean;
  /** 仅用于 V14D 三层颜色基线取证；默认关闭，不改变生产渲染路径。 */
  v14dColorBaseline?: boolean;
  /** 仅用于 V14D Face State 2 静态黄金帧预览；默认关闭，不改变生产渲染路径。 */
  v14dFaceStatic?: boolean;
  v14dFaceStaticMode?: V14dFaceStaticMode;
  /** 黄金帧诊断 ROI/pick/HDR 取样门控（仅 faceStatic 页面启用；与组件门控分离）。 */
  v14dFaceStaticGated?: boolean;
  /** true 时 WebGPU 画布透明，由页面 MIO CSS 背景透出；false 用场景背景色。 */
  transparentBackground?: boolean;
  cameraSnapshot?: MmdCameraSnapshot | null;
  onReadyChange?: (ready: boolean, detail?: string) => void;
  onInteractionComplete?: () => void;
};

const DEFAULT_SETTINGS = REZE_DESIGN_SCENE_DEFAULTS;

const MATERIAL_GRAPHS: Record<string, ShaderGraph> = {
  "默认": DEFAULT_GRAPH,
  "角色皮肤": BODY_GRAPH,
  "面部": FACE_GRAPH,
  "眼睛": EYE_GRAPH,
  "头发": HAIR_GRAPH,
  "柔滑布料": CLOTH_SMOOTH_GRAPH,
  "金属": METAL_GRAPH,
  "半透材质": CLOTH_SMOOTH_GRAPH,
};

/**
 * V14D 最小迁移 PoC 的诊断图。
 *
 * 这个图只把引擎已经绑定的 PMX diffuse texture 原样输出，不引入灯光、
 * 法线、球面贴图、toon、Fresnel 或材质高光。纹理绑定本身使用
 * `rgba8unorm-srgb`，因此这里不能再次手工做 sRGB 解码。
 */
const V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D Material Unlit Diagnostic",
  tags: ["diagnostic", "v14d", "unlit"],
  nodes: [{ id: "tex", type: "texture" }],
  links: [],
  output: { node: "tex", socket: "color" },
};

const V14D_UNLIT_MATERIAL_GROUPS = [
  {
    id: "v14d-unlit-body-skin",
    label: "V14D Unlit Skin",
    materials: ["BodySkin", "Face"],
  },
  {
    id: "v14d-unlit-white-clothes",
    label: "V14D Unlit White Clothes",
    materials: ["Cth1-Top"],
  },
  {
    id: "v14d-unlit-hair",
    label: "V14D Unlit Hair",
    materials: ["HairA", "HairB"],
    renderClass: "hair" as const,
  },
] as const;

/**
 * V14D Face State 2 静态预览图：只输出引擎已绑定的 Face diffuse 纹理
 * （该纹理由自定义 AssetReader 在 faceStatic 模式下重定向到预烘焙合成图）。
 * 与 Stage 1 unlit 同口径 —— 纯纹理采样，无灯光/法线/toon/AgX。
 */
const V14D_FACE_STATIC_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D Face Static State2",
  tags: ["diagnostic", "v14d", "face-static"],
  nodes: [{ id: "tex", type: "texture" }],
  links: [],
  output: { node: "tex", socket: "color" },
};

/**
 * V14D Face 静态 UV 调试图：只输出 Face 材质的插值 UV（R=u, G=v, B=0）。
 * 与 V14D_FACE_STATIC_GRAPH 同一条渲染管线、同一几何/相机/pick mask，
 * 只是 fragment 用 `input.uv` 替代纹理采样，供 UV-direct 逐纹素对账读取
 * 每个脸部像素在 Web 侧实际使用的 UV 坐标。仅诊断，不改变生产渲染。
 */
const V14D_FACE_UV_DEBUG_GRAPH_LEGACY: ShaderGraph = {
  version: 1,
  name: "V14D Face UV Debug",
  tags: ["diagnostic", "v14d", "face-static", "uv"],
  nodes: [{ id: "uv", type: "geometry" }],
  links: [],
  output: { node: "uv", socket: "uv" },
};

/**
 * 黄金帧几何验证图：所有材质统一输出 world_pos 归一化颜色
 * （(worldPos*0.05+0.5) 映射到可见色），用于肉眼核对相机/缩放对齐结果。
 * 只读几何节点，不采样纹理、不受材质影响。
 */
const V14D_FACE_STATIC_WORLD_POS_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D GF World Pos Debug",
  tags: ["diagnostic", "v14d", "face-static", "worldpos"],
  nodes: [{ id: "geo", type: "geometry" }],
  links: [],
  output: { node: "geo", socket: "world_pos" },
};

/**
 * 黄金帧材质验证图：所有材质统一输出 material_diffuse（无光照），
 * 用于区分「几何/相机没对齐」与「光照/材质输出为黑」。
 */
const V14D_FACE_STATIC_DIFFUSE_GRAPH: ShaderGraph = {
  version: 1,
  name: "V14D GF Diffuse Flat",
  tags: ["diagnostic", "v14d", "face-static", "diffuse"],
  nodes: [{ id: "mat", type: "material_diffuse" }],
  links: [],
  output: { node: "mat", socket: "color" },
};

type RezeStyleGroup = ReturnType<Engine["getStyleGroups"]>[number];

function buildV14dUnlitStyleGroups(
  originalGroups: readonly RezeStyleGroup[],
  modelMaterialNames: ReadonlySet<string>,
  excludeFace = false,
) {
  const targetMaterials = new Set<string>(
    V14D_UNLIT_MATERIAL_GROUPS.flatMap((group) => group.materials),
  );
  // faceStatic：Face 由 face-static 块单独套纯纹理 graph（三模式 A/B），
  // 不进入全局 unlit 分组。
  if (excludeFace) targetMaterials.delete(V14D_FACE_MATERIAL_NAME);
  const retainedGroups = originalGroups
    .map((group) => ({
      ...group,
      materials: group.materials.filter((materialName) => !targetMaterials.has(materialName)),
    }))
    .filter((group) => group.materials.length > 0);
  const appliedGroups: string[] = [];
  const unknownMaterials: string[] = [];
  const unlitGroups: RezeStyleGroup[] = [];

  for (const group of V14D_UNLIT_MATERIAL_GROUPS) {
    const matchedMaterials = group.materials.filter((materialName) => modelMaterialNames.has(materialName));
    unknownMaterials.push(...group.materials.filter((materialName) => !modelMaterialNames.has(materialName)));
    if (!matchedMaterials.length) continue;
    unlitGroups.push({
      id: group.id,
      label: group.label,
      materials: matchedMaterials,
      graph: V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH,
      ...("renderClass" in group && group.renderClass ? { renderClass: group.renderClass } : {}),
    });
    appliedGroups.push(group.id);
  }

  return {
    groups: [...retainedGroups, ...unlitGroups],
    appliedGroups,
    unknownMaterials,
  };
}

async function applyV14dUnlitStyleGroups(
  engine: Engine,
  modelMaterialNames: ReadonlySet<string>,
  originalGroups: readonly RezeStyleGroup[],
) {
  const plan = buildV14dUnlitStyleGroups(originalGroups, modelMaterialNames);
  const result = await engine.applyStyleGroups("companion", plan.groups);
  if (!result.ok) {
    const diagnostics = result.groups
      .flatMap((group) => group.diagnostics.map((diagnostic) => diagnostic.message))
      .join("; ");
    throw new Error(`V14D Unlit 诊断图编译失败：${diagnostics || "unknown error"}`);
  }
  return {
    ...plan,
    result,
  };
}

function hexToLinearVec3(hex: string): Vec3 {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean, 16);
  const channel = (shift: number) => {
    const srgb = ((value >> shift) & 0xff) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return new Vec3(channel(16), channel(8), channel(0));
}

function hexToSrgbVec3(hex: string): Vec3 {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean, 16);
  return new Vec3(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255);
}

function azElToDirection(azimuth: number, elevation: number): Vec3 {
  const azimuthRad = (azimuth * Math.PI) / 180;
  const elevationRad = (elevation * Math.PI) / 180;
  return new Vec3(
    -Math.cos(elevationRad) * Math.sin(azimuthRad),
    -Math.sin(elevationRad),
    -Math.cos(elevationRad) * Math.cos(azimuthRad),
  );
}

function stableMaterialId(index: number): string {
  return `reze:material:${index}`;
}

type RezeCameraRuntime = {
  alpha: number;
  beta: number;
  radius: number;
  target: { x: number; y: number; z: number };
  fov: number;
  getPosition: () => { x: number; y: number; z: number };
  setInputLocked: (locked: boolean) => void;
};

function readRezeCamera(engine: Engine | null): RezeCameraRuntime | null {
  const camera = (engine as unknown as { camera?: RezeCameraRuntime } | null)?.camera;
  if (
    !camera ||
    typeof camera.getPosition !== "function" ||
    typeof camera.setInputLocked !== "function" ||
    !Number.isFinite(camera.radius) ||
    !Number.isFinite(camera.alpha) ||
    !Number.isFinite(camera.beta)
  ) {
    return null;
  }
  return camera;
}

function captureRezeCameraSnapshot(engine: Engine | null): MmdCameraSnapshot | null {
  const camera = readRezeCamera(engine);
  if (!camera) return null;
  const position = camera.getPosition();
  const target = camera.target;
  const fov = Number.isFinite(camera.fov) ? (camera.fov * 180) / Math.PI : 45;
  if (
    ![position.x, position.y, position.z, target.x, target.y, target.z, fov].every(Number.isFinite)
  ) {
    return null;
  }
  return {
    fov,
    position: [position.x, position.y, position.z],
    target: [target.x, target.y, target.z],
    locked: false,
  };
}

function applyRezeCameraSnapshot(engine: Engine | null, snapshot: MmdCameraSnapshot | null): boolean {
  if (!snapshot) return false;
  const camera = readRezeCamera(engine);
  if (!camera) return false;
  const [positionX, positionY, positionZ] = snapshot.position;
  const [targetX, targetY, targetZ] = snapshot.target;
  const offsetX = positionX - targetX;
  const offsetY = positionY - targetY;
  const offsetZ = positionZ - targetZ;
  const distance = Math.hypot(offsetX, offsetY, offsetZ);
  if (!Number.isFinite(distance) || distance <= 0) return false;
  const beta = Math.acos(Math.max(-1, Math.min(1, offsetY / distance)));
  const alpha = Math.atan2(offsetX, offsetZ);
  if (!Number.isFinite(alpha) || !Number.isFinite(beta)) return false;

  engine?.setCameraTarget(new Vec3(targetX, targetY, targetZ));
  engine?.setCameraDistance(distance);
  engine?.setCameraAlpha(alpha);
  engine?.setCameraBeta(beta);
  if (Number.isFinite(snapshot.fov)) {
    camera.fov = (snapshot.fov * Math.PI) / 180;
  }
  return true;
}

function isKoledaFaceOrBodyMaterialName(materialName: string): boolean {
  const name = materialName.toLowerCase();
  return (
    name.includes("body") ||
    name.includes("face") ||
    name.includes("skin") ||
    name.includes("肌") ||
    name.includes("皮肤") ||
    name.includes("顔") ||
    name.includes("颜") ||
    name.includes("顏") ||
    name.includes("脸") ||
    name.includes("臉")
  );
}

function createEmptyV14dColorBaselineReadback(): V14dColorBaselineResult["readback"] {
  return {
    roiReadback: false,
    linearHdrReadback: false,
    finalDisplayReadback: false,
    materialMaskReadback: false,
    materialMaskSource: null,
    materialMaskSourceFormat: null,
    baseColorSource: null,
    linearHdrSource: null,
    hdrSourceFormat: null,
    maskSourceFormat: null,
    width: V14D_COLOR_BASELINE_WIDTH,
    height: V14D_COLOR_BASELINE_HEIGHT,
    rowPitch: { hdr: null, mask: null },
    nanCount: null,
    infCount: null,
  };
}

function readV14dAnimationProgress(
  model: Awaited<ReturnType<Engine["loadModel"]>> | null,
): V14dAnimationProgressEvidence | null {
  if (!model || typeof model.getAnimationProgress !== "function") return null;
  const progress = model.getAnimationProgress();
  const currentSeconds = Number(progress.current);
  const durationSeconds = Number(progress.duration);
  const percentage = Number(progress.percentage);
  if (![currentSeconds, durationSeconds, percentage].every(Number.isFinite)) return null;
  const currentFrame = currentSeconds * V14D_COLOR_BASELINE_FPS;
  return {
    animationName: progress.animationName ?? null,
    currentSeconds,
    durationSeconds,
    percentage,
    currentFrame,
    expectedFrame: V14D_COLOR_BASELINE_FRAME,
    frameError: currentFrame - V14D_COLOR_BASELINE_FRAME,
    looping: Boolean(progress.looping),
    playing: Boolean(progress.playing),
    paused: Boolean(progress.paused),
  };
}

function createV14dAnimationEvidence(
  beforeRenderFrame: V14dAnimationProgressEvidence | null,
  afterBaseColorRenderFrame: V14dAnimationProgressEvidence | null,
  afterLinearHdrRenderFrame: V14dAnimationProgressEvidence | null,
): V14dAnimationEvidence {
  const samples = [
    beforeRenderFrame,
    afterBaseColorRenderFrame,
    afterLinearHdrRenderFrame,
  ].filter((sample): sample is V14dAnimationProgressEvidence => sample !== null);
  const renderFrameStable =
    samples.length >= 2 &&
    samples.every((sample) => Math.abs(sample.frameError) <= V14D_COLOR_BASELINE_EPSILON) &&
    samples.every(
      (sample) =>
        Math.abs(sample.currentSeconds - samples[0].currentSeconds) <= V14D_COLOR_BASELINE_EPSILON,
    );
  return {
    beforeRenderFrame,
    afterBaseColorRenderFrame,
    afterLinearHdrRenderFrame,
    expectedFrame: V14D_COLOR_BASELINE_FRAME,
    fps: V14D_COLOR_BASELINE_FPS,
    renderFrameStable,
    frame120Verified:
      samples.length > 0 &&
      samples.every((sample) => Math.abs(sample.frameError) <= V14D_COLOR_BASELINE_EPSILON) &&
      samples.every((sample) => sample.paused && !sample.playing),
  };
}

export const RezeWebGpuStage = forwardRef<MMDStageHandle, RezeStageProps>(function RezeWebGpuStage(
  { modelUrl, modelIdentifier = "", localModelImport = null, interaction, backgroundEffect = "Shining Stars", grade = "中性", gradeIntensity = 1, sceneSettings, scenePreset = "reze-design", v14dUnlitDiagnostic = false, v14dColorBaseline = false, v14dFaceStatic = false, v14dFaceStaticMode = "normal", v14dFaceStaticGated = false, transparentBackground = false, cameraSnapshot = null, onReadyChange, onInteractionComplete },
  ref,
) {
  const pipelineDefaultSettings = scenePreset === "reze-k3" ? REZE_K3_SCENE_DEFAULTS : DEFAULT_SETTINGS;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<{ state: "loading" | "ready" | "error"; detail: string }>({
    state: "loading",
    detail: "正在初始化 reze-engine WebGPU…",
  });
  const engineRef = useRef<Engine | null>(null);
  const engineReadyRef = useRef(false);
  const defaultIkEnabledRef = useRef(true);
  const settingsRef = useRef<RezeSceneDebugSettings>(DEFAULT_SETTINGS);
  const cameraSnapshotRef = useRef<MmdCameraSnapshot | null>(cameraSnapshot);
  const modelRef = useRef<Awaited<ReturnType<Engine["loadModel"]>> | null>(null);
  const materialStateRef = useRef(new Map<string, { visible: boolean; preset: string }>());
  const currentVmdUrlRef = useRef("");
  const lastLoopVmdUrlRef = useRef("");
  const vmdCompletionFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vmdRequestGuardRef = useRef(createRezeVmdRequestGuard());
  const vmdIkPolicyCacheRef = useRef(new Map<string, ReturnType<typeof fetchRezeVmdIkPolicy>>());
  const v14dColorBaselineRef = useRef(v14dColorBaseline);
  const v14dFaceStaticRef = useRef(v14dFaceStatic);
  // 黄金帧组件/材质门控（Face unlit graph、暗背景等）与诊断 ROI 门控分离：
  // 画面始终按票据纵切渲染；pick/HDR 诊断只在显式诊断模式下启用，避免
  // 远景可见构图的取样口径被锁定在近景脸部 ROI 上。
  const v14dFaceStaticGatedRef = useRef(v14dFaceStaticGated);
  const baselineOriginalStyleGroupsRef = useRef<RezeStyleGroup[] | null>(null);
  const baselineResultRef = useRef<V14dColorBaselineResult | null>(null);
  const baselineCapturePromiseRef = useRef<Promise<V14dColorBaselineResult> | null>(null);
  const baselineCaptureFnRef = useRef<(() => Promise<V14dColorBaselineResult>) | null>(null);
  const baselineVmdLoadedRef = useRef(false);
  const interactionRef = useRef(interaction);
  const backgroundEffectRef = useRef<RezeBackgroundEffect>(backgroundEffect);
  const gradeRef = useRef<RezeGradePreset>(grade);
  const gradeIntensityRef = useRef(gradeIntensity);
  const transparentBackgroundRef = useRef(transparentBackground);
  const onReadyChangeRef = useRef(onReadyChange);
  const onInteractionCompleteRef = useRef(onInteractionComplete);
  interactionRef.current = interaction;
  v14dColorBaselineRef.current = v14dColorBaseline;
  v14dFaceStaticRef.current = v14dFaceStatic;
  v14dFaceStaticGatedRef.current = v14dFaceStaticGated;
  backgroundEffectRef.current = backgroundEffect;
  gradeRef.current = grade;
  gradeIntensityRef.current = gradeIntensity;
  transparentBackgroundRef.current = transparentBackground;
  cameraSnapshotRef.current = cameraSnapshot;
  onReadyChangeRef.current = onReadyChange;
  onInteractionCompleteRef.current = onInteractionComplete;

  const reportStatus = (state: "loading" | "ready" | "error", detail: string) => {
    if (canvasRef.current) {
      canvasRef.current.dataset.webgpuStatus = state;
      canvasRef.current.dataset.webgpuDetail = detail;
    }
    setRuntimeStatus({ state, detail });
    onReadyChangeRef.current?.(state === "ready", detail);
  };

  const applyKoledaDefaultAppearance = (model: Awaited<ReturnType<Engine["loadModel"]>>) => {
    // faceStatic：权威 PMX 已强门控为 Koleda，外观/形变锁定与 Koleda 判定不依赖外部
    // modelIdentifier/modelUrl（该模式下未传入 target modelUrl），强制视为 Koleda。
    const enabled =
      v14dFaceStatic || isKoledaModelIdentifier(modelIdentifier, modelUrl, localModelImport?.pmxFile?.name);
    if (!enabled) return;

    for (const [index, material] of model.getMaterials().entries()) {
      if (!isKoledaMaskMaterialName(material.name)) continue;
      engineRef.current?.setMaterialVisible("companion", material.name, false);
      materialStateRef.current.set(stableMaterialId(index), { visible: false, preset: "默认" });
    }

    const morphNames = model.getMorphing().morphs.map((morph) => morph.name);
    const closedEyeMorphs = selectKoledaClosedEyeMorphNames(morphNames);
    lockKoledaMorphWeights(model, Object.fromEntries(closedEyeMorphs.map((name) => [name, 1])));
  };

  const clearVmdCompletionFallback = () => {
    if (vmdCompletionFallbackTimerRef.current === null) return;
    globalThis.clearTimeout(vmdCompletionFallbackTimerRef.current);
    vmdCompletionFallbackTimerRef.current = null;
  };

  const readRezeVmdIkPolicy = async (url: string) => {
    let pending = vmdIkPolicyCacheRef.current.get(url);
    if (!pending) {
      pending = fetchRezeVmdIkPolicy(url);
      vmdIkPolicyCacheRef.current.set(url, pending);
    }
    try {
      return await pending;
    } catch (error) {
      vmdIkPolicyCacheRef.current.delete(url);
      console.warn("[reze-vmd] 无法读取 VMD IK 状态，保持舞台默认 IK", error);
      return {
        mode: "unavailable",
        engineIkEnabled: null,
        ikFrameCount: 0,
        footIkEntryCount: 0,
      };
    }
  };

  const applyVmdIkPolicy = (
    engine: Engine,
    policy: Awaited<ReturnType<typeof readRezeVmdIkPolicy>>,
  ) => {
    const enabled = applyRezeVmdIkPolicy(engine, policy, defaultIkEnabledRef.current);
    if (canvasRef.current) {
      canvasRef.current.dataset.vmdIkPolicy = policy.mode;
      canvasRef.current.dataset.vmdIkEnabled = String(enabled);
      canvasRef.current.dataset.vmdIkLastPolicy = policy.mode;
      canvasRef.current.dataset.vmdIkLastEnabled = String(enabled);
    }
    return enabled;
  };

  const restoreDefaultIk = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setIKEnabled(defaultIkEnabledRef.current);
    if (canvasRef.current) {
      canvasRef.current.dataset.vmdIkPolicy = "default";
      canvasRef.current.dataset.vmdIkEnabled = String(defaultIkEnabledRef.current);
    }
  };

  const handleRezeVmdFinished = (
    model: Awaited<ReturnType<Engine["loadModel"]>>,
    finishedName: string,
  ) => {
    clearVmdCompletionFallback();
    const currentName = currentVmdUrlRef.current.split("/").pop();
    if (!currentName || currentName !== finishedName) return;

    const activeInteraction = interactionRef.current;
    const loopUrls = Array.from(new Set((activeInteraction?.vmdLoopUrls || []).filter(Boolean)));
    if (loopUrls.length) {
      const finishedUrl = loopUrls.find((url) => url.split("/").pop() === finishedName) || "";
      const nextUrl =
        activeInteraction?.loopMode === "sequential"
          ? loopUrls[(Math.max(0, loopUrls.indexOf(finishedUrl)) + 1) % loopUrls.length]
          : (() => {
              const candidates = loopUrls.filter((url) => url !== finishedUrl);
              const pool = candidates.length ? candidates : loopUrls;
              return pool[Math.floor(Math.random() * pool.length)];
            })();
      if (!nextUrl) return;
      const nextName = nextUrl.split("/").pop() || "motion.vmd";
      void (async () => {
        try {
          const [policy] = await Promise.all([
            readRezeVmdIkPolicy(nextUrl),
            model.loadVmd(nextName, nextUrl),
          ]);
          if (model !== modelRef.current) return;
          const engine = engineRef.current;
          if (!engine) return;
          applyVmdIkPolicy(engine, policy);
          playRezeVmd(model, nextName, { preserveCurrentPose: true });
          currentVmdUrlRef.current = nextUrl;
          lastLoopVmdUrlRef.current = nextUrl;
          armRezeVmdCompletionFallback(model, nextName, nextUrl);
          engine.resetPhysics();
        } catch (error) {
          reportStatus("error", `循环动作切换失败：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
      return;
    }

    // 单次动作的 VMD 可能只有第 0 帧；reze-engine 对零时长剪辑不会派发
    // animationState.onEnd。无论来自引擎结束事件还是兜底计时器，都统一复原姿势
    // 并通知页面恢复待机。
    currentVmdUrlRef.current = "";
    restoreDefaultIk();
    resetRezeModelToBindPose(model);
    applyKoledaDefaultAppearance(model);
    onInteractionCompleteRef.current?.();
  };

  const armRezeVmdCompletionFallback = (
    model: Awaited<ReturnType<Engine["loadModel"]>>,
    name: string,
    url: string,
  ) => {
    clearVmdCompletionFallback();
    const durationSeconds = Math.max(0, Number(model.getAnimationProgress?.().duration) || 0);
    const delayMs = durationSeconds > 0 ? Math.ceil(durationSeconds * 1000) + 350 : 80;
    if (canvasRef.current) {
      canvasRef.current.dataset.vmdCompletionFallbackDelay = String(delayMs);
      canvasRef.current.dataset.vmdCompletionFallbackFired = "false";
    }
    vmdCompletionFallbackTimerRef.current = globalThis.setTimeout(() => {
      vmdCompletionFallbackTimerRef.current = null;
      if (canvasRef.current) canvasRef.current.dataset.vmdCompletionFallbackFired = "true";
      if (model !== modelRef.current || currentVmdUrlRef.current !== url) return;
      handleRezeVmdFinished(model, name);
    }, delayMs);
  };

  const applySceneSettings = (next: RezeSceneDebugSettings) => {
    settingsRef.current = { ...DEFAULT_SETTINGS, ...next };
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current) return { ...settingsRef.current };
    const settings = settingsRef.current;
    engine.setWorld({ color: hexToLinearVec3(settings.worldColor), strength: settings.ambientIntensity });
    engine.setSun({
      color: hexToLinearVec3(settings.sunColor),
      strength: settings.keyIntensity,
      direction: azElToDirection(settings.sunAzimuth, settings.sunElevation),
    });
    engine.setBloomOptions({
      enabled: settings.bloomStrength > 0,
      threshold: settings.bloomThreshold,
      knee: settings.bloomKnee,
      radius: settings.bloomRadius,
      intensity: settings.bloomStrength,
      color: hexToLinearVec3(settings.bloomColor),
    });
    engine.setBackgroundColor(transparentBackgroundRef.current ? null : hexToSrgbVec3(settings.backgroundColor));
    engine.setCameraTarget(new Vec3(settings.cameraTargetX, settings.cameraTargetY, settings.cameraTargetZ));
    engine.setCameraDistance(settings.cameraDistance);
    engine.addGround({
      diffuseColor: hexToLinearVec3(settings.groundColor),
      opacity: settings.groundOpacity,
      shadowStrength: settings.groundShadow ? 1 : 0,
      gridLineOpacity: settings.groundGridEnabled ? 0.4 : 0,
      gridLineColor: hexToLinearVec3(settings.groundGridColor),
      width: settings.groundSize,
      height: settings.groundSize,
      fadeStart: settings.groundSize * (10 / 160),
      fadeEnd: settings.groundSize * (80 / 160),
    });
    return { ...settings };
  };

  const applyGrade = (preset: RezeGradePreset, intensity: number) => {
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current) return null;
    const cdl = resolveRezeGrade(preset, intensity);
    engine.setColorGrading({
      shadows: hexToSrgbVec3(cdl.shadows),
      midtones: hexToSrgbVec3(cdl.midtones),
      highlights: hexToSrgbVec3(cdl.highlights),
      contrast: cdl.contrast,
      saturation: cdl.saturation,
    });
    if (canvasRef.current) {
      canvasRef.current.dataset.rezeGrade = preset;
      canvasRef.current.dataset.rezeGradeIntensity = String(intensity);
    }
    return { preset, intensity };
  };

  const restorePersistedCamera = (snapshot: MmdCameraSnapshot | null = cameraSnapshotRef.current) => {
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current || !snapshot) return null;
    if (!applyRezeCameraSnapshot(engine, snapshot)) return null;
    settingsRef.current = {
      ...settingsRef.current,
      cameraDistance: Math.hypot(
        snapshot.position[0] - snapshot.target[0],
        snapshot.position[1] - snapshot.target[1],
        snapshot.position[2] - snapshot.target[2],
      ),
      cameraTargetX: snapshot.target[0],
      cameraTargetY: snapshot.target[1],
      cameraTargetZ: snapshot.target[2],
    };
    return captureRezeCameraSnapshot(engine);
  };

  const updateV14dColorBaselineDataset = (result: V14dColorBaselineResult) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.v14dColorBaseline = "true";
    canvas.dataset.v14dColorBaselineStatus = result.status;
    canvas.dataset.v14dColorBaselineScene = result.scene.status;
    canvas.dataset.v14dColorBaselineRoiReadback = String(result.readback.roiReadback);
    canvas.dataset.v14dColorBaselineLinearHdrReadback = String(result.readback.linearHdrReadback);
    canvas.dataset.v14dColorBaselineFinalDisplayReadback = String(result.readback.finalDisplayReadback);
    canvas.dataset.v14dColorBaselineMaterialMaskReadback = String(result.readback.materialMaskReadback);
    canvas.dataset.v14dColorBaselineMaterialMaskSource = result.readback.materialMaskSource || "";
    canvas.dataset.v14dColorBaselineMaterialMaskSourceFormat = result.readback.materialMaskSourceFormat || "";
    canvas.dataset.v14dColorBaselineFirstDivergence = result.firstDivergenceLevel || result.firstDivergenceStatus;
    canvas.dataset.v14dColorBaselineVmdLoaded = String(result.input.vmdLoaded);
    canvas.dataset.v14dColorBaselineRenderLoopStopped = String(result.input.renderLoopStopped);
    canvas.dataset.v14dColorBaselineBaseColorSource = result.readback.baseColorSource || "";
    canvas.dataset.v14dColorBaselineLinearHdrSource = result.readback.linearHdrSource || "";
    canvas.dataset.v14dColorBaselineHdrSourceFormat = result.readback.hdrSourceFormat || "";
    canvas.dataset.v14dColorBaselineMaskSourceFormat = result.readback.maskSourceFormat || "";
    canvas.dataset.v14dColorBaselineNanCount =
      result.readback.nanCount === null ? "" : String(result.readback.nanCount);
    canvas.dataset.v14dColorBaselineInfCount =
      result.readback.infCount === null ? "" : String(result.readback.infCount);
    const animation = result.input.animation;
    const finalProgress = animation.afterLinearHdrRenderFrame ?? animation.beforeRenderFrame;
    canvas.dataset.v14dColorBaselineAnimationName = finalProgress?.animationName || "";
    canvas.dataset.v14dColorBaselineAnimationCurrentSeconds =
      finalProgress ? String(finalProgress.currentSeconds) : "";
    canvas.dataset.v14dColorBaselineAnimationDurationSeconds =
      finalProgress ? String(finalProgress.durationSeconds) : "";
    canvas.dataset.v14dColorBaselineAnimationCurrentFrame =
      finalProgress ? String(finalProgress.currentFrame) : "";
    canvas.dataset.v14dColorBaselineAnimationPlaying =
      finalProgress ? String(finalProgress.playing) : "";
    canvas.dataset.v14dColorBaselineAnimationPaused =
      finalProgress ? String(finalProgress.paused) : "";
    canvas.dataset.v14dColorBaselineAnimationFrame120Verified = String(animation.frame120Verified);
    canvas.dataset.v14dColorBaselineAnimationRenderFrameStable = String(animation.renderFrameStable);
  };

  const createV14dColorBaselineInput = (
    animation = createV14dAnimationEvidence(null, null, null),
  ) => ({
    width: V14D_COLOR_BASELINE_WIDTH,
    height: V14D_COLOR_BASELINE_HEIGHT,
    frame: V14D_COLOR_BASELINE_FRAME,
    fps: V14D_COLOR_BASELINE_FPS,
    seconds: V14D_COLOR_BASELINE_SECONDS,
    camera: V14D_COLOR_BASELINE_CAMERA,
    vmdUrl: interactionRef.current.vmdUrl || "",
    vmdLoaded: baselineVmdLoadedRef.current,
    renderLoopStopped: true,
    renderFrameDeltaSeconds: 0 as const,
    animation,
  });

  const captureV14dColorBaseline = (): Promise<V14dColorBaselineResult> => {
    if (!v14dColorBaselineRef.current) {
      return Promise.reject(new Error("V14D 颜色基线入口未启用，请使用 v14dColorBaseline=1。"));
    }
    const pending = baselineCapturePromiseRef.current;
    if (pending) return pending;

    const promise = (async () => {
      const engine = engineRef.current;
      const model = modelRef.current;
      const canvas = canvasRef.current;
      let input = createV14dColorBaselineInput();
      const scene = validateV14dColorBaselineScene(settingsRef.current);
      const readback = createEmptyV14dColorBaselineReadback();
      if (!engine || !model || !canvas || !engineReadyRef.current) {
        const result = createV14dColorBaselineResult({
          status: "error",
          scene,
          input,
          readback,
          error: "WebGPU 引擎或 PMX 模型尚未就绪，无法执行固定单帧颜色基线采集。",
        });
        baselineResultRef.current = result;
        updateV14dColorBaselineDataset(result);
        return result;
      }

      engine.stopRenderLoop();
      model.pause();
      let beforeRenderFrame = readV14dAnimationProgress(model);
      let afterBaseColorRenderFrame: V14dAnimationProgressEvidence | null = null;
      let afterLinearHdrRenderFrame: V14dAnimationProgressEvidence | null = null;
      input = createV14dColorBaselineInput(
        createV14dAnimationEvidence(beforeRenderFrame, null, null),
      );

      const originalGroups =
        baselineOriginalStyleGroupsRef.current ?? engine.getStyleGroups("companion");
      baselineOriginalStyleGroupsRef.current = originalGroups.map((group) => ({
        ...group,
        materials: [...group.materials],
      }));
      const restoreGroups = baselineOriginalStyleGroupsRef.current;
      let styleGroupsRestored = false;
      let baseResolve: Awaited<ReturnType<typeof readV14dColorBaselineResolveTargets>> | null = null;
      let linearResolve: Awaited<ReturnType<typeof readV14dColorBaselineResolveTargets>> | null = null;
      let materialMask: Awaited<ReturnType<typeof readV14dColorBaselineMaterialMask>> | null = null;
      let finalDisplay: V14dNormalizedImage | null = null;

      const restoreProductionStyleGroups = async () => {
        const restored = await engine.applyStyleGroups("companion", restoreGroups);
        if (!restored.ok) {
          const diagnostics = restored.groups
            .flatMap((group) => group.diagnostics.map((diagnostic) => diagnostic.message))
            .join("; ");
          throw new Error(`恢复生产材质组失败：${diagnostics || "unknown error"}`);
        }
        styleGroupsRestored = true;
      };

      try {
        const modelMaterialNames = new Set(model.getMaterials().map((material) => material.name));
        let nextMaterialId = 1;
        const materialIdByName: Record<string, number> = {};
        for (const material of model.getMaterials()) {
          if (material.vertexCount === 0) continue;
          materialIdByName[material.name] = nextMaterialId;
          nextMaterialId += 1;
        }
        const unlit = await applyV14dUnlitStyleGroups(engine, modelMaterialNames, restoreGroups);
        if (canvasRef.current) {
          canvasRef.current.dataset.v14dUnlitDiagnostic = "true";
          canvasRef.current.dataset.v14dUnlitGraph = V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH.name;
          canvasRef.current.dataset.v14dUnlitGroups = unlit.appliedGroups.join(",");
          canvasRef.current.dataset.v14dUnlitUnknownMaterials = unlit.unknownMaterials.join(",");
        }

        // BaseColor 只来自 texture-only Unlit 组；这里禁止把生产材质组的 HDR
        // 读回同时当作 BaseColor，两个阶段必须各自 render + readback。
        engine.stopRenderLoop();
        model.pause();
        engine.renderFrame(0);
        afterBaseColorRenderFrame = readV14dAnimationProgress(model);
        input = createV14dColorBaselineInput(
          createV14dAnimationEvidence(beforeRenderFrame, afterBaseColorRenderFrame, null),
        );
        baseResolve = await readV14dColorBaselineResolveTargets(
          engine,
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
        );
        materialMask = await readV14dColorBaselineMaterialMask(
          engine,
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
        );

        await restoreProductionStyleGroups();
        engine.stopRenderLoop();
        model.pause();
        engine.renderFrame(0);
        afterLinearHdrRenderFrame = readV14dAnimationProgress(model);
        input = createV14dColorBaselineInput(
          createV14dAnimationEvidence(
            beforeRenderFrame,
            afterBaseColorRenderFrame,
            afterLinearHdrRenderFrame,
          ),
        );
        linearResolve = await readV14dColorBaselineResolveTargets(
          engine,
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
        );
        finalDisplay = await readV14dCanvasDisplay(canvas);

        const baseColorImage = baseResolve ? makeV14dLinearImage(
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
          baseResolve.hdr.data,
        ) : null;
        const linearHdrImage = linearResolve ? makeV14dLinearImage(
          V14D_COLOR_BASELINE_WIDTH,
          V14D_COLOR_BASELINE_HEIGHT,
          linearResolve.hdr.data,
        ) : null;
        const analysis = analyzeV14dColorBaselineRois({
          readback: {
            baseColor: baseColorImage,
            linearHdr: linearHdrImage,
            finalDisplay,
            // Geometry and camera are unchanged between the two passes; use the
            // production pass mask plus the diagnostic material/depth mask as the
            // authoritative background exclusion.
            mask: linearResolve?.mask.data ?? baseResolve?.mask.data ?? null,
            materialMask: materialMask?.data ?? null,
          },
          materialIdByName,
          scene,
        });
        const hasReadyRoi = V14D_COLOR_BASELINE_ROIS.some((roi) => roi.calibrationStatus === "ready");
        const allRoiLevelsMeasured =
          hasReadyRoi &&
          analysis.rois.length > 0 &&
          analysis.rois.every((roi) =>
            (["baseColor", "linearHdr", "finalDisplay"] as const).every(
              (level) => roi.levels[level].status === "measured",
            ),
          );
        const resultReadback: V14dColorBaselineResult["readback"] = {
          roiReadback: hasReadyRoi && Boolean(baseResolve && linearResolve && materialMask),
          linearHdrReadback: Boolean(linearResolve),
          finalDisplayReadback: Boolean(finalDisplay),
          materialMaskReadback: Boolean(materialMask),
          materialMaskSource: materialMask ? "engine-pick-material-id-depth" : null,
          materialMaskSourceFormat: materialMask?.sourceFormat ?? null,
          baseColorSource: baseResolve ? "v14d-unlit-texture-only" : null,
          linearHdrSource: linearResolve ? "production-style-groups" : null,
          hdrSourceFormat: linearResolve?.hdr.sourceFormat ?? baseResolve?.hdr.sourceFormat ?? null,
          maskSourceFormat: linearResolve?.mask.sourceFormat ?? baseResolve?.mask.sourceFormat ?? null,
          width: V14D_COLOR_BASELINE_WIDTH,
          height: V14D_COLOR_BASELINE_HEIGHT,
          rowPitch: {
            hdr: linearResolve?.hdr.rowPitch ?? baseResolve?.hdr.rowPitch ?? null,
            mask: linearResolve?.mask.rowPitch ?? baseResolve?.mask.rowPitch ?? null,
          },
          nanCount: linearResolve?.hdr.nanCount ?? baseResolve?.hdr.nanCount ?? null,
          infCount: linearResolve?.hdr.infCount ?? baseResolve?.hdr.infCount ?? null,
        };
        const result = createV14dColorBaselineResult({
          status:
            scene.valid &&
            input.vmdLoaded &&
            resultReadback.roiReadback &&
            resultReadback.linearHdrReadback &&
            resultReadback.finalDisplayReadback &&
            allRoiLevelsMeasured
              ? "ready"
              : "invalid",
          scene,
          input,
          readback: resultReadback,
          rois: analysis.rois,
          firstDivergenceStatus: analysis.firstDivergence.status,
          firstDivergenceLevel: analysis.firstDivergence.level,
          firstDivergenceReason: analysis.firstDivergence.reason,
        });
        // 临时根因取证：记录 Web unlit BaseColor 每 ROI 实际均值。
        (result as Record<string, unknown>).__webBaseColorActualMeans =
          measureV14dRoiActualMeans({
            image: baseColorImage,
            mask: linearResolve?.mask.data ?? baseResolve?.mask.data ?? null,
            materialMask: materialMask?.data ?? null,
            materialIdByName,
          });
        baselineResultRef.current = result;
        updateV14dColorBaselineDataset(result);
        return result;
      } catch (error) {
        const resultReadback: V14dColorBaselineResult["readback"] = {
          roiReadback: Boolean(baseResolve && linearResolve && materialMask && V14D_COLOR_BASELINE_ROIS.some((roi) => roi.calibrationStatus === "ready")),
          linearHdrReadback: Boolean(linearResolve),
          finalDisplayReadback: Boolean(finalDisplay),
          materialMaskReadback: Boolean(materialMask),
          materialMaskSource: materialMask ? "engine-pick-material-id-depth" : null,
          materialMaskSourceFormat: materialMask?.sourceFormat ?? null,
          baseColorSource: baseResolve ? "v14d-unlit-texture-only" : null,
          linearHdrSource: linearResolve ? "production-style-groups" : null,
          hdrSourceFormat: linearResolve?.hdr.sourceFormat ?? baseResolve?.hdr.sourceFormat ?? null,
          maskSourceFormat: linearResolve?.mask.sourceFormat ?? baseResolve?.mask.sourceFormat ?? null,
          width: V14D_COLOR_BASELINE_WIDTH,
          height: V14D_COLOR_BASELINE_HEIGHT,
          rowPitch: {
            hdr: linearResolve?.hdr.rowPitch ?? baseResolve?.hdr.rowPitch ?? null,
            mask: linearResolve?.mask.rowPitch ?? baseResolve?.mask.rowPitch ?? null,
          },
          nanCount: linearResolve?.hdr.nanCount ?? baseResolve?.hdr.nanCount ?? null,
          infCount: linearResolve?.hdr.infCount ?? baseResolve?.hdr.infCount ?? null,
        };
        const result = createV14dColorBaselineResult({
          status: "error",
          scene,
          input,
          readback: resultReadback,
          error: error instanceof Error ? error.message : String(error),
        });
        baselineResultRef.current = result;
        updateV14dColorBaselineDataset(result);
        return result;
      } finally {
        if (!styleGroupsRestored) {
          try {
            await restoreProductionStyleGroups();
            engine.stopRenderLoop();
            model.pause();
            engine.renderFrame(0);
          } catch (restoreError) {
            console.error("[v14d-color-baseline] 恢复生产材质组失败", restoreError);
          }
        }
      }
    })();
    baselineCapturePromiseRef.current = promise;
    void promise.then(
      () => {
        if (baselineCapturePromiseRef.current === promise) baselineCapturePromiseRef.current = null;
      },
      () => {
        if (baselineCapturePromiseRef.current === promise) baselineCapturePromiseRef.current = null;
      },
    );
    return promise;
  };
  baselineCaptureFnRef.current = captureV14dColorBaseline;

  /**
   * V14D Face State 2 静态预览采集：固定单帧（frame120）后，用 Face 材质 ID
   * pick mask + 模型覆盖 alpha + 深度前景隔离脸部 ROI，返回显示 sRGB/线性均值。
   * 只读消费渲染结果，不写回动画 Runtime；生产路径不创建 pick 资源。
   */
  const captureV14dFaceStatic = async (): Promise<V14dFaceStaticCapture> => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    const model = modelRef.current;
    const mode = v14dFaceStaticMode;
    const texture = v14dFaceStaticTextureName(mode);
    const base: V14dFaceStaticCapture = {
      mode,
      frame: V14D_FACE_STATIC_FRAME,
      state: V14D_FACE_STATIC_STATE,
      blend: V14D_FACE_STATIC_BLEND,
      cameraLocked: true,
      paused: true,
      texture,
      width: V14D_FACE_STATIC_SIZE,
      height: V14D_FACE_STATIC_SIZE,
      faceMaterialId: null,
      faceMaterialName: V14D_FACE_MATERIAL_NAME,
      authorityOk: false,
      roi: { px: [0, 0, 0, 0], samples: 0, faceSamples: 0 },
      meanSrgb: null,
      meanLinear: null,
    };
    if (!canvas || !engine || !model || !v14dFaceStaticRef.current || !v14dFaceStaticGatedRef.current) {
      return { ...base, error: "V14D Face Static 未启用或引擎未就绪。" };
    }
    try {
      // Face pick ID 从材质名映射推导（不硬编码）：引擎 pick mask 只统计
      // vertexCount>0 的材质，1-based，0=无命中。
      const faceMaterialId = v14dFaceStaticFacePickId(
        model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
      );
      if (faceMaterialId === null) {
        return { ...base, error: `未在 PMX 材质中找到权威 Face 材质（${V14D_FACE_MATERIAL_NAME}）。` };
      }
      base.faceMaterialId = faceMaterialId;
      base.authorityOk = true;
      const materialMask = await readV14dColorBaselineMaterialMask(engine, V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      const display = await readV14dCanvasDisplay(canvas);
      const [rx, ry, rw, rh] = V14D_FACE_STATIC_ROI_NORM;
      const x0 = Math.floor(rx * V14D_FACE_STATIC_SIZE);
      const y0 = Math.floor(ry * V14D_FACE_STATIC_SIZE);
      const x1 = Math.min(V14D_FACE_STATIC_SIZE - 1, Math.ceil((rx + rw) * V14D_FACE_STATIC_SIZE) - 1);
      const y1 = Math.min(V14D_FACE_STATIC_SIZE - 1, Math.ceil((ry + rh) * V14D_FACE_STATIC_SIZE) - 1);
      let samples = 0;
      let faceSamples = 0;
      const srgbSum = [0, 0, 0];
      const linearSum = [0, 0, 0];
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          samples += 1;
          const off = (y * V14D_FACE_STATIC_SIZE + x) * 4;
          const modelId = materialMask.data[off];
          const matId = materialMask.data[off + 1];
          if (modelId === 0 || matId !== faceMaterialId) continue;
          faceSamples += 1;
          const r = display.data[off];
          const g = display.data[off + 1];
          const b = display.data[off + 2];
          srgbSum[0] += r; srgbSum[1] += g; srgbSum[2] += b;
          linearSum[0] += srgbToLinear(r); linearSum[1] += srgbToLinear(g); linearSum[2] += srgbToLinear(b);
        }
      }
      if (faceSamples > 0) {
        base.meanSrgb = [srgbSum[0] / faceSamples, srgbSum[1] / faceSamples, srgbSum[2] / faceSamples];
        base.meanLinear = [linearSum[0] / faceSamples, linearSum[1] / faceSamples, linearSum[2] / faceSamples];
      }
      base.roi = { px: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], samples, faceSamples };
      return base;
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    }
  };

  /** 导出脸部像素 mask（PNG base64）：Face 材质命中像素=白，其余=黑。
   *  供同口径分量 Gate 在 Blender 参考图上复用同一脸部像素定义量化。 */
  const exportV14dFaceMaskPng = async (): Promise<string | null> => {
    const engine = engineRef.current;
    const model = modelRef.current;
    if (!engine || !model || !v14dFaceStaticRef.current || !v14dFaceStaticGatedRef.current) return null;
    try {
      const faceMaterialId = v14dFaceStaticFacePickId(
        model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
      );
      if (faceMaterialId === null) return null;
      const materialMask = await readV14dColorBaselineMaterialMask(engine, V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      const c = document.createElement("canvas");
      c.width = V14D_FACE_STATIC_SIZE; c.height = V14D_FACE_STATIC_SIZE;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const img = ctx.createImageData(V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      for (let i = 0; i < V14D_FACE_STATIC_SIZE * V14D_FACE_STATIC_SIZE; i += 1) {
        const off = i * 4;
        const isFace = materialMask.data[off] !== 0 && materialMask.data[off + 1] === faceMaterialId;
        const v = isFace ? 255 : 0;
        img.data[off] = v; img.data[off + 1] = v; img.data[off + 2] = v; img.data[off + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL("image/png").split(",")[1] ?? null;
    } catch {
      return null;
    }
  };

  /**
   * 导出 Face 材质逐像素插值 UV（R=u, G=v, B=0）的 PNG base64。
   * 与 exportV14dFaceMaskPng 用同一 Face pick mask 隔离脸部像素；
   * 仅在 faceStatic 模式且 Face 已切到 V14D_FACE_UV_DEBUG_GRAPH 时有意义。
   * 供 UV-direct 对账读取 Web 侧每个脸部像素实际使用的 UV 坐标。
   */
  /**
   * 共享辅助：取 Face 材质 pick ID + pre-tonemap HDR resolve + 逐像素 Face mask。
   * 两个导出函数（UV / HDR 浮点）复用，避免重复 Face ID、resolve/mask 与 mask 构造。
   * pre-tonemap：源纹理 hdrResolveTexture（格式随硬件 rg11b10ufloat/rgba16float，
   * 诊断链 blit 到 rgba16float 读回），未过 composite 的 bloom/exposure/tonemap/grade/gamma。
   */
  const readV14dFaceResolveAndMask = async (): Promise<{
    faceMaterialId: number;
    hdr: Float32Array;
    faceMask: Uint8Array;
    size: number;
  } | null> => {
    const engine = engineRef.current;
    const model = modelRef.current;
    if (!engine || !model || !v14dFaceStaticRef.current || !v14dFaceStaticGatedRef.current) return null;
    try {
      const faceMaterialId = v14dFaceStaticFacePickId(
        model.getMaterials().map((m) => ({ name: m.name, vertexCount: m.vertexCount })),
      );
      if (faceMaterialId === null) return null;
      const resolve = await readV14dColorBaselineResolveTargets(engine, V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      const materialMask = await readV14dColorBaselineMaterialMask(engine, V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      const size = V14D_FACE_STATIC_SIZE;
      const faceMaskArr = new Uint8Array(size * size);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        faceMaskArr[i] = materialMask.data[off] !== 0 && materialMask.data[off + 1] === faceMaterialId ? 1 : 0;
      }
      return { faceMaterialId, hdr: resolve.hdr.data, faceMask: faceMaskArr, size };
    } catch {
      return null;
    }
  };

  const exportV14dFaceUvPng = async (): Promise<{
    png: string;
    width: number;
    height: number;
    faceMaterialId: number;
    /** 逐像素原始插值 UV（Float32，pre-tonemap HDR readback，非最终 canvas 显示色）。 */
    uv: Float32Array;
    /** 逐像素是否命中 Face 材质（同一 Face pick mask）。 */
    faceMask: Uint8Array;
  } | null> => {
    try {
      // 关键修复：uvDebug 的 Face fragment 输出 vec3f(input.uv, 0.0)，在场景 HDR pass
      // 写入 pre-tonemap 的 hdrResolveTexture。必须从该 HDR resolve 做 GPU readback，
      // 读取的 R/G 才是原始插值 UV。旧实现从最终 canvas（readV14dCanvasDisplay）反推，
      // 已被 composite 的 bloom/exposure/Filmic LUT/color grading/gamma 污染，不是原始 UV。
      const fr = await readV14dFaceResolveAndMask();
      if (!fr) return null;
      const { faceMaterialId, hdr, faceMask: faceMaskArr, size } = fr;
      const uv = new Float32Array(size * size * 2);
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const img = ctx.createImageData(size, size);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        const isFace = faceMaskArr[i] === 1;
        // HDR readback 的 R=u, G=v（vec3f(input.uv, 0.0)），保持浮点精度。
        const u = isFace ? hdr[off] : 0;
        const v = isFace ? hdr[off + 1] : 0;
        uv[i * 2] = u;
        uv[i * 2 + 1] = v;
        // PNG 仅供人眼检查（8-bit 量化），精确值用 uv Float32Array。
        img.data[off] = Math.round(Math.max(0, Math.min(255, u * 255)));
        img.data[off + 1] = Math.round(Math.max(0, Math.min(255, v * 255)));
        img.data[off + 2] = 0;
        img.data[off + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const png = c.toDataURL("image/png").split(",")[1] ?? null;
      if (!png) return null;
      return { png, width: size, height: size, faceMaterialId, uv, faceMask: faceMaskArr };
    } catch {
      return null;
    }
  };

  /**
   * 导出当前 faceStatic 模式 Face 材质的 pre-tonemap HDR 线性 RGB（逐像素浮点）。
   * 从 hdrResolveTexture（场景 pass 输出，源格式随硬件为 rg11b10ufloat/rgba16float，
   * 诊断链 blit 到 rgba16float 读回目标；未过 composite 的
   * bloom/exposure/Filmic LUT/color grading/gamma）GPU readback。
   * 与 uvDebug 用同一 Face pick mask；供 UV-direct Gate 用「同一线性口径」对账，
   * 避免拿 tonemap 后的最终 canvas 对比未 tonemap 的 baker 参考（口径不一致）。
   */
  const exportV14dFaceHdrFloat = async (): Promise<{
    width: number;
    height: number;
    faceMaterialId: number;
    rgb: Float32Array;
    faceMask: Uint8Array;
  } | null> => {
    try {
      const fr = await readV14dFaceResolveAndMask();
      if (!fr) return null;
      const { faceMaterialId, hdr, faceMask: faceMaskArr, size } = fr;
      const rgb = new Float32Array(size * size * 3);
      for (let i = 0; i < size * size; i += 1) {
        const off = i * 4;
        if (faceMaskArr[i] === 1) {
          rgb[i * 3] = hdr[off];
          rgb[i * 3 + 1] = hdr[off + 1];
          rgb[i * 3 + 2] = hdr[off + 2];
        }
      }
      return { width: size, height: size, faceMaterialId, rgb, faceMask: faceMaskArr };
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!v14dFaceStatic) return;
    window.__v14dFaceStatic = {
      capture: () => captureV14dFaceStatic(),
      exportFaceMaskPng: () => exportV14dFaceMaskPng(),
      exportFaceUvPng: () => exportV14dFaceUvPng(),
      exportFaceHdrFloat: () => exportV14dFaceHdrFloat(),
    };
    return () => {
      if (window.__v14dFaceStatic) delete window.__v14dFaceStatic;
    };
    // captureV14dFaceStatic 读取最新 ref/mode，稳定引用即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v14dFaceStatic]);

  useImperativeHandle(ref, () => ({
    unlockCamera: () => {
      readRezeCamera(engineRef.current)?.setInputLocked(false);
      return captureRezeCameraSnapshot(engineRef.current);
    },
    lockCamera: () => {
      readRezeCamera(engineRef.current)?.setInputLocked(true);
      return captureRezeCameraSnapshot(engineRef.current);
    },
    captureCamera: () => captureRezeCameraSnapshot(engineRef.current),
    resetCamera: () => {
      applySceneSettings(DEFAULT_SETTINGS);
      return captureRezeCameraSnapshot(engineRef.current);
    },
    adjustCameraDistance: (delta) => {
      const engine = engineRef.current;
      const currentDistance = readRezeCamera(engine)?.radius ?? settingsRef.current.cameraDistance;
      const cameraDistance = Math.max(3.5, Math.min(40, currentDistance + delta));
      if (engine && engineReadyRef.current) {
        engine.setCameraDistance(cameraDistance);
      }
      settingsRef.current = { ...settingsRef.current, cameraDistance };
      return cameraDistance;
    },
    hitTestCharacterAtClientPoint: (clientX, clientY) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return Boolean(
        rect &&
          canvasRef.current?.dataset.webgpuStatus === "ready" &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom,
      );
    },
    getStageRect: () => canvasRef.current?.getBoundingClientRect() ?? null,
    setSpeechLevel: () => undefined,
    setSpeechViseme: () => undefined,
    getRendererLabel: () => "reze-engine WebGPU",
    getMaterialDebugEntries: () => {
      const model = modelRef.current;
      if (!model) return [];
      return model.getMaterials().map((material, index) => {
        const id = stableMaterialId(index);
        const state = materialStateRef.current.get(id) ?? { visible: true, preset: "默认" };
        return {
          id,
          name: material.name || `材质 ${index + 1}`,
          meshName: "PMX / WebGPU",
          preset: state.preset,
          visible: state.visible,
          opacity: 1,
          emissiveIntensity: 0,
          supportsOpacity: false,
          supportsEmissive: false,
        };
      });
    },
    updateMaterialDebug: (id, patch) => {
      const engine = engineRef.current;
      const model = modelRef.current;
      if (!engine || !model) return null;
      const index = Number(id.split(":").at(-1));
      const material = model.getMaterials()[index];
      if (!material) return null;
      const current = materialStateRef.current.get(id) ?? { visible: true, preset: "默认" };
      const visible = typeof patch.visible === "boolean" ? patch.visible : current.visible;
      engine.setMaterialVisible("companion", material.name, visible);
      materialStateRef.current.set(id, { ...current, visible });
      return { id, visible, opacity: 1, emissiveIntensity: 0 };
    },
    resetMaterialDebug: (id) => {
      const engine = engineRef.current;
      const model = modelRef.current;
      if (!engine || !model) return null;
      const index = Number(id.split(":").at(-1));
      const material = model.getMaterials()[index];
      if (!material) return null;
      engine.setMaterialVisible("companion", material.name, true);
      materialStateRef.current.set(id, { visible: true, preset: "默认" });
      return { id, visible: true, opacity: 1, emissiveIntensity: 0 };
    },
    setMaterialPreset: (id, preset) => {
      const engine = engineRef.current;
      const model = modelRef.current;
      const graph = MATERIAL_GRAPHS[preset];
      if (!engine || !model || !graph) return null;
      const index = Number(id.split(":").at(-1));
      const material = model.getMaterials()[index];
      if (!material) return null;
      const current = materialStateRef.current.get(id) ?? { visible: true, preset: "默认" };
      void engine.upsertStyleGroup("companion", {
        id: `reze-debug-${index}`,
        label: material.name || `材质 ${index + 1}`,
        materials: [material.name],
        graph,
        ...(preset === "眼睛" ? { renderClass: "eye" as const } : {}),
        ...(preset === "头发" ? { renderClass: "hair" as const } : {}),
      });
      materialStateRef.current.set(id, { ...current, preset });
      return { id, preset };
    },
    captureStagePng: () => canvasRef.current?.toDataURL("image/png") ?? null,
    setSceneDebugSettings: (settings) => applySceneSettings(settings as RezeSceneDebugSettings),
    resetSceneDebugSettings: () => applySceneSettings(DEFAULT_SETTINGS),
    captureColorBaseline: () =>
      baselineCaptureFnRef.current?.() ??
      Promise.reject(new Error("V14D 颜色基线采集接口尚未初始化。")),
    getColorBaselineResult: () => baselineResultRef.current,
  }), []);

  useEffect(() => {
    if (!v14dColorBaseline) return;
    const api = {
      capture: () =>
        baselineCaptureFnRef.current?.() ??
        Promise.reject(new Error("V14D 颜色基线采集接口尚未初始化。")),
      getResult: () => baselineResultRef.current,
    };
    window.__v14dColorBaseline = api;
    return () => {
      if (window.__v14dColorBaseline === api) delete window.__v14dColorBaseline;
    };
  }, [v14dColorBaseline]);

  useEffect(() => {
    const canvas = canvasRef.current;
    // faceStatic：资产经注入（File）提供，不依赖 modelUrl，故空 modelUrl 也要启动 boot。
    if (!canvas || (!modelUrl && !v14dFaceStatic)) return;
    let disposed = false;
    const initialSettings = sceneSettings ?? pipelineDefaultSettings;
    // faceStatic 黄金帧：复用 reze-k3 白光场景（票据确认口径），但按权威 blend
    // 改为暗背景、无地面（blend 无地面网格）、bloom 关闭；相机随后由
    // V14D_FACE_STATIC_CAMERA 覆盖（不受 settings 里的 cameraTarget/Distance 影响）。
    const effectiveInitialSettings =
      v14dColorBaseline || v14dFaceStatic ? REZE_K3_SCENE_DEFAULTS : initialSettings;
    const boot = async () => {
      reportStatus("loading", "正在初始化 reze-engine WebGPU…");
      if (!("gpu" in navigator)) throw new Error("当前浏览器不支持 WebGPU，请改用 Reze NPR（WebGL）模式。");
      settingsRef.current = { ...DEFAULT_SETTINGS, ...effectiveInitialSettings };
      engineReadyRef.current = false;
      const engine = new Engine(canvas, {
        background: transparentBackgroundRef.current ? null : hexToSrgbVec3(effectiveInitialSettings.backgroundColor),
        camera: {
          distance: effectiveInitialSettings.cameraDistance,
          target: new Vec3(effectiveInitialSettings.cameraTargetX, effectiveInitialSettings.cameraTargetY, effectiveInitialSettings.cameraTargetZ),
        },
        world: { color: hexToLinearVec3(effectiveInitialSettings.worldColor), strength: effectiveInitialSettings.ambientIntensity },
        sun: {
          color: hexToLinearVec3(effectiveInitialSettings.sunColor),
          strength: effectiveInitialSettings.keyIntensity,
          direction: azElToDirection(effectiveInitialSettings.sunAzimuth, effectiveInitialSettings.sunElevation),
        },
        bloom: {
          enabled: effectiveInitialSettings.bloomStrength > 0,
          threshold: effectiveInitialSettings.bloomThreshold,
          knee: effectiveInitialSettings.bloomKnee,
          radius: effectiveInitialSettings.bloomRadius,
          intensity: effectiveInitialSettings.bloomStrength,
          color: hexToLinearVec3(effectiveInitialSettings.bloomColor),
        },
        // 仅为颜色基线诊断启用引擎已有的材质 pick 资源；生产路径不创建
        // pick draw call，也不改变生产材质 shader 或灯光行为。
        onRaycast: v14dColorBaseline || v14dFaceStatic ? () => undefined : undefined,
      });
      engineRef.current = engine;
      await engine.init();
      if (disposed) return;
      engineReadyRef.current = true;
      if (v14dFaceStatic) {
        engine.setRenderSize(V14D_FACE_STATIC_SIZE, V14D_FACE_STATIC_SIZE);
      } else if (v14dColorBaseline) {
        engine.setRenderSize(V14D_COLOR_BASELINE_WIDTH, V14D_COLOR_BASELINE_HEIGHT);
      }
      defaultIkEnabledRef.current = engine.getIKEnabled?.() ?? true;
      const initialBackgroundEffect = await engine.setBackgroundEffect(
        v14dColorBaseline || v14dFaceStatic || backgroundEffectRef.current === "关闭" || backgroundEffectRef.current !== "Shining Stars"
          ? null
          : REZE_SHINING_STARS_WGSL,
      );
      if (!initialBackgroundEffect.ok) throw new Error(`Shining Stars 背景编译失败：${initialBackgroundEffect.diagnostics.join("; ")}`);
      let model: Awaited<ReturnType<Engine["loadModel"]>>;
      if (v14dFaceStatic) {
        // V14D Face State 2 静态预览：权威 PMX/纹理/VMD 与派生纹理以 File 注入，
        // 引擎 files 变体用 createFileMapAssetReader 完全局部解析（无网络、无 404、
        // 不全局包装 window.fetch）。仓库不捆绑第三方资产（README 资产政策）。
        // 强门控：pmxFile 必须是权威 Koleda PMX，否则抛错不静默回退。
        // 资产由 addInitScript/用户注入，可能晚于 boot；轮询等待其就绪（有界 30s）。
        let assets = window.__v14dFaceStaticAssets;
        const waitStart = Date.now();
        while (!assets && Date.now() - waitStart < 30000) {
          await new Promise((r) => setTimeout(r, 100));
          if (disposed) return;
          assets = window.__v14dFaceStaticAssets;
        }
        if (!assets) {
          throw new Error(
            "v14dFaceStatic 需要权威资产集（window.__v14dFaceStaticAssets）：由采集脚本注入或用户 folder 选择提供。",
          );
        }
        if (assets.pmxFile.name !== V14D_FACE_STATIC_AUTHORITY.pmxFileName) {
          throw new Error(
            `v14dFaceStatic 仅支持权威 Koleda PMX（${V14D_FACE_STATIC_AUTHORITY.pmxFileName}），收到 ${assets.pmxFile.name}`,
          );
        }
        // 派生/原始 Face diffuse：按当前模式选纹理（faceTextures 优先，否则单一 faceOverride），
        // 覆盖 face_d 逻辑键后并入模型文件列表。
        // uvDebug 模式不需要纹理（Face 只输出 UV），用原始 face_d 占位即可。
        const isUvDebug = v14dFaceStaticMode === "uvDebug";
        const faceOverride = isUvDebug
          ? assets.faceTextures?.normal ?? assets.faceOverride ?? null
          : (assets.faceTextures?.[v14dFaceStaticMode] ?? assets.faceOverride ?? null);
        const isBaked = v14dFaceStaticMode === "bakedGolden";
        const bakedFiles = isBaked && assets.bakedTextures
          ? (Object.values(assets.bakedTextures) as File[])
          : [];
        const modelFiles = [
          ...assets.modelFiles,
          ...(faceOverride ? [faceOverride] : []),
          ...bakedFiles,
        ];
        model = await engine.loadModel("companion", {
          files: modelFiles,
          pmxFile: assets.pmxFile,
        });
        if (canvasRef.current) {
          canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.texture] =
            isUvDebug ? "uv-debug" : v14dFaceStaticTextureName(v14dFaceStaticMode);
        }
      } else if (localModelImport) {
        model = await engine.loadModel("companion", { files: localModelImport.files, pmxFile: localModelImport.pmxFile });
      } else {
        model = await engine.loadModel("companion", modelUrl);
      }
      if (disposed) return;
      modelRef.current = model;
      applyKoledaDefaultAppearance(model);
      setRezeVmdCompletionHandler(model, (finishedName: string) => handleRezeVmdFinished(model, finishedName));
      // faceStatic：权威 PMX 已强门控为 Koleda，材质预设/分组不依赖外部 modelIdentifier/modelUrl。
      const isKoleda =
        v14dFaceStatic || isKoledaModelIdentifier(modelIdentifier, modelUrl, localModelImport?.pmxFile?.name);
      const koledaFaceAndBodyMaterials = isKoleda
        ? model.getMaterials().map((material) => material.name).filter(isKoledaFaceOrBodyMaterialName)
        : [];
      await engine.autoStyleGroups(
        "companion",
        koledaFaceAndBodyMaterials.length ? { cloth_smooth: koledaFaceAndBodyMaterials } : undefined,
      );
      const originalStyleGroups = engine.getStyleGroups("companion");
      baselineOriginalStyleGroupsRef.current = originalStyleGroups.map((group) => ({
        ...group,
        materials: [...group.materials],
      }));
      if (v14dUnlitDiagnostic) {
        const modelMaterialNames = new Set(model.getMaterials().map((material) => material.name));
        const unlitPlan = buildV14dUnlitStyleGroups(originalStyleGroups, modelMaterialNames, v14dFaceStatic);
        if (canvasRef.current) {
          canvasRef.current.dataset.v14dUnlitDiagnostic = "true";
          canvasRef.current.dataset.v14dUnlitGraph = V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH.name;
          canvasRef.current.dataset.v14dUnlitGroups = unlitPlan.appliedGroups.join(",");
          canvasRef.current.dataset.v14dUnlitUnknownMaterials = unlitPlan.unknownMaterials.join(",");
        }
        if (!v14dColorBaseline) {
          const unlit = await applyV14dUnlitStyleGroups(engine, modelMaterialNames, originalStyleGroups);
          if (canvasRef.current) {
            canvasRef.current.dataset.v14dUnlitGroups = unlit.appliedGroups.join(",");
            canvasRef.current.dataset.v14dUnlitUnknownMaterials = unlit.unknownMaterials.join(",");
          }
        }
      }
      if (v14dFaceStatic) {
        // worldPos 模式：所有材质统一输出 world_pos 颜色，验证相机/缩放几何。
        if (v14dFaceStaticMode === "worldPos" || v14dFaceStaticMode === "diffuseFlat") {
          const allNames = model.getMaterials().map((m) => m.name);
          const worldPosResult = await engine.applyStyleGroups("companion", [
            {
              id: "v14d-gf-world-pos",
              label: "V14D GF World Pos Debug",
              materials: allNames,
              graph: v14dFaceStaticMode === "worldPos" ? V14D_FACE_STATIC_WORLD_POS_GRAPH : V14D_FACE_STATIC_DIFFUSE_GRAPH,
            },
          ]);
          if (canvasRef.current) {
            canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.faceMaterialApplied] = String(worldPosResult.ok);
          }
        }
        // 三个模式（normal/faceShadowOnly/finalFaceComposite）都只把 Face 材质切到
        // 纯纹理 unlit graph，仅纹理不同（原始 face_d / 衰减图 / 合成图），
        // 保证「只有 Face 纹理变化」的严格 A/B；其余材质保持 reze-k3 正常分组，
        // 不套全局 unlit。Face 不再随 v14dUnlitDiagnostic 的全局 graph 走。
        // uvDebug 模式只输出 Face 的插值 UV（几何节点），供 UV-direct 对账。
        if (v14dFaceStaticMode !== "worldPos" && v14dFaceStaticMode !== "diffuseFlat") {
        if (v14dFaceStaticMode === "bakedGolden") {
          // 黄金帧烘焙模式：把全部烘焙材质（Face/HairA/HairB/BodySkin/Cth1-Top/Cth1-Cape）
          // 切到纯纹理 unlit graph，纹理已由 AssetReader 按材质逻辑名替换为
          // Blender frame120 可见岛烘焙图（含手绘阴影/高光，保留 alpha cutout）。
          const bakedMaterials = Object.keys(V14D_BAKED_MATERIAL_MAP);
          const bakedGroups = originalStyleGroups.map((group) => ({
            ...group,
            materials: group.materials.filter((name) => !bakedMaterials.includes(name)),
          })).filter((group) => group.materials.length > 0);
          const bakedResult = await engine.applyStyleGroups("companion", [
            ...bakedGroups,
            {
              id: "v14d-baked-golden",
              label: "V14D Baked Golden Frame",
              materials: bakedMaterials,
              graph: V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH,
            },
          ]);
          if (canvasRef.current) {
            canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.faceMaterialApplied] = String(bakedResult.ok);
          }
          if (!bakedResult.ok) {
            console.warn("[v14d-face-static] bakedGolden graph 应用失败", bakedResult);
          }
        } else {
        const faceGraph =
          v14dFaceStaticMode === "uvDebug" ? V14D_FACE_UV_DEBUG_GRAPH_LEGACY : V14D_FACE_STATIC_GRAPH;
        const faceGroups = originalStyleGroups.map((group) => ({
          ...group,
          materials: group.materials.filter((name) => name !== V14D_FACE_MATERIAL_NAME),
        })).filter((group) => group.materials.length > 0);
        const faceResult = await engine.applyStyleGroups("companion", [
          ...faceGroups,
          {
            id: "v14d-face-static",
            label: "V14D Face Static State2",
            materials: [V14D_FACE_MATERIAL_NAME],
            graph: faceGraph,
          },
        ]);
        if (canvasRef.current) {
          canvasRef.current.dataset[V14D_FACE_STATIC_DATASET.faceMaterialApplied] = String(faceResult.ok);
        }
        if (!faceResult.ok) {
          console.warn("[v14d-face-static] Face 材质 graph 应用失败", faceResult);
        }
        }
        }
      }
      if (isKoleda) {
        for (const [index, material] of model.getMaterials().entries()) {
          if (!isKoledaFaceOrBodyMaterialName(material.name)) continue;
          const current = materialStateRef.current.get(stableMaterialId(index)) ?? { visible: true, preset: "默认" };
          materialStateRef.current.set(stableMaterialId(index), { ...current, preset: "柔滑布料" });
        }
      }
      if (disposed) return;
      if (v14dColorBaseline || v14dFaceStatic) applySceneSettings(effectiveInitialSettings);
      else applySceneSettings(initialSettings);
      if (v14dFaceStatic) {
        // 黄金帧构图：暗背景 + 无地面 + bloom 关闭，对齐 blend 最终画面口径；
        // 曝光 -0.56 对齐权威 AgX exposure，look 保持引擎默认 medium_high_contrast。
        const faceEngine = engineRef.current;
        if (faceEngine) {
          faceEngine.setBackgroundColor(hexToLinearVec3("#050505"));
          faceEngine.addGround({ opacity: 0, width: 0, height: 0 });
          faceEngine.setBloomOptions({ enabled: false, intensity: 0 });
          // bakedGolden：烘焙纹理=BaseColor 反照率（已含手绘阴影/高光），
          // 用 Standard/曝光0 原样显示；其余三模式仍对齐权威 AgX 曝光 -0.56。
          faceEngine.setViewTransformOptions(
            v14dFaceStaticMode === "bakedGolden"
              ? { exposure: 0, gamma: 1.0 }
              : { exposure: -0.56, gamma: 1.0 },
          );
        }
        restorePersistedCamera(V14D_FACE_STATIC_CAMERA);
        readRezeCamera(engine)?.setInputLocked(true);
      } else if (v14dColorBaseline) {
        restorePersistedCamera(V14D_COLOR_BASELINE_CAMERA);
        readRezeCamera(engine)?.setInputLocked(true);
      } else {
        restorePersistedCamera();
      }
      applyGrade(gradeRef.current, gradeIntensityRef.current);
      const initialInteraction = interactionRef.current;
      // faceStatic：用注入的权威 VMD File（对象 URL），不经网络 URL。
      const faceStaticVmdUrl =
        v14dFaceStatic && window.__v14dFaceStaticAssets?.vmdFile
          ? URL.createObjectURL(window.__v14dFaceStaticAssets.vmdFile)
          : null;
      const effectiveVmdUrl: string = v14dFaceStatic
        ? faceStaticVmdUrl ?? ""
        : initialInteraction.vmdUrl || "";
      if (effectiveVmdUrl) {
        const requestId = vmdRequestGuardRef.current.begin();
        const vmdSrc = effectiveVmdUrl;
        const name = v14dFaceStatic
          ? V14D_FACE_STATIC_AUTHORITY.vmdFileName
          : vmdSrc.split("/").pop() || "motion.vmd";
        const [policy] = await Promise.all([
          readRezeVmdIkPolicy(vmdSrc),
          model.loadVmd(name, vmdSrc),
        ]);
        if (disposed || !vmdRequestGuardRef.current.isCurrent(requestId)) return;
          applyVmdIkPolicy(engine, policy);
          baselineVmdLoadedRef.current = true;
          if (v14dColorBaseline || v14dFaceStatic) {
            // loadVmd() 只登记剪辑；必须先把它设为当前动作，seek() 才会
            // 写入 frame 120。否则固定单帧诊断会继续渲染绑定姿态。
            playRezeVmd(model, name);
            model.seek(v14dFaceStatic ? V14D_FACE_STATIC_SECONDS : V14D_COLOR_BASELINE_SECONDS);
            model.pause();
            currentVmdUrlRef.current = vmdSrc;
          } else {
          playRezeVmd(model, name);
          currentVmdUrlRef.current = vmdSrc;
          armRezeVmdCompletionFallback(model, name, vmdSrc);
        }
        engine.resetPhysics();
      }
      if (v14dColorBaseline || v14dFaceStatic) {
        engine.stopRenderLoop();
        model.pause();
        engine.renderFrame(0);
        // 黄金帧：模型以 PMX 单位渲染（实测 skinned head Y≈16.42，与相机
        // 同单位），无需 setModelTransform 缩放；V14D_FACE_STATIC_CAMERA
        // 已按 PMX 单位换算自权威 PROTO_GameCamera。
      } else {
        engine.runRenderLoop();
      }
      if (v14dFaceStatic && canvasRef.current) {
        // 黄金帧诊断探针：暴露引擎相机实际值与模型世界包围盒，供采集脚本核对构图。
        const gfEngine = engineRef.current;
        const gfModel = modelRef.current;
        (window as unknown as { __rezeEngineProbe?: () => unknown }).__rezeEngineProbe = () => {
          // 黄金帧诊断探针（最小字段）：仅暴露核对构图所需的引擎相机实际值、
          // 模型变换与脸部皮肤后世界包围盒，供采集脚本核对相机/缩放对齐。
          const cam = gfEngine ? readRezeCamera(gfEngine) : null;
          const pos = cam?.getPosition?.();
          let faceBox: { center: number[] | null; sizeY: number | null; minW: number[]; maxW: number[] } | null = null;
          try {
            const verts = (gfModel as unknown as { getVertices?: () => ArrayLike<number> | null })?.getVertices?.();
            const skinning = gfModel?.getSkinning?.();
            const joints = skinning?.joints;
            const weights = skinning?.weights;
            const skinMats = gfModel?.getSkinMatrices?.();
            const mats = gfModel?.getMaterials?.() ?? [];
            const indices = gfModel?.getIndices?.();
            const faceMatIdx = mats.findIndex((m) => m.name === "Face");
            if (verts && skinMats && joints && weights && indices && faceMatIdx >= 0) {
              let idxStart = 0;
              for (let mi = 0; mi < faceMatIdx; mi += 1) idxStart += mats[mi].vertexCount;
              const idxEnd = idxStart + mats[faceMatIdx].vertexCount;
              const faceVertSet = new Set<number>();
              for (let k = idxStart; k < idxEnd; k += 1) faceVertSet.add(indices[k]);
              const minW = [Infinity, Infinity, Infinity];
              const maxW = [-Infinity, -Infinity, -Infinity];
              const px: number[] = []; const py: number[] = []; const pz: number[] = [];
              for (const vi of faceVertSet) {
                const bx = verts[vi * 8], by = verts[vi * 8 + 1], bz = verts[vi * 8 + 2];
                let wx = 0, wy = 0, wz = 0;
                for (let k = 0; k < 4; k += 1) {
                  const bi = joints[vi * 4 + k];
                  const w = weights[vi * 4 + k] / 255;
                  if (w <= 0) continue;
                  const o = bi * 16;
                  wx += w * (skinMats[o] * bx + skinMats[o + 4] * by + skinMats[o + 8] * bz + skinMats[o + 12]);
                  wy += w * (skinMats[o + 1] * bx + skinMats[o + 5] * by + skinMats[o + 9] * bz + skinMats[o + 13]);
                  wz += w * (skinMats[o + 2] * bx + skinMats[o + 6] * by + skinMats[o + 10] * bz + skinMats[o + 14]);
                }
                px.push(wx); py.push(wy); pz.push(wz);
                minW[0] = Math.min(minW[0], wx); maxW[0] = Math.max(maxW[0], wx);
                minW[1] = Math.min(minW[1], wy); maxW[1] = Math.max(maxW[1], wy);
                minW[2] = Math.min(minW[2], wz); maxW[2] = Math.max(maxW[2], wz);
              }
              if (px.length > 0) {
                const med = (a: number[]) => { const s = [...a].sort((p, q2) => p - q2); return s[Math.floor(s.length / 2)]; };
                faceBox = { center: [med(px), med(py), med(pz)], sizeY: maxW[1] - minW[1], minW, maxW };
              }
            }
          } catch { /* ignore */ }
          return {
            camera: cam && pos
              ? { position: [pos.x, pos.y, pos.z], target: [cam.target.x, cam.target.y, cam.target.z], fovDeg: (cam.fov * 180) / Math.PI }
              : null,
            modelTransform: gfEngine?.getModelTransform?.("companion") ?? null,
            faceBox,
          };
        };
        const canvas = canvasRef.current;
        canvas.dataset[V14D_FACE_STATIC_DATASET.enabled] = "true";
        canvas.dataset[V14D_FACE_STATIC_DATASET.mode] = v14dFaceStaticMode;
        canvas.dataset[V14D_FACE_STATIC_DATASET.frame] = String(V14D_FACE_STATIC_FRAME);
        canvas.dataset[V14D_FACE_STATIC_DATASET.state] = String(V14D_FACE_STATIC_STATE);
        canvas.dataset[V14D_FACE_STATIC_DATASET.blend] = V14D_FACE_STATIC_BLEND.toFixed(2);
        canvas.dataset[V14D_FACE_STATIC_DATASET.cameraLocked] = "true";
        canvas.dataset[V14D_FACE_STATIC_DATASET.paused] = "true";
        canvas.dataset[V14D_FACE_STATIC_DATASET.authority] =
          `${V14D_FACE_STATIC_AUTHORITY.pmxFileName}#${V14D_FACE_STATIC_AUTHORITY.vmdFileName}`;
      }
      reportStatus(
        "ready",
        `${localModelImport ? `已导入 ${localModelImport.pmxFile.name}` : "WebGPU 已就绪"} · ${model.getMaterials().length} 个 PMX 材质${v14dUnlitDiagnostic ? " · V14D Unlit 诊断" : ""}${v14dColorBaseline ? " · 白光颜色基线单帧" : ""}${v14dFaceStatic ? ` · V14D Face Static ${v14dFaceStaticMode} f${V14D_FACE_STATIC_FRAME}` : ""}`,
      );
    };
    void boot().catch((error: unknown) => {
      if (!disposed) reportStatus("error", error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
      engineReadyRef.current = false;
      modelRef.current = null;
      // 黄金帧诊断探针：页面卸载/默认入口时清除，避免残留到生产路径。
      delete (window as unknown as { __rezeEngineProbe?: unknown }).__rezeEngineProbe;
      clearVmdCompletionFallback();
      vmdIkPolicyCacheRef.current.clear();
      materialStateRef.current.clear();
      baselineOriginalStyleGroupsRef.current = null;
      baselineResultRef.current = null;
      baselineVmdLoadedRef.current = false;
      baselineCapturePromiseRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [modelUrl, localModelImport, modelIdentifier, v14dUnlitDiagnostic, v14dColorBaseline, v14dFaceStatic, v14dFaceStaticMode, scenePreset]);

  useEffect(() => {
    if (v14dColorBaseline || v14dFaceStatic || !sceneSettings) return;
    applySceneSettings(sceneSettings);
  }, [sceneSettings, v14dColorBaseline, v14dFaceStatic]);

  useEffect(() => {
    if (v14dColorBaseline || v14dFaceStatic) return;
    restorePersistedCamera(cameraSnapshot);
  }, [cameraSnapshot, v14dColorBaseline, v14dFaceStatic]);

  useEffect(() => {
    if (v14dColorBaseline || v14dFaceStatic) return;
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current) return;
    void engine.setBackgroundEffect(backgroundEffect === "Shining Stars" ? REZE_SHINING_STARS_WGSL : null).then((result) => {
      if (!result.ok) reportStatus("error", `Shining Stars 背景编译失败：${result.diagnostics.join("; ")}`);
    });
  }, [backgroundEffect, v14dColorBaseline]);

  useEffect(() => {
    applyGrade(grade, gradeIntensity);
  }, [grade, gradeIntensity]);

  useEffect(() => {
    // 固定单帧诊断（colorBaseline / faceStatic）在 boot 内一次性加载 VMD 并
    // seek→pause→stopRenderLoop→renderFrame(0)，通用 VMD effect 不得再 play/resetPhysics。
    if (v14dColorBaseline || v14dFaceStatic) return;
    const requestId = vmdRequestGuardRef.current.begin();
    const model = modelRef.current;
    if (!model || interaction.mode !== "vmd" || !interaction.vmdUrl) return;
    const load = async () => {
      try {
        const url = interaction.vmdUrl!;
        const name = url.split("/").pop() || "motion.vmd";
        const [policy] = await Promise.all([
          readRezeVmdIkPolicy(url),
          model.loadVmd(name, url),
        ]);
        if (!vmdRequestGuardRef.current.isCurrent(requestId) || model !== modelRef.current) return;
        const engine = engineRef.current;
        if (!engine) return;
        applyVmdIkPolicy(engine, policy);
        // 只有在「上一个动作已经结束（currentVmdUrlRef 已被完成回调清空）」时
        // 才代表真的没有动作在播，直接 show/play 从绑定姿势起跳；只要前一个
        // 动作仍在进行中（currentVmdUrlRef 非空），新动作必须保留当前姿势，避免
        // 模型被 resetAllBones() 拉回 T 形再跳到新动作，产生闪烁。
        playRezeVmd(model, name, { preserveCurrentPose: Boolean(currentVmdUrlRef.current) });
        currentVmdUrlRef.current = url;
        if (interaction.vmdLoopUrls?.includes(url)) lastLoopVmdUrlRef.current = url;
        armRezeVmdCompletionFallback(model, name, url);
        engine.resetPhysics();
      } catch (error) {
        if (!vmdRequestGuardRef.current.isCurrent(requestId)) return;
        reportStatus("error", `VMD 加载失败：${error instanceof Error ? error.message : String(error)}`);
      }
    };
    void load();
  }, [interaction.mode, interaction.vmdUrl, interaction.playbackRate, interaction.vmdRequestId, v14dColorBaseline, v14dFaceStatic]);

  useEffect(() => {
    if (v14dColorBaseline || v14dFaceStatic) return;
    if (interaction.mode === "vmd" && interaction.vmdUrl) return;
    clearVmdCompletionFallback();
    currentVmdUrlRef.current = "";
    restoreDefaultIk();
  }, [interaction.mode, interaction.vmdUrl]);

  return (
    <div
      className="mio-stage-webgpu-shell"
      data-webgpu-status={runtimeStatus.state}
      data-v14d-unlit-diagnostic={v14dUnlitDiagnostic ? "true" : "false"}
      data-v14d-color-baseline={v14dColorBaseline ? "true" : "false"}
    >
      <canvas
        ref={canvasRef}
        className="mio-stage-canvas mio-stage-canvas--webgpu"
        data-renderer="reze-engine-webgpu"
        data-v14d-unlit-diagnostic={v14dUnlitDiagnostic ? "true" : "false"}
        data-v14d-color-baseline={v14dColorBaseline ? "true" : "false"}
      />
      {runtimeStatus.state !== "ready" ? <p className="mio-stage-webgpu-status" role="status">{runtimeStatus.detail}</p> : null}
    </div>
  );
});
