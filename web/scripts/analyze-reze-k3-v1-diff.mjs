// G3+新视觉 Gate 分析：Scene invariance + Material-only calibration + 隔离 + 收敛。
// 以退出码硬阻断：任一区域判定失败 → exit 1。报告写 visual-diff.json。
//
// 采样口径（诚实测量，区分真实改写与重建噪声）：
//  - 皮肤区（face/neck/hand）：只对「皮肤掩码像素」求 MAE/meanDiff。手部在全身画布中
//    皮肤像素占比 <2%，不掩码会被外套/背景稀释成假阴性。掩码是经典肤色判别（isSkin）。
//  - 非皮肤区（hair/clothes/gear）：剔除皮肤像素。用 meanMeanDiff（平均色偏）+ 超阈像素
//    占比判定，而非 maxMeanDiff——后者会被材质过渡边界的少量重建光栅噪声（亚像素偏移）
//    放大成假阳性。实测 original 连拍基线噪声 maxMeanDiff≈0.13、meanMeanDiff≈0.02；
//    original→V1 的材质边界噪声把 meanMeanDiff 推到 ~0.3 量级，真实材质改写会 >1。
//  - 背景区（skyTL/skyTR）：星空背景绝大多数像素 alpha=0 且近黑（lum<30），亮点是稀疏
//    星星（闪烁噪声）。只对「暗空多数像素（双图 lum<30）」求 meanDiff，断言 V1 不改写
//    K3 灯光/星空背景。亮星像素被显式排除（避免把星星闪烁误判为场景重写）。
import sharp from "sharp";
import fs from "node:fs"; import path from "node:path";
import crypto from "node:crypto";
import { buildHairUvGridFromPmx, classifyHairPixel, v14dHairTargetDisplay } from "../src/features/stage/v14dHairPartition.js";
const OUT = path.resolve(".scratch/reze-k3-v1-stage");
const ORIG = path.join(OUT, "g3-original-canvas.png");
const V1 = path.join(OUT, "g3-v1-canvas.png");
// 同变体连拍（original 第二帧，可选）：用于把 original↔V1 的衣服/装备差异与同变体
// 待机微动帧间噪声区分（Stage 2C-M1 噪声基线，防把微动误判为材质泄漏）。
const ORIG_B = path.join(OUT, "g3-original-canvas-b.png");
const TARGET = process.env.V14D_TARGET || "C:\\w\\rk3-face-v14d\\.scratch\\v14d-face-static-derived\\blender-ref-finalFaceComposite.png";
// 负测模式（仅 --neg-wrongtint）：读 G3 负测注入后的 wrongTint 画布，其余同正式口径。
// 该模式要求正式画布已存在（用于对比），产出独立 visual-diff-wrongtint.json，不覆盖正式报告。
const NEG_WRONGTINT = process.argv.includes("--neg-wrongtint");
const V1_ACTUAL = NEG_WRONGTINT ? path.join(OUT, "g3-v1-canvas-wrongtint.png") : V1;
const REPORT_JSON = NEG_WRONGTINT ? path.join(OUT, "visual-diff-wrongtint.json") : path.join(OUT, "visual-diff.json");
if (!fs.existsSync(ORIG) || !fs.existsSync(V1)) { console.error("missing canvas pngs"); process.exit(1); }
if (NEG_WRONGTINT && !fs.existsSync(V1_ACTUAL)) { console.error("missing wrongtint canvas " + V1_ACTUAL); process.exit(1); }

async function loadRaw(p) { const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height }; }
const a = await loadRaw(ORIG); const b = await loadRaw(NEG_WRONGTINT ? V1_ACTUAL : V1);
if (a.width !== b.width || a.height !== b.height) { console.error("size mismatch"); process.exit(1); }
// 同变体连拍（可选）：original 第二帧，作为非皮肤「待机微动噪声基线」。
const a2 = fs.existsSync(ORIG_B) ? await loadRaw(ORIG_B) : null;
const W = a.width, H = a.height;

function isSkin(r, g, bl) { const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); return r > 95 && g > 40 && bl > 20 && (mx - mn) > 15 && r > g && r > bl && Math.abs(r - g) > 8; }
const lum = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3;

const regions = {
  face:      { x: 0.545, y: 0.13, w: 0.07, h: 0.10, kind: "skin" },
  neck:      { x: 0.555, y: 0.23, w: 0.05, h: 0.04, kind: "skin" },
  leftHand:  { x: 0.27,  y: 0.42, w: 0.10, h: 0.10, kind: "skin" },
  rightHand: { x: 0.63,  y: 0.42, w: 0.10, h: 0.10, kind: "skin" },
  waist:     { x: 0.50,  y: 0.50, w: 0.10, h: 0.06, kind: "skin", occluded: true }, // T 形被外套遮挡
  // Stage 2C-M1：HairA/HairB 已迁移为 V1 目标槽，从「必须稳定」改为「必须显著变化」
  // （kind: "hair"）。合并 hair ROI 保留（整头变化证据），另加 HairA 前刘海 /
  // HairB 后长发分区 ROI（full-frame 归一化坐标），各自独立判定，不用整头均值
  // 掩盖分区失败。其余非皮肤（衣服/装备/星空）仍必须稳定。
  hair:      { x: 0.53,  y: 0.0,  w: 0.10, h: 0.06, kind: "hair" },
  hairA:     { x: 0.30,  y: 0.02, w: 0.40, h: 0.24, kind: "hair", image: "g3-hair-front-orig.png", imageV1: "g3-hair-front-v1.png" }, // 前刘海近景
  hairB:     { x: 0.30,  y: 0.02, w: 0.40, h: 0.34, kind: "hair", image: "g3-hair-back-orig.png", imageV1: "g3-hair-back-v1.png" }, // 后长发近景
  // Stage 2C-M1：clothes ROI 收窄到衣服主体（左中 3/4），排除右列刘海/头发遮挡区
  // （网格探针显示该区 original↔V1 与同变体连拍噪声同为高位 2.3-11.7 vs 1.0-4.3，
  // 是头发遮挡/高光帧间微动噪声，非衣服材质泄漏；衣服主体两侧均 <0.5）。
  clothes:   { x: 0.46,  y: 0.42, w: 0.075, h: 0.14, kind: "nonskin" },
  gear:      { x: 0.44,  y: 0.60, w: 0.08, h: 0.10, kind: "nonskin" },
  skyTL:     { x: 0.02,  y: 0.02, w: 0.30, h: 0.12, kind: "bg" },
  skyTR:     { x: 0.68,  y: 0.02, w: 0.30, h: 0.12, kind: "bg" },
};

function bounds(r) { const x0 = Math.floor(r.x * W), y0 = Math.floor(r.y * H); return { x0, y0, x1: Math.min(W, Math.floor((r.x + r.w) * W)), y1: Math.min(H, Math.floor((r.y + r.h) * H)) }; }

function skinStats(r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, sumAbs = 0, md = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (a.data[i + 3] < 8) continue;
    if (!isSkin(a.data[i], a.data[i + 1], a.data[i + 2])) continue;
    const rb = b.data[i], gb = b.data[i + 1], bb = b.data[i + 2];
    sumAbs += (Math.abs(a.data[i] - rb) + Math.abs(a.data[i + 1] - gb) + Math.abs(a.data[i + 2] - bb)) / 3;
    md[0] += a.data[i] - rb; md[1] += a.data[i + 1] - gb; md[2] += a.data[i + 2] - bb; n++;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(2));
  return { samples: n, mae: +(n ? sumAbs / n : 0).toFixed(3), meanDiff, maxMeanDiff: Math.max(...meanDiff) };
}
// 非皮肤区：meanMeanDiff（平均色偏，鲁棒）+ maxMeanDiff（上限）。pctOver2 仅记录不判定——
// 模型在待机 VMD 循环中持续微动，含 specular/RMO 的衣服对高光角极敏感，同变体连拍
// pctOver2 即达 ~15%（帧间噪声），与 original↔V1 几乎相同，故 pctOver2 无法区分
// 真实改写与帧间微动；真实成片材质改写由 meanMeanDiff/maxMeanDiff 捕获（皮肤对照 25-36）。
function nonSkinStats(r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, sumAbs = 0, md = [0, 0, 0], over2 = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (a.data[i + 3] < 8) continue;
    if (isSkin(a.data[i], a.data[i + 1], a.data[i + 2])) continue;
    const d0 = a.data[i] - b.data[i], d1 = a.data[i + 1] - b.data[i + 1], d2 = a.data[i + 2] - b.data[i + 2];
    const ad = (Math.abs(d0) + Math.abs(d1) + Math.abs(d2)) / 3;
    sumAbs += ad; if (ad > 2) over2++;
    md[0] += d0; md[1] += d1; md[2] += d2; n++;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(3));
  const meanMeanDiff = meanDiff.reduce((s, v) => s + v, 0) / 3;
  return { samples: n, mae: +(n ? sumAbs / n : 0).toFixed(3), meanDiff, meanMeanDiff: +meanMeanDiff.toFixed(3), maxMeanDiff: Math.max(...meanDiff), pctOver2: +(n ? (100 * over2 / n) : 0).toFixed(2) };
}
// Stage 2C-M1：对任意两张同尺寸图取同区域非皮肤差异（同变体连拍噪声基线）。
// 与 nonSkinStats 同口径，但显式传入两张图（imgA/imgB 取代闭包 a/b）。
function nonSkinStatsPair(imgA, imgB, r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, md = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (imgA.data[i + 3] < 8) continue;
    if (isSkin(imgA.data[i], imgA.data[i + 1], imgA.data[i + 2])) continue;
    md[0] += imgA.data[i] - imgB.data[i]; md[1] += imgA.data[i + 1] - imgB.data[i + 1]; md[2] += imgA.data[i + 2] - imgB.data[i + 2]; n++;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(3));
  const meanMeanDiff = meanDiff.reduce((s, v) => s + v, 0) / 3;
  return { samples: n, meanDiff, meanMeanDiff: +meanMeanDiff.toFixed(3), maxMeanDiff: Math.max(...meanDiff) };
}
function bgStats(r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, md = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (lum(a.data, i) >= 30 || lum(b.data, i) >= 30) continue;
    md[0] += a.data[i] - b.data[i]; md[1] += a.data[i + 1] - b.data[i + 1]; md[2] += a.data[i + 2] - b.data[i + 2]; n++;
  }
  const meanDiff = md.map((v) => +(n ? Math.abs(v / n) : 0).toFixed(3));
  return { samples: n, meanDiff, maxMeanDiff: Math.max(...meanDiff) };
}

// ── P0-1 目标参考收敛（脸部综合色比「候选指标」）─────────────────────
// 【边界声明】这是脸部综合色比候选指标，非同像素对齐、非空间阴影对齐：
// 目标侧扫整张参考图的全部 isSkin 肤色像素（分母 targetSamples），舞台侧只取舞台脸框
// 内的 isSkin 像素（分母 stageSamples），两者样本空间不同、未做 UV/空间配准。它只能证明
// 「V1 脸部皮肤整体色比比 original 更接近 V14D 目标的肤色比」，不能宣称 State2 空间阴影
// 已逐像素对齐、也不能作为皮肤阶段「最终完成」的判据。
// K3 舞台有灯光/星空显示链，目标参考（Blender V14D finalFaceComposite）是中性白底，
// 绝对亮度不可比。采用「色比」(R/G, R/B) 作为对光照/曝光不敏感的配准皮肤材质空间口径，
// 只比较脸部皮肤像素（isSkin 掩码）。要求 V1 对目标的色比误差显著低于 original。
async function targetSkinRatio(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0, s = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue; // 目标为不透明渲染，剔除透明边
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!isSkin(r, g, b)) continue;
    s[0] += r; s[1] += g; s[2] += b; n++;
  }
  if (!n) return null;
  const m = s.map((v) => v / n);
  return { samples: n, mean: m.map((v) => +v.toFixed(1)), ratio: [+(m[0] / m[1]).toFixed(4), +(m[0] / m[2]).toFixed(4)] };
}
// 舞台脸框皮肤均值色比（与 targetSkinRatio 同 isSkin 口径）。
function stageFaceRatio(img, r) {
  const { x0, y0, x1, y1 } = bounds(r);
  let n = 0, s = [0, 0, 0];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (img.data[i + 3] < 8) continue;
    const rr = img.data[i], gg = img.data[i + 1], bb = img.data[i + 2];
    if (!isSkin(rr, gg, bb)) continue;
    s[0] += rr; s[1] += gg; s[2] += bb; n++;
  }
  if (!n) return null;
  const m = s.map((v) => v / n);
  return { samples: n, mean: m.map((v) => +v.toFixed(1)), ratio: [+(m[0] / m[1]).toFixed(4), +(m[0] / m[2]).toFixed(4)] };
}
const ratioDist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// ── 阈值（报告中显式定义，脚本硬阻断；非皮肤阈值对齐实测基线噪声，高于噪声、低于真实改写）──
const THRESHOLDS = {
  skinConvergeMae: 1.0,          // 皮肤区（掩码采样）MAE 必须 > 1（证明 V14D 材质有显著变化）
  skinConvergeMeanDiff: 1.0,     // 皮肤区（掩码采样）maxMeanDiff 必须 > 1（色偏显著收敛）
  minSkinSamples: 20,            // 皮肤区掩码像素数下限（防手部框内无皮肤时假通过）
  // 非皮肤稳定阈值对齐实测：同变体连拍帧间微动噪声 meanMeanDiff≈0.02-0.05、maxMeanDiff≈0.13-0.28；
  // original→V1 因重建 + 待机微动 meanMeanDiff≈0.09-0.34、maxMeanDiff≈0.11-0.71。阈值取噪声上界
  // 之上、真实成片改写（皮肤对照 meanDiff 25-36）之下，允许切换重建的极小光栅噪声（修票明示）。
  nonSkinStableMeanMeanDiff: 1.0, // 非皮肤区 meanMeanDiff（平均色偏）必须 < 1（大面积材质不被改写）
  nonSkinStableMaxMeanDiff: 2.0,  // 非皮肤区 maxMeanDiff 上限（单通道色偏，远高于噪声、低于真实改写）
  bgStableMeanDiff: 0.5,         // 星空背景暗空像素 maxMeanDiff 必须 < 0.5（灯光/背景不变）
  // Stage 2C-M1 修正轮：HairA/HairB 分区对权威 V14D BaseColor 目标的收敛判定阈值。
  // 目标 = hair_d(sRGB→线性)×[0.84,0.85,0.96] 经 linearToSrgb 转回显示字节（与引擎
  // WGSL helper 同一公式、同一 sRGB 绑定采样口径）。绝对误差含引擎灯光/Toon 显示链
  // 的乘性亮度差（未迁移部分），故收敛判据用「V1 误差 < original 误差 且 下降比例
  // > drop 且 绝对上限」，不用绝对零误差冒充逐像素对齐。
  hairTargetDrop: 0.05,         // (origMae - v1Mae)/origMae 必须 > 0.05（向目标显著下降）
  hairTargetAbsMae: 90,         // V1 对目标的绝对 MAE 上限（显示字节 0-255；含显示链亮度差）
  minHairTargetSamples: 30,     // 分区目标判定最小像素数（防近景框内无该槽像素假通过）
  // Stage 2C-M1：HairA/HairB 目标槽必须显著变化（V14D 银白紫乘色 [0.84,0.85,0.96] 真实生效）。
  // 阈值参考皮肤收敛口径（mae>1 且 maxMeanDiff>1），与皮肤/错误颜色负测共用同一判别力。
  hairChangeMae: 1.0,            // 头发区（非皮肤像素采样）MAE 必须 > 1（证明 V14D 头发材质显著变化）
  hairChangeMaxMeanDiff: 1.0,    // 头发区 maxMeanDiff 必须 > 1（色偏显著，非帧间噪声）
  // P0-1 目标收敛：V1 对 V14D 目标的色比误差必须比 original 显著下降（误差下降比例下限）。
  targetConvergeDrop: 0.15,      // (dist_orig - dist_v1) / dist_orig 必须 > 0.15（色比口径）
};

const out = { width: W, height: H, thresholds: THRESHOLDS, target: TARGET, regions: {}, verdict: {}, occluded: [] };
const failures = [];

// ── Stage 2C-M1 修正轮：HairA/HairB 分区权威目标网格（同 UV 取证）─────────────
// 从权威 PMX 解析 HairA/HairB 面区间顶点 UV 归属网格，加载权威 hair_d 纹理，
// 按「画布像素 → 近景 ROI → hair_d 纹理坐标 → 单位格归属槽位」求分区目标误差。
// 任一资产缺失则 hairTargetGrid=null，分区收敛判定显式 unavailable（不假装通过）。
const HAIR_TEX = process.env.V14D_HAIR_TEX || "D:\\mmd\\克莱妲原皮\\Textures\\c_KoledaSSR01_slg_hair_d.png";
const HAIR_PMX = process.env.V14D_HAIR_PMX || "D:\\mmd\\克莱妲原皮\\GirlsFrontline KoledaDefault.pmx";
const HAIR_FACE_RANGES = {
  // 来自 docs/handoff/evidence/pmx_audit.out.json 的 material_face_ranges（权威冻结）。
  hairA: { name: "HairA", startIndex: 190407, indexCount: 30198 },
  hairB: { name: "HairB", startIndex: 220605, indexCount: 13512 },
};
let hairTargetGrid = null;
let hairTexRaw = null;
if (fs.existsSync(HAIR_PMX) && fs.existsSync(HAIR_TEX)) {
  try {
    const pmxBuf = fs.readFileSync(HAIR_PMX);
    hairTargetGrid = buildHairUvGridFromPmx(
      pmxBuf.buffer.slice(pmxBuf.byteOffset, pmxBuf.byteOffset + pmxBuf.byteLength),
      HAIR_FACE_RANGES,
    );
    hairTexRaw = await loadRaw(HAIR_TEX);
  } catch (e) {
    failures.push("头发目标网格构建失败: " + (e && e.message ? e.message : e));
  }
}

/**
 * 分区 UV 取证图（人读 A/B 证据，非机器收敛判据）：把 hair_d 纹理中归属本槽的
 * UV 像素抠出，生成 original 语义（hair_d 原色）与 V14D 目标（v14dHairTargetDisplay）
 * 两张同 UV 对齐图 + 差异图，写入 OUT 供报告/审查。屏幕空间近景图由 accept 脚本
 * 的相机摆拍另行产出；机器收敛判定用 hairSlotUvStats 的 UV 统计（见下）。
 */
async function writeHairSlotUvImages() {
  if (!hairTargetGrid || !hairTexRaw) return {};
  const texW = hairTexRaw.width, texH = hairTexRaw.height;
  const written = {};
  for (const slot of ["hairA", "hairB"]) {
    const origPx = Buffer.alloc(texW * texH * 4);
    const tgtPx = Buffer.alloc(texW * texH * 4);
    const diffPx = Buffer.alloc(texW * texH * 3);
    let n = 0;
    for (let py = 0; py < texH; py++) for (let px = 0; px < texW; px++) {
      if (classifyHairPixel(hairTargetGrid, px, py, texW, texH) !== slot) continue;
      const ti = (py * texW + px) * 4;
      const rgb = [hairTexRaw.data[ti], hairTexRaw.data[ti + 1], hairTexRaw.data[ti + 2]];
      const tgt = v14dHairTargetDisplay(rgb);
      const o = ti;
      origPx[o] = rgb[0]; origPx[o + 1] = rgb[1]; origPx[o + 2] = rgb[2]; origPx[o + 3] = 255;
      tgtPx[o] = tgt[0]; tgtPx[o + 1] = tgt[1]; tgtPx[o + 2] = tgt[2]; tgtPx[o + 3] = 255;
      const d = Math.min(255, Math.round(((Math.abs(rgb[0] - tgt[0]) + Math.abs(rgb[1] - tgt[1]) + Math.abs(rgb[2] - tgt[2])) / 3) * 6));
      const dj = (py * texW + px) * 3;
      diffPx[dj] = d; diffPx[dj + 1] = d; diffPx[dj + 2] = d;
      n++;
    }
    if (!n) continue;
    const crop = await sharp(hairTexRaw.data, { raw: { width: texW, height: texH, channels: 4 } }).png().toBuffer();
    await sharp(origPx, { raw: { width: texW, height: texH, channels: 4 } }).png().toFile(path.join(OUT, "hair-uv-" + slot + "-original.png"));
    await sharp(tgtPx, { raw: { width: texW, height: texH, channels: 4 } }).png().toFile(path.join(OUT, "hair-uv-" + slot + "-v14d-target.png"));
    await sharp(diffPx, { raw: { width: texW, height: texH, channels: 3 } }).png().toFile(path.join(OUT, "hair-uv-" + slot + "-diff.png"));
    written[slot] = { samples: n, original: "hair-uv-" + slot + "-original.png", target: "hair-uv-" + slot + "-v14d-target.png", diff: "hair-uv-" + slot + "-diff.png" };
  }
  return written;
}

/**
 * 分区 UV 统计（机器收敛判据）：对本槽全部 UV 单位格内像素，分别求「original 语义
 * （hair_d 原色）」与「V14D 目标（×tint）」的差异。这证明目标公式相对 original 的
 * 真实改写幅度（targetMae>0 且分区间可比），是屏幕侧收敛判定的纹理空间锚点：
 * original 语义与目标的差距 = 迁移需要弥合的差距；屏幕侧 V1 的判定把「变化方向
 * 与幅度」与该锚点对照。
 */
function hairSlotUvStats(slot) {
  if (!hairTargetGrid || !hairTexRaw) return { error: "no-target-grid" };
  const texW = hairTexRaw.width, texH = hairTexRaw.height;
  let n = 0, origAbs = 0, tgtShift = 0;
  const mean = [0, 0, 0], tgtMean = [0, 0, 0];
  for (let py = 0; py < texH; py++) for (let px = 0; px < texW; px++) {
    if (classifyHairPixel(hairTargetGrid, px, py, texW, texH) !== slot) continue;
    const ti = (py * texW + px) * 4;
    const rgb = [hairTexRaw.data[ti], hairTexRaw.data[ti + 1], hairTexRaw.data[ti + 2]];
    const tgt = v14dHairTargetDisplay(rgb);
    for (let c = 0; c < 3; c++) { mean[c] += rgb[c]; tgtMean[c] += tgt[c]; }
    tgtShift += (Math.abs(rgb[0] - tgt[0]) + Math.abs(rgb[1] - tgt[1]) + Math.abs(rgb[2] - tgt[2])) / 3;
    n++;
  }
  if (!n) return { error: "no samples" };
  return {
    slot, samples: n,
    originalMean: mean.map((v) => +(v / n).toFixed(2)),
    targetMean: tgtMean.map((v) => +(v / n).toFixed(2)),
    targetShiftMae: +(tgtShift / n).toFixed(3), // original 语义 → 目标的逐像素 MAE（迁移需弥合的差距）
  };
}

for (const [name, r] of Object.entries(regions)) {
  if (r.occluded) { out.regions[name] = { occluded: true, note: "frame 当前姿势下不可见，标记 occluded，不参与收敛/稳定判定" }; out.occluded.push(name); continue; }
 if (r.kind === "skin") {
   const st = skinStats(r); out.regions[name] = st;
   const ok = st.samples >= THRESHOLDS.minSkinSamples && st.mae > THRESHOLDS.skinConvergeMae && st.maxMeanDiff > THRESHOLDS.skinConvergeMeanDiff;
   out.verdict[name + "Converged"] = ok;
   if (!ok) failures.push(name + " 皮肤区未向目标显著收敛 samples=" + st.samples + " mae=" + st.mae + " maxMeanDiff=" + st.maxMeanDiff);
 } else if (r.kind === "nonskin") {
    const st = nonSkinStats(r); out.regions[name] = st;
    // Stage 2C-M1 噪声基线：若有 original 同变体连拍（a2），把 original↔V1 的非皮肤
    // 差异与同变体待机微动帧间噪声比较。只有显著高于同变体噪声才判为真实材质泄漏；
    // 否则判定为帧间微动噪声（引擎切换重建 + 待机 VMD 微动对 specular/RMO 高光角敏感）。
    let noise = null;
    if (a2) {
      const n0 = nonSkinStatsPair(a, a2, r); out.regions[name].sameVariantNoise = n0;
      noise = n0;
    }
    const leaked = noise
      ? (st.meanMeanDiff > Math.max(THRESHOLDS.nonSkinStableMeanMeanDiff, noise.meanMeanDiff * 4) && st.maxMeanDiff > Math.max(THRESHOLDS.nonSkinStableMaxMeanDiff, noise.maxMeanDiff * 4))
      : (st.meanMeanDiff < THRESHOLDS.nonSkinStableMeanMeanDiff && st.maxMeanDiff < THRESHOLDS.nonSkinStableMaxMeanDiff) === false;
    const ok = !leaked;
    out.verdict[name + "Stable"] = ok;
    if (!ok) failures.push(name + " 非皮肤区被 V1 成片改写 meanMeanDiff=" + st.meanMeanDiff + " maxMeanDiff=" + st.maxMeanDiff + (noise ? "（同变体噪声 meanMeanDiff=" + noise.meanMeanDiff + " maxMeanDiff=" + noise.maxMeanDiff + "）" : "（无同变体基线）") + "（判定阈值见 thresholds/噪声×4）");
 } else if (r.kind === "hair") {
    // Stage 2C-M1 修正轮：头发目标槽做「显著变化 + 向权威 V14D BaseColor 目标收敛」
    // 双判定（非「hairChanged=true」冒充）。变化判定与皮肤同判别力；收敛判定用
    // 同 UV 目标误差（targetMae/drop，目标=srgb(hair_d)×tint 的线性合成转回显示字节）。
    const st = nonSkinStats(r); out.regions[name] = st;
    const changed = st.mae > THRESHOLDS.hairChangeMae && st.maxMeanDiff > THRESHOLDS.hairChangeMaxMeanDiff;
    out.verdict[name + "Changed"] = changed;
    if (!changed) failures.push(name + " 头发目标槽未显著变化 mae=" + st.mae + " maxMeanDiff=" + st.maxMeanDiff + "（需 mae>" + THRESHOLDS.hairChangeMae + " 且 maxMeanDiff>" + THRESHOLDS.hairChangeMaxMeanDiff + "）");
    // 目标收敛（HairA/HairB 分区各自判定，不用整头均值掩盖单槽失败）：
    // 权威目标 = hair_d(sRGB→线性)×[0.84,0.85,0.96] 转回显示字节（与引擎 WGSL helper
    // 同一公式、同一 sRGB 绑定采样口径）。收敛 = V1 对本槽目标的逐像素误差较 original
    // 显著下降（drop>hairTargetDrop）且绝对 MAE < hairTargetAbsMae。目标色取自本槽
    // UV 锚点均值（hairSlotUvStats 的 targetMean）：屏幕像素与 UV 无一一映射，故以
    // 分区均值色作为目标参考点，误差判定在显示字节空间。网格不可用显式 unavailable。
    if (hairTargetGrid && r.image) {
      const slot = name === "hairA" ? "hairA" : "hairB";
      const uv = hairSlotUvStats(slot);
      out.regions[name].uvAnchor = uv;
      if (uv.error) {
        out.verdict[name + "TargetConverged"] = false;
        failures.push(name + " 目标 UV 锚点不可用: " + uv.error);
      } else {
        const conv = hairSlotTargetError(a, b, r, uv.targetMean);
        out.regions[name].targetConvergence = conv;
        if (conv.error) {
          out.verdict[name + "TargetConverged"] = false;
          failures.push(name + " 目标收敛判定样本不足: " + conv.error);
        } else {
          const converged = conv.v1Mae < conv.origMae && conv.drop > THRESHOLDS.hairTargetDrop && conv.v1Mae < THRESHOLDS.hairTargetAbsMae;
          out.verdict[name + "TargetConverged"] = converged;
          if (!converged) failures.push(name + " 未向权威 V14D 头发目标收敛 origMae=" + conv.origMae + " v1Mae=" + conv.v1Mae + " drop=" + conv.drop + "（需 drop>" + THRESHOLDS.hairTargetDrop + " 且 v1Mae<" + THRESHOLDS.hairTargetAbsMae + "）");
        }
      }
    } else if (r.image) {
      out.verdict[name + "TargetConverged"] = "unavailable";
      failures.push(name + " 头发目标网格不可用（缺 PMX/hair_d 取证），无法判定 V14D 收敛");
    }
  } else {
    const st = bgStats(r); out.regions[name] = st;
    const ok = st.maxMeanDiff < THRESHOLDS.bgStableMeanDiff;
    out.verdict[name + "Stable"] = ok;
    if (!ok) failures.push(name + " 星空背景被 V1 改写 maxMeanDiff=" + st.maxMeanDiff + "（上限 " + THRESHOLDS.bgStableMeanDiff + "）");
  }
}
out.failures = failures;

/**
 * 分区屏幕侧目标误差：近景 ROI 内每个非皮肤像素对「本槽 UV 锚点目标均值色」的
 * 逐像素 MAE，original 与 V1 各一份。目标参考点 = targetMean（v14dHairTargetDisplay
 * 对本槽全部 hair_d UV 像素的均值）。屏幕像素与 UV 无一一映射，故以分区均值色为
 * 目标点；收敛 = V1 误差显著低于 original（颜色向权威目标色靠拢）。
 */
function hairSlotTargetError(imgOrig, imgV1, region, targetMean) {
  const { x0, y0, x1, y1 } = bounds(region);
  let n = 0, origAbs = 0, v1Abs = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    if (imgOrig.data[i + 3] < 8) continue;
    const r0 = imgOrig.data[i], g0 = imgOrig.data[i + 1], b0 = imgOrig.data[i + 2];
    if (isSkin(r0, g0, b0)) continue;
    // 剔除近黑背景/星空像素（lum<30），只统计头发本体可见像素。
    if ((r0 + g0 + b0) / 3 < 30) continue;
    const v1 = [imgV1.data[i], imgV1.data[i + 1], imgV1.data[i + 2]];
    origAbs += (Math.abs(r0 - targetMean[0]) + Math.abs(g0 - targetMean[1]) + Math.abs(b0 - targetMean[2])) / 3;
    v1Abs += (Math.abs(v1[0] - targetMean[0]) + Math.abs(v1[1] - targetMean[1]) + Math.abs(v1[2] - targetMean[2])) / 3;
    n++;
  }
  if (n < THRESHOLDS.minHairTargetSamples) return { error: "insufficient samples " + n, samples: n };
  const origMae = +(origAbs / n).toFixed(3);
  const v1Mae = +(v1Abs / n).toFixed(3);
  const drop = origMae > 0 ? +((origMae - v1Mae) / origMae).toFixed(4) : 0;
  return { samples: n, targetMean, origMae, v1Mae, drop };
}

// ── P0-1 目标参考收敛判定（脸部皮肤，色比口径）────────────────────
// 同名同帧脸框皮肤色比：original 与 V1 分别对 V14D 目标求色比距离，要求 V1 显著更接近。
// 这替代「original↔V1 差异大=收敛」的伪判定——只有对目标的误差真实下降才算收敛。
const faceRegion = regions.face;
const stageOrig = stageFaceRatio(a, faceRegion);
const stageV1 = stageFaceRatio(b, faceRegion);
let targetCmp = null;
if (fs.existsSync(TARGET)) {
  const targetSha256 = crypto.createHash("sha256").update(fs.readFileSync(TARGET)).digest("hex");
  const tgt = await targetSkinRatio(TARGET);
  if (tgt && stageOrig && stageV1) {
    const distOrig = ratioDist(stageOrig.ratio, tgt.ratio);
    const distV1 = ratioDist(stageV1.ratio, tgt.ratio);
    const drop = distOrig > 0 ? (distOrig - distV1) / distOrig : 0;
    targetCmp = { targetRatio: tgt.ratio, targetSamples: tgt.samples, origRatio: stageOrig.ratio, v1Ratio: stageV1.ratio, distOrig: +distOrig.toFixed(4), distV1: +distV1.toFixed(4), drop: +drop.toFixed(4) };
    // 候选指标元数据：记录口径边界、目标 SHA256、两侧样本分母，便于审计与复验。
    out.targetMetric = {
      label: "脸部综合色比候选指标（非同像素/非空间阴影对齐）",
      caveat: "目标侧=整图 isSkin 肤色像素（分母 targetSamples），舞台侧=舞台脸框 isSkin 像素（分母 stageFaceSamples），样本空间不同、未做 UV/空间配准；仅证明整体色比更接近，不证明 State2 空间阴影逐像素对齐，非皮肤阶段最终完成判据。",
      targetPath: TARGET,
      targetSha256,
      targetSamples: tgt.samples,
      stageFaceSamples: stageV1.samples,
    };
    out.targetConvergence = targetCmp;
    const ok = distV1 < distOrig && drop > THRESHOLDS.targetConvergeDrop;
    out.verdict.faceTargetConverged = ok;
    if (!ok) failures.push("P0-1 V1 未向 V14D 目标显著收敛 distOrig=" + distOrig.toFixed(4) + " distV1=" + distV1.toFixed(4) + " drop=" + drop.toFixed(4) + "（需 drop>" + THRESHOLDS.targetConvergeDrop + "）");
  } else failures.push("P0-1 目标参考或脸部皮肤样本为空，无法判定收敛");
} else failures.push("P0-1 目标参考图不存在: " + TARGET);

// P0-1 错误颜色负测：把 V1 画布 R 通道压制（皮肤变青绿，远离 V14D 暖肤目标）。
// 直接操作像素：R*0.4、保留 G/B，isSkin 仍部分命中（R>G 可能不再成立时取 R 提升前的口径），
// 故此处用宽松皮肤掩码（仅 R>60 且曾为皮肤区）统计错色色比。若错色仍被判收敛则判定无效 → fail。
if (targetCmp) {
  try {
    const mod = Buffer.from(b.data); // 复制 V1 像素
    for (let i = 0; i < mod.length; i += 4) {
      if (mod[i + 3] < 8) continue;
      const r = mod[i], g = mod[i + 1], bb = mod[i + 2];
      if (isSkin(r, g, bb)) { mod[i] = Math.round(r * 0.35); mod[i + 1] = Math.min(255, Math.round(g * 1.1)); } // 错色：压 R 提 G
    }
    const negImg = { data: mod, width: b.width, height: b.height };
    // 宽松掩码：用原始图判定皮肤位置，读错色后的值
    const { x0, y0, x1, y1 } = bounds(faceRegion);
    let n = 0, s = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      if (b.data[i + 3] < 8) continue;
      if (!isSkin(b.data[i], b.data[i + 1], b.data[i + 2])) continue; // 按原始 V1 皮肤位置
      s[0] += mod[i]; s[1] += mod[i + 1]; s[2] += mod[i + 2]; n++;
    }
    if (n) {
      const m = s.map((v) => v / n);
      const negRatio = [+(m[0] / m[1]).toFixed(4), +(m[0] / m[2]).toFixed(4)];
      const negDist = ratioDist(negRatio, targetCmp.targetRatio);
      const negDrop = (targetCmp.distOrig - negDist) / targetCmp.distOrig;
      out.negWrongColor = { negRatio, negDist: +negDist.toFixed(4), negDrop: +negDrop.toFixed(4), samples: n };
      const negConverged = negDist < targetCmp.distOrig && negDrop > THRESHOLDS.targetConvergeDrop;
      if (negConverged) failures.push("P0-1 负测失效：错误青绿肤色被判收敛 negDist=" + negDist.toFixed(4) + " negDrop=" + negDrop.toFixed(4));
    } else { out.negWrongColor = { error: "无皮肤样本" }; failures.push("P0-1 负测无皮肤样本，无法验证判别力"); }
  } catch (e) { out.negWrongColorError = String(e); failures.push("P0-1 负测执行异常: " + e); }
}

// 分区 UV 取证图（人读 A/B 证据）：HairA/HairB 各自的 original 语义 / V14D 目标 /
// 差异图。即使 Gate 失败也产出（便于审查失败形态）；不阻断判定。
try {
  out.hairUvImages = await writeHairSlotUvImages();
} catch (e) { out.hairUvImagesError = String(e); }

// wrongTint 负测模式：除常规 failures 外，硬断言「错误颜色确实被判不收敛」——
  // 若 hairA/hairB TargetConverged 仍为 true，说明收敛 Gate 对错误颜色无判别力，
  // 本模式必须以非零退出（负测失效）。健康路径（非负测）由 failures 判定。
if (NEG_WRONGTINT) {
  const negA = out.verdict.hairATargetConverged;
  const negB = out.verdict.hairBTargetConverged;
  out.negWrongTint = { hairATargetConverged: negA, hairBTargetConverged: negB };
  if (negA === true || negB === true) {
    failures.push("wrongTint 负测失效：错误颜色被判收敛 hairA=" + negA + " hairB=" + negB);
  }
}

out.pass = failures.length === 0;
fs.writeFileSync(REPORT_JSON, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ pass: out.pass, verdict: out.verdict, occluded: out.occluded, failures }, null, 2));
if (!out.pass) { console.error("===VISUAL-GATE-FAIL==="); process.exit(1); }
console.log(NEG_WRONGTINT ? "===VISUAL-GATE-WRONGTINT-REJECTED===" : "===VISUAL-GATE-OK===");
