"use client";

import { useEffect, useMemo, useState } from "react";

import { MMDStage } from "@/features/stage/MMDStage";
import type { MmdCameraSnapshot, RenderPipeline } from "@/lib/types";

type CalibrationQuery = {
  modelUrl: string;
  vmdUrl: string;
  renderPipeline: RenderPipeline;
  cameraSnapshot: MmdCameraSnapshot | null;
  v14dUnlitDiagnostic: boolean;
};

function readRenderPipeline(value: string | null): RenderPipeline {
  if (
    value === "classic" ||
    value === "hero-shot" ||
    value === "genshin" ||
    value === "mio-reference" ||
    value === "reze-npr" ||
    value === "reze-design" ||
    value === "k3" ||
    value === "reze-k3"
  ) {
    return value;
  }
  return "genshin";
}

function readCameraSnapshot(value: string | null): MmdCameraSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed?.position) || !Array.isArray(parsed?.target)) return null;
    const position = parsed.position.map((item: unknown) => Number(item));
    const target = parsed.target.map((item: unknown) => Number(item));
    if (position.length !== 3 || target.length !== 3) return null;
    if (position.some((item: number) => !Number.isFinite(item)) || target.some((item: number) => !Number.isFinite(item))) {
      return null;
    }
    return {
      fov: Number(parsed.fov) || 33,
      position: position as [number, number, number],
      target: target as [number, number, number],
      locked: parsed.locked !== false,
    };
  } catch {
    return null;
  }
}

function readCalibrationQuery(): CalibrationQuery {
  if (typeof window === "undefined") {
    return {
      modelUrl: "",
      vmdUrl: "",
      renderPipeline: "genshin",
      cameraSnapshot: null,
      v14dUnlitDiagnostic: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    modelUrl: params.get("modelUrl") || "",
    vmdUrl: params.get("vmdUrl") || "",
    renderPipeline: readRenderPipeline(params.get("renderPipeline")),
    cameraSnapshot: readCameraSnapshot(params.get("camera")),
    v14dUnlitDiagnostic: params.get("v14dUnlit") === "1",
  };
}

function createCalibrationInteraction(vmdUrl: string) {
  return {
    emotion: "neutral",
    action: "idle",
    mode: (vmdUrl ? "vmd" : "procedural") as "vmd" | "procedural",
    vmdUrl,
    disableCrossfade: true,
    playbackRate: 1,
    sequence: [],
  };
}

export default function MmdCalibrationRenderPage() {
  const [query, setQuery] = useState<CalibrationQuery>(() => readCalibrationQuery());

  useEffect(() => {
    setQuery(readCalibrationQuery());
  }, []);

  useEffect(() => {
    const marker = { route: "mmd-calibration-render" };
    (window as any).__mmdCalibrationRender = marker;
    return () => {
      if ((window as any).__mmdCalibrationRender === marker) {
        delete (window as any).__mmdCalibrationRender;
      }
    };
  }, []);

  const interaction = useMemo(() => createCalibrationInteraction(query.vmdUrl), [query.vmdUrl]);

  return (
    <main className="mmd-calibration-render" data-testid="mmd-calibration-render">
      <MMDStage
        interaction={interaction}
        speaking={false}
        models={[]}
        selectedModelPath=""
        modelUrl={query.modelUrl}
        modelLabel="Calibration model"
        onModelChange={() => {}}
        renderPipeline={query.renderPipeline}
        cameraSnapshot={query.cameraSnapshot}
        v14dUnlitDiagnostic={query.v14dUnlitDiagnostic}
        chrome="bare"
        enableCharacterClickCapture={false}
        cameraLocked
      />
      <style jsx global>{`
        html,
        body {
          margin: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent;
        }

        .mmd-calibration-render,
        .mmd-calibration-render .mio-stage,
        .mmd-calibration-render .mio-stage-canvas {
          width: 100vw;
          height: 100vh;
          min-width: 100vw;
          min-height: 100vh;
          background: transparent;
        }
      `}</style>
    </main>
  );
}
