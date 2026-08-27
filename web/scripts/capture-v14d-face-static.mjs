// V14D Face State 2 静态预览三模式采集 + HTTP 4xx/5xx 门禁。
// 权威 PMX/纹理/VMD 经 page.route 从本地文件 fulfill（引擎 files 变体局部解析）；
// face_d 按模式由 Face override File 覆盖（normal=原始, composite=合成, shadow=衰减）。
// 仓库不捆绑第三方资产（README 资产政策）；本地路径可用环境变量覆盖。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3100/mmd-calibration-render";
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-face-static/capture-final");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX = process.env.V14D_PMX || path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const DERIVED_DIR = process.env.V14D_DERIVED_DIR || "C:\\w\\rk3-face-v14d\\.scratch\\v14d-face-static-derived";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const FACE_D_REL = "Textures/c_Koleda_slg_face_d.png";
fs.mkdirSync(OUT, { recursive: true });

function collectModelFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name)) out.push(fp);
    }
  };
  walk(dir);
  return out;
}
const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p) => path.resolve(p) !== path.resolve(FACE_D));
if (!fs.existsSync(PMX)) throw new Error("缺权威 PMX: " + PMX);
if (!fs.existsSync(VMD)) throw new Error("缺权威 VMD: " + VMD);

const DERIVED_FILE = {
  finalFaceComposite: "v14d-face-composite-state2.png",
  faceShadowOnly: "v14d-face-shadow-attenuation-state2.png",
  normal: null,
};
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

const summary = { out: OUT, modes: {}, pageErrors: [], failedRequests: [], httpBadResponses: [] };
for (const mode of ["normal", "faceShadowOnly", "finalFaceComposite"]) {
  // 每模式独立 context（仅一次 init script + 一次 route），避免多文档累积。
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-face-static-chrome-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 },
    deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
  });
  try {
  // 资产请求路由到本地文件（页面 fetch 的是 blob: URL，经 route 用本地字节 fulfill）。
  await context.route("**/*", (route) => {
    const url = route.request().url();
    const m = url.match(/[?&]v14dasset=([^&]+)/);
    if (!m) return route.continue();
    const key = decodeURIComponent(m[1]);
    // 资产清单：列出模型文件相对路径（供 faceStatic 逐个 fetch 建 File[]）
    if (key === "__manifest__") {
      const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).replace(/\\/g, "/"));
      rels.push(path.relative(KOLEDA_DIR, PMX).replace(/\\/g, "/"));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: rels }) });
    }
    let filePath = null;
    if (key === "pmx") filePath = PMX;
    else if (key === "vmd") filePath = VMD;
    else if (key.startsWith("__derived__/")) filePath = path.join(DERIVED_DIR, key.slice("__derived__/".length));
    else filePath = path.join(KOLEDA_DIR, key);
    if (filePath && fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(filePath) });
    }
    return route.fulfill({ status: 404, body: "missing " + key });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => summary.pageErrors.push(String(e?.stack || e)));
  page.on("requestfailed", (r) => summary.failedRequests.push({ url: r.url(), err: r.failure()?.errorText || "unknown" }));
  page.on("response", (r) => { const s = r.status(); if (s >= 400) summary.httpBadResponses.push({ url: r.url(), status: s }); });

    // 每个文档加载前：经路由 ?v14dasset= 把权威资产逐个拉成 File 注入
    // window.__v14dFaceStaticAssets；Face diffuse 用 override 覆盖 face_d 逻辑名。
    await page.addInitScript(async (payload) => {
      const fetchFile = async (key, rel, mime) => {
        const resp = await fetch(`${payload.route}?v14dasset=${encodeURIComponent(key)}`);
        if (!resp.ok) throw new Error(`asset ${key} -> ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const f = new File([buf], key.split("/").pop(), { type: mime || "application/octet-stream" });
        if (rel) Object.defineProperty(f, "webkitRelativePath", { value: rel });
        return f;
      };
      const manifest = await (await fetch(`${payload.route}?v14dasset=__manifest__`)).json();
      const modelFiles = [];
      for (const rel of manifest.files) {
        if (rel.toLowerCase().endsWith("c_koleda_slg_face_d.png")) continue; // 由 faceOverride 提供
        modelFiles.push(await fetchFile(rel, rel));
      }
      const pmxRel = manifest.files.find((r) => r.toLowerCase().endsWith(".pmx"));
      const pmxFile = await fetchFile(pmxRel, pmxRel);
      const vmdFile = await fetchFile("vmd", null);
      let faceOverride = null;
      if (payload.faceRel) {
        faceOverride = await fetchFile(payload.faceKey, payload.faceRel);
      }
      window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride };
    }, {
      route: "http://v14d-asset.local/a",
      faceKey: mode === "normal" ? "Textures/c_Koleda_slg_face_d.png" : `__derived__/${DERIVED_FILE[mode]}`,
      faceRel: "Textures/c_Koleda_slg_face_d.png",
    });

    const modelUrl = `http://v14d-asset.local/a?v14dasset=pmx`;
    const vmdUrl = `http://v14d-asset.local/a?v14dasset=vmd`;
    const query = new URLSearchParams({ modelUrl, vmdUrl, v14dFaceStatic: "1", v14dFaceMode: mode });
    await page.goto(`${BASE}?${query.toString()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-testid='mmd-calibration-render']", { timeout: 60000 });
    await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
    await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      return {
        webgpuStatus: c?.dataset.webgpuStatus || "", faceStatic: c?.dataset.v14dFaceStatic || "",
        mode: c?.dataset.v14dFaceStaticMode || "", frame: c?.dataset.v14dFaceStaticFrame || "",
        state: c?.dataset.v14dFaceStaticState || "", blend: c?.dataset.v14dFaceStaticBlend || "",
        cameraLocked: c?.dataset.v14dFaceStaticCameraLocked || "", paused: c?.dataset.v14dFaceStaticPaused || "",
        texture: c?.dataset.v14dFaceStaticTexture || "", faceApplied: c?.dataset.v14dFaceStaticFaceApplied || "",
        authority: c?.dataset.v14dFaceStaticAuthority || "", width: c?.width || 0, height: c?.height || 0,
      };
    });
    const png = path.join(OUT, `face-static-${mode}.png`);
    await page.screenshot({ path: png });
    const roiCapture = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api) return { error: "no __v14dFaceStatic api" };
      return api.capture();
    });
    summary.modes[mode] = { state, roi: roiCapture, png };
    console.log(`[capture] mode=${mode} faceApplied=${state.faceApplied} faceId=${roiCapture?.faceMaterialId} faceSamples=${roiCapture?.roi?.faceSamples} meanLinear=${JSON.stringify(roiCapture?.meanLinear)} err=${roiCapture?.error || ""}`);
  } finally { await context.close(); }
}
fs.writeFileSync(path.join(OUT, "capture-summary.json"), JSON.stringify(summary, null, 2));
// 硬断言门禁：任一失败 exit 1（不再只记录）。
const MIN_FACE_SAMPLES = 1000;
const fails = [];
for (const mode of ["normal", "faceShadowOnly", "finalFaceComposite"]) {
  const m = summary.modes[mode];
  if (!m) { fails.push(`${mode}: 无采集结果`); continue; }
  if (m.state.webgpuStatus !== "ready") fails.push(`${mode}: canvas 未 ready (${m.state.webgpuStatus})`);
  if (m.state.faceStatic !== "true") fails.push(`${mode}: faceStatic 未启用`);
  if (m.state.mode !== mode) fails.push(`${mode}: 模式不一致 (${m.state.mode})`);
  if (m.state.frame !== "120" || m.state.state !== "2" || m.state.blend !== "0.00") fails.push(`${mode}: 状态帧错误 ${JSON.stringify(m.state)}`);
  if (m.state.cameraLocked !== "true" || m.state.paused !== "true") fails.push(`${mode}: 未锁定/暂停`);
  if (m.state.faceApplied !== "true") fails.push(`${mode}: Face 未应用 (${m.state.faceApplied})`);
  if (!m.roi || m.roi.error) fails.push(`${mode}: capture 错误 ${m.roi?.error || "none"}`);
  if ((m.roi?.roi?.faceSamples ?? 0) < MIN_FACE_SAMPLES) fails.push(`${mode}: faceSamples 不足 (${m.roi?.roi?.faceSamples})`);
  if (!m.roi?.meanLinear) fails.push(`${mode}: meanLinear 缺失`);
}
if (summary.pageErrors.length) fails.push(`pageErrors=${summary.pageErrors.length}`);
if (summary.failedRequests.length) fails.push(`failedRequests=${summary.failedRequests.length}`);
if (summary.httpBadResponses.length) fails.push(`httpBad=${summary.httpBadResponses.length}`);
console.log("===CAPTURE-DONE===");
console.log(JSON.stringify({ pageErrors: summary.pageErrors.length, failedRequests: summary.failedRequests.length, httpBad: summary.httpBadResponses.length }));
if (fails.length) {
  console.error("===CAPTURE-GATE-FAIL===\n" + fails.join("\n"));
  process.exit(1);
}
console.log("===CAPTURE-GATE-OK===");
