import type { MmdCameraSnapshot, RenderPipeline } from "@/lib/types";

export type PetInteractionMode = "window-drag" | "camera-adjust";

const STORAGE_KEY_PREFIX = "desktop-pet:mmd-camera";

type StoredPetCameraSnapshot = {
  version: 1;
  modelPath: string;
  renderPipeline: RenderPipeline;
  snapshot: MmdCameraSnapshot;
  updatedAt: string;
};

function petCameraStorageKey(modelPath: string, renderPipeline: RenderPipeline): string {
  return `${STORAGE_KEY_PREFIX}:${renderPipeline}:${encodeURIComponent(modelPath)}`;
}

function isCameraVector(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function normalizePetCameraSnapshot(value: unknown): MmdCameraSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<MmdCameraSnapshot>;
  if (typeof snapshot.fov !== "number" || !Number.isFinite(snapshot.fov)) return null;
  if (!isCameraVector(snapshot.position)) return null;
  if (!isCameraVector(snapshot.target)) return null;
  return {
    fov: snapshot.fov,
    position: snapshot.position,
    target: snapshot.target,
    locked: Boolean(snapshot.locked),
  };
}

export function preparePetCameraSnapshotForStorage(snapshot: MmdCameraSnapshot): MmdCameraSnapshot | null {
  const normalized = normalizePetCameraSnapshot(snapshot);
  return normalized ? { ...normalized, locked: true } : null;
}

export function loadPetCameraSnapshot(options: {
  storage: Storage;
  modelPath: string;
  renderPipeline: RenderPipeline;
}): MmdCameraSnapshot | null {
  const raw = options.storage.getItem(petCameraStorageKey(options.modelPath, options.renderPipeline));
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as Partial<StoredPetCameraSnapshot>;
    if (payload.version !== 1) return null;
    if (payload.modelPath !== options.modelPath || payload.renderPipeline !== options.renderPipeline) return null;
    return normalizePetCameraSnapshot(payload.snapshot);
  } catch {
    return null;
  }
}

export function savePetCameraSnapshot(options: {
  storage: Storage;
  modelPath: string;
  renderPipeline: RenderPipeline;
  snapshot: MmdCameraSnapshot;
  nowIso?: string;
}): void {
  const snapshot = normalizePetCameraSnapshot(options.snapshot);
  if (!snapshot) return;
  const payload: StoredPetCameraSnapshot = {
    version: 1,
    modelPath: options.modelPath,
    renderPipeline: options.renderPipeline,
    snapshot,
    updatedAt: options.nowIso ?? new Date().toISOString(),
  };
  options.storage.setItem(petCameraStorageKey(options.modelPath, options.renderPipeline), JSON.stringify(payload));
}

export function shouldPersistPetCameraOnModeChange(
  previousMode: PetInteractionMode,
  nextMode: PetInteractionMode,
): boolean {
  return previousMode === "camera-adjust" && nextMode === "window-drag";
}
