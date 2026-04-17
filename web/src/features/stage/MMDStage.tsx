"use client";

import { ChangeEvent, useEffect, useRef } from "react";

import { getModelDisplayLabel } from "@/features/stage/modelCatalog.js";
import { MMDCompanionRuntime } from "@/features/stage/mmdCompanionRuntime.js";
import type { MmdModelAsset } from "@/lib/types";

type StageInteraction = {
  emotion: string;
  action: string;
  mode?: "procedural" | "vmd";
  vmdUrl?: string;
  sequence?: Array<{
    template: string;
    action: string;
    durationMs: number;
    intensity: number;
  }>;
};

function toAbsolute(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
  return `${baseUrl}${url.startsWith("/") ? url : `/${url}`}`;
}

export function MMDStage({
  interaction,
  speaking,
  models,
  selectedModelPath,
  modelUrl,
  modelLabel,
  onModelChange,
}: {
  interaction: StageInteraction;
  speaking: boolean;
  models: MmdModelAsset[];
  selectedModelPath: string;
  modelUrl: string;
  modelLabel: string;
  onModelChange: (nextPath: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const runtimeRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !statusRef.current) return;
    if (!modelUrl) {
      runtimeRef.current = null;
      statusRef.current.textContent = "No MMD models found.";
      return;
    }
    const runtime = new MMDCompanionRuntime({
      container: containerRef.current,
      statusElement: statusRef.current,
    });
    runtimeRef.current = runtime;
    runtime.init(toAbsolute(modelUrl)).catch((error: Error) => {
      statusRef.current!.textContent = `Model load failed: ${error.message}`;
    });
    return () => runtime.dispose();
  }, [modelUrl]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.setSpeaking(speaking);
  }, [speaking]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (interaction.mode === "vmd" && interaction.vmdUrl) {
      runtime.playVmd(toAbsolute(interaction.vmdUrl));
      return;
    }
    runtime.applyInteraction(interaction);
  }, [interaction]);

  function handleModelChange(event: ChangeEvent<HTMLSelectElement>) {
    onModelChange(event.target.value);
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
}
