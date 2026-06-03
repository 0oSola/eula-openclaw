import type { MmdModelAsset, VmdAsset } from "@/lib/types";

const MIN_FALLBACK_MODEL_BYTES = 1024;

function isFallbackLoadable(model: MmdModelAsset): boolean {
  return typeof model.size_bytes !== "number" || model.size_bytes >= MIN_FALLBACK_MODEL_BYTES;
}

export function pickSelectedModel(models: MmdModelAsset[], selectedModelPath: string | null | undefined) {
  if (selectedModelPath) {
    return models.find((model) => model.relative_path === selectedModelPath) ?? models.find(isFallbackLoadable) ?? models[0] ?? null;
  }
  return models.find(isFallbackLoadable) ?? models[0] ?? null;
}

export function selectFavoriteVmdUrls(assets: VmdAsset[], selectedModelPath: string): string[] {
  return assets
    .filter((asset) => asset.is_favorite && asset.favorite_model_relative_path === selectedModelPath)
    .map((asset) => `/assets/vmd/file/${asset.asset_id}`);
}
