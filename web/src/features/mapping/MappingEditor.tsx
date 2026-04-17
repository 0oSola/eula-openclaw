"use client";

import { useMemo, useState } from "react";

import { listVmdAssets, putUserMappings, uploadVmdAsset } from "@/lib/api";
import type { MappingConfig, VmdAsset } from "@/lib/types";

const SLOTS = ["neutral", "happy", "sad", "thinking", "excited", "caring"] as const;
const PROCEDURAL_ACTIONS = [
  "idle",
  "nod",
  "wave",
  "think",
  "cheer",
  "comfort",
  "lean_in",
  "look_away",
  "headshake",
];

export function MappingEditor({
  userId,
  mappings,
  onMappingsChange,
  assets,
  onAssetsChange,
  onPreviewAsset,
}: {
  userId: string;
  mappings: Record<string, MappingConfig>;
  onMappingsChange: (value: Record<string, MappingConfig>) => void;
  assets: VmdAsset[];
  onAssetsChange: (value: VmdAsset[]) => void;
  onPreviewAsset: (asset: VmdAsset) => void;
}) {
  const [busySlot, setBusySlot] = useState<string>("");
  const [error, setError] = useState("");

  const assetsBySlot = useMemo(() => {
    const map: Record<string, VmdAsset[]> = {};
    for (const slot of SLOTS) map[slot] = [];
    for (const item of assets) {
      map[item.slot] ||= [];
      map[item.slot].push(item);
    }
    return map;
  }, [assets]);

  async function refreshAssets() {
    const next = await listVmdAssets(userId);
    onAssetsChange(next);
  }

  async function saveSlot(slot: string, config: MappingConfig) {
    setBusySlot(slot);
    setError("");
    try {
      const updated = await putUserMappings(userId, { [slot]: config });
      onMappingsChange({ ...mappings, ...updated });
      await refreshAssets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mapping.");
    } finally {
      setBusySlot("");
    }
  }

  async function upload(slot: string, file: File) {
    setBusySlot(slot);
    setError("");
    try {
      const item = await uploadVmdAsset(userId, slot, file);
      const nextAssets = [item, ...assets];
      onAssetsChange(nextAssets);
      onPreviewAsset(item);
      await saveSlot(slot, { kind: "vmd", value: item.asset_id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setBusySlot("");
    }
  }

  return (
    <section className="panel" style={{ padding: "0.9rem", display: "grid", gap: "0.7rem" }}>
      <h3 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Action Mapping</h3>
      {error ? (
        <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.9rem" }}>
          {error}
        </p>
      ) : null}
      {SLOTS.map((slot) => {
        const current = mappings[slot] || { kind: "procedural", value: slot === "happy" ? "wave" : "nod" };
        const candidates = assetsBySlot[slot] || [];
        const selectedVmd = candidates.find((item) => item.asset_id === current.value) || null;
        return (
          <article
            key={slot}
            style={{
              border: "1px solid rgba(140, 209, 255, 0.15)",
              borderRadius: "0.7rem",
              padding: "0.65rem",
              display: "grid",
              gap: "0.5rem",
            }}
          >
            <strong style={{ textTransform: "capitalize" }}>{slot}</strong>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.5rem" }}>
              <select
                className="select"
                defaultValue={current.kind}
                onChange={(event) => {
                  const nextKind = event.target.value as "procedural" | "vmd";
                  const nextValue =
                    nextKind === "procedural"
                      ? "nod"
                      : candidates[0]?.asset_id || current.value || "";
                  saveSlot(slot, { kind: nextKind, value: nextValue });
                }}
                disabled={busySlot === slot}
              >
                <option value="procedural">procedural</option>
                <option value="vmd">vmd</option>
              </select>
              {current.kind === "procedural" ? (
                <select
                  className="select"
                  value={current.value}
                  onChange={(event) => saveSlot(slot, { kind: "procedural", value: event.target.value })}
                  disabled={busySlot === slot}
                >
                  {PROCEDURAL_ACTIONS.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem" }}>
                  <select
                    className="select"
                    value={current.value}
                    onChange={(event) => saveSlot(slot, { kind: "vmd", value: event.target.value })}
                    disabled={busySlot === slot}
                  >
                    {candidates.length ? null : <option value="">No VMD for this slot</option>}
                    {candidates.map((item) => (
                      <option key={item.asset_id} value={item.asset_id}>
                        {item.filename}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={busySlot === slot || !selectedVmd}
                    onClick={() => {
                      if (!selectedVmd) return;
                      onPreviewAsset(selectedVmd);
                    }}
                  >
                    预览
                  </button>
                </div>
              )}
              <label className="btn secondary" style={{ textAlign: "center", minWidth: "6rem" }}>
                上传 VMD
                <input
                  type="file"
                  accept=".vmd"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) upload(slot, file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          </article>
        );
      })}
    </section>
  );
}
