const DEFAULT_VMD_PLAYBACK_RATE = 1.2;
const ENTRY_STANDBY_HINTS = ["杩涘満寰呮満", "entry idle"];

function normalizeAssetName(value) {
  return String(value || "").trim().toLowerCase();
}

export function isEntryStandbyAsset(asset) {
  const candidates = [asset?.display_name, asset?.filename].map(normalizeAssetName);
  return candidates.some((value) => ENTRY_STANDBY_HINTS.some((hint) => value.includes(hint)));
}

export function resolveVmdPlaybackRate() {
  return DEFAULT_VMD_PLAYBACK_RATE;
}

export function createVmdPreviewInteraction(asset) {
  return {
    emotion: asset?.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: asset?.url || "",
    sequence: [],
  };
}

export function createDefaultFavoriteLoopInteraction(assets = [], { loopMode = "random" } = {}) {
  const assetsWithUrls = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.url);
  const standbyAsset = assetsWithUrls.find((asset) => isEntryStandbyAsset(asset)) || null;
  const playableAssets = assetsWithUrls.filter((asset) => asset !== standbyAsset);
  const leadAsset = playableAssets[0] || standbyAsset;

  if (!leadAsset) return null;

  return {
    emotion: leadAsset.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: leadAsset.url,
    vmdLoopUrls: playableAssets.map((asset) => asset.url),
    standbyVmdUrl: standbyAsset?.url || "",
    loopMode: loopMode === "sequential" ? "sequential" : "random",
    playbackRate: resolveVmdPlaybackRate(leadAsset),
    sequence: [],
  };
}
