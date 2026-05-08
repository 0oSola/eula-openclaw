import { DEFAULT_VMD_PLAYBACK_RATE } from "../stage/builtInMotionPreferences.js";

const IDLE_ANIMATIONS_PACK_PLAYBACK_RATE = 2.5;
const ENTRY_STANDBY_HINTS = ["\u8fdb\u573a\u5f85\u673a", "\u6769\u6d98\u6e80\u5bf0\u546e\u6e80", "entry idle"];
const ENTRY_GREETING_FILENAMES = ["\u6253\u62db\u547c1.vmd", "\u817c\u8146\u6253\u62db\u547c.vmd", "\u884c\u793c1.vmd"];
function describeVmdAsset(asset) {
  return [asset?.source_relative_path, asset?.filename, asset?.display_name, asset?.url]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function describeAssetName(asset) {
  return [asset?.display_name, asset?.filename].filter(Boolean).join(" ").toLowerCase();
}

function normalizeAssetFilename(asset) {
  const name = asset?.filename || asset?.display_name || "";
  return name.trim().toLowerCase();
}

function pickRandomItem(items, randomValue = Math.random()) {
  if (!items.length) return null;
  const clamped = Math.min(0.999999, Math.max(0, Number(randomValue) || 0));
  return items[Math.floor(clamped * items.length)] || items[0] || null;
}

export function isEntryStandbyAsset(asset) {
  const text = describeAssetName(asset);
  return ENTRY_STANDBY_HINTS.some((hint) => text.includes(hint));
}

export function excludeEntryStandbyAssets(assets = []) {
  return Array.isArray(assets) ? assets.filter((asset) => !isEntryStandbyAsset(asset)) : [];
}

export function isCompanionSafeVmdAsset(asset) {
  const profile = asset?.motion_profile;
  if (!profile) return true;
  return profile.companion_safe !== false;
}

export function excludeCompanionUnsafeAssets(assets = []) {
  return Array.isArray(assets) ? assets.filter((asset) => isCompanionSafeVmdAsset(asset)) : [];
}

export function getCompanionVmdPlaybackGuards(asset) {
  if (isCompanionSafeVmdAsset(asset)) return {};
  return {
    lockLowerBody: true,
    disableCrossfade: true,
  };
}

function clampPlaybackMultiplier(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(4, Math.max(0.1, numeric));
}

function normalizePlaybackRate(value) {
  return Math.round(value * 1000) / 1000;
}

export function resolveVmdPlaybackRate(asset, multiplier = 1) {
  const text = describeVmdAsset(asset);
  const rateMultiplier = clampPlaybackMultiplier(multiplier);
  if (text.includes("idle_animations_pack") || text.includes("idle animations pack")) {
    return normalizePlaybackRate(IDLE_ANIMATIONS_PACK_PLAYBACK_RATE * rateMultiplier);
  }
  return normalizePlaybackRate(DEFAULT_VMD_PLAYBACK_RATE * rateMultiplier);
}

export function createVmdPreviewInteraction(asset, multiplier = 1) {
  return {
    emotion: asset?.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: asset?.url || "",
    vmdLoopEmotionByUrl: asset?.url ? { [asset.url]: asset?.slot || "neutral" } : {},
    playbackRate: resolveVmdPlaybackRate(asset, multiplier),
    lockLowerBody: true,
    disableCrossfade: true,
    sequence: [],
  };
}

export function createDefaultFavoriteLoopInteraction(assets = [], { enabled = true, loopMode = "random" } = {}) {
  if (!enabled) return null;
  const playableAssets = excludeCompanionUnsafeAssets(excludeEntryStandbyAssets(assets)).filter((asset) => asset?.url);
  const leadAsset = playableAssets[0];
  if (!leadAsset) return null;

  return {
    emotion: leadAsset?.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: leadAsset.url,
    vmdLoopUrls: playableAssets.map((asset) => asset.url),
    vmdLoopEmotionByUrl: Object.fromEntries(
      playableAssets.filter((asset) => asset?.url).map((asset) => [asset.url, asset?.slot || "neutral"]),
    ),
    standbyVmdUrl: "",
    loopMode: loopMode === "sequential" ? "sequential" : "random",
    ...getCompanionVmdPlaybackGuards(leadAsset),
    playbackRate: resolveVmdPlaybackRate(leadAsset),
    sequence: [],
  };
}

export function createEntryGreetingFolderLoopInteraction(
  assets = [],
  { enabled = true, loopMode = "random", randomValue = Math.random() } = {},
) {
  if (!enabled) return null;
  const playableAssets = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.url);
  if (!playableAssets.length) return null;

  const greetingAssets = playableAssets.filter((asset) => ENTRY_GREETING_FILENAMES.includes(normalizeAssetFilename(asset)));
  const fallbackLeadAssets = excludeEntryStandbyAssets(playableAssets);
  const leadAsset = greetingAssets.length ? pickRandomItem(greetingAssets, randomValue) : fallbackLeadAssets[0] || playableAssets[0];
  if (!leadAsset) return null;

  return {
    emotion: leadAsset?.slot || "neutral",
    action: "idle",
    mode: "vmd",
    vmdUrl: leadAsset.url,
    vmdLoopUrls: playableAssets.map((asset) => asset.url),
    vmdLoopEmotionByUrl: Object.fromEntries(
      playableAssets.filter((asset) => asset?.url).map((asset) => [asset.url, asset?.slot || "neutral"]),
    ),
    standbyVmdUrl: "",
    loopMode: loopMode === "sequential" ? "sequential" : "random",
    playbackRate: resolveVmdPlaybackRate(leadAsset),
    sequence: [],
  };
}

export function buildAutoFavoriteInteraction(assets = [], options = {}) {
  return createEntryGreetingFolderLoopInteraction(assets, options);
}

export function buildAutoplayResumeInteraction(assets = [], options = {}) {
  const autoInteraction = buildAutoFavoriteInteraction(assets, options);
  if (!autoInteraction) return null;
  if (!autoInteraction.standbyVmdUrl) return autoInteraction;
  return {
    ...autoInteraction,
    vmdUrl: autoInteraction.standbyVmdUrl,
  };
}
