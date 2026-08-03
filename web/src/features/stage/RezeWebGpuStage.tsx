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

type RezeStageProps = {
  modelUrl: string;
  localModelImport?: {
    revision: number;
    files: File[];
    pmxFile: File;
  } | null;
  interaction: {
    mode?: "procedural" | "vmd";
    vmdUrl?: string;
    playbackRate?: number;
  };
  backgroundEffect?: RezeBackgroundEffect;
  grade?: RezeGradePreset;
  gradeIntensity?: number;
  cameraSnapshot?: MmdCameraSnapshot | null;
  onReadyChange?: (ready: boolean, detail?: string) => void;
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

export const RezeWebGpuStage = forwardRef<MMDStageHandle, RezeStageProps>(function RezeWebGpuStage(
  { modelUrl, localModelImport = null, interaction, backgroundEffect = "Shining Stars", grade = "中性", gradeIntensity = 1, onReadyChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<{ state: "loading" | "ready" | "error"; detail: string }>({
    state: "loading",
    detail: "正在初始化 reze-engine WebGPU…",
  });
  const engineRef = useRef<Engine | null>(null);
  const settingsRef = useRef<RezeSceneDebugSettings>(DEFAULT_SETTINGS);
  const modelRef = useRef<Awaited<ReturnType<Engine["loadModel"]>> | null>(null);
  const materialStateRef = useRef(new Map<string, { visible: boolean; preset: string }>());
  const currentVmdUrlRef = useRef("");
  const interactionRef = useRef(interaction);
  const backgroundEffectRef = useRef<RezeBackgroundEffect>(backgroundEffect);
  const gradeRef = useRef<RezeGradePreset>(grade);
  const gradeIntensityRef = useRef(gradeIntensity);
  const onReadyChangeRef = useRef(onReadyChange);
  interactionRef.current = interaction;
  backgroundEffectRef.current = backgroundEffect;
  gradeRef.current = grade;
  gradeIntensityRef.current = gradeIntensity;
  onReadyChangeRef.current = onReadyChange;

  const reportStatus = (state: "loading" | "ready" | "error", detail: string) => {
    if (canvasRef.current) {
      canvasRef.current.dataset.webgpuStatus = state;
      canvasRef.current.dataset.webgpuDetail = detail;
    }
    setRuntimeStatus({ state, detail });
    onReadyChangeRef.current?.(state === "ready", detail);
  };

  const applySceneSettings = (next: RezeSceneDebugSettings) => {
    const engine = engineRef.current;
    if (!engine) return null;
    settingsRef.current = { ...DEFAULT_SETTINGS, ...next };
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
    engine.setBackgroundColor(hexToSrgbVec3(settings.backgroundColor));
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
    if (!engine) return null;
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

  useImperativeHandle(ref, () => ({
    unlockCamera: () => null,
    lockCamera: () => null,
    captureCamera: () => null,
    resetCamera: () => null,
    hitTestCharacterAtClientPoint: () => false,
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
    const boot = async () => {
      reportStatus("loading", "正在初始化 reze-engine WebGPU…");
      if (!("gpu" in navigator)) throw new Error("当前浏览器不支持 WebGPU，请改用 Reze NPR（WebGL）模式。");
      const engine = new Engine(canvas, {
        background: hexToSrgbVec3(DEFAULT_SETTINGS.backgroundColor),
        camera: { distance: DEFAULT_SETTINGS.cameraDistance, target: new Vec3(0, 11.4, 0) },
        world: { color: hexToLinearVec3(DEFAULT_SETTINGS.worldColor), strength: DEFAULT_SETTINGS.ambientIntensity },
        sun: {
          color: hexToLinearVec3(DEFAULT_SETTINGS.sunColor),
          strength: DEFAULT_SETTINGS.keyIntensity,
          direction: azElToDirection(DEFAULT_SETTINGS.sunAzimuth, DEFAULT_SETTINGS.sunElevation),
        },
        bloom: {
          enabled: true,
          threshold: DEFAULT_SETTINGS.bloomThreshold,
          knee: DEFAULT_SETTINGS.bloomKnee,
          radius: DEFAULT_SETTINGS.bloomRadius,
          intensity: DEFAULT_SETTINGS.bloomStrength,
          color: hexToLinearVec3(DEFAULT_SETTINGS.bloomColor),
        },
      });
       engineRef.current = engine;
       await engine.init();
       if (disposed) return;
       const initialBackgroundEffect = await engine.setBackgroundEffect(
         backgroundEffectRef.current === "Shining Stars" ? REZE_SHINING_STARS_WGSL : null,
       );
       if (!initialBackgroundEffect.ok) throw new Error(`Shining Stars 背景编译失败：${initialBackgroundEffect.diagnostics.join("; ")}`);
      const model = localModelImport
        ? await engine.loadModel("companion", { files: localModelImport.files, pmxFile: localModelImport.pmxFile })
        : await engine.loadModel("companion", modelUrl);
      if (disposed) return;
      modelRef.current = model;
      await engine.autoStyleGroups("companion");
       if (disposed) return;
       applySceneSettings(settingsRef.current);
       applyGrade(gradeRef.current, gradeIntensityRef.current);
      const initialInteraction = interactionRef.current;
      if (initialInteraction.mode === "vmd" && initialInteraction.vmdUrl) {
        const name = initialInteraction.vmdUrl.split("/").pop() || "motion.vmd";
        await model.loadVmd(name, initialInteraction.vmdUrl);
        if (disposed) return;
        model.show(name);
        model.play(name, { loop: false });
        currentVmdUrlRef.current = initialInteraction.vmdUrl;
        engine.resetPhysics();
      }
      engine.runRenderLoop();
      reportStatus("ready", `${localModelImport ? `已导入 ${localModelImport.pmxFile.name}` : "WebGPU 已就绪"} · ${model.getMaterials().length} 个 PMX 材质`);
    };
    void boot().catch((error: unknown) => {
      if (!disposed) reportStatus("error", error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
      modelRef.current = null;
      materialStateRef.current.clear();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [modelUrl, localModelImport]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    void engine.setBackgroundEffect(backgroundEffect === "Shining Stars" ? REZE_SHINING_STARS_WGSL : null).then((result) => {
      if (!result.ok) reportStatus("error", `Shining Stars 背景编译失败：${result.diagnostics.join("; ")}`);
    });
  }, [backgroundEffect]);

  useEffect(() => {
    applyGrade(grade, gradeIntensity);
  }, [grade, gradeIntensity]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || interaction.mode !== "vmd" || !interaction.vmdUrl || interaction.vmdUrl === currentVmdUrlRef.current) return;
    const load = async () => {
      try {
        const name = interaction.vmdUrl!.split("/").pop() || "motion.vmd";
        await model.loadVmd(name, interaction.vmdUrl!);
        model.show(name);
        model.play(name, { loop: false });
        currentVmdUrlRef.current = interaction.vmdUrl!;
        engineRef.current?.resetPhysics();
      } catch (error) {
        reportStatus("error", `VMD 加载失败：${error instanceof Error ? error.message : String(error)}`);
      }
    };
    void load();
  }, [interaction.mode, interaction.vmdUrl, interaction.playbackRate]);

  return (
    <div className="mio-stage-webgpu-shell" data-webgpu-status={runtimeStatus.state}>
      <canvas ref={canvasRef} className="mio-stage-canvas mio-stage-canvas--webgpu" data-renderer="reze-engine-webgpu" />
      {runtimeStatus.state !== "ready" ? <p className="mio-stage-webgpu-status" role="status">{runtimeStatus.detail}</p> : null}
    </div>
  );
});
