/**
 * Reze K3 皮肤变体偏好（"原始 Reze K3" / "Reze K3 V1（V14D）"）。
 *
 * 概念登记（见 workflow/workflow-glossary.zh-CN.md）：
 *   - 皮肤变体（Skin Variant）：在同一 reze-k3 舞台运行时中，对克莱妲
 *     Face/BodySkin 材质应用 V14D State2 实时合成图的可选模式。
 *   - rezeK3SkinVariant：机器字段名，取值 "original" | "v1"。
 *
 * 持久化口径：localStorage 按「用户 + 模型 + reze-k3 管线」三维隔离，
 * 不写入会话、不写入共享配置（桌面 Pet 不受影响），默认 original。
 */

import { V14D_FACE_STATIC_AUTHORITY } from "@/features/stage/v14dFaceStatic";

export type RezeK3SkinVariant = "original" | "v1";

export const REZE_K3_SKIN_VARIANTS: readonly RezeK3SkinVariant[] = ["original", "v1"];

export const REZE_K3_SKIN_VARIANT_LABEL: Record<RezeK3SkinVariant, string> = {
  original: "原始 Reze K3",
  v1: "Reze K3 V1（V14D）",
};

export function isRezeK3SkinVariant(value: unknown): value is RezeK3SkinVariant {
  return value === "original" || value === "v1";
}

/** 存储键：用户 + 模型 + 管线三维隔离；仅 reze-k3 管线使用。 */
export function rezeK3SkinVariantStorageKey(userId: string, modelRelativePath: string): string {
  return "mmd_reze_k3_skin_variant_v1:" + userId + ":reze-k3:" + modelRelativePath;
}

/** 读取持久化的皮肤变体；缺失或非法值回退 original（安全默认，向后兼容）。 */
export function readRezeK3SkinVariant(storage: Pick<Storage, "getItem">, key: string): RezeK3SkinVariant {
  const raw = storage.getItem(key);
  return isRezeK3SkinVariant(raw) ? raw : "original";
}

/** 写入持久化；original 为默认值，直接清除键避免堆积。 */
export function writeRezeK3SkinVariant(storage: Pick<Storage, "setItem"> & Pick<Storage, "removeItem">, key: string, variant: RezeK3SkinVariant): void {
  if (variant === "original") storage.removeItem(key);
  else storage.setItem(key, variant);
}

/**
 * V1（V14D）启用资格：仅权威克莱妲 PMX 可启用。
 * 权威依据 = PMX 文件名（与诊断入口强门控同源），非克莱妲返回 false 时
 * UI 必须隐藏/禁用 V1 并安全回退原始 Reze K3。
 */
export function isRezeK3V1Eligible(pmxFileName: string): boolean {
  return pmxFileName === V14D_FACE_STATIC_AUTHORITY.pmxFileName;
}
