import * as THREE from "three";
import { isKoledaModelIdentifier } from "./koledaDefaultAppearance.js";
import {
  V14D_GAME_DEFAULT_SETTINGS,
  V14D_GAME_MANIFEST_URL,
  getV14dGameTextureUrl,
  validateV14dGameManifest,
} from "./v14dGameAppearanceAssets.js";

const IDLE_STATUS = Object.freeze({
  pipeline: "v14d-game",
  phase: "idle",
  realAppearanceAvailable: false,
  label: "V14D 游戏外观未安装",
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function materialList(child) {
  const material = child?.material;
  if (Array.isArray(material)) return material.filter(Boolean);
  return material ? [material] : [];
}

function text(value) {
  return String(value || "").trim().toLowerCase().replace(/[ _]+/g, "");
}

function isCapeNode(node) {
  const name = text(node?.name);
  return name === "cth1-cape" || name === "cth1-cape2" || name.includes("cth1-cape") || name.includes("cth1-cape2");
}

function isEyesPlusMaterial(material) {
  return text(material?.name).includes("eyes+") || text(material?.name).includes("eyesplus");
}

function materialMatches(material, hints) {
  const name = text(material?.name);
  return asArray(hints).some((hint) => name.includes(text(hint)));
}

function loadTexture(loader, url) {
  if (!url) return Promise.reject(new Error("纹理 URL 缺失。"));
  if (typeof loader?.loadAsync === "function") return loader.loadAsync(url);
  if (typeof loader?.load !== "function") return Promise.reject(new Error("纹理加载器不可用。"));
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

function snapshotMaterial(material) {
  return {
    material,
    map: material.map,
    normalMap: material.normalMap,
    roughnessMap: material.roughnessMap,
    metalnessMap: material.metalnessMap,
    alphaTest: material.alphaTest,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    opacity: material.opacity,
    side: material.side,
    visible: material.visible,
    userData: { ...(material.userData || {}) },
  };
}

function restoreMaterial(snapshot) {
  const material = snapshot.material;
  material.map = snapshot.map;
  material.normalMap = snapshot.normalMap;
  material.roughnessMap = snapshot.roughnessMap;
  material.metalnessMap = snapshot.metalnessMap;
  material.alphaTest = snapshot.alphaTest;
  material.transparent = snapshot.transparent;
  material.depthWrite = snapshot.depthWrite;
  material.opacity = snapshot.opacity;
  material.side = snapshot.side;
  material.visible = snapshot.visible;
  material.userData = { ...(snapshot.userData || {}) };
  material.needsUpdate = true;
}

function snapshotNode(node) {
  return { node, visible: node.visible };
}

function restoreNode(snapshot) {
  snapshot.node.visible = snapshot.visible;
}

export function createV14dGameAppearanceAdapter({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  manifestUrl = V14D_GAME_MANIFEST_URL,
  manifest: initialManifest = null,
  textureLoader = new THREE.TextureLoader(),
} = {}) {
  let status = { ...IDLE_STATUS };
  let installedModel = null;
  let installedManifest = initialManifest;
  let materialSnapshots = [];
  let nodeSnapshots = [];
  let ownedTextures = [];
  let installGeneration = 0;

  const getStatus = () => ({
    ...status,
    installed: installedModel !== null,
    settings: { ...V14D_GAME_DEFAULT_SETTINGS },
    manifestId: installedManifest?.id || null,
  });

  async function resolveManifest(override) {
    if (override) return override;
    if (installedManifest) return installedManifest;
    if (typeof fetchImpl !== "function") throw new Error("V14D 游戏外观清单请求器不可用。");
    const response = await fetchImpl(manifestUrl, { cache: "no-store" });
    if (!response?.ok) throw new Error("V14D 游戏外观清单请求失败（" + (response?.status || "未知") + "）。");
    installedManifest = await response.json();
    return installedManifest;
  }

  function resetSnapshots() {
    materialSnapshots = [];
    nodeSnapshots = [];
  }

  function restoreInstall(materials, nodes, textures) {
    for (const snapshot of materials) restoreMaterial(snapshot);
    for (const snapshot of nodes) restoreNode(snapshot);
    for (const texture of textures) texture.dispose?.();
  }

  function restore() {
    restoreInstall(materialSnapshots, nodeSnapshots, ownedTextures);
    ownedTextures = [];
    resetSnapshots();
    installedModel = null;
  }

  async function install({ model, modelUrl = "", manifest = null } = {}) {
    if (installedModel === model && status.phase === "ready") return getStatus();
    const generation = ++installGeneration;
    restore();
    if (!model) {
      status = { ...IDLE_STATUS, phase: "unavailable", label: "V14D 游戏外观不可用：模型缺失", reason: "模型缺失。" };
      return getStatus();
    }
    if (!isKoledaModelIdentifier(modelUrl, model.name, model.userData?.modelUrl, model.userData?.modelPath)) {
      status = {
        ...IDLE_STATUS,
        phase: "unsupported",
        label: "V14D 游戏外观不可用：仅支持克莱妲模型",
        reason: "当前模型不是明确支持的克莱妲模型。",
      };
      return getStatus();
    }

    const nextMaterialSnapshots = [];
    const nextNodeSnapshots = [];
    const nextOwnedTextures = [];
    try {
      const resolved = await resolveManifest(manifest);
      const validation = validateV14dGameManifest(resolved);
      if (!validation.ok) throw new Error(validation.reason);

      const textureEntries = asArray(resolved.textures);
      const textures = new Map();
      for (const entry of textureEntries) {
        const texture = await loadTexture(textureLoader, entry.url);
        if (!texture) throw new Error("纹理加载失败：" + (entry.key || "未命名") + "。");
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        textures.set(entry.key, texture);
        nextOwnedTextures.push(texture);
      }

      if (generation !== installGeneration) {
        restoreInstall(nextMaterialSnapshots, nextNodeSnapshots, nextOwnedTextures);
        return getStatus();
      }

      model.traverse?.((node) => {
        if (isCapeNode(node)) {
          nextNodeSnapshots.push(snapshotNode(node));
          node.visible = true;
        }
        for (const material of materialList(node)) {
          nextMaterialSnapshots.push(snapshotMaterial(material));
          if (isEyesPlusMaterial(material)) {
            material.visible = false;
            material.needsUpdate = true;
            continue;
          }
          const bindings = textureEntries.filter((entry) => materialMatches(material, entry.materialHints));
          if (!bindings.length) continue;
          for (const binding of bindings) {
            const texture = textures.get(binding.key);
            if (!texture) continue;
            if (binding.kind === "normal" && "normalMap" in material) material.normalMap = texture;
            if (binding.kind === "rmo" && "roughnessMap" in material) {
              material.roughnessMap = texture;
              material.metalnessMap = texture;
            }
            // hair-specular 只作为资源身份记录；它不是 PMX 的颜色贴图。
            if (binding.kind === "specular") {
              material.userData = {
                ...(material.userData || {}),
                v14dGameSpecularTextureKey: binding.key,
              };
            }
            material.userData = {
              ...(material.userData || {}),
              v14dGameAppearance: true,
              v14dGameTextureKeys: Array.from(new Set([
                ...((material.userData || {}).v14dGameTextureKeys || []),
                binding.key,
              ])),
            };
          }
          // 准备态曾用 alphaTest=0.5 截断发丝；真实外观沿用 PMX 原值，不再强制覆盖。
          material.needsUpdate = true;
        }
      });

      if (generation !== installGeneration) {
        restoreInstall(nextMaterialSnapshots, nextNodeSnapshots, nextOwnedTextures);
        return getStatus();
      }

      materialSnapshots = nextMaterialSnapshots;
      nodeSnapshots = nextNodeSnapshots;
      ownedTextures = nextOwnedTextures;
      installedModel = model;
      installedManifest = resolved;
      status = {
        pipeline: "v14d-game",
        phase: "ready",
        realAppearanceAvailable: true,
        label: "V14D 本机游戏外观已接入",
        reason: "",
        resources: {
          model: resolved.model.url,
          modelSource: resolved.model.relativePath || resolved.model.url,
          textures: textureEntries.map((entry) => entry.key),
          ocio: Object.keys(resolved.ocio || {}).filter((key) => resolved.ocio[key]?.url),
          sourceSha256: resolved.sourceSha256 || null,
          sourceManifestSha256: resolved.sourceManifestSha256 || null,
          modelSha256: resolved.model.sha256 || null,
          ocioIdentity: resolved.ocioIdentity || null,
          ocioSha256: Object.fromEntries(Object.entries(resolved.ocio || {}).map(([key, entry]) => [key, entry.sha256 || null])),
          lightNames: asArray(resolved.lights).map((light) => light.name || ""),
          scope: resolved.scope || "",
        },
      };
      return getStatus();
    } catch (error) {
      restoreInstall(nextMaterialSnapshots, nextNodeSnapshots, nextOwnedTextures);
      if (generation !== installGeneration) return getStatus();
      status = {
        ...IDLE_STATUS,
        phase: "unavailable",
        label: "V14D 游戏外观不可用：本机资源未就绪",
        reason: error instanceof Error ? error.message : String(error),
      };
      return getStatus();
    }
  }

  function release() {
    installGeneration += 1;
    restore();
    status = { ...IDLE_STATUS };
    return getStatus();
  }

  function markUnavailable(reason) {
    installGeneration += 1;
    restore();
    status = {
      ...IDLE_STATUS,
      phase: "unavailable",
      label: "V14D 游戏外观不可用：本机资源未就绪",
      reason: String(reason || "本机资源未就绪。"),
    };
    return getStatus();
  }

  return {
    getStatus,
    install,
    release,
    markUnavailable,
    getTextureUrl: (key) => getV14dGameTextureUrl(installedManifest, key),
  };
}
