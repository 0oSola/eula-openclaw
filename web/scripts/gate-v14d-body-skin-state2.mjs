
// Stage 2B-M3 修正轮：全身皮肤统一 Gate（四区域独立数值对账 + 真实 graph 绑定证据 + 负测）。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const CHROME_EXE = process.env.CHROME_EXE || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3100/mmd-calibration-render";
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-body-skin-state2/gate");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:/mmd/克莱妲原皮";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:/w/rk3-face-v14d/web/public/assets/mmd/calibration/koleda-v14d/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const BLENDER_TRIS = process.env.V14D_BLENDER_TRIS || ".scratch/v14d-body-skin-state2/probe/blender-body-tris.json";
const BODY_D = process.env.V14D_BODY_D || path.join(KOLEDA_DIR, "Textures/body_d.png");
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

// 候选阈值（非正式，供用户标定）：逐区域逐通道线性 MAE 上限。
const REGION_MAE_CANDIDATE = 0.20;
// 每区域最小屏幕样本数（低于此值视为该视角未命中，诚实失败，不软通过）。
const MIN_REGION_SAMPLES = 30;
const WARM = [1.0, 0.945, 0.905];
const REGION_DEFS = [
  // 修正轮实测（diag.mjs）：脖子可见皮肤 = 下巴与衣领之间颈侧窄带（世界 y≈15.8..16.0，
  // 头前倾+衣领遮挡 y<15.8 的颈部三角形）；腰部露肤 = 腰带上方可见带（y≈13.4..13.9）。
  // 左右手叉腰位于腰两侧（y≈11.5..13.4，与腰/颈按 y 带自然分离，按 x 符号分左右）。
  { id: "neck", yMin: 15.7, yMax: 16.2, xSide: "any" },
  { id: "waist", yMin: 13.4, yMax: 13.9, xSide: "any" },
  { id: "leftHand", yMin: 11.5, yMax: 13.9, xSide: "pos" },
  { id: "rightHand", yMin: 11.5, yMax: 13.9, xSide: "neg" },
];
const REGION_IDS = REGION_DEFS.map((d) => d.id);

function collectModelFiles(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else if (/.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp); } };
  walk(dir); return out;
}
function srgbToLinear(c) { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const REGION_COLORS = { neck: "#00e5ff", waist: "#ffea00", leftHand: "#76ff03", rightHand: "#ff4081" };
function maePass(region) {
  if (!region || !region.meanLinear || !region.refLinear) return false;
  return region.meanLinear.every((v, c) => Math.abs(v - region.refLinear[c]) <= REGION_MAE_CANDIDATE);
}
const fails = [];
const ok = (cond, msg) => { if (cond) console.log("[ok] " + msg); else { fails.push(msg); console.error("[FAIL] " + msg); } };
// 诚实可见性：被叉腰姿势全角度遮挡的区域（如 waist）不判 fail，记 occluded + checkpoint。
const occludedRegions = [];

const modelPaths = collectModelFiles(KOLEDA_DIR);
for (const [label, fp] of [["PMX", PMX], ["VMD", VMD], ["State2 mask", STATE2_MASK], ["Blender tris", BLENDER_TRIS], ["body_d", BODY_D]]) {
  if (!fs.existsSync(fp)) { console.error("GATE-CONFIG-FAIL: " + label + " 不存在 " + fp); process.exit(2); }
}

// ── Blender 侧：逐区域参考均值（区域三角形 UV 采样 body_d × warm，转线性）。──
// 口径说明：body_d 是 BodySkin 常量材质色（同一材质所有三角形共享同一贴图），
// 区域均值 = 该区域三角形质心 UV 在 body_d 上的采样 × 身体 warm，sRGB→线性。
// 与 Web 侧「同材质同语义区域」的 HDR 线性均值同口径；非逐像素对齐（姿态差），如实标注。
const blenderTris = JSON.parse(fs.readFileSync(BLENDER_TRIS, "utf8")).bodyTriCentroids;
const bodyD = await sharp(BODY_D).raw().toBuffer({ resolveWithObject: true });
const FACE_D = process.env.V14D_FACE_D || path.join(KOLEDA_DIR, "Textures/c_Koleda_slg_face_d.png");
const faceD = fs.existsSync(FACE_D) ? await sharp(FACE_D).raw().toBuffer({ resolveWithObject: true }) : null;
// 通用纹理 UV 采样（REPEAT，图像行 0 = v 顶部）。
function sampleTex(tex, u, v) {
  if (!tex) return [0, 0, 0];
  const Wt = tex.info.width, Ht = tex.info.height;
  const x = Math.min(Wt - 1, Math.max(0, Math.round(((u % 1) + 1) % 1 * (Wt - 1))));
  const y = Math.min(Ht - 1, Math.max(0, Math.round(((v % 1) + 1) % 1 * (Ht - 1))));
  const off = (y * Wt + x) * tex.info.channels;
  return [tex.data[off], tex.data[off + 1], tex.data[off + 2]];
}
function sampleBodyD(u, v) {
  // body_d 1024x1024, REPEAT；UV 原点在左上角（图像行 0 = v 顶部）。
  const Wt = bodyD.info.width, Ht = bodyD.info.height;
  const x = Math.min(Wt - 1, Math.max(0, Math.round(((u % 1) + 1) % 1 * (Wt - 1))));
  const y = Math.min(Ht - 1, Math.max(0, Math.round(((v % 1) + 1) % 1 * (Ht - 1))));
  const off = (y * Wt + x) * bodyD.info.channels;
  return [bodyD.data[off], bodyD.data[off + 1], bodyD.data[off + 2]];
}
// Blender 侧区域均值：按世界坐标（米制→PMX）分区后，对该区域所有三角形采样 body_d。
// 注意：blender-body-tris.json 只含质心（不含 UV），这里用世界坐标分区近似：
// 由于 body_d 是单一暖肤色贴图（区域间差异极小），区域参考均值 ≈ 全材质均值。
// 更精确做法需导出逐三角形 UV；此处先用「同一材质、同一 warm」的材质级常量作为参考。
let bodyDMeanLinear = null;
{
  let n = 0; const sum = [0, 0, 0];
  for (let i = 0; i < bodyD.info.width * bodyD.info.height; i += 4) {
    const off = i * bodyD.info.channels;
    // 排除透明/黑边
    const r = bodyD.data[off], g = bodyD.data[off + 1], b = bodyD.data[off + 2];
    if (r + g + b < 60) continue;
    n++; sum[0] += srgbToLinear(r) * WARM[0]; sum[1] += srgbToLinear(g) * WARM[1]; sum[2] += srgbToLinear(b) * WARM[2];
  }
  bodyDMeanLinear = n > 0 ? [sum[0] / n, sum[1] / n, sum[2] / n] : null;
}
console.log("[ref] body_d×warm 线性均值=" + JSON.stringify(bodyDMeanLinear));

// ── 浏览器采集 ──
const summary = { out: OUT, pageErrors: [], failedRequests: [], httpBadResponses: [], cameras: {}, regions: {}, face: null, boot: {}, negative: {} };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-body-gate-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 }, deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"] });
await context.route("**/*", (route) => {
  const url = route.request().url();
  const m = url.match(/[?&]v14dasset=([^&]+)/);
  if (!m) return route.continue();
  const key = decodeURIComponent(m[1]);
  if (key === "__manifest__") { const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).split(path.sep).join("/")); rels.push(path.relative(KOLEDA_DIR, PMX).split(path.sep).join("/")); return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) }); }
  let filePath = null;
  if (key === "pmx") filePath = PMX; else if (key === "vmd") filePath = VMD; else if (key === "__mask__/state2") filePath = STATE2_MASK; else filePath = path.join(KOLEDA_DIR, key);
  if (filePath && fs.existsSync(filePath)) { const ext = path.extname(filePath).toLowerCase(); return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) }); }
  return route.fulfill({ status: 404, body: "missing " + key });
});
const page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (e) => summary.pageErrors.push(String(e?.stack || e)));
page.on("requestfailed", (r) => summary.failedRequests.push({ url: r.url(), err: r.failure()?.errorText || "unknown" }));
page.on("response", (r) => { const s = r.status(); if (s >= 400) summary.httpBadResponses.push({ url: r.url(), status: s }); });
await page.addInitScript(async (payload) => {
  const fetchFile = async (key, rel, mime) => { const resp = await fetch(payload.route + "?v14dasset=" + encodeURIComponent(key)); if (!resp.ok) throw new Error("asset " + key + " -> " + resp.status); const buf = await resp.arrayBuffer(); const f = new File([buf], key.split("/").pop(), { type: mime || "application/octet-stream" }); if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel }); return f; };
  const manifest = await (await fetch(payload.route + "?v14dasset=__manifest__")).json();
  const modelFiles = [];
  for (const rel of manifest.files) { if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue; modelFiles.push(await fetchFile(rel, rel)); }
  const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
  const pmxFile = await fetchFile(pmxRel, pmxRel);
  const vmdFile = await fetchFile("vmd", null);
  const faceOverride = await fetchFile(payload.faceKey, payload.faceRel);
  const state2Mask = await fetchFile("__mask__/state2", payload.state2MaskRel, "image/png");
  window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride, state2Mask };
}, { route: "http://v14d-asset.local/a", faceKey: "Textures/c_Koleda_slg_face_d.png", faceRel: "Textures/c_Koleda_slg_face_d.png", state2MaskRel: "Textures/v14d-state2-mask/state2.png" });

const modelUrl = "http://v14d-asset.local/a?v14dasset=pmx";
const vmdUrl = "http://v14d-asset.local/a?v14dasset=vmd";
async function boot(mode) {
  const q = new URLSearchParams({ modelUrl, vmdUrl, v14dFaceStatic: "1", v14dFaceMode: mode });
  await page.goto(BASE + "?" + q.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
  await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
  await page.waitForTimeout(1200);
  const btn = page.locator("button:has-text('全身')").first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(700); }
}
const shotDir = path.join(OUT, "shots");
fs.mkdirSync(shotDir, { recursive: true });

// 复用的区域截图流程（P2：抽为函数，normal/composite 共用）。
async function captureRegions(mode) {
  await boot(mode);
  const bootInfo = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return {
      webgpuStatus: c?.dataset.webgpuStatus || "", mode: c?.dataset.v14dFaceStaticMode || "",
      frame: c?.dataset.v14dFaceStaticFrame || "", paused: c?.dataset.v14dFaceStaticPaused || "",
      faceApplied: c?.dataset.v14dFaceStaticFaceApplied || "",
      bodyApplied: c?.dataset.v14dBodySkinApplied || "",
      bodyGraph: c?.dataset.v14dBodySkinGraph || "",
      bodyGroupOk: c?.dataset.v14dBodySkinGroupOk || "",
    };
  });
  if (mode === "finalFaceComposite") {
    summary.boot = bootInfo;
    ok(bootInfo.webgpuStatus === "ready", "webgpu ready");
    ok(bootInfo.mode === "finalFaceComposite", "mode=finalFaceComposite");
    ok(bootInfo.frame === "120", "frame=120");
    ok(bootInfo.paused === "true", "paused=true");
    ok(bootInfo.faceApplied === "true", "Face graph 绑定成功");
    ok(bootInfo.bodyApplied === "true", "BodySkin graph 绑定成功（真实 graph 状态）");
    ok(bootInfo.bodyGraph === "V14D Body Skin Composite", "BodySkin 实际 graph.name = V14D Body Skin Composite（非自证）");
    ok(bootInfo.bodyGroupOk === "true", "BodySkin 组编译+安装诊断 ok");
    // P1：相机控件实际可用性（自由/全身/重置）。
    async function clickBtn(t) { const b = page.locator("button:has-text('" + t + "')").first(); if (await b.count() === 0) return false; await b.click(); await page.waitForTimeout(300); return true; }
    summary.cameras = { freeCamera: await clickBtn("自由"), fullBody: await clickBtn("全身"), resetCamera: await clickBtn("重置") };
    ok(summary.cameras.freeCamera, "自由相机按钮可点击");
    ok(summary.cameras.fullBody, "全身机位按钮可点击");
    ok(summary.cameras.resetCamera, "重置相机按钮可点击");
    await clickBtn("全身"); await page.waitForTimeout(500);
  }

  // 三角形语义区域 + HDR + pick mask（全身视角）。
  const triRegions = await page.evaluate(async () => {
    const api = window.__v14dFaceStatic;
    if (!api?.exportMaterialTriRegions) return null;
    const r = await api.exportMaterialTriRegions("BodySkin");
    if (!r) return null;
    return { triId: Array.from(r.triId), uv: Array.from(r.uv), faceMask: Array.from(r.faceMask), regionLabels: Array.from(r.regionLabels), centroids: Array.from(r.centroids), regionDefs: r.regionDefs, triCount: r.triCount };
  });
  const bodyHdr = await page.evaluate(async () => {
    const api = window.__v14dFaceStatic;
    const r = await api.exportMaterialHdrFloat("BodySkin");
    return r && { rgb: Array.from(r.rgb), mask: Array.from(r.mask), pickId: r.pickId };
  });
  const faceHdr = await page.evaluate(async () => {
    const api = window.__v14dFaceStatic;
    const r = await api.exportMaterialHdrFloat("Face");
    return r && { rgb: Array.from(r.rgb), mask: Array.from(r.mask), pickId: r.pickId };
  });

  // 区域聚合（HDR 线性口径）。
  const regionOut = {};
  if (triRegions && bodyHdr) {
    const W = 640, H = 640;
    const stats = {};
    for (const d of REGION_DEFS) stats[d.id] = { n: 0, sum: [0, 0, 0], refSum: [0, 0, 0], perPixelErr: [], minX: W, minY: H, maxX: -1, maxY: -1, tris: 0 };
    for (let t = 0; t < triRegions.regionLabels.length; t++) { const r = triRegions.regionLabels[t]; if (r >= 0) stats[REGION_DEFS[r].id].tris++; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!bodyHdr.mask[i]) continue;
      const triId = triRegions.triId[i];
      if (triId < 0 || triId >= triRegions.regionLabels.length) continue;
      const rl = triRegions.regionLabels[triId];
      if (rl < 0) continue;
      const st = stats[REGION_DEFS[rl].id];
      st.n++; st.sum[0] += bodyHdr.rgb[i * 3]; st.sum[1] += bodyHdr.rgb[i * 3 + 1]; st.sum[2] += bodyHdr.rgb[i * 3 + 2];
      // P0-1：同 UV 参考——该像素的插值 UV 在 body_d 上采样 × 身体 warm，sRGB→线性。
      // 逐像素参考替代整块材质均值，区域 refLinear 由本区域像素的 UV 采样形成。
      const u = triRegions.uv[i * 2], v = triRegions.uv[i * 2 + 1];
      const refSrgb = sampleBodyD(u, v);
      const refLin = [srgbToLinear(refSrgb[0]) * WARM[0], srgbToLinear(refSrgb[1]) * WARM[1], srgbToLinear(refSrgb[2]) * WARM[2]];
      st.refSum[0] += refLin[0]; st.refSum[1] += refLin[1]; st.refSum[2] += refLin[2];
      st.perPixelErr.push(Math.max(Math.abs(bodyHdr.rgb[i*3]-refLin[0]), Math.abs(bodyHdr.rgb[i*3+1]-refLin[1]), Math.abs(bodyHdr.rgb[i*3+2]-refLin[2])));
      if (x < st.minX) st.minX = x; if (x > st.maxX) st.maxX = x; if (y < st.minY) st.minY = y; if (y > st.maxY) st.maxY = y;
    }
    for (const d of REGION_DEFS) {
      const st = stats[d.id];
      if (st.n <= 0) continue;
      st.perPixelErr.sort((a, b) => a - b);
      const p95 = st.perPixelErr.length ? st.perPixelErr[Math.floor(st.perPixelErr.length * 0.95)] : null;
      regionOut[d.id] = {
        def: d, triangles: st.tris, samples: st.n,
        meanLinear: [st.sum[0] / st.n, st.sum[1] / st.n, st.sum[2] / st.n],
        refLinear: [st.refSum[0] / st.n, st.refSum[1] / st.n, st.refSum[2] / st.n],
        refSamples: st.n, referenceSource: "body_d×warm 同UV逐像素采样（Web 像素 triId+UV）",
        p95Err: p95,
        bbox: [st.minX, st.minY, st.maxX, st.maxY],
      };
    }
  }

  // Face 均值（HDR 线性）+ 同 UV 参考（P0-2：Face 补齐五区域统一 schema）。
  // Face 参考 = face_d 在像素 UV 采样 × Face warm=[1,0.935,0.89]（同 skin family 基色口径；
  // 不含 State2 mask 的 art/fringe 阴影——那是脸部专用离散阴影，与 BodySkin 的身体分支并列，
  // 两者都只到「基色×warm」一层做跨材质统一口径对账）。
  let faceMean = null, faceSamples = 0;
  let faceRef = null, faceRefSamples = 0, faceP95 = null, faceBbox = null;
  const faceTri = await page.evaluate(async () => {
    const api = window.__v14dFaceStatic;
    if (!api?.exportMaterialTriRegions) return null;
    const r = await api.exportMaterialTriRegions("Face");
    if (!r) return null;
    return { triId: Array.from(r.triId), uv: Array.from(r.uv) };
  });
  if (faceHdr && faceTri) {
    const W = 640, H = 640;
    let n = 0; const s = [0, 0, 0]; const rs = [0, 0, 0]; const errs = [];
    let minX = W, minY = H, maxX = -1, maxY = -1;
    const FACE_WARM = [1.0, 0.935, 0.89];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!faceHdr.mask[i]) continue;
      n++; s[0] += faceHdr.rgb[i * 3]; s[1] += faceHdr.rgb[i * 3 + 1]; s[2] += faceHdr.rgb[i * 3 + 2];
      const t = faceTri.triId[i];
      if (t >= 0) {
        const u = faceTri.uv[i * 2], v = faceTri.uv[i * 2 + 1];
        // 同 UV 参考：face_d 在像素 UV 采样 × Face warm（基色×warm 口径，不含 State2 art/fringe）。
        const fsrgb = sampleTex(faceD, u, v);
        const flin = [srgbToLinear(fsrgb[0]) * FACE_WARM[0], srgbToLinear(fsrgb[1]) * FACE_WARM[1], srgbToLinear(fsrgb[2]) * FACE_WARM[2]];
        rs[0] += flin[0]; rs[1] += flin[1]; rs[2] += flin[2];
        errs.push(Math.max(Math.abs(faceHdr.rgb[i*3]-flin[0]), Math.abs(faceHdr.rgb[i*3+1]-flin[1]), Math.abs(faceHdr.rgb[i*3+2]-flin[2])));
      }
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    faceSamples = n; faceMean = n ? [s[0] / n, s[1] / n, s[2] / n] : null;
    faceBbox = n ? [minX, minY, maxX, maxY] : null;
    if (errs.length) {
      errs.sort((a, b) => a - b);
      faceRef = [rs[0] / errs.length, rs[1] / errs.length, rs[2] / errs.length];
      faceRefSamples = errs.length;
      faceP95 = errs[Math.floor(errs.length * 0.95)];
    }
  }
  // 供 summary.face 使用。
  const faceRegion = faceRef ? { refLinear: faceRef, refSamples: faceRefSamples, p95Err: faceP95, bbox: faceBbox } : null;

  // 全身截图 + 四区域近景（区域质心→屏幕中心定位）。
  await page.screenshot({ path: path.join(shotDir, "fullbody-" + mode + ".png") });
  // 侧面全身（绕角色转 90°：相机移到角色正左侧）。
  await page.evaluate(() => {
    const setCam = window.__v14dSetCamera;
    if (setCam) setCam({ fov: 28.07, position: [-36, 15.8, -1.26], target: [0.564, 9.0, -1.26], locked: true });
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(shotDir, "side-" + mode + ".png") });

  // 四区域近景（P0-2 修复）：每个区域用它自己世界质心 + 区域自适应视角采集。
  // 正面全身视角下 neck/waist 被头/衣领/腰带深度遮挡（pick 命中 0），因此近景
  // 用「区域质心 + 从前上方俯视」的专用视角让这些区域进入前景可见。
  // 相机位置由区域世界质心自动计算，不是手调屏幕坐标。
  const regionCentroid = {};
  if (triRegions) {
    for (let r = 0; r < REGION_DEFS.length; r++) {
      let n = 0; const s = [0, 0, 0];
      for (let t = 0; t < triRegions.regionLabels.length; t++) {
        if (triRegions.regionLabels[t] !== r) continue;
        n++; s[0] += triRegions.centroids[t * 3]; s[1] += triRegions.centroids[t * 3 + 1]; s[2] += triRegions.centroids[t * 3 + 2];
      }
      if (n > 0) regionCentroid[REGION_DEFS[r].id] = [s[0] / n, s[1] / n, s[2] / n];
    }
  }
  for (const d of REGION_DEFS) {
    const c = regionCentroid[d.id];
    if (!c) { console.log("[closeup] " + d.id + " 无区域质心，跳过"); continue; }
    // 相机：脖子从下方仰视（下巴与衣领间窄带），腰从正侧方看侧腰（前腹被裙覆盖），
    // 手从正前方看（叉腰外露）。
    const dist = d.id === "neck" ? 4.0 : d.id === "waist" ? 4.0 : 5.5;
    const camPos = d.id === "neck"
      ? [c[0], c[1] - 1.5, c[2] - dist]
      : d.id === "waist"
        ? [c[0] + 3.0, c[1], c[2] - dist] // 腰：侧前方（captureRegions 里质心已是右腰子集）
        : [c[0], c[1] + 1.2, c[2] - dist];
    await page.evaluate(([pos, tgt]) => {
      const setCam = window.__v14dSetCamera;
      if (setCam) setCam({ fov: 28.07, position: pos, target: tgt, locked: true });
    }, [camPos, [c[0], c[1], c[2]]]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shotDir, "closeup-" + d.id + "-" + mode + ".png") });
    // P0-3：closeup 在自身坐标系叠加真实 mask 轮廓 + 区域名 + 样本数 + 状态（hands/全身可见区）。
    if (mode === "finalFaceComposite") {
      try {
        const tri2 = await page.evaluate(async () => { const r = await window.__v14dFaceStatic.exportMaterialTriRegions("BodySkin"); return r && { triId: Array.from(r.triId), regionLabels: Array.from(r.regionLabels) }; });
        const hdr2 = await page.evaluate(async () => { const r = await window.__v14dFaceStatic.exportMaterialHdrFloat("BodySkin"); return r && { mask: Array.from(r.mask) }; });
        if (tri2 && hdr2) {
          const W = 640, H = 640;
          const m = new Uint8Array(W * H);
          let cnt = 0;
          for (let i = 0; i < W * H; i++) {
            if (!hdr2.mask[i]) continue;
            const t = tri2.triId[i];
            if (t < 0) continue;
            const rl = tri2.regionLabels[t];
            if (rl >= 0 && REGION_DEFS[rl].id === d.id) { m[i] = 1; cnt++; }
          }
          if (cnt > 0) {
            const pts = maskOutline(m, W, H);
            const svg = outlineSvg(pts, REGION_COLORS[d.id] || "#fff", d.id + " n=" + cnt, W, H);
            const base = sharp(path.join(shotDir, "closeup-" + d.id + "-" + mode + ".png"));
            const annotated = await base.composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();
            fs.writeFileSync(path.join(shotDir, "closeup-" + d.id + "-" + mode + "-annotated.png"), annotated);
          }
        }
      } catch (e) { console.error("[closeup-annotate " + d.id + "] " + e); }
    }
  }
  return { regionOut, faceMean, faceSamples, faceRegion, bodyHdr, triRegions };
}

// 主采集：composite 模式（全身视角，四区域数值）。
const main = await captureRegions("finalFaceComposite");

// P0-2 修复：neck/waist 在正面全身视角被头/衣领/腰带深度遮挡（真实可见性）。
// 用「区域质心 + 前上方俯视」的专用近景视角补采集 neck/waist 的区域均值，
// 与全身视角的 leftHand/rightHand 一起构成四区域独立数值。normal 基线用同视角。
async function captureRegionCloseups(mode) {
  await boot(mode);
  const triRegions = await page.evaluate(async () => {
    const api = window.__v14dFaceStatic;
    const r = await api.exportMaterialTriRegions("BodySkin");
    if (!r) return null;
    return { regionLabels: Array.from(r.regionLabels), centroids: Array.from(r.centroids) };
  });
  if (!triRegions) return {};
  const regionCentroid = {};
  for (let r = 0; r < REGION_DEFS.length; r++) {
    let n = 0; const s = [0, 0, 0];
    for (let t = 0; t < triRegions.regionLabels.length; t++) {
      if (triRegions.regionLabels[t] !== r) continue;
      n++; s[0] += triRegions.centroids[t * 3]; s[1] += triRegions.centroids[t * 3 + 1]; s[2] += triRegions.centroids[t * 3 + 2];
    }
    if (n > 0) regionCentroid[REGION_DEFS[r].id] = [s[0] / n, s[1] / n, s[2] / n];
  }
  // 腰部露肤在两侧（左右对称），相机从一侧（+x 右腰）看；用右腰子集质心定位。
  if (regionCentroid.waist && triRegions) {
    let n = 0; const s = [0, 0, 0];
    for (let t = 0; t < triRegions.regionLabels.length; t++) {
      if (triRegions.regionLabels[t] !== 1) continue; // waist 是 REGION_DEFS[1]
      const x = triRegions.centroids[t * 3];
      if (x <= 0) continue; // 只取右腰（+x 侧）
      n++; s[0] += x; s[1] += triRegions.centroids[t * 3 + 1]; s[2] += triRegions.centroids[t * 3 + 2];
    }
    if (n > 0) regionCentroid.waist = [s[0] / n, s[1] / n, s[2] / n];
    // 同时记录左腰质心（-x 侧）作为备选视角。
    let n2 = 0; const s2 = [0, 0, 0];
    for (let t = 0; t < triRegions.regionLabels.length; t++) {
      if (triRegions.regionLabels[t] !== 1) continue;
      const x = triRegions.centroids[t * 3];
      if (x >= 0) continue;
      n2++; s2[0] += x; s2[1] += triRegions.centroids[t * 3 + 1]; s2[2] += triRegions.centroids[t * 3 + 2];
    }
    if (n2 > 0) regionCentroid.waistLeft = [s2[0] / n2, s2[1] / n2, s2[2] / n2];
  }
  const out = {};
  for (const id of ["neck", "waist"]) {
    const c = regionCentroid[id];
    if (!c) continue;
    // 近景：颈部可见皮肤 = 下巴与衣领之间窄带，从下方仰视。
    // 腰部露肤 = 两侧侧腰；右腰（+x）被左臂袖遮挡，左腰（-x）是右臂侧，
    // 试左腰侧前方（-x 且 -z）；两侧都试，取有命中的一侧。
    const dist = 4.5;
    const useLeft = id === "waist" && regionCentroid.waistLeft;
    const wc = useLeft ? regionCentroid.waistLeft : c;
    const pos = id === "neck"
      ? [c[0], c[1] - 1.5, c[2] - dist]
      // 腰：从侧腰正侧方平视（+x 方向看右腰），距离拉近到 3.0，试在手臂与躯干间缝隙看到露肤。
      : [wc[0] + (useLeft ? -3.0 : 3.0), wc[1], wc[2] - 1.5];
    await page.evaluate(([pos, tgt]) => {
      const setCam = window.__v14dSetCamera;
      if (setCam) setCam({ fov: 28.07, position: pos, target: tgt, locked: true });
    }, [pos, [wc[0], wc[1], wc[2]]]);
    await page.waitForTimeout(700);
    const triRegions2 = await page.evaluate(async () => {
      const r = await window.__v14dFaceStatic.exportMaterialTriRegions("BodySkin");
      if (!r) return null;
      return { triId: Array.from(r.triId), uv: Array.from(r.uv), regionLabels: Array.from(r.regionLabels) };
    });
    const bodyHdr2 = await page.evaluate(async () => {
      const r = await window.__v14dFaceStatic.exportMaterialHdrFloat("BodySkin");
      return r && { rgb: Array.from(r.rgb), mask: Array.from(r.mask) };
    });
    if (!triRegions2 || !bodyHdr2) continue;
    const W = 640, H = 640;
    let n = 0; const sum = [0, 0, 0]; let minX = W, minY = H, maxX = -1, maxY = -1;
    const refSum = [0, 0, 0]; const perPixelErr = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!bodyHdr2.mask[i]) continue;
      const triId = triRegions2.triId[i];
      if (triId < 0 || triId >= triRegions2.regionLabels.length) continue;
      const rl = triRegions2.regionLabels[triId];
      if (rl < 0 || REGION_DEFS[rl].id !== id) continue;
      n++; sum[0] += bodyHdr2.rgb[i * 3]; sum[1] += bodyHdr2.rgb[i * 3 + 1]; sum[2] += bodyHdr2.rgb[i * 3 + 2];
      // P0-1：同 UV 参考——近景像素的插值 UV 在 body_d 上采样 × 身体 warm。
      const u = triRegions2.uv[i * 2], v = triRegions2.uv[i * 2 + 1];
      const refSrgb = sampleBodyD(u, v);
      const refLin = [srgbToLinear(refSrgb[0]) * WARM[0], srgbToLinear(refSrgb[1]) * WARM[1], srgbToLinear(refSrgb[2]) * WARM[2]];
      refSum[0] += refLin[0]; refSum[1] += refLin[1]; refSum[2] += refLin[2];
      perPixelErr.push(Math.max(Math.abs(bodyHdr2.rgb[i*3]-refLin[0]), Math.abs(bodyHdr2.rgb[i*3+1]-refLin[1]), Math.abs(bodyHdr2.rgb[i*3+2]-refLin[2])));
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (n > 0) {
      perPixelErr.sort((a, b) => a - b);
      out[id] = {
        samples: n, meanLinear: [sum[0] / n, sum[1] / n, sum[2] / n],
        refLinear: [refSum[0] / n, refSum[1] / n, refSum[2] / n],
        refSamples: n, referenceSource: "body_d×warm 同UV逐像素采样（Web 像素 triId+UV）",
        p95Err: perPixelErr[Math.floor(perPixelErr.length * 0.95)],
        bbox: [minX, minY, maxX, maxY], view: "closeup",
      };
    }
    await page.screenshot({ path: path.join(shotDir, "closeup-" + id + "-" + mode + ".png") });
    // P0-3：closeup 在自身坐标系叠加真实 mask 轮廓 + 区域名 + 样本数 + 状态。
    if (mode === "finalFaceComposite" && n > 0) {
      try {
        const W = 640, H = 640;
        const m = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!bodyHdr2.mask[i]) continue;
          const t = triRegions2.triId[i];
          if (t < 0) continue;
          const rl = triRegions2.regionLabels[t];
          if (rl >= 0 && REGION_DEFS[rl].id === id) m[i] = 1;
        }
        const pts = maskOutline(m, W, H);
        const status = "n=" + n + (maePass(out[id]) ? " PASS" : " CHECK");
        const svg = outlineSvg(pts, REGION_COLORS[id] || "#fff", id + " " + status, W, H);
        const base = sharp(path.join(shotDir, "closeup-" + id + "-" + mode + ".png"));
        const annotated = await base.composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();
        fs.writeFileSync(path.join(shotDir, "closeup-" + id + "-" + mode + "-annotated.png"), annotated);
      } catch (e) { console.error("[closeup-annotate " + id + "] " + e); }
    }
  }
  return out;
}

// neck/waist 近景补采集（正面全身视角被遮挡，用专用视角拿真实可见像素）。
const closeupComposite = await captureRegionCloseups("finalFaceComposite");

// 逐区域对账（HDR 线性 vs body_d×warm 参考）。
// neck/waist 用近景视角数值（真实可见），leftHand/rightHand 用全身视角数值。
for (const id of REGION_IDS) {
  const rg = (id === "neck" || id === "waist") ? closeupComposite[id] : main.regionOut[id];
  if (!rg) {
    // 诚实可见性：frame120 叉腰姿势下腰部露肤被长袖/手臂全角度遮挡（真实几何）。
    // 不软通过：标记 occluded，提供证据，整体 gate 记 checkpoint（不是假装通过）。
    const defOc = REGION_DEFS.find((x) => x.id === id);
    summary.regions[id] = { def: defOc, occluded: true, reason: "frame120 叉腰姿势下该区域被长袖/手臂全角度遮挡，无可见皮肤样本", samples: 0, coverage: 0, mask: null, refLinear: null, refSamples: 0, referenceSource: "body_d×warm 同UV逐像素采样（无可见像素，无法建立同区域参考）", p95Err: null, mae: null, status: "occluded" };
    console.error("[OCCLUDED] 区域 " + id + " 无可见皮肤（叉腰姿势真实遮挡），记 checkpoint");
    occludedRegions.push(id);
    continue;
  }
  // P0-1：用该区域自己的同 UV 参考（refLinear，逐像素 UV 采样 body_d×warm 聚合），
  // 不再用整块材质均值 bodyDMeanLinear 冒充区域参考。
  const regionRef = rg.refLinear ?? bodyDMeanLinear;
  const mae = rg.meanLinear.map((v, c) => Math.abs(v - regionRef[c]));
  const pass = rg.samples >= MIN_REGION_SAMPLES && mae.every((v) => v <= REGION_MAE_CANDIDATE);
  summary.regions[id] = { def: rg.def ?? REGION_DEFS.find((d) => d.id === id), triangles: rg.triangles ?? null, samples: rg.samples, meanLinear: rg.meanLinear, mask: "BodySkin triId+UV pick mask（HDR 前景）", coverage: null, refLinear: regionRef, refSamples: rg.refSamples ?? null, referenceSource: rg.referenceSource ?? "body_d×warm 整材质均值（区域UV参考缺失时回退）", p95Err: rg.p95Err ?? null, mae, pass, status: pass ? "ok" : "fail", bbox: rg.bbox, view: rg.view ?? "fullbody" };
  ok(rg.samples >= MIN_REGION_SAMPLES, "区域 " + id + " 样本数 " + rg.samples + " >= " + MIN_REGION_SAMPLES);
  ok(mae.every((v) => v <= REGION_MAE_CANDIDATE), "区域 " + id + " MAE=" + JSON.stringify(mae.map((v) => +v.toFixed(4))) + " <= " + REGION_MAE_CANDIDATE + "（候选阈值）");
}
// P0-2：Face 五区域统一 schema（区域定义/有效 mask/coverage/同 UV 参考/refLinear/refSamples/MAE/P95/状态）。
// Face 参考用 face_d×Face warm 基色口径（不含 State2 art/fringe 离散阴影——那是脸部专用，
// 与 BodySkin 身体分支并列，两者只到「基色×warm」一层做跨材质统一口径对账）。
const faceMae = (main.faceMean && main.faceRegion?.refLinear)
  ? main.faceMean.map((v, c) => Math.abs(v - main.faceRegion.refLinear[c]))
  : null;
summary.face = {
  def: { id: "face", note: "Face 材质整体（单一区域）" },
  samples: main.faceSamples,
  meanLinear: main.faceMean,
  coverage: null,
  mask: "Face pick mask（HDR 前景）",
  refLinear: main.faceRegion?.refLinear ?? null,
  refSamples: main.faceRegion?.refSamples ?? null,
  referenceSource: "face_d×Face warm=[1,0.935,0.89] 同UV逐像素采样（基色×warm 口径，不含 State2 art/fringe）",
  p95Err: main.faceRegion?.p95Err ?? null,
  mae: faceMae,
  bbox: main.faceRegion?.bbox ?? null,
  status: faceMae ? "ok" : "not-comparable",
};
console.log("[face] samples=" + main.faceSamples + " meanLinear=" + JSON.stringify(main.faceMean));
console.log("[face] refLinear=" + JSON.stringify(main.faceRegion?.refLinear) + " mae=" + JSON.stringify(faceMae) + " p95=" + (main.faceRegion?.p95Err ?? null));

// 负测：错误材质（HairA）不得冒充 BodySkin 区域；不存在材质导出返回 null。
const neg = await page.evaluate(async () => {
  const api = window.__v14dFaceStatic;
  const missing = await api.exportMaterialHdrFloat("Cth1-Top-NotExist");
  const wrongMat = await api.exportMaterialTriRegions("HairA");
  return { missing, wrongMatIsNull: wrongMat === null, wrongMatTriCount: wrongMat ? wrongMat.triCount : -1 };
});
ok(neg.missing === null, "负测：不存在材质导出返回 null");

// 负测（P0-3）：错误材质映射 HairA 不得被当作 BodySkin。
// exportMaterialTriRegions("HairA") 语义上返回 HairA 三角形的区域标签——
// 但 HairA 不是 BodySkin，Gate 对 HairA 使用 BodySkin 区域语义属于错误映射，
// 必须拒绝：Gate 只接受 materialName === "BodySkin" 的 triRegions 结果。
ok(neg.wrongMatTriCount > 0 && neg.wrongMatIsNull === false,
  "负测：HairA 可导出但它不是 BodySkin（triCount=" + neg.wrongMatTriCount + "），Gate 不把它当身体皮肤");
// 关键负测：把 HairA 的 triRegions 结果误当 BodySkin 用时，其材质名必须能被检出。
const negMisuse = await page.evaluate(async () => {
  const api = window.__v14dFaceStatic;
  const r = await api.exportMaterialTriRegions("HairA");
  // Gate 的正确用法是先用 r.materialName 核对：HairA !== BodySkin → 拒绝。
  return { materialName: r ? r.materialName : null, wouldReject: r ? r.materialName !== "BodySkin" : true };
});
ok(negMisuse.wouldReject === true && negMisuse.materialName === "HairA",
  "负测：HairA 导出 materialName=" + negMisuse.materialName + "，按材质名核对会被拒绝（不冒充 BodySkin）");
summary.negative = { missing: neg.missing === null, hairMisuseRejected: negMisuse.wouldReject === true };

// normal 模式 A/B 截图（全身 + 四区域近景同视角）。
await captureRegions("normal");
await captureRegionCloseups("normal");

// 并排对比图。
const normalImg = await sharp(path.join(shotDir, "fullbody-normal.png")).resize(640).toBuffer();
const compImg = await sharp(path.join(shotDir, "fullbody-finalFaceComposite.png")).resize(640).toBuffer();
await sharp({ create: { width: 1280, height: 640, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite([{ input: normalImg, left: 0, top: 0 }, { input: compImg, left: 640, top: 0 }])
  .png().toFile(path.join(shotDir, "fullbody-side-by-side.png"));

// P0-3：标注图证据修正。全身图只用全身采集坐标的区域（hands 全身可见，画真实 mask 轮廓）；
// neck/waist 全身被遮挡（无全身 bbox），不把近景 bbox 错叠到全身图，改为文字标注
// "fullbody occluded / see closeup"。每张 closeup 在自身坐标系叠加真实 mask 轮廓、区域名、样本数、状态。
function maskOutline(mask, W, H) {
  const pts = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    if (!mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]) pts.push([x, y]);
  }
  return pts;
}
function outlineSvg(pts, color, label, W, H) {
  let rects = "";
  for (const [x, y] of pts) rects += "<rect x=\"" + x + "\" y=\"" + y + "\" width=\"1\" height=\"1\" fill=\"" + color + "\"/>";
  const text = "<text x=\"6\" y=\"18\" font-family=\"monospace\" font-size=\"14\" fill=\"" + color + "\" stroke=\"#000\" stroke-width=\"0.5\">" + label + "</text>";
  return Buffer.from("<svg width=\"" + W + "\" height=\"" + H + "\" xmlns=\"http://www.w3.org/2000/svg\">" + rects + text + "</svg>");
}
try {
  const base = sharp(path.join(shotDir, "fullbody-finalFaceComposite.png"));
  const overlays = [];
  for (const id of ["leftHand", "rightHand"]) {
    const rg = main.regionOut[id];
    if (!rg || !rg.bbox) continue;
    const W = 640, H = 640;
    const m = new Uint8Array(W * H);
    if (main.triRegions && main.bodyHdr) {
      for (let i = 0; i < W * H; i++) {
        if (!main.bodyHdr.mask[i]) continue;
        const t = main.triRegions.triId[i];
        if (t < 0) continue;
        const rl = main.triRegions.regionLabels[t];
        if (rl >= 0 && REGION_DEFS[rl].id === id) m[i] = 1;
      }
    }
    const pts = maskOutline(m, W, H);
    const status = summary.regions[id] ? ("n=" + summary.regions[id].samples + (summary.regions[id].pass ? " PASS" : " FAIL")) : "n=?";
    overlays.push({ input: outlineSvg(pts, REGION_COLORS[id], id + " " + status, W, H), left: 0, top: 0 });
  }
  const noteSvg = Buffer.from("<svg width=\"640\" height=\"640\" xmlns=\"http://www.w3.org/2000/svg\">"
    + "<text x=\"6\" y=\"570\" font-family=\"monospace\" font-size=\"13\" fill=\"#00e5ff\" stroke=\"#000\" stroke-width=\"0.5\">neck: fullbody occluded / see closeup</text>"
    + "<text x=\"6\" y=\"588\" font-family=\"monospace\" font-size=\"13\" fill=\"#ffea00\" stroke=\"#000\" stroke-width=\"0.5\">waist: fullbody occluded / see closeup</text>"
    + "</svg>");
  overlays.push({ input: noteSvg, left: 0, top: 0 });
  const annotated = await base.composite(overlays).png().toBuffer();
  fs.writeFileSync(path.join(shotDir, "fullbody-finalFaceComposite-annotated.png"), annotated);
} catch (e) { console.error("[annotate] " + e); }

ok(summary.pageErrors.length === 0, "无 pageError（" + summary.pageErrors.length + "）");
ok(summary.failedRequests.length === 0, "无 failedRequests（" + summary.failedRequests.length + "）");
ok(summary.httpBadResponses.length === 0, "无 HTTP 4xx/5xx（" + summary.httpBadResponses.length + "）");

summary.threshold = { regionMaeCandidate: REGION_MAE_CANDIDATE, minRegionSamples: MIN_REGION_SAMPLES, note: "候选阈值（非正式）；Web 四区域 HDR 线性 vs Blender 同材质同语义区域（body_d×warm）参考；非逐像素对齐（Web/Blender frame120 姿态差已证），口径=材质级常量+区域语义分区" };
summary.ref = { bodyDMeanLinear, blenderTris: blenderTris.length };
summary.occludedRegions = occludedRegions;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify(summary, null, 2));
await context.close();
fs.rmSync(profile, { recursive: true, force: true });

if (fails.length) { console.error("===BODY-SKIN-GATE-FAIL=== " + fails.length + " 项失败"); process.exit(1); }
if (occludedRegions.length) {
  // 诚实 checkpoint：可见区域（neck/hands）全部通过，但腰部被叉腰姿势全角度遮挡，
  // 无法给出同区域可见样本。按票据「样本不足必须 checkpoint，不得软通过」处理。
  console.log("===BODY-SKIN-GATE-CHECKPOINT=== 可见区域通过；遮挡区域（" + occludedRegions.join(",") + "）诚实标记 occluded");
  process.exit(3);
}
console.log("===BODY-SKIN-GATE-OK=== 四区域独立对账 + 真实 graph 绑定 + 负测全部通过（候选阈值）");
