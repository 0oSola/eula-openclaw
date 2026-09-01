// Stage 2B-M3 全身皮肤统一 Gate：BodySkin 实时合成 + ROI 对账。
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
const BODY_REF = process.env.V14D_BODY_REF || ".scratch/v14d-body-skin-state2/ref/blender-ref-bodyskin-composite.png";
const STATE2_MASK_REL = "Textures/v14d-state2-mask/state2.png";
const FIXED = 640;
const BODY_MAE_CANDIDATE = 0.35;
const MIN_BODY_SAMPLES = 200;
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

function collectModelFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp);
    }
  };
  walk(dir);
  return out;
}
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const fails = [];
const ok = (cond, msg) => { if (cond) console.log("[ok] " + msg); else { fails.push(msg); console.error("[FAIL] " + msg); } };

const modelPaths = collectModelFiles(KOLEDA_DIR);
for (const [label, fp] of [["PMX", PMX], ["VMD", VMD], ["State2 mask", STATE2_MASK], ["Body ref", BODY_REF]]) {
  if (!fs.existsSync(fp)) { console.error("GATE-CONFIG-FAIL: " + label + " 不存在 " + fp); process.exit(2); }
}

const refRaw = await sharp(BODY_REF).raw().toBuffer({ resolveWithObject: true });
let refMeanLinear = null, refSamples = 0;
{
  const { data, info } = refRaw;
  let n = 0; const sum = [0, 0, 0];
  for (let i = 0; i < info.width * info.height; i += 1) {
    const r = data[i * info.channels], g = data[i * info.channels + 1], b = data[i * info.channels + 2];
    // BodySkin 色相 mask：皮肤 R 明显高于 G/B（线性），隔离 Blender 参考中的身体皮肤区域。
    // 透明背景/服装为灰白，不满足该条件。
    const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    if (lr - lg > 0.02 && lr - lb > 0.03) {
    n += 1;
    sum[0] += lr; sum[1] += lg; sum[2] += lb;
    }
  }
  refMeanLinear = n > 0 ? [sum[0] / n, sum[1] / n, sum[2] / n] : null;
  refSamples = n;
}

const summary = { out: OUT, pageErrors: [], failedRequests: [], httpBadResponses: [], cameras: {} };
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-body-skin-chrome-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 },
  deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
});
await context.route("**/*", (route) => {
  const url = route.request().url();
  const m = url.match(/[?&]v14dasset=([^&]+)/);
  if (!m) return route.continue();
  const key = decodeURIComponent(m[1]);
  if (key === "__manifest__") {
    const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).split(path.sep).join("/"));
    rels.push(path.relative(KOLEDA_DIR, PMX).split(path.sep).join("/"));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) });
  }
  let filePath = null;
  if (key === "pmx") filePath = PMX;
  else if (key === "vmd") filePath = VMD;
  else if (key === "__mask__/state2") filePath = STATE2_MASK;
  else filePath = path.join(KOLEDA_DIR, key);
  if (filePath && fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) });
  }
  return route.fulfill({ status: 404, body: "missing " + key });
});

const page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (e) => summary.pageErrors.push(String(e?.stack || e)));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || (m.type() === "warning" && (t.includes("v14d") || t.includes("WGSL") || t.includes("reze")))) {
    console.log("[console:" + m.type() + "] " + t.slice(0, 500));
  }
});
page.on("console", (m) => {
  const t = m.text();
  if ((m.type() === "warning" || m.type() === "error") && t.includes("v14d-body-skin")) console.log("[console:" + m.type() + "] " + t);
});
page.on("requestfailed", (r) => summary.failedRequests.push({ url: r.url(), err: r.failure()?.errorText || "unknown" }));
page.on("response", (r) => { const s = r.status(); if (s >= 400) summary.httpBadResponses.push({ url: r.url(), status: s }); });

await page.addInitScript(async (payload) => {
  const fetchFile = async (key, rel, mime) => {
    const resp = await fetch(payload.route + "?v14dasset=" + encodeURIComponent(key));
    if (!resp.ok) throw new Error("asset " + key + " -> " + resp.status);
    const buf = await resp.arrayBuffer();
    const f = new File([buf], key.split("/").pop(), { type: mime || "application/octet-stream" });
    if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel });
    return f;
  };
  const manifest = await (await fetch(payload.route + "?v14dasset=__manifest__")).json();
  const modelFiles = [];
  for (const rel of manifest.files) {
    if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue;
    modelFiles.push(await fetchFile(rel, rel));
  }
  const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
  const pmxFile = await fetchFile(pmxRel, pmxRel);
  const vmdFile = await fetchFile("vmd", null);
  const faceOverride = await fetchFile(payload.faceKey, payload.faceRel);
  const state2Mask = await fetchFile("__mask__/state2", payload.state2MaskRel, "image/png");
  window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride, state2Mask };
}, {
  route: "http://v14d-asset.local/a",
  faceKey: "Textures/c_Koleda_slg_face_d.png",
  faceRel: "Textures/c_Koleda_slg_face_d.png",
  state2MaskRel: STATE2_MASK_REL,
});

const modelUrl = "http://v14d-asset.local/a?v14dasset=pmx";
const vmdUrl = "http://v14d-asset.local/a?v14dasset=vmd";
const queryComposite = new URLSearchParams({ modelUrl, vmdUrl, v14dFaceStatic: "1", v14dFaceMode: "finalFaceComposite" });
await page.goto(BASE + "?" + queryComposite.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("[data-testid='mmd-calibration-render']", { timeout: 60000 });
try {
await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
} catch (e) {
  const st = await page.evaluate(() => { const c = document.querySelector("canvas"); return { hasCanvas: !!c, status: c?.dataset.webgpuStatus || null, detail: c?.dataset.webgpuDetail || null }; });
  console.error("WEBGPU-NOT-READY: " + JSON.stringify(st));
  throw e;
}
await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
await page.waitForTimeout(1500);

const boot = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  return {
    webgpuStatus: c?.dataset.webgpuStatus || "", mode: c?.dataset.v14dFaceStaticMode || "",
    frame: c?.dataset.v14dFaceStaticFrame || "", state: c?.dataset.v14dFaceStaticState || "",
    blend: c?.dataset.v14dFaceStaticBlend || "", paused: c?.dataset.v14dFaceStaticPaused || "",
    cameraLocked: c?.dataset.v14dFaceStaticCameraLocked || "",
    faceApplied: c?.dataset.v14dFaceStaticFaceApplied || "",
    bodyApplied: c?.dataset.v14dBodySkinApplied || "",
  };
});
console.log("[boot] " + JSON.stringify(boot));
ok(boot.webgpuStatus === "ready", "webgpu ready");
ok(boot.mode === "finalFaceComposite", "mode=finalFaceComposite");
ok(boot.frame === "120", "frame=120");
ok(boot.paused === "true", "paused=true");
ok(boot.faceApplied === "true", "Face graph 绑定成功");
ok(boot.bodyApplied === "true", "BodySkin graph 绑定成功（Stage 2B-M3）");

async function clickButton(text) {
  const btn = page.locator("button:has-text(\"" + text + "\")").first();
  if (await btn.count() === 0) return false;
  await btn.click();
  await page.waitForTimeout(400);
  return true;
}
summary.cameras.fullBody = await clickButton("全身");
summary.cameras.freeCamera = await clickButton("自由");
summary.cameras.resetCamera = await clickButton("重置");
console.log("[camera] " + JSON.stringify(summary.cameras));
ok(summary.cameras.fullBody, "全身机位按钮可点击");
ok(summary.cameras.freeCamera, "自由相机按钮可点击");
ok(summary.cameras.resetCamera, "重置相机按钮可点击");

await clickButton("全身");
await page.waitForTimeout(600);

const bodyHdr = await page.evaluate(async () => {
  const api = window.__v14dFaceStatic;
  if (!api?.exportMaterialHdrFloat) return null;
  const r = await api.exportMaterialHdrFloat("BodySkin");
  if (!r) return null;
  return { width: r.width, height: r.height, pickId: r.pickId, rgb: Array.from(r.rgb), mask: Array.from(r.mask) };
});
ok(!!bodyHdr, "BodySkin HDR 导出成功（exportMaterialHdrFloat）");

let bodyMeanLinear = null, bodySamples = 0;
if (bodyHdr) {
  const { rgb, mask } = bodyHdr;
  let n = 0; const sum = [0, 0, 0];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    n += 1;
    sum[0] += rgb[i * 3]; sum[1] += rgb[i * 3 + 1]; sum[2] += rgb[i * 3 + 2];
  }
  bodySamples = n;
  bodyMeanLinear = n > 0 ? [sum[0] / n, sum[1] / n, sum[2] / n] : null;
}
ok(bodySamples >= MIN_BODY_SAMPLES, "BodySkin ROI 样本数 " + bodySamples + " >= " + MIN_BODY_SAMPLES);

const bodyMae = (bodyMeanLinear && refMeanLinear)
  ? [Math.abs(bodyMeanLinear[0] - refMeanLinear[0]), Math.abs(bodyMeanLinear[1] - refMeanLinear[1]), Math.abs(bodyMeanLinear[2] - refMeanLinear[2])]
  : null;
console.log("[roi] BodySkin web=" + JSON.stringify(bodyMeanLinear) + " samples=" + bodySamples);
console.log("[roi] Blender 身体参考=" + JSON.stringify(refMeanLinear) + " samples=" + refSamples);
console.log("[roi] BodySkin MAE(候选阈值 " + BODY_MAE_CANDIDATE + ")=" + JSON.stringify(bodyMae));
ok(bodyMae && bodyMae.every((v) => v <= BODY_MAE_CANDIDATE), "BodySkin 线性 MAE <= " + BODY_MAE_CANDIDATE + "（候选阈值）");

const faceHdr = await page.evaluate(async () => {
  const api = window.__v14dFaceStatic;
  if (!api?.exportMaterialHdrFloat) return null;
  const r = await api.exportMaterialHdrFloat("Face");
  if (!r) return null;
  return { width: r.width, height: r.height, pickId: r.pickId, rgb: Array.from(r.rgb), mask: Array.from(r.mask) };
});
let faceMeanLinear = null, faceSamples = 0;
if (faceHdr) {
  const { rgb, mask } = faceHdr;
  let n = 0; const sum = [0, 0, 0];
  for (let i = 0; i < mask.length; i += 1) { if (!mask[i]) continue; n += 1; sum[0] += rgb[i * 3]; sum[1] += rgb[i * 3 + 1]; sum[2] += rgb[i * 3 + 2]; }
  faceSamples = n; faceMeanLinear = n > 0 ? [sum[0] / n, sum[1] / n, sum[2] / n] : null;
}
console.log("[roi] Face web=" + JSON.stringify(faceMeanLinear) + " samples=" + faceSamples);

const neg = await page.evaluate(async () => {
  const api = window.__v14dFaceStatic;
  const missing = await api.exportMaterialHdrFloat("Cth1-Top-NotExist");
  const wrongMat = await api.exportMaterialHdrFloat("HairA");
  return { missing, wrongMatPickId: wrongMat?.pickId ?? null, wrongMatSamples: wrongMat ? Array.from(wrongMat.mask).reduce((a, b) => a + b, 0) : 0 };
});
ok(neg.missing === null, "负测：不存在的材质导出返回 null（不漏不冒充）");
ok(neg.wrongMatPickId !== null && neg.wrongMatPickId !== bodyHdr?.pickId, "负测：HairA pickId 与 BodySkin 不同（可按材质区分）");

const shotDir = path.join(OUT, "shots");
fs.mkdirSync(shotDir, { recursive: true });
await clickButton("全身");
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(shotDir, "fullbody-composite.png") });

// 四区域近景（Stage 2B-M3）：用 __v14dSetCamera 定位脖子/腰/左手/右手。
const REGIONS = [
  // 相机 target 由全身图（640x640）屏幕坐标反推（fov=28.07°, dist≈37.4 PMX 单位）。
  // 屏幕 (x,y) -> 世界: worldX = 0.56 - (320-x)/320*14.05, worldY = 9.0 + (320-y)/320*14.05。
  ["neck",      [0.56, 14.9, -1.2], 3.5],   // 下巴/颈根 (≈屏幕 y=310)
  ["waist",     [1.44, 13.6, -1.4], 4.0],   // 腰部露肤 (≈屏幕 x=300 y=215)
  ["leftHand",  [0.58, 12.0, -1.6], 4.5],   // 左手（叉腰，画面中央偏下）
  ["rightHand", [0.58, 12.0, -1.6], 4.5],   // 右手（叉腰，画面中央偏下）
];
for (const [label, target, radius] of REGIONS) {
  await page.evaluate(async ([t, r]) => {
    const setCam = window.__v14dSetCamera;
    if (setCam) setCam({ fov: 28.07, position: [t[0], t[1], t[2] - r], target: t, locked: true });
  }, [target, radius]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(shotDir, "closeup-" + label + "-composite.png") });
}

const queryNormal = new URLSearchParams({ modelUrl, vmdUrl, v14dFaceStatic: "1", v14dFaceMode: "normal" });
await page.goto(BASE + "?" + queryNormal.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
await page.waitForTimeout(1200);
await clickButton("全身");
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shotDir, "fullbody-normal.png") });
for (const [label, target, radius] of REGIONS) {
  await page.evaluate(async ([t, r]) => {
    const setCam = window.__v14dSetCamera;
    if (setCam) setCam({ fov: 28.07, position: [t[0], t[1], t[2] - r], target: t, locked: true });
  }, [target, radius]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(shotDir, "closeup-" + label + "-normal.png") });
}

const normalImg = await sharp(path.join(shotDir, "fullbody-normal.png")).resize(640).toBuffer();
const compImg = await sharp(path.join(shotDir, "fullbody-composite.png")).resize(640).toBuffer();
await sharp({ create: { width: 1280, height: 640, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite([{ input: normalImg, left: 0, top: 0 }, { input: compImg, left: 640, top: 0 }])
  .png().toFile(path.join(shotDir, "fullbody-side-by-side.png"));

summary.body = { meanLinear: bodyMeanLinear, samples: bodySamples, mae: bodyMae, refMeanLinear, refSamples };
summary.face = { meanLinear: faceMeanLinear, samples: faceSamples };
summary.boot = boot;
summary.threshold = { bodyMaeCandidate: BODY_MAE_CANDIDATE, note: "候选阈值（非正式）；Web 近景（脖子）vs Blender 全身可见皮肤（脖子+嘴部），口径不同，只按材质 ROI 均值对账" };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify(summary, null, 2));

ok(summary.pageErrors.length === 0, "无 pageError（" + summary.pageErrors.length + "）");
ok(summary.failedRequests.length === 0, "无 failedRequests（" + summary.failedRequests.length + "）");
ok(summary.httpBadResponses.length === 0, "无 HTTP 4xx/5xx（" + summary.httpBadResponses.length + "）");

await context.close();
fs.rmSync(profile, { recursive: true, force: true });

if (fails.length) {
  console.error("===BODY-SKIN-GATE-FAIL=== " + fails.length + " 项失败");
  process.exit(1);
}
console.log("===BODY-SKIN-GATE-OK=== BodySkin 实时合成 + ROI 对账通过（候选阈值）");
