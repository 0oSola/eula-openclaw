"use client";

import { ChangeEvent, PointerEvent, forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { getModelDisplayLabel } from "@/features/stage/modelCatalog.js";
import { shouldTriggerStageCharacterClick } from "@/features/stage/stageCharacterClick.js";
import { applyStageRuntimeState, MMDCompanionRuntime } from "@/features/stage/mmdCompanionRuntime.js";
import type { MmdCameraSnapshot, MmdModelAsset, RenderPipeline } from "@/lib/types";

declare global {
  interface Window {
    __mmdCompanionRuntime?: any;
  }
}

type StageInteraction = {
  emotion: string;
  action: string;
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
  sequence?: Array<{
    template: string;
    action: string;
    durationMs: number;
    intensity: number;
  }>;
};

type StageClickRipple = {
  id: string;
  x: number;
  y: number;
  xPercent?: number;
  yPercent?: number;
};

type StagePointerCandidate = {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
};

function toAbsolute(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
  return `${baseUrl}${url.startsWith("/") ? url : `/${url}`}`;
}

export type MMDStageHandle = {
  unlockCamera: () => MmdCameraSnapshot | null;
  lockCamera: () => MmdCameraSnapshot | null;
  captureCamera: () => MmdCameraSnapshot | null;
  resetCamera: () => MmdCameraSnapshot | null;
  setSpeechLevel: (level: number) => void;
  setSpeechViseme: (frame: { viseme: string; weight?: number } | null) => void;
};

type MMDStageProps = {
  interaction: StageInteraction;
  speaking: boolean;
  models: MmdModelAsset[];
  selectedModelPath: string;
  modelUrl: string;
  modelLabel: string;
  onModelChange: (nextPath: string) => void;
  onInteractionComplete?: () => void;
  onInteractionError?: (error: { type: "vmd"; vmdUrl: string }) => void;
  onCharacterClick?: (event: { clientX: number; clientY: number; stageRect: DOMRect }) => void;
  clickRipples?: StageClickRipple[];
  renderPipeline?: RenderPipeline;
  cameraSnapshot?: MmdCameraSnapshot | null;
  chrome?: "panel" | "bare";
};

export const MMDStage = forwardRef<MMDStageHandle, MMDStageProps>(function MMDStage({
  interaction,
  speaking,
  models,
  selectedModelPath,
  modelUrl,
  modelLabel,
  onModelChange,
  onInteractionComplete,
  onInteractionError,
  onCharacterClick,
  clickRipples = [],
  renderPipeline = "classic",
  cameraSnapshot = null,
  chrome = "panel",
}: MMDStageProps, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const runtimeRef = useRef<any>(null);
  const currentInteractionRef = useRef(interaction);
  const currentSpeakingRef = useRef(speaking);
  const cameraSnapshotRef = useRef<MmdCameraSnapshot | null>(cameraSnapshot);
  const onInteractionErrorRef = useRef(onInteractionError);
  const stagePointerCandidateRef = useRef<StagePointerCandidate | null>(null);

  currentInteractionRef.current = interaction;
  currentSpeakingRef.current = speaking;
  cameraSnapshotRef.current = cameraSnapshot;
  onInteractionErrorRef.current = onInteractionError;

  useImperativeHandle(
    ref,
    () => ({
      unlockCamera() {
        return runtimeRef.current?.setCameraLocked?.(false) ?? null;
      },
      lockCamera() {
        return runtimeRef.current?.setCameraLocked?.(true) ?? null;
      },
      captureCamera() {
        return runtimeRef.current?.getCameraSnapshot?.() ?? null;
      },
      resetCamera() {
        return runtimeRef.current?.resetCameraToDefault?.() ?? null;
      },
      setSpeechLevel(level: number) {
        runtimeRef.current?.setSpeechLevel?.(level);
      },
      setSpeechViseme(frame: { viseme: string; weight?: number } | null) {
        runtimeRef.current?.setSpeechViseme?.(frame);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current || !statusRef.current) return;
    if (!modelUrl) {
      runtimeRef.current = null;
      statusRef.current.textContent = "No MMD models found.";
      return;
    }
    let disposed = false;
    const runtime = new (MMDCompanionRuntime as any)({
      container: containerRef.current,
      statusElement: statusRef.current,
      renderPipeline,
      cameraSnapshot: cameraSnapshotRef.current,
    });
    runtimeRef.current = runtime;
    if (process.env.NODE_ENV !== "production") {
      window.__mmdCompanionRuntime = runtime;
    }
    applyStageRuntimeState(runtime, {
      interaction: currentInteractionRef.current,
      speaking: currentSpeakingRef.current,
      resolveUrl: toAbsolute,
    });
    runtime
      .init(toAbsolute(modelUrl))
      .then(() => {
        if (disposed) return;
        applyStageRuntimeState(runtime, {
          interaction: currentInteractionRef.current,
          speaking: currentSpeakingRef.current,
          resolveUrl: toAbsolute,
        });
      })
      .catch((error: Error) => {
        if (disposed) return;
        statusRef.current!.textContent = `Model load failed: ${error.message}`;
      });
    return () => {
      disposed = true;
      if (process.env.NODE_ENV !== "production" && window.__mmdCompanionRuntime === runtime) {
        delete window.__mmdCompanionRuntime;
      }
      runtime.dispose();
    };
  }, [modelUrl, renderPipeline]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setSpeaking(speaking);
  }, [speaking]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (interaction.mode === "vmd" && interaction.vmdUrl) {
      let cancelled = false;
      const requestedVmdUrl = toAbsolute(interaction.vmdUrl);
      void Promise.resolve(runtime.playVmd(
        requestedVmdUrl,
        interaction.playbackRate,
        interaction.vmdLoopUrls?.map((url) => toAbsolute(url)),
        {
          standbyUrl: interaction.standbyVmdUrl ? toAbsolute(interaction.standbyVmdUrl) : "",
          loopGapMs: interaction.loopGapMs,
          loopMode: interaction.loopMode === "sequential" ? "sequential" : "random",
          ...(interaction.lockLowerBody ? { lockLowerBody: true } : {}),
          ...(interaction.disableCrossfade ? { disableCrossfade: true } : {}),
          emotionByUrl: interaction.vmdLoopEmotionByUrl
            ? Object.fromEntries(
                Object.entries(interaction.vmdLoopEmotionByUrl).map(([url, emotion]) => [toAbsolute(url), emotion]),
              )
            : undefined,
        },
      )).then((played) => {
        if (!cancelled && played === false) {
          onInteractionErrorRef.current?.({ type: "vmd", vmdUrl: requestedVmdUrl });
        }
      });
      return () => {
        cancelled = true;
      };
    }
    runtime.applyInteraction(interaction);
  }, [interaction]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (!cameraSnapshot) return;
    runtime.applyCameraSnapshot(cameraSnapshot);
  }, [cameraSnapshot]);

  useEffect(() => {
    if (!onInteractionComplete) return;
    if (interaction.mode === "vmd" && (interaction.vmdLoopUrls?.length || interaction.standbyVmdUrl)) return;

    let armedProceduralCompletion = false;
    const expectedVmdUrl = interaction.mode === "vmd" && interaction.vmdUrl ? toAbsolute(interaction.vmdUrl) : "";
    const intervalId = window.setInterval(() => {
      const runtime = runtimeRef.current;
      if (!runtime || runtime.isLoadingVmd) return;

      if (interaction.mode === "vmd") {
        if (!expectedVmdUrl || runtime.currentVmdUrl !== expectedVmdUrl) return;
        if (!runtime.currentVmdDurationMs || !runtime.currentVmdStartedAt) return;
        if (performance.now() - runtime.currentVmdStartedAt < runtime.currentVmdDurationMs) return;
        window.clearInterval(intervalId);
        onInteractionComplete();
        return;
      }

      if (runtime.currentSequence || runtime.currentAction) {
        armedProceduralCompletion = true;
        return;
      }
      if (!armedProceduralCompletion) return;
      window.clearInterval(intervalId);
      onInteractionComplete();
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [interaction, onInteractionComplete]);

  function handleModelChange(event: ChangeEvent<HTMLSelectElement>) {
    onModelChange(event.target.value);
  }

  function handleStagePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    stagePointerCandidateRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: event.timeStamp,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleStagePointerUp(event: PointerEvent<HTMLElement>) {
    const candidate = stagePointerCandidateRef.current;
    stagePointerCandidateRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    if (
      !shouldTriggerStageCharacterClick({
        downClientX: candidate.clientX,
        downClientY: candidate.clientY,
        upClientX: event.clientX,
        upClientY: event.clientY,
        downTimeMs: candidate.timeStamp,
        upTimeMs: event.timeStamp,
      })
    ) {
      return;
    }
    const runtime = runtimeRef.current;
    if (!runtime?.hitTestModelAtClientPoint?.(event.clientX, event.clientY)) return;
    onCharacterClick?.({
      clientX: event.clientX,
      clientY: event.clientY,
      stageRect: event.currentTarget.getBoundingClientRect(),
    });
  }

  function handleStagePointerCancel() {
    stagePointerCandidateRef.current = null;
  }

  function renderClickRipples() {
    if (!clickRipples.length) return null;
    return (
      <div className="mio-stage-click-ripples" aria-hidden="true">
        {clickRipples.map((ripple) => (
          <span
            key={ripple.id}
            className="mio-stage-click-ripple"
            style={{ left: `${ripple.x}px`, top: `${ripple.y}px` }}
          />
        ))}
      </div>
    );
  }

  if (chrome === "bare") {
    return (
      <section
        className="mio-stage"
        aria-label="MMD companion stage"
        onPointerDown={handleStagePointerDown}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerCancel}
      >
        <div ref={containerRef} className="mio-stage-canvas" />
        {renderClickRipples()}
        <p ref={statusRef} className="mio-stage-status mio-stage-status--sr-only" aria-live="polite" hidden>
          Initializing stage...
        </p>
      </section>
    );
  }

  return (
    <section className="panel" style={{ display: "grid", gridTemplateRows: "auto 1fr auto", minHeight: 0 }}>
      <header style={{ padding: "0.95rem 1rem 0.35rem" }}>
        <h2 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Companion Stage</h2>
        <p className="muted" style={{ margin: "0.35rem 0 0" }}>
          Model: {modelLabel || "No model selected"}
        </p>
        <label style={{ display: "grid", gap: "0.35rem", marginTop: "0.7rem", maxWidth: "20rem" }}>
          <span className="muted">Model</span>
          <select
            className="select"
            aria-label="Model"
            value={selectedModelPath}
            onChange={handleModelChange}
            disabled={models.length === 0}
          >
            {models.length === 0 ? <option value="">No MMD models</option> : null}
            {models.map((model) => (
              <option key={model.relative_path} value={model.relative_path}>
                {getModelDisplayLabel(model)}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div
        ref={containerRef}
        onPointerDown={handleStagePointerDown}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerCancel}
        style={{
          margin: "0.45rem 0.95rem",
          minHeight: 0,
          borderRadius: "0.8rem",
          border: "1px solid rgba(140, 209, 255, 0.19)",
          overflow: "hidden",
        }}
      />
      <p ref={statusRef} className="muted" style={{ margin: 0, padding: "0.6rem 1rem 0.9rem" }}>
        Initializing stage...
      </p>
    </section>
  );
});
