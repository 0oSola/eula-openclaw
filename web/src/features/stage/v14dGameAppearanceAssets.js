export const V14D_GAME_MANIFEST_URL = "/assets/v14d-game/manifest";

export const V14D_GAME_DEFAULT_SETTINGS = Object.freeze({
  display: "game/ocio",
  exposure: -0.4,
  fabricDetail: 2,
  legStructure: 1,
  closedEye: "reference",
  smile: 0.55,
  iris: 2,
  autoFace: true,
  manualMask: 2,
  lightingEnabled: true,
  hairMaskStrength: 1,
  hairMaskView: false,
  hairDiskCandidate: false,
  rotation: 0,
});

export function createV14dGameModelAsset(manifest) {
  const model = manifest?.model;
  const relativePath = String(model?.relativePath || "").trim();
  const url = String(model?.url || "").trim();
  if (!relativePath && !url) return null;
  const name = (relativePath.split(/[\\/]/).filter(Boolean).pop() || "GirlsFrontline KoledaDefault.pmx").trim();
  return {
    name,
    label: "Koleda（V14D 本机游戏外观）",
    relative_path: relativePath || name,
    size_bytes: Number(model?.sizeBytes) || 0,
    url,
  };
}

const REQUIRED_OCIO_KEYS = ["processor", "shader", "lut0", "lut1"];

export function validateV14dGameManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, reason: "V14D 游戏外观清单缺失。" };
  }
  if (manifest.available === false) {
    return { ok: false, reason: String(manifest.reason || "V14D 游戏外观资源不可用。") };
  }
  if (!manifest.model?.url || !/\.(pmx|pmd)(?:$|[?#])/i.test(String(manifest.model.url))) {
    return { ok: false, reason: "V14D 游戏外观模型资源未登记。" };
  }
  if (!manifest.model.relativePath || !manifest.model.sha256) {
    return { ok: false, reason: "V14D 游戏外观模型身份不完整。" };
  }
  const ocio = manifest.ocio || {};
  const missingOcio = REQUIRED_OCIO_KEYS.filter((key) => !ocio[key]?.url || !ocio[key]?.sha256);
  if (missingOcio.length) {
    return { ok: false, reason: "V14D 本机 OCIO 资源缺失：" + missingOcio.join(", ") + "。" };
  }
  if (!Array.isArray(manifest.textures) || !manifest.textures.length) {
    return { ok: false, reason: "V14D 游戏外观材质纹理未登记。" };
  }
  if (manifest.textures.some((entry) => !entry?.key || !entry?.url || !entry?.sha256 || !entry?.kind)) {
    return { ok: false, reason: "V14D 游戏外观材质纹理身份不完整。" };
  }
  if (!Array.isArray(manifest.lights) || manifest.lights.length !== 6) {
    return { ok: false, reason: "V14D 游戏外观六灯清单不完整。" };
  }
  for (const light of manifest.lights) {
    if (
      light?.type !== "AREA" ||
      !["DISK", "RECTANGLE"].includes(light.shape) ||
      !Array.isArray(light.color) ||
      light.color.length !== 3 ||
      !Array.isArray(light.matrix) ||
      light.matrix.length !== 4 ||
      light.matrix.some((row) => !Array.isArray(row) || row.length !== 4 || row.some((value) => !Number.isFinite(Number(value)))) ||
      !Number.isFinite(Number(light.size)) ||
      !Number.isFinite(Number(light.sizeY)) ||
      !Number.isFinite(Number(light.power))
    ) {
      return { ok: false, reason: "V14D 游戏外观六灯参数不完整。" };
    }
  }
  if (!manifest.sourceManifestSha256) {
    return { ok: false, reason: "V14D 游戏外观源清单身份缺失。" };
  }
  return { ok: true, reason: "" };
}

export function getV14dGameTextureUrl(manifest, key) {
  return manifest?.textures?.find((item) => item?.key === key)?.url || "";
}
