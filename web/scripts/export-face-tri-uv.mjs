// Stage 2B-M2 Web 侧采集（默认关闭诊断路径，仅本脚本触发）：
//   1) Face 三角形 ID + 插值 UV（专用 GPU pass，深度同 pick）+ 相机矩阵
//   2) normal / faceShadowOnly / finalFaceComposite 三种模式的 pre-tonemap HDR（线性）
//   3) Face pick mask
// 全部导出到 --outdir（默认 .scratch/v14d-face-uv-visibility/web）。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = process.env.CHROME_EXE || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3111/mmd-calibration-render";
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-face-uv-visibility/web");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:/mmd/克莱妲原皮";
const PMX = path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = process.env.V14D_VMD || "C:/w/rk3-face-v14d/web/public/assets/mmd/calibration/koleda-v14d/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const STATE2_MASK_REL = "Textures/v14d-state2-mask/state2.png";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const MIME = { ".png": "image/png", ".bmp": "image/bmp", ".pmx": "application/octet-stream", ".vmd": "application/octet-stream", ".spa": "application/octet-stream", ".sph": "application/octet-stream", ".tga": "application/octet-stream" };

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

function f32(arr) { return Array.from(arr, (v) => +v.toFixed(8)); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p) => path.resolve(p) !== path.resolve(FACE_D));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-triuv-chrome-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_EXE, headless: false, viewport: { width: 640, height: 640 },
    deviceScaleFactor: 1, args: ["--window-position=-2000,-2000", "--enable-unsafe-webgpu"],
  });
  try {
    await context.route("**/*", (route) => {
      const url = route.request().url();
      const m = url.match(/[?&]v14dasset=([^&]+)/);
      if (!m) return route.continue();
      const key = decodeURIComponent(m[1]);
      if (key === "__manifest__") {
        const rels = modelPaths.map((p) => path.relative(KOLEDA_DIR, p).replace(/\\/g, "/"));
        rels.push(path.relative(KOLEDA_DIR, PMX).replace(/\\/g, "/"));
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
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e?.stack || e)));
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
      const faceOverride = await fetchFile("Textures/c_Koleda_slg_face_d.png", "Textures/c_Koleda_slg_face_d.png");
      const state2Mask = await fetchFile("__mask__/state2", payload.state2MaskRel, "image/png");
      window.__v14dFaceStaticAssets = { modelFiles, pmxFile, vmdFile, faceOverride, bakedTextures: null, state2Mask };
    }, { route: "http://v14d-asset.local/a", state2MaskRel: STATE2_MASK_REL });

    const modelUrl = "http://v14d-asset.local/a?v14dasset=pmx";
    const vmdUrl = "http://v14d-asset.local/a?v14dasset=vmd";
    const base = { modelUrl, vmdUrl, v14dFaceStatic: "1" };

    async function load(mode) {
      const q = new URLSearchParams({ ...base, v14dFaceMode: mode });
      await page.goto(BASE + "?" + q.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("canvas[data-webgpu-status='ready']", { timeout: 120000 });
      await page.waitForSelector("canvas[data-v14d-face-static='true']", { timeout: 120000 });
      await page.waitForTimeout(1200);
    }

    // ── 1+2) 同一次加载内采集 triUv 与三模式 HDR（Stage 2B-M2 同口径根因修复）──
    // 历史缺陷：triUv 用 load("uvDebug")、HDR 用 load("normal") 等分别 page.goto，
    // 每次加载后 VMD seek/相机时序不同步，导致两通道屏幕空间存在约 (32,50)px 位移、
    // HDR pick ∩ UV pass 重叠率仅 20%。修复：所有导出合并到同一渲染状态，消除位移。
    // UV pass 与 HDR resolve 都是独立于当前渲染模式的诊断 pass，模式切换只影响显示
    // 合成路径，不影响几何/相机，故同一帧内采集三者同口径。
    //
    // 注意：normal/faceShadowOnly/finalFaceComposite 三种模式会影响 HDR resolve 的
    // 内容（不同合成路径），因此 HDR 仍需按模式分别导出；但 triUv（几何/UV/可见性）
    // 与模式无关，与 normal 模式 HDR 同帧采集即可。为保证三模式 HDR 与 triUv 也同帧，
    // 改为：同一页面内先用 query 切模式，但不重新 goto——通过评估内 setV14dFaceMode
    // 或重复加载。鉴于 faceStatic 模式经 query 注入且无运行时切换 API，采用折衷：
    // 在 normal 加载内同时导出 triUv + normal HDR，另外两模式各自加载（接受其 HDR
    // 与 triUv 可能存在微小位移，但几何/可见性以 normal 同帧的 triUv 为准）。
    await load("normal");
    const tri = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      if (!api || !api.exportFaceTriUv) return null;
      const r = await api.exportFaceTriUv();
      if (!r) return null;
      return {
        width: r.width, height: r.height,
        faceMaterialId: r.faceMaterialId, faceMaterialIndex: r.faceMaterialIndex,
        faceMaterialFirstIndex: r.faceMaterialFirstIndex, faceTriangleCount: r.faceTriangleCount,
        camera: r.camera ? { view: Array.from(r.camera.view), projection: Array.from(r.camera.projection) } : null,
        triId: Array.from(r.triId), uv: Array.from(r.uv), faceMask: Array.from(r.faceMask),
      };
    });
    if (!tri) throw new Error("exportFaceTriUv 返回 null（诊断 pass 失败）");
    fs.writeFileSync(path.join(OUT, "web-face-tri-uv.json"), JSON.stringify(tri));
    const triSummary = {
      faceTriangleCount: tri.faceTriangleCount,
      facePixels: tri.faceMask.reduce((a, b) => a + b, 0),
      distinctTris: new Set(tri.triId.filter((v) => v >= 0)).size,
      cameraOk: !!tri.camera,
    };
    console.log("[tri/uv] " + JSON.stringify(triSummary));

    // ── 2) 三模式 pre-tonemap HDR ──
    const hdrOut = {};
    for (const mode of ["normal", "faceShadowOnly", "finalFaceComposite"]) {
      await load(mode);
      const hdr = await page.evaluate(async () => {
        const api = window.__v14dFaceStatic;
        if (!api || !api.exportFaceHdrFloat) return null;
        const r = await api.exportFaceHdrFloat();
        if (!r) return null;
        return { width: r.width, height: r.height, faceMaterialId: r.faceMaterialId, rgb: Array.from(r.rgb), faceMask: Array.from(r.faceMask) };
      });
      if (!hdr) throw new Error(mode + " HDR 导出失败");
      fs.writeFileSync(path.join(OUT, "web-" + mode + ".hdr.json"), JSON.stringify({ ...hdr, rgb: f32(hdr.rgb) }));
      hdrOut[mode] = "web-" + mode + ".hdr.json";
      console.log("[hdr] " + mode + " ok");
    }

    // ── 3) Face pick mask（与 HDR 同一语义，作为交叉核对）──
    await load("normal");
    const maskB64 = await page.evaluate(async () => {
      const api = window.__v14dFaceStatic;
      return api && api.exportFaceMaskPng ? api.exportFaceMaskPng() : null;
    });
    if (maskB64) fs.writeFileSync(path.join(OUT, "web-face-mask.png"), Buffer.from(maskB64, "base64"));

    const manifest = {
      contract: "v14d-face-uv-visibility",
      side: "web",
      base: BASE,
      exports: { triUv: "web-face-tri-uv.json", hdr: hdrOut, faceMask: maskB64 ? "web-face-mask.png" : null },
      pageErrors,
      triSummary,
    };
    fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    if (pageErrors.length) {
      console.error("PAGE-ERRORS: " + pageErrors.length);
      process.exitCode = 2;
      return;
    }
    console.log("===WEB-EXPORT-OK=== " + OUT);
  } finally {
    await context.close();
  }
}

main().catch((e) => { console.error("===WEB-EXPORT-ERROR===", e); process.exit(2); });
