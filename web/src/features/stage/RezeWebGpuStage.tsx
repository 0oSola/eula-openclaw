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
  /** 仅用于 V14D 材质迁移取证；默认关闭，不改变生产渲染路径。 */
  v14dUnlitDiagnostic?: boolean;
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
    materials: ["BodySkin"],
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

export const RezeWebGpuStage = forwardRef<MMDStageHandle, RezeStageProps>(function RezeWebGpuStage(
  { modelUrl, modelIdentifier = "", localModelImport = null, interaction, backgroundEffect = "Shining Stars", grade = "中性", gradeIntensity = 1, sceneSettings, v14dUnlitDiagnostic = false, transparentBackground = false, cameraSnapshot = null, onReadyChange, onInteractionComplete },
  ref,
) {
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
  const interactionRef = useRef(interaction);
  const backgroundEffectRef = useRef<RezeBackgroundEffect>(backgroundEffect);
  const gradeRef = useRef<RezeGradePreset>(grade);
  const gradeIntensityRef = useRef(gradeIntensity);
  const transparentBackgroundRef = useRef(transparentBackground);
  const onReadyChangeRef = useRef(onReadyChange);
  const onInteractionCompleteRef = useRef(onInteractionComplete);
  interactionRef.current = interaction;
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
    const enabled = isKoledaModelIdentifier(modelIdentifier, modelUrl, localModelImport?.pmxFile?.name);
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
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !modelUrl) return;
    let disposed = false;
    const initialSettings = sceneSettings ?? DEFAULT_SETTINGS;
    const boot = async () => {
      reportStatus("loading", "正在初始化 reze-engine WebGPU…");
      if (!("gpu" in navigator)) throw new Error("当前浏览器不支持 WebGPU，请改用 Reze NPR（WebGL）模式。");
      settingsRef.current = { ...DEFAULT_SETTINGS, ...initialSettings };
      engineReadyRef.current = false;
      const engine = new Engine(canvas, {
        background: transparentBackgroundRef.current ? null : hexToSrgbVec3(initialSettings.backgroundColor),
        camera: {
          distance: initialSettings.cameraDistance,
          target: new Vec3(initialSettings.cameraTargetX, initialSettings.cameraTargetY, initialSettings.cameraTargetZ),
        },
        world: { color: hexToLinearVec3(initialSettings.worldColor), strength: initialSettings.ambientIntensity },
        sun: {
          color: hexToLinearVec3(initialSettings.sunColor),
          strength: initialSettings.keyIntensity,
          direction: azElToDirection(initialSettings.sunAzimuth, initialSettings.sunElevation),
        },
        bloom: {
          enabled: initialSettings.bloomStrength > 0,
          threshold: initialSettings.bloomThreshold,
          knee: initialSettings.bloomKnee,
          radius: initialSettings.bloomRadius,
          intensity: initialSettings.bloomStrength,
          color: hexToLinearVec3(initialSettings.bloomColor),
        },
      });
       engineRef.current = engine;
       await engine.init();
       if (disposed) return;
       engineReadyRef.current = true;
       defaultIkEnabledRef.current = engine.getIKEnabled?.() ?? true;
       const initialBackgroundEffect = await engine.setBackgroundEffect(
         backgroundEffectRef.current === "Shining Stars" ? REZE_SHINING_STARS_WGSL : null,
       );
       if (!initialBackgroundEffect.ok) throw new Error(`Shining Stars 背景编译失败：${initialBackgroundEffect.diagnostics.join("; ")}`);
      const model = localModelImport
        ? await engine.loadModel("companion", { files: localModelImport.files, pmxFile: localModelImport.pmxFile })
        : await engine.loadModel("companion", modelUrl);
      if (disposed) return;
      modelRef.current = model;
      applyKoledaDefaultAppearance(model);
      setRezeVmdCompletionHandler(model, (finishedName: string) => handleRezeVmdFinished(model, finishedName));
      const isKoleda = isKoledaModelIdentifier(modelIdentifier, modelUrl, localModelImport?.pmxFile?.name);
      const koledaFaceAndBodyMaterials = isKoleda
        ? model.getMaterials().map((material) => material.name).filter(isKoledaFaceOrBodyMaterialName)
        : [];
      await engine.autoStyleGroups(
        "companion",
        koledaFaceAndBodyMaterials.length ? { cloth_smooth: koledaFaceAndBodyMaterials } : undefined,
      );
      if (v14dUnlitDiagnostic) {
        const modelMaterialNames = new Set(model.getMaterials().map((material) => material.name));
        const appliedGroups: string[] = [];
        const unknownMaterials: string[] = [];
        for (const group of V14D_UNLIT_MATERIAL_GROUPS) {
          const matchedMaterials = group.materials.filter((materialName) => modelMaterialNames.has(materialName));
          unknownMaterials.push(...group.materials.filter((materialName) => !modelMaterialNames.has(materialName)));
          if (!matchedMaterials.length) continue;
          const result = await engine.upsertStyleGroup("companion", {
            ...group,
            materials: matchedMaterials,
            graph: V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH,
          });
          if (!result.ok) {
            throw new Error(
              `V14D Unlit 诊断图编译失败（${group.id}）：${result.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
            );
          }
          appliedGroups.push(group.id);
        }
        if (canvasRef.current) {
          canvasRef.current.dataset.v14dUnlitDiagnostic = "true";
          canvasRef.current.dataset.v14dUnlitGraph = V14D_MATERIAL_UNLIT_DIAGNOSTIC_GRAPH.name;
          canvasRef.current.dataset.v14dUnlitGroups = appliedGroups.join(",");
          canvasRef.current.dataset.v14dUnlitUnknownMaterials = unknownMaterials.join(",");
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
       applySceneSettings(settingsRef.current);
       restorePersistedCamera();
      applyGrade(gradeRef.current, gradeIntensityRef.current);
      const initialInteraction = interactionRef.current;
      if (initialInteraction.mode === "vmd" && initialInteraction.vmdUrl) {
        const requestId = vmdRequestGuardRef.current.begin();
        const name = initialInteraction.vmdUrl.split("/").pop() || "motion.vmd";
        const [policy] = await Promise.all([
          readRezeVmdIkPolicy(initialInteraction.vmdUrl),
          model.loadVmd(name, initialInteraction.vmdUrl),
        ]);
        if (disposed || !vmdRequestGuardRef.current.isCurrent(requestId)) return;
        applyVmdIkPolicy(engine, policy);
        playRezeVmd(model, name);
        currentVmdUrlRef.current = initialInteraction.vmdUrl;
        armRezeVmdCompletionFallback(model, name, initialInteraction.vmdUrl);
        engine.resetPhysics();
      }
      engine.runRenderLoop();
      reportStatus(
        "ready",
        `${localModelImport ? `已导入 ${localModelImport.pmxFile.name}` : "WebGPU 已就绪"} · ${model.getMaterials().length} 个 PMX 材质${v14dUnlitDiagnostic ? " · V14D Unlit 诊断" : ""}`,
      );
    };
    void boot().catch((error: unknown) => {
      if (!disposed) reportStatus("error", error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
      engineReadyRef.current = false;
      modelRef.current = null;
      clearVmdCompletionFallback();
      vmdIkPolicyCacheRef.current.clear();
      materialStateRef.current.clear();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [modelUrl, localModelImport, modelIdentifier, v14dUnlitDiagnostic]);

  useEffect(() => {
    if (!sceneSettings) return;
    applySceneSettings(sceneSettings);
  }, [sceneSettings]);

  useEffect(() => {
    restorePersistedCamera(cameraSnapshot);
  }, [cameraSnapshot]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !engineReadyRef.current) return;
    void engine.setBackgroundEffect(backgroundEffect === "Shining Stars" ? REZE_SHINING_STARS_WGSL : null).then((result) => {
      if (!result.ok) reportStatus("error", `Shining Stars 背景编译失败：${result.diagnostics.join("; ")}`);
    });
  }, [backgroundEffect]);

  useEffect(() => {
    applyGrade(grade, gradeIntensity);
  }, [grade, gradeIntensity]);

  useEffect(() => {
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
  }, [interaction.mode, interaction.vmdUrl, interaction.playbackRate, interaction.vmdRequestId]);

  useEffect(() => {
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
    >
      <canvas
        ref={canvasRef}
        className="mio-stage-canvas mio-stage-canvas--webgpu"
        data-renderer="reze-engine-webgpu"
        data-v14d-unlit-diagnostic={v14dUnlitDiagnostic ? "true" : "false"}
      />
      {runtimeStatus.state !== "ready" ? <p className="mio-stage-webgpu-status" role="status">{runtimeStatus.detail}</p> : null}
    </div>
  );
});
