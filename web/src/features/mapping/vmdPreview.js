import { DEFAULT_VMD_PLAYBACK_RATE } from "../stage/builtInMotionPreferences.js";

const IDLE_ANIMATIONS_PACK_PLAYBACK_RATE = 2.5;
const ENTRY_STANDBY_HINTS = ["\u8fdb\u573a\u5f85\u673a", "\u6769\u6d98\u6e80\u5bf0\u546e\u6e80", "entry idle"];
const ENTRY_GREETING_FILENAMES = ["\u6253\u62db\u547c1.vmd", "\u817c\u8146\u6253\u62db\u547c.vmd", "\u884c\u793c1.vmd"];
export const VMD_MOTION_CATEGORIES = Object.freeze({
  IDLE_LOOP: "00_idle_loop",
  ENTRY_FALLBACK: "01_entry_fallback",
  GREETING_SOCIAL: "02_greeting_social",
  THINKING_WAITING: "03_thinking_waiting",
  ANSWERING_EXPLAIN: "04_answering_explain",
  SOFT_EMOTION: "05_soft_emotion",
  STRONG_PERSONALITY: "06_strong_personality",
});
export const IDLE_LOOP_VMD_CATEGORIES = Object.freeze([VMD_MOTION_CATEGORIES.IDLE_LOOP]);
export const CLICK_REACTION_VMD_CATEGORIES = Object.freeze([
  VMD_MOTION_CATEGORIES.GREETING_SOCIAL,
  VMD_MOTION_CATEGORIES.SOFT_EMOTION,
  VMD_MOTION_CATEGORIES.STRONG_PERSONALITY,
]);
export const CLICK_FALLBACK_EXCLUDED_VMD_CATEGORIES = Object.freeze([
  VMD_MOTION_CATEGORIES.IDLE_LOOP,
  VMD_MOTION_CATEGORIES.ENTRY_FALLBACK,
]);

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

function describeVmdAssetPath(asset) {
  return [asset?.favorite_relative_path, asset?.source_relative_path, asset?.relative_path]
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .toLowerCase();
}

export function getVmdAssetCategory(asset) {
  const text = describeVmdAssetPath(asset);
  if (!text) return "";
  return (
    Object.values(VMD_MOTION_CATEGORIES).find(
      (category) => text.includes(`/${category.toLowerCase()}/`) || text.includes(`${category.toLowerCase()}/`),
    ) || ""
  );
}

export function isVmdAssetInCategory(asset, categories = []) {
  const category = getVmdAssetCategory(asset);
  return Boolean(category && new Set(categories).has(category));
}

export function filterVmdAssetsByCategories(assets = [], categories = []) {
  if (!Array.isArray(assets) || !categories?.length) return [];
  const categorySet = new Set(categories);
  return assets.filter((asset) => {
    const category = getVmdAssetCategory(asset);
    return category && categorySet.has(category);
  });
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

function getPlayableVmdAssets(assets = []) {
  return excludeCompanionUnsafeAssets(Array.isArray(assets) ? assets : []).filter((asset) => asset?.url);
}

export function selectAutoplayIdleVmdAssets(assets = []) {
  const categorizedIdleAssets = getPlayableVmdAssets(filterVmdAssetsByCategories(assets, IDLE_LOOP_VMD_CATEGORIES));
  if (categorizedIdleAssets.length) return categorizedIdleAssets;
  return getPlayableVmdAssets(excludeEntryStandbyAssets(assets));
}

/**
 * 待机播放与收藏归属是两层语义：当前模型的收藏永远优先；只有它没有任何
 * 可播放待机时，才从其它模型的已收藏安全 VMD 中借用一个只读待机池。
 *
 * 调用方不得把 returned fallback 用于资源库、收藏/取消收藏、聊天意图解析或
 * 点击动作；它只用于避免 PMX 在没有本模型待机时回到 T 姿 bind pose。
 */
export function resolveAutoplayVmdAssetPool(currentModelAssets = [], sharedIdleAssets = []) {
  if (selectAutoplayIdleVmdAssets(currentModelAssets).length) return currentModelAssets;
  return Array.isArray(sharedIdleAssets) ? sharedIdleAssets : [];
}

export function selectIdleFallbackVmdAsset(assets = [], { randomValue = Math.random() } = {}) {
  return pickRandomItem(selectAutoplayIdleVmdAssets(assets), randomValue);
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

export function createIdleVmdFallbackInteraction(
  assets = [],
  { enabled = true, emotion = "neutral", action = "idle", randomValue = Math.random() } = {},
) {
  if (!enabled) return null;
  const asset = selectIdleFallbackVmdAsset(assets, { randomValue });
  if (!asset?.url) return null;
  const resolvedEmotion = emotion || asset?.slot || "neutral";

  return {
    activeVmdAssetId: asset.asset_id || "",
    interaction: {
      emotion: resolvedEmotion,
      action: action || "idle",
      mode: "vmd",
      vmdUrl: asset.url,
      vmdLoopUrls: [],
      vmdLoopEmotionByUrl: { [asset.url]: resolvedEmotion },
      standbyVmdUrl: "",
      loopGapMs: 0,
      loopMode: "random",
      playbackRate: resolveVmdPlaybackRate(asset),
      sequence: [],
    },
  };
}

export function createDefaultFavoriteLoopInteraction(
  assets = [],
  { enabled = true, loopMode = "random", leadMode = "first", randomValue = Math.random() } = {},
) {
  if (!enabled) return null;
  const playableAssets = selectAutoplayIdleVmdAssets(assets);
  const leadAsset = leadMode === "random" ? pickRandomItem(playableAssets, randomValue) : playableAssets[0];
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
  { enabled = true, loopMode = "random", randomValue = Math.random(), leadMode = "entry" } = {},
) {
  if (!enabled) return null;
  const playableAssets = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.url);
  if (!playableAssets.length) return null;

  const greetingAssets = playableAssets.filter((asset) => ENTRY_GREETING_FILENAMES.includes(normalizeAssetFilename(asset)));
  const fallbackLeadAssets = excludeEntryStandbyAssets(playableAssets);
  const randomLeadAssets = fallbackLeadAssets.length ? fallbackLeadAssets : playableAssets;
  const leadAsset =
    leadMode === "random"
      ? pickRandomItem(randomLeadAssets, randomValue)
      : greetingAssets.length
        ? pickRandomItem(greetingAssets, randomValue)
        : fallbackLeadAssets[0] || playableAssets[0];
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
  return createDefaultFavoriteLoopInteraction(assets, { ...options, leadMode: "random" });
}

export function buildAutoplayResumeInteraction(assets = [], options = {}) {
  const autoInteraction = createDefaultFavoriteLoopInteraction(assets, { ...options, leadMode: "random" });
  if (!autoInteraction) return null;
  if (!autoInteraction.standbyVmdUrl) return autoInteraction;
  return {
    ...autoInteraction,
    vmdUrl: autoInteraction.standbyVmdUrl,
  };
}
