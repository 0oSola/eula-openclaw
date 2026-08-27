"use client";

import { useEffect, useMemo, useState } from "react";

import { MMDStage } from "@/features/stage/MMDStage";
import {
  V14D_COLOR_BASELINE_CAMERA,
  V14D_COLOR_BASELINE_HEIGHT,
  V14D_COLOR_BASELINE_WIDTH,
} from "@/features/stage/v14dColorBaseline";
import {
  V14D_FACE_STATIC_CAMERA,
  V14D_FACE_STATIC_MODE_TEXTURE,
  V14D_FACE_STATIC_STATE,
  V14D_FACE_STATIC_BLEND,
  V14D_FACE_STATIC_FRAME,
  V14D_FACE_STATIC_AUTHORITY,
  V14D_FACE_STATIC_DERIVED,
  V14D_FACE_STATIC_MODES,
  V14D_FACE_MATERIAL_NAME,
  isV14dFaceStaticMode,
  type V14dFaceStaticMode,
  type V14dFaceStaticAssetSource,
} from "@/features/stage/v14dFaceStatic";
import type { MmdCameraSnapshot, RenderPipeline } from "@/lib/types";

type CalibrationQuery = {
  modelUrl: string;
  vmdUrl: string;
  renderPipeline: RenderPipeline;
  cameraSnapshot: MmdCameraSnapshot | null;
  v14dUnlitDiagnostic: boolean;
  v14dColorBaseline: boolean;
  v14dFaceStatic: boolean;
  v14dFaceStaticMode: V14dFaceStaticMode;
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
      v14dFaceStatic: false,
      v14dFaceStaticMode: "normal",
    };
  }
  const params = new URLSearchParams(window.location.search);
  const v14dColorBaseline = params.get("v14dColorBaseline") === "1";
  const v14dFaceStatic = params.get("v14dFaceStatic") === "1";
  const modeParam = params.get("v14dFaceMode");
  const v14dFaceStaticMode: V14dFaceStaticMode = isV14dFaceStaticMode(modeParam) ? modeParam : "normal";
  return {
    modelUrl: params.get("modelUrl") || "",
    vmdUrl: params.get("vmdUrl") || "",
    renderPipeline: v14dColorBaseline || v14dFaceStatic ? "reze-k3" : readRenderPipeline(params.get("renderPipeline")),
    cameraSnapshot: v14dFaceStatic
      ? V14D_FACE_STATIC_CAMERA
      : v14dColorBaseline
        ? V14D_COLOR_BASELINE_CAMERA
        : readCameraSnapshot(params.get("camera")),
    // faceStatic 不再强制全局 unlit：normal 用原始 face_d，分量/合成只在 Face 材质局部 unlit。
    v14dUnlitDiagnostic: params.get("v14dUnlit") === "1" || v14dColorBaseline,
    v14dColorBaseline,
    v14dFaceStatic,
    v14dFaceStaticMode,
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

const MODE_LABEL: Record<V14dFaceStaticMode, string> = {
  normal: "正常基线",
  faceShadowOnly: "脸部阴影分量",
  finalFaceComposite: "最终脸部合成",
  uvDebug: "UV 调试",
};

const FACE_D_KEY = "Textures/c_Koleda_slg_face_d.png";

type FaceStaticAssetsState =
  | { status: "idle" }
  | { status: "ready"; source: V14dFaceStaticAssetSource }
  | { status: "error"; message: string };

/** 静态预览资产面板：本地目录 + 权威 VMD + 两个派生 State2 PNG 选择器。 */
function FaceStaticAssetPanel(props: {
  assets: FaceStaticAssetsState;
  onLoaded: (source: V14dFaceStaticAssetSource) => void;
}) {
  const { assets, onLoaded } = props;
  const [modelDir, setModelDir] = useState<FileList | null>(null);
  const [vmdFile, setVmdFile] = useState<File | null>(null);
  const [compositeFile, setCompositeFile] = useState<File | null>(null);
  const [attenuationFile, setAttenuationFile] = useState<File | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const analyze = (): { source: V14dFaceStaticAssetSource | null; missing: string[] } => {
    const lack: string[] = [];
    const modelFiles: File[] = modelDir ? Array.from(modelDir) : [];
    if (!modelFiles.length) lack.push("Koleda 模型目录（含 PMX 与纹理）");
    const pmxFile = modelFiles.find((f) => f.name === V14D_FACE_STATIC_AUTHORITY.pmxFileName) ?? null;
    if (modelFiles.length && !pmxFile) lack.push(`目录内缺少权威 PMX：${V14D_FACE_STATIC_AUTHORITY.pmxFileName}`);
    const faceD = modelFiles.find((f) => /c_Koleda_slg_face_d\.png$/i.test(f.name)) ?? null;
    if (modelFiles.length && !faceD) lack.push("目录内缺少脸部基图：c_Koleda_slg_face_d.png");
    if (!vmdFile) lack.push(`权威 VMD：${V14D_FACE_STATIC_AUTHORITY.vmdFileName}`);
    if (!compositeFile) lack.push(`派生合成图：${V14D_FACE_STATIC_DERIVED.composite}`);
    if (!attenuationFile) lack.push(`派生阴影分量图：${V14D_FACE_STATIC_DERIVED.attenuation}`);
    if (!pmxFile || !faceD || !vmdFile || !compositeFile || !attenuationFile) {
      return { source: null, missing: lack };
    }
    // 以模式无关方式构造：faceOverride 由 RezeWebGpuStage 按当前模式选择；这里把三张脸部纹理都带上，
    // 用 webkitRelativePath 让它们覆盖 face_d 逻辑键或作为独立键。
    const withRel = (f: File, rel: string) => {
      try {
        Object.defineProperty(f, "webkitRelativePath", { value: rel, configurable: true });
      } catch {
        /* ignore */
      }
      return f;
    };
    const source: V14dFaceStaticAssetSource = {
      modelFiles,
      pmxFile,
      vmdFile,
      faceOverride: null,
      faceTextures: {
        normal: withRel(faceD, FACE_D_KEY),
        finalFaceComposite: withRel(compositeFile, FACE_D_KEY),
        faceShadowOnly: withRel(attenuationFile, FACE_D_KEY),
      },
    };
    return { source, missing: [] };
  };

  const handleLoad = () => {
    setBusy(true);
    try {
      const { source, missing: lack } = analyze();
      setMissing(lack);
      if (source) {
        (window as any).__v14dFaceStaticAssets = source;
        onLoaded(source);
      }
    } finally {
      setBusy(false);
    }
  };

  if (assets.status === "ready") return null;

  return (
    <div
      data-testid="v14d-face-static-asset-panel"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10,10,14,0.72)",
        color: "#eee",
        font: "13px/1.6 sans-serif",
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: "92vw",
          maxHeight: "88vh",
          overflow: "auto",
          background: "#17181d",
          border: "1px solid #33353f",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>V14D Face State 2 静态预览 · 本地资产</div>
        <div style={{ color: "#aab", marginBottom: 14 }}>
          请选择本地权威资产（仓库不捆绑第三方 PMX/纹理）。选择后即可在三种模式间切换，无需重选。
        </div>

        <label style={{ display: "block", marginBottom: 10 }}>
          <div style={{ marginBottom: 4 }}>1. Koleda 模型目录（含 PMX 与全部纹理）</div>
          <input
            data-testid="v14d-face-dir-input"
            type="file"
            // @ts-expect-error webkitdirectory 非标准属性
            webkitdirectory=""
            multiple
            onChange={(e) => setModelDir(e.target.files)}
          />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <div style={{ marginBottom: 4 }}>2. 权威 VMD（frame120 姿态）</div>
          <input data-testid="v14d-face-vmd-input" type="file" accept=".vmd" onChange={(e) => setVmdFile(e.target.files?.[0] ?? null)} />
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <div style={{ marginBottom: 4 }}>3. 派生合成图（{V14D_FACE_STATIC_DERIVED.composite}）</div>
          <input data-testid="v14d-face-composite-input" type="file" accept="image/png" onChange={(e) => setCompositeFile(e.target.files?.[0] ?? null)} />
        </label>
        <label style={{ display: "block", marginBottom: 14 }}>
          <div style={{ marginBottom: 4 }}>4. 派生阴影分量图（{V14D_FACE_STATIC_DERIVED.attenuation}）</div>
          <input data-testid="v14d-face-attenuation-input" type="file" accept="image/png" onChange={(e) => setAttenuationFile(e.target.files?.[0] ?? null)} />
        </label>

        {missing.length ? (
          <div data-testid="v14d-face-missing" style={{ color: "#f2b8b8", marginBottom: 12, whiteSpace: "pre-wrap" }}>
            缺失：
            {missing.map((m) => `\n· ${m}`).join("")}
          </div>
        ) : null}
        {assets.status === "error" ? (
          <div data-testid="v14d-face-error" style={{ color: "#f2b8b8", marginBottom: 12, whiteSpace: "pre-wrap" }}>
            {assets.message}
          </div>
        ) : null}

        <button
          data-testid="v14d-face-load"
          type="button"
          disabled={busy}
          onClick={handleLoad}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #4a4d5c",
            background: busy ? "#2a2c36" : "#2f6fed",
            color: "#fff",
            cursor: busy ? "default" : "pointer",
            fontWeight: 600,
          }}
        >
          {busy ? "加载中…" : "加载资产并渲染"}
        </button>
      </div>
    </div>
  );
}

export default function MmdCalibrationRenderPage() {
  const [query, setQuery] = useState<CalibrationQuery | null>(null);
  const [faceStaticAssets, setFaceStaticAssets] = useState<FaceStaticAssetsState>({ status: "idle" });
  const [faceStaticMode, setFaceStaticMode] = useState<V14dFaceStaticMode>("normal");

  useEffect(() => {
    const q = readCalibrationQuery();
    setQuery(q);
    // 采集/复验脚本经 addInitScript 预注入权威资产（可能异步晚于首次 effect）：
    // 轮询等待其就绪后直接置 ready，跳过手动面板。
    if (q.v14dFaceStatic) {
      let cancelled = false;
      const tryAdopt = () => {
        const injected = (window as any).__v14dFaceStaticAssets;
        if (injected && !cancelled) {
          setFaceStaticAssets({ status: "ready", source: injected });
          return true;
        }
        return false;
      };
      if (!tryAdopt()) {
        const timer = window.setInterval(() => {
          if (tryAdopt()) window.clearInterval(timer);
        }, 150);
        // 5 秒内无注入则说明是手动用户路径，停止轮询（面板保持显示）。
        window.setTimeout(() => window.clearInterval(timer), 5000);
      }
      return () => { cancelled = true; };
    }
  }, []);

  useEffect(() => {
    if (query) setFaceStaticMode(query.v14dFaceStaticMode);
  }, [query]);

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
        data-v14d-face-static="false"
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

  const faceStaticReady = !query.v14dFaceStatic || faceStaticAssets.status === "ready";

  return (
    <main
      className="mmd-calibration-render"
      data-testid="mmd-calibration-render"
      data-v14d-color-baseline={query.v14dColorBaseline ? "true" : "false"}
      data-v14d-color-baseline-size={`${V14D_COLOR_BASELINE_WIDTH}x${V14D_COLOR_BASELINE_HEIGHT}`}
      data-v14d-color-baseline-frame={query.v14dColorBaseline ? "120" : ""}
      data-v14d-color-baseline-seconds={query.v14dColorBaseline ? "4.0" : ""}
      data-v14d-color-baseline-lighting={query.v14dColorBaseline ? "white" : ""}
      data-v14d-face-static={query.v14dFaceStatic ? "true" : "false"}
      data-v14d-face-static-mode={query.v14dFaceStatic ? faceStaticMode : ""}
    >
      {query.v14dFaceStatic ? (
        <FaceStaticAssetPanel assets={faceStaticAssets} onLoaded={(source) => setFaceStaticAssets({ status: "ready", source })} />
      ) : null}

      {query.v14dFaceStatic && faceStaticAssets.status === "ready" ? (
        <div
          data-testid="v14d-face-static-badge"
          style={{
            position: "fixed",
            left: 12,
            top: 12,
            zIndex: 10,
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.72)",
            color: "#fff",
            font: "12px/1.5 monospace",
            pointerEvents: "none",
            whiteSpace: "pre",
          }}
        >
          {`V14D Static Golden Frame
Frame ${V14D_FACE_STATIC_FRAME} · Face State ${V14D_FACE_STATIC_STATE} · Blend ${V14D_FACE_STATIC_BLEND.toFixed(2)}
Mode ${faceStaticMode} · tex ${faceStaticMode === "uvDebug" ? "uv-debug" : V14D_FACE_STATIC_MODE_TEXTURE[faceStaticMode]}
Camera Locked · Animation Paused
静态脸部合成分量预览 · 不代表完整 Blender 最终视觉`}
        </div>
      ) : null}

      {query.v14dFaceStatic && faceStaticAssets.status === "ready" ? (
        <div
          data-testid="v14d-face-static-mode-bar"
          style={{ position: "fixed", left: 12, bottom: 12, zIndex: 10, display: "flex", gap: 8 }}
        >
          {V14D_FACE_STATIC_MODES.map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`v14d-face-mode-${m}`}
              data-active={m === faceStaticMode ? "true" : "false"}
              onClick={() => setFaceStaticMode(m)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #4a4d5c",
                background: m === faceStaticMode ? "#2f6fed" : "rgba(20,20,26,0.8)",
                color: "#fff",
                cursor: "pointer",
                font: "12px/1.4 sans-serif",
                fontWeight: m === faceStaticMode ? 700 : 500,
              }}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      ) : null}

      {faceStaticReady ? (
        <MMDStage
          key={query.v14dFaceStatic ? `face-static-${faceStaticMode}` : "calibration"}
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
          v14dFaceStatic={query.v14dFaceStatic}
          v14dFaceStaticMode={faceStaticMode}
          rezeBackgroundEffect={query.v14dColorBaseline || query.v14dFaceStatic ? "关闭" : undefined}
          rezeTransparentBackground={query.v14dColorBaseline || query.v14dFaceStatic ? false : undefined}
          rezeGrade={query.v14dColorBaseline || query.v14dFaceStatic ? "中性" : undefined}
          rezeGradeIntensity={query.v14dColorBaseline || query.v14dFaceStatic ? 1 : undefined}
          chrome="bare"
          enableCharacterClickCapture={false}
          cameraLocked
        />
      ) : null}
      <style jsx global>{`
        html,
        body {
          margin: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: ${query.v14dColorBaseline || query.v14dFaceStatic ? "#ffffff" : "transparent"};
        }

        .mmd-calibration-render,
        .mmd-calibration-render .mio-stage,
        .mmd-calibration-render .mio-stage-canvas {
          width: 100vw;
          height: 100vh;
          min-width: 100vw;
          min-height: 100vh;
          background: ${query.v14dColorBaseline || query.v14dFaceStatic ? "#ffffff" : "transparent"};
        }
      `}</style>
    </main>
  );
}
