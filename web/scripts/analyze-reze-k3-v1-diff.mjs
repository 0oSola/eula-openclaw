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
const OUT = path.resolve(".scratch/reze-k3-v1-stage");
const ORIG = path.join(OUT, "g3-original-canvas.png");
const V1 = path.join(OUT, "g3-v1-canvas.png");
const TARGET = process.env.V14D_TARGET || "C:\\w\\rk3-face-v14d\\.scratch\\v14d-face-static-derived\\blender-ref-finalFaceComposite.png";
if (!fs.existsSync(ORIG) || !fs.existsSync(V1)) { console.error("missing canvas pngs"); process.exit(1); }

async function loadRaw(p) { const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height }; }
const a = await loadRaw(ORIG); const b = await loadRaw(V1);
if (a.width !== b.width || a.height !== b.height) { console.error("size mismatch"); process.exit(1); }
const W = a.width, H = a.height;

function isSkin(r, g, bl) { const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); return r > 95 && g > 40 && bl > 20 && (mx - mn) > 15 && r > g && r > bl && Math.abs(r - g) > 8; }
const lum = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3;

const regions = {
  face:      { x: 0.545, y: 0.13, w: 0.07, h: 0.10, kind: "skin" },
  neck:      { x: 0.555, y: 0.23, w: 0.05, h: 0.04, kind: "skin" },
  leftHand:  { x: 0.27,  y: 0.42, w: 0.10, h: 0.10, kind: "skin" },
  rightHand: { x: 0.63,  y: 0.42, w: 0.10, h: 0.10, kind: "skin" },
  waist:     { x: 0.50,  y: 0.50, w: 0.10, h: 0.06, kind: "skin", occluded: true }, // T 形被外套遮挡
  hair:      { x: 0.53,  y: 0.0,  w: 0.10, h: 0.06, kind: "nonskin" },
  clothes:   { x: 0.46,  y: 0.42, w: 0.10, h: 0.14, kind: "nonskin" },
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

// ── P0-1 目标参考收敛 ───────────────────────────────────────────────
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
  // P0-1 目标收敛：V1 对 V14D 目标的色比误差必须比 original 显著下降（误差下降比例下限）。
  targetConvergeDrop: 0.15,      // (dist_orig - dist_v1) / dist_orig 必须 > 0.15（色比口径）
};

const out = { width: W, height: H, thresholds: THRESHOLDS, target: TARGET, regions: {}, verdict: {}, occluded: [] };
const failures = [];
for (const [name, r] of Object.entries(regions)) {
  if (r.occluded) { out.regions[name] = { occluded: true, note: "frame 当前姿势下不可见，标记 occluded，不参与收敛/稳定判定" }; out.occluded.push(name); continue; }
  if (r.kind === "skin") {
    const st = skinStats(r); out.regions[name] = st;
    const ok = st.samples >= THRESHOLDS.minSkinSamples && st.mae > THRESHOLDS.skinConvergeMae && st.maxMeanDiff > THRESHOLDS.skinConvergeMeanDiff;
    out.verdict[name + "Converged"] = ok;
    if (!ok) failures.push(name + " 皮肤区未向目标显著收敛 samples=" + st.samples + " mae=" + st.mae + " maxMeanDiff=" + st.maxMeanDiff);
  } else if (r.kind === "nonskin") {
    const st = nonSkinStats(r); out.regions[name] = st;
    const ok = st.meanMeanDiff < THRESHOLDS.nonSkinStableMeanMeanDiff && st.maxMeanDiff < THRESHOLDS.nonSkinStableMaxMeanDiff;
    out.verdict[name + "Stable"] = ok;
    if (!ok) failures.push(name + " 非皮肤区被 V1 成片改写 meanMeanDiff=" + st.meanMeanDiff + " maxMeanDiff=" + st.maxMeanDiff + " pctOver2(参考)=" + st.pctOver2 + "%（上限 meanMeanDiff<" + THRESHOLDS.nonSkinStableMeanMeanDiff + " 且 maxMeanDiff<" + THRESHOLDS.nonSkinStableMaxMeanDiff + "）");
  } else {
    const st = bgStats(r); out.regions[name] = st;
    const ok = st.maxMeanDiff < THRESHOLDS.bgStableMeanDiff;
    out.verdict[name + "Stable"] = ok;
    if (!ok) failures.push(name + " 星空背景被 V1 改写 maxMeanDiff=" + st.maxMeanDiff + "（上限 " + THRESHOLDS.bgStableMeanDiff + "）");
  }
}
out.failures = failures;

// ── P0-1 目标参考收敛判定（脸部皮肤，色比口径）────────────────────
// 同名同帧脸框皮肤色比：original 与 V1 分别对 V14D 目标求色比距离，要求 V1 显著更接近。
// 这替代「original↔V1 差异大=收敛」的伪判定——只有对目标的误差真实下降才算收敛。
const faceRegion = regions.face;
const stageOrig = stageFaceRatio(a, faceRegion);
const stageV1 = stageFaceRatio(b, faceRegion);
let targetCmp = null;
if (fs.existsSync(TARGET)) {
  const tgt = await targetSkinRatio(TARGET);
  if (tgt && stageOrig && stageV1) {
    const distOrig = ratioDist(stageOrig.ratio, tgt.ratio);
    const distV1 = ratioDist(stageV1.ratio, tgt.ratio);
    const drop = distOrig > 0 ? (distOrig - distV1) / distOrig : 0;
    targetCmp = { targetRatio: tgt.ratio, targetSamples: tgt.samples, origRatio: stageOrig.ratio, v1Ratio: stageV1.ratio, distOrig: +distOrig.toFixed(4), distV1: +distV1.toFixed(4), drop: +drop.toFixed(4) };
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

out.pass = failures.length === 0;
fs.writeFileSync(path.join(OUT, "visual-diff.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ pass: out.pass, verdict: out.verdict, occluded: out.occluded, failures }, null, 2));
if (!out.pass) { console.error("===VISUAL-GATE-FAIL==="); process.exit(1); }
console.log("===VISUAL-GATE-OK===");
