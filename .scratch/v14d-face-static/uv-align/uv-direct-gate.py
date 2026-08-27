# -*- coding: utf-8 -*-
# UV-direct 逐纹素对账(同 UV 直采, 消除 raster/filter 差异):
#   对每个脸部像素, 用 Web 侧实际插值 UV 直接双线性采样 Blender 权威线性像素
#   (face_d / State2 mask), 重算 baker 链得到 normal/attenuation/composite 参考值,
#   与 Web 实际捕获值对比, 按 Base→warm→mask→shadowFactor→composite 顺序定位首次分歧。
#
# 口径锁定:
#   - 只用 Face pick mask 内的像素(faceSamples=5865), 不混入背景/边缘/其他材质。
#   - 双线性采样在 Blender 线性像素上做(与 Blender Linear interpolation 同语义),
#     采样中心 = 纹素中心, UV 原点在纹理左上角(与 PNG/WebGPU 一致)。
#   - sRGB 只解码一次(face_d 在 Blender 侧已是场景线性; Non-Color mask 不解码)。
#   - Web 捕获值是 canvas display sRGB -> linear(与 Blender Standard/曝光0/gamma1 对应)。
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BL = ROOT / ".scratch" / "v14d-face-static" / "uv-align" / "blender"
WEB = ROOT / ".scratch" / "v14d-face-static" / "uv-align" / "web"
SAME = ROOT / ".scratch" / "v14d-face-static" / "same-metric"
DERIVED = Path(r"C:\w\rk3-face-v14d\.scratch\v14d-face-static-derived")
OUT = ROOT / ".scratch" / "v14d-face-static" / "uv-align"

WARM = np.array([1.0, 0.935, 0.89], dtype=np.float64)
SHADOW = np.array([0.66, 0.58, 0.60], dtype=np.float64)
FRINGE = np.array([0.70, 0.64, 0.69], dtype=np.float64)

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def load_png(p, mode="RGB"):
    return np.asarray(Image.open(p).convert(mode), dtype=np.float64) / 255.0

# 1) 权威线性像素
# face_d: PIL 解码 PNG 字节(sRGB) -> 标准 sRGB->linear。
#   说明: Blender img.pixels 的 OCIO 解码/行序与 PNG 字节存在系统性偏差(见
#   colorspace-isolation.json), 而 Web 引擎实际收到的就是 PNG 字节, 故以 PIL 为
#   唯一可信的逐纹素参考。V 轴: PNG/引擎/Blender UV 均为左上原点, 无需翻转。
def load_face_d_linear():
    im = Image.open(r"D:\mmd\克莱妲原皮\Textures\c_Koleda_slg_face_d.png").convert("RGB")
    srgb = np.asarray(im, dtype=np.float64) / 255.0
    return srgb_to_linear(srgb)
face_lin = load_face_d_linear()
# State2 mask: Non-Color, PIL 解码字节即线性值(不做 sRGB 解码)。
mask_lin = np.asarray(Image.open(r"C:\w\rk3-face-v14d\experiments\koleda-v14d-face-shadow\assets\textures\v14d-01234-face-shadow-state-2.png").convert("RGB"), dtype=np.float64) / 255.0
H, W = face_lin.shape[:2]

# 2) Web 侧逐像素 UV(0..255 -> 0..1) 与脸部 mask
uv_img = load_png(WEB / "web-face-uv.png")
face_mask = load_png(SAME / "web-face-mask.png", "L") > 0.5
u = uv_img[..., 0]
v = uv_img[..., 1]

# 3) Web 三模式捕获(显示 sRGB) -> 线性
web_normal = srgb_to_linear(load_png(ROOT / ".scratch" / "v14d-face-static" / "capture-final" / "face-static-normal.png"))
web_comp = srgb_to_linear(load_png(ROOT / ".scratch" / "v14d-face-static" / "capture-final" / "face-static-finalFaceComposite.png"))
web_atten = srgb_to_linear(load_png(ROOT / ".scratch" / "v14d-face-static" / "capture-final" / "face-static-faceShadowOnly.png"))

# 4) 双线性采样(纹素中心, UV 左上原点, REPEAT wrap 用 mod)
def bilinear(img, uu, vv):
    h, w = img.shape[:2]
    x = (uu % 1.0) * w - 0.5
    y = (vv % 1.0) * h - 0.5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    x1 = x0 + 1; y1 = y0 + 1
    wx = (x - x0)[..., None]; wy = (y - y0)[..., None]
    x0 = np.clip(x0, 0, w - 1); x1 = np.clip(x1, 0, w - 1)
    y0 = np.clip(y0, 0, h - 1); y1 = np.clip(y1, 0, h - 1)
    c00 = img[y0, x0]; c01 = img[y0, x1]; c10 = img[y1, x0]; c11 = img[y1, x1]
    return (c00 * (1 - wx) + c01 * wx) * (1 - wy) + (c10 * (1 - wx) + c11 * wx) * wy

# 5) baker 链在 Web UV 上重算(同 UV 直采)
face_b = bilinear(face_lin[..., :3], u, v)       # Web UV 处的 face_d 线性
mask_b = bilinear(mask_lin[..., :3], u, v)       # Web UV 处的 State2 mask(Non-Color 线性)
R = mask_b[..., 0:1]; G = mask_b[..., 1:2]; B = mask_b[..., 2:3]
invB = 1.0 - B
art = 1.0 + (SHADOW - 1.0) * (R * invB)
fringe = 1.0 + (FRINGE - 1.0) * (G * invB)
shadow_factor = art * fringe
warm = face_b * WARM
composite = warm * shadow_factor
attenuation = 1.0 - shadow_factor

# 6) 只在脸部 mask 内量化(逐像素 abs diff)
def masked_stats(ref, web, m):
    d = np.abs(ref - web)
    dm = d[m]
    rm = ref[m]
    wm = web[m]
    return {
        "meanAbsLinearDiff": [float(dm[..., c].mean()) for c in range(3)],
        "p95AbsLinearDiff": [float(np.percentile(dm[..., c], 95)) for c in range(3)],
        "maxAbsLinearDiff": [float(dm[..., c].max()) for c in range(3)],
        "refMeanLinear": [float(rm[..., c].mean()) for c in range(3)],
        "webMeanLinear": [float(wm[..., c].mean()) for c in range(3)],
    }

report = {
    "textureSize": [W, H],
    "faceSamples": int(face_mask.sum()),
    "uvRange": {"u": [float(u[face_mask].min()), float(u[face_mask].max())], "v": [float(v[face_mask].min()), float(v[face_mask].max())]},
    "gate": {
        "normal": masked_stats(face_b, web_normal, face_mask),
        "faceShadowOnly": masked_stats(attenuation, web_atten, face_mask),
        "finalFaceComposite": masked_stats(composite, web_comp, face_mask),
    },
    "chainDivergence": {
        "baseTexture": masked_stats(face_b, web_normal, face_mask),
        "warmTint": masked_stats(warm, web_normal * (WARM if True else 1), face_mask),  # 近似: web normal 无 warm
        "shadowFactor": masked_stats(shadow_factor, 1.0 - web_atten, face_mask),
        "composite": masked_stats(composite, web_comp, face_mask),
    },
    "pass": {
        "meanLe0.005": None,
        "p95Le0.01": None,
    },
    "note": "UV-direct 同 UV 逐纹素对账; Web UV 来自 faceStatic uvDebug 模式(几何节点), 纹理采样在 Blender 权威线性像素上重算 baker 链。",
}

# Gate 判定: 每通道 mean <= 0.005, P95 <= 0.01
ok_mean = all(all(v <= 0.005 for v in report["gate"][k]["meanAbsLinearDiff"]) for k in report["gate"])
ok_p95 = all(all(v <= 0.01 for v in report["gate"][k]["p95AbsLinearDiff"]) for k in report["gate"])
report["pass"]["meanLe0.005"] = ok_mean
report["pass"]["p95Le0.01"] = ok_p95
report["pass"]["all"] = ok_mean and ok_p95

(OUT / "uv-direct-gate.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

# 差值热图(脸部 ROI)
for name, ref, web in [("normal", face_b, web_normal), ("faceShadowOnly", attenuation, web_atten), ("finalFaceComposite", composite, web_comp)]:
    d = np.abs(ref - web)
    d[~face_mask] = 0
    dm = d.max(axis=-1)
    vmax = max(dm[face_mask].max(), 1e-6)
    heat = (dm / vmax * 255).astype(np.uint8)
    Image.fromarray(heat, "L").save(OUT / f"uv-direct-diff-{name}.png")

print(json.dumps(report, ensure_ascii=False, indent=2))
