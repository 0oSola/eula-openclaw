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
