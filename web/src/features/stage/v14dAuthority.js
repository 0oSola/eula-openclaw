/**
 * V14D 权威资产身份（单一事实源 / single source of truth）。
 *
 * 本模块是纯 JS、无 bundler alias（不用 "@/..."）、无外部依赖，因此
 * v14dFaceStatic.ts（TS）、rezeSkinVariantPreference.js（纯 JS）、以及
 * node:test 聚焦测试都能不经验证 bundler 直接 import 同一份常量，
 * 消除「注释式双权威」（P0-2 第 2 项）。配套类型见同名 .d.ts。
 */

/** 权威克莱妲 PMX 文件名（诊断入口强门控与生产 V1 资格共用）。 */
export const V14D_AUTHORITY_PMX_FILE_NAME = "GirlsFrontline KoledaDefault.pmx";

/** 权威 State2 packed mask 文件名（实时合成唯一遮罩来源）。 */
export const V14D_STATE2_MASK_FILE_NAME = "v14d-01234-face-shadow-state-2.png";

/***********************************************
 * Stage 2C-M1 修正轮：V1 皮肤变体材质名/合成常量迁入本模块（纯 JS、无 bundler、
 * 无外部依赖），使 v14dSkinVariantGraphs.js 与 node:test 能直接 import 同一份常量，
 * 不经 TSX/TS 编译。来源与语义与 v14dFaceStatic.ts 同步（两者同源，勿双写漂移）。
 ***********************************************/
/** 权威脸部材质名（PMX/Blender/Web 三侧一致）。 */
export const V14D_FACE_MATERIAL_NAME = "Face";
/** 权威身体皮肤材质名。 */
export const V14D_BODY_MATERIAL_NAME = "BodySkin";
/** Stage 2C-M1：HairA/HairB V1 迁移的权威 PMX 材质名。 */
export const V14D_HAIR_A_MATERIAL_NAME = "HairA";
export const V14D_HAIR_B_MATERIAL_NAME = "HairB";
/** Blender 取证：BodySkin PROTO_FaceWarm Color2（暖肤 tint，线性乘法）。 */
export const V14D_BODY_WARM = [1.0, 0.945, 0.905];
/** Blender 取证：头发 PROTO_HairTint Color2（银白紫乘色，线性乘法，Factor=1）。 */
export const V14D_HAIR_TINT = [0.84, 0.85, 0.96];
