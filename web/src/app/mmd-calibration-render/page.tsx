"use client";

import { useEffect, useMemo, useState } from "react";

import { MMDStage } from "@/features/stage/MMDStage";
import {
  V14D_COLOR_BASELINE_CAMERA,
  V14D_COLOR_BASELINE_HEIGHT,
  V14D_COLOR_BASELINE_WIDTH,
} from "@/features/stage/v14dColorBaseline";
import type { MmdCameraSnapshot, RenderPipeline } from "@/lib/types";

type CalibrationQuery = {
  modelUrl: string;
  vmdUrl: string;
  renderPipeline: RenderPipeline;
  cameraSnapshot: MmdCameraSnapshot | null;
  v14dUnlitDiagnostic: boolean;
  v14dColorBaseline: boolean;
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
      v14dColorBaseline: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const v14dColorBaseline = params.get("v14dColorBaseline") === "1";
  return {
    modelUrl: params.get("modelUrl") || "",
    vmdUrl: params.get("vmdUrl") || "",
    renderPipeline: v14dColorBaseline ? "reze-k3" : readRenderPipeline(params.get("renderPipeline")),
    cameraSnapshot: v14dColorBaseline ? V14D_COLOR_BASELINE_CAMERA : readCameraSnapshot(params.get("camera")),
    v14dUnlitDiagnostic: params.get("v14dUnlit") === "1" || v14dColorBaseline,
    v14dColorBaseline,
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
  const [query, setQuery] = useState<CalibrationQuery | null>(null);

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

  const interaction = useMemo(() => createCalibrationInteraction(query?.vmdUrl ?? ""), [query?.vmdUrl]);

  if (!query) {
    return (
      <main
        className="mmd-calibration-render"
        data-testid="mmd-calibration-render"
        data-v14d-color-baseline="false"
        data-v14d-color-baseline-size={`${V14D_COLOR_BASELINE_WIDTH}x${V14D_COLOR_BASELINE_HEIGHT}`}
        data-v14d-color-baseline-frame=""
        data-v14d-color-baseline-seconds=""
        data-v14d-color-baseline-lighting=""
      >
        <style jsx global>{`
          html,
          body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: transparent;
          }
        `}</style>
      </main>
    );
  }

  return (
    <main
      className="mmd-calibration-render"
      data-testid="mmd-calibration-render"
      data-v14d-color-baseline={query.v14dColorBaseline ? "true" : "false"}
      data-v14d-color-baseline-size={`${V14D_COLOR_BASELINE_WIDTH}x${V14D_COLOR_BASELINE_HEIGHT}`}
      data-v14d-color-baseline-frame={query.v14dColorBaseline ? "120" : ""}
      data-v14d-color-baseline-seconds={query.v14dColorBaseline ? "4.0" : ""}
      data-v14d-color-baseline-lighting={query.v14dColorBaseline ? "white" : ""}
    >
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
        v14dColorBaseline={query.v14dColorBaseline}
        rezeBackgroundEffect={query.v14dColorBaseline ? "关闭" : undefined}
        rezeTransparentBackground={query.v14dColorBaseline ? false : undefined}
        rezeGrade={query.v14dColorBaseline ? "中性" : undefined}
        rezeGradeIntensity={query.v14dColorBaseline ? 1 : undefined}
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
          background: ${query.v14dColorBaseline ? "#ffffff" : "transparent"};
        }

        .mmd-calibration-render,
        .mmd-calibration-render .mio-stage,
        .mmd-calibration-render .mio-stage-canvas {
          width: 100vw;
          height: 100vh;
          min-width: 100vw;
          min-height: 100vh;
          background: ${query.v14dColorBaseline ? "#ffffff" : "transparent"};
        }
      `}</style>
    </main>
  );
}
