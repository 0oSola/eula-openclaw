/// <reference types="@webgpu/types" />

/**
 * Koleda V14D Face State 2 静态黄金帧预览（固定初始状态）。
 *
 * 视觉常量全部来自权威 blend 取证，不在 Web 手调：
 *   blend: Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend
 *   sha256: 1139617cf24c8b0a79c0e5ad6549bf7696661cef6b5a4dc51dc209396a353cd4
 *   frame=120, fps=24, 640x640, AgX Medium High Contrast, exposure=-0.56, gamma=1.0
 *   State=2, LayerA=2, LayerB=2, BlendWeight=0
 *
 * 合成公式（线性空间，逐纹素；掩码 R/G/B 取自 State2 Non-Color 图，faceValid 恒 1）：
 *   warm   = faceD * [1, 0.935, 0.89]
 *   artW   = mask.R * (1 - mask.B)
 *   fringeW= mask.G * (1 - mask.B)
 *   art    = mix(white, [0.66,0.58,0.60], artW)
 *   fringe = mix(white, [0.70,0.64,0.69], fringeW)
 *   shadowFactor = art * fringe        // 乘法阴影因子（≈1 处无阴影）
 *   composite  = warm * shadowFactor   // 最终脸部线性色（BaseColor + State2, Blend 0）
 *   attenuation = 1 - shadowFactor     // 纯阴影衰减分量（0=无阴影，黑底）
 *
 * 三模式 diffuse 语义相互独立：
 *   normal            → 原始 face_d（未应用 State2 的现有 Web 脸部基线）
 *   finalFaceComposite→ composite（BaseColor + State2, Blend 0 静态合成）
 *   faceShadowOnly    → attenuation（纯阴影衰减分量，黑底灰阶）
 *
 * 资产政策（README：第三方资产不可再分发，仓库不捆绑）：仓库只保留可发布代码/脚本/文档。
 * 权威 PMX/纹理/VMD 与派生纹理均由用户本地源以 File 形式注入（采集脚本经 Node fs 从
 * 本地路径读取；用户经 folder file input 选择），引擎 files 变体用 createFileMapAssetReader
 * 完全局部解析，无网络请求、无 404、不全局包装 window.fetch。
 */

import type { MmdCameraSnapshot } from "@/lib/types";

export const V14D_FACE_STATIC_FRAME = 120;
export const V14D_FACE_STATIC_FPS = 24;
export const V14D_FACE_STATIC_SECONDS = V14D_FACE_STATIC_FRAME / V14D_FACE_STATIC_FPS;
export const V14D_FACE_STATIC_SIZE = 640;
export const V14D_FACE_STATIC_STATE = 2;
export const V14D_FACE_STATIC_BLEND = 0;

/** 权威脸部材质名（PMX/Blender/Web 三侧一致），用于推导 Face pick ID（不硬编码材质 ID）。 */
export const V14D_FACE_MATERIAL_NAME = "Face";
/** 权威脸部 diffuse 纹理文件名（原始 BaseColor），normal 模式直接用它。 */
export const V14D_FACE_BASE_TEXTURE_NAME = "c_Koleda_slg_face_d.png";

/** 权威 PMX 与 VMD 的身份（强门控；来自权威 blend / 用户本地包取证）。 */
export const V14D_FACE_STATIC_AUTHORITY = {
  pmxFileName: "GirlsFrontline KoledaDefault.pmx",
  vmdFileName: "koleda-v14d-authoritative-pose-f120.vmd",
  vmdSha256: "2536c886029af068878c674bf749a409fccaa3cad519fbcde4233bd7c3b3394d",
} as const;

/** 派生纹理文件名（本地生成，不提交仓库；由 bake-face-state2.py 产出）。 */
export const V14D_FACE_STATIC_DERIVED = {
  composite: "v14d-face-composite-state2.png",
  attenuation: "v14d-face-shadow-attenuation-state2.png",
} as const;

/** 黄金帧可见岛逐材质烘焙纹理（Blender frame120 BaseColor 反照率,发射+mask 法）。 */
export const V14D_BAKED_TEXTURES = {
  face: "baked_face.png",
  hairA: "baked_hairA.png",
  hairB: "baked_hairB.png",
  body: "baked_body.png",
  top: "baked_top.png",
  cape: "baked_cape.png",
} as const;

/** 烘焙纹理 -> PMX 材质逻辑名（webkitRelativePath 覆盖键）。 */
export const V14D_BAKED_MATERIAL_MAP: Readonly<Record<string, string>> = {
  face: "Textures/c_Koleda_slg_face_d.png",
  hairA: "Textures/c_KoledaSSR01_slg_hair_d.png",
  hairB: "Textures/c_KoledaSSR01_slg_hair_d.png",
  body: "Textures/body_d.png",
  top: "Textures/c_KoledaSSR01_slg_cloth1_da.png",
  cape: "Textures/c_KoledaSSR01_slg_cloth1_da.png",
};

/**
 * 三模式 -> Face 材质 diffuse 应使用的文件名。
 * normal 用 PMX 包内原始 face_d；另两模式用本地派生文件（覆盖 face_d 逻辑名）。
 */
export const V14D_FACE_STATIC_MODE_TEXTURE = {
  normal: V14D_FACE_BASE_TEXTURE_NAME,
  finalFaceComposite: V14D_FACE_STATIC_DERIVED.composite,
  faceShadowOnly: V14D_FACE_STATIC_DERIVED.attenuation,
} as const;

/**
 * 诊断模式：Face 材质输出插值 UV（R=u, G=v, B=0），不采样纹理。
 * 仅供 UV-direct 逐纹素对账；不改变三模式语义，默认关闭。
 */
export const V14D_FACE_UV_DEBUG_MODE = "uvDebug";
/** 黄金帧几何验证模式：所有材质输出 world_pos 颜色，肉眼核对相机/缩放。 */
export const V14D_FACE_STATIC_WORLD_POS_MODE = "worldPos";
/** 黄金帧材质验证模式：所有材质输出 material_diffuse 颜色（无光照）。 */
export const V14D_FACE_STATIC_DIFFUSE_MODE = "diffuseFlat";
/** 黄金帧烘焙模式：可见岛逐材质 unlit 显示 Blender frame120 烘焙纹理。 */
export const V14D_FACE_STATIC_BAKED_MODE = "bakedGolden";

export type V14dFaceStaticMode =
  | keyof typeof V14D_FACE_STATIC_MODE_TEXTURE
  | typeof V14D_FACE_UV_DEBUG_MODE
  | typeof V14D_FACE_STATIC_WORLD_POS_MODE
  | typeof V14D_FACE_STATIC_DIFFUSE_MODE
  | typeof V14D_FACE_STATIC_BAKED_MODE;

export const V14D_FACE_STATIC_MODES: readonly V14dFaceStaticMode[] = [
  "normal",
  "faceShadowOnly",
  "finalFaceComposite",
];

export function isV14dFaceStaticMode(value: string | null): value is V14dFaceStaticMode {
  return (
    value === "normal" ||
    value === "faceShadowOnly" ||
    value === "finalFaceComposite" ||
    value === V14D_FACE_UV_DEBUG_MODE ||
    value === V14D_FACE_STATIC_WORLD_POS_MODE ||
    value === V14D_FACE_STATIC_DIFFUSE_MODE ||
    value === V14D_FACE_STATIC_BAKED_MODE
  );
}

/** 模式是否用派生纹理（normal 直接用 PMX 原始 face_d）。 */
export function v14dFaceStaticIsDerivedMode(mode: V14dFaceStaticMode): boolean {
  if (mode === V14D_FACE_UV_DEBUG_MODE || mode === V14D_FACE_STATIC_WORLD_POS_MODE || mode === V14D_FACE_STATIC_DIFFUSE_MODE) return false;
  return mode !== "normal";
}

/** 模式对应的 Face diffuse 文件名（用于徽章/capture 显示与 fileMap 键）。 */
export function v14dFaceStaticTextureName(mode: V14dFaceStaticMode): string {
  if (mode === V14D_FACE_UV_DEBUG_MODE) return "uv-debug";
  if (mode === V14D_FACE_STATIC_WORLD_POS_MODE) return "world-pos";
  if (mode === V14D_FACE_STATIC_DIFFUSE_MODE) return "diffuse-flat";
  if (mode === V14D_FACE_STATIC_BAKED_MODE) return "baked-golden";
  return V14D_FACE_STATIC_MODE_TEXTURE[mode];
}

/** 权威 frame-120 脸部 ROI（Blender 640x640 投影, blender-face-ref.py 计算），Web 归一化 [x,y,w,h]。 */
export const V14D_FACE_STATIC_ROI_NORM: readonly [number, number, number, number] = [
  0.3462, 0.3142, 0.3052, 0.3354,
];

/**
 * 权威近景相机（[Stage 2A-GF] 从 blend 取证 golden-frame.json）：
 * PROTO_GameCamera loc=[0.03,-1.02,1.335]m, rotX=90deg/rotZ≈-0.21deg, lens 72mm, sensor 36mm(AUTO)。
 * 引擎为垂直 FOV，square frame 下 vfov = 2*atan(36/(2*72)) = 28.0725°。
 * Blender 角色身高约 1.49m（米）；reze 侧模型实测以 PMX 单位渲染
 * （CPU 皮肤后脸部中心 [0.53,16.44,-1.17]，与 PMX bind 同单位），相机按
 * PMX 单位换算：Blender frame120 脸相对相机约 (x≈0, y≈0.10m, 前方 1.02m)，
 * 即 PMX 单位 (x≈0, y≈+1.25, 前方 12.75)；Web 相机 = 脸部中心 + 该偏移。
 * （注：CPU 皮肤矩阵的 Y 列与 Blender 有约 0.84 的既有差异，超出本票范围。）
 * 脸部相对相机偏移用 Blender 脸中心与相机的实际差值；但 Web 姿态脸部前倾更多，
 * 中心 z≈-1.26（Blender ≈0）。由于 Web/Blender 姿态存在差异（Web 头前倾更大，
 * 见 boneEulers 对比），相机 target 取 Web 实测脸部皮肤中位数，position 在
 * Blender 的 PMX 前方 12.75 单位处，保证脸在画面中心且不被相机压入体内。
 */
export const V14D_FACE_STATIC_CAMERA: MmdCameraSnapshot = {
  fov: 28.072486935852954,
  position: [0.564, 18.55, -13.0],
  target: [0.564, 16.4125, -1.26],
  locked: true,
};

/** 画布 dataset 标记键名（供 capture 脚本与报告读取）。 */
export const V14D_FACE_STATIC_DATASET = {
  enabled: "v14dFaceStatic",
  mode: "v14dFaceStaticMode",
  frame: "v14dFaceStaticFrame",
  state: "v14dFaceStaticState",
  blend: "v14dFaceStaticBlend",
  cameraLocked: "v14dFaceStaticCameraLocked",
  paused: "v14dFaceStaticPaused",
  texture: "v14dFaceStaticTexture",
  faceMaterialApplied: "v14dFaceStaticFaceApplied",
  faceMaterialIndex: "v14dFaceStaticFaceIndex",
  authority: "v14dFaceStaticAuthority",
} as const;

/**
 * 从 PMX 材质列表按权威材质名推导 Face 在"vertexCount>0 材质"中的 1-based pick ID。
 * 引擎 pick mask 的 materialId 只统计 vertexCount>0 的材质（1-based，0=无命中）。
 * 返回 null 表示未找到（门控失败，不硬编码回退）。
 */
export function v14dFaceStaticFacePickId(
  materials: readonly { name: string; vertexCount: number }[],
  faceName: string = V14D_FACE_MATERIAL_NAME,
): number | null {
  let pickId = 0;
  for (const mat of materials) {
    if (mat.vertexCount <= 0) continue;
    pickId += 1;
    if (mat.name === faceName) return pickId;
  }
  return null;
}

/**
 * faceStatic 资产注入（引擎 files 变体完全局部解析，不全局包装 fetch、无网络 404）。
 * 采集脚本经 page.route 把权威 PMX/纹理/VMD 从本地文件读成 File[] 注入
 * window.__v14dFaceStaticAssets；Face diffuse 用 faceOverride File 覆盖 face_d 逻辑名。
 * 用户场景可由 folder file input 选择权威 Koleda 目录得到同样的 File 列表。
 */
export type V14dFaceStaticAssetSource = {
  /** 权威 Koleda PMX 及其全部纹理/依赖的 File 列表（webkitRelativePath 保留相对路径）。 */
  modelFiles: File[];
  /** 权威 PMX File（modelFiles 中的 .pmx）。 */
  pmxFile: File;
  /** 权威 VMD File（frame120 姿态）。 */
  vmdFile: File;
  /** Face diffuse override（单一来源场景：normal=原始 face_d；composite/shadow=派生图，webkitRelativePath=face_d 键）。 */
  faceOverride: File | null;
  /** 三模式各自的 Face diffuse 纹理（页面 UI 一次提供三张，运行时按模式选用；与 faceOverride 二选一）。 */
  faceTextures?: Partial<Record<V14dFaceStaticMode, File>>;
  /** 黄金帧烘焙纹理（bakedGolden 模式）：逐材质 baked_* File，运行时按 V14D_BAKED_MATERIAL_MAP 覆盖。 */
  bakedTextures?: Partial<Record<keyof typeof V14D_BAKED_TEXTURES, File>>;
};
