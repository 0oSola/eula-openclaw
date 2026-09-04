// Stage 2C-M2a.3 最小红灯：强 sentinel 已进入 Brows/Lashes 编译结果，
// 但最终 canvas 是否仍与 identity 相同。
//
// 这是只读诊断复现：浏览器内只读取引擎运行时对象、调用既有 acceptance probe，
// 不改生产图、正式阈值、相机、PMX/VMD 或 alpha analyzer。原始 PNG/JSON 全部写入
// .scratch/repro-v14d-brows-lashes-display-chain，不提交。
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3114";
const BASE = ORIGIN + "/companion?v14dAcceptanceProbe=1";
const OUT = path.resolve(process.env.V14D_REPRO_OUT || ".scratch/repro-v14d-brows-lashes-display-chain");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX_NAME = "GirlsFrontline KoledaDefault.pmx";
const PMX = path.join(KOLEDA_DIR, PMX_NAME);
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const VMD_URL = "/__probe__/koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:\\w\\rk3-face-v14d\\experiments\\koleda-v14d-face-shadow\\assets\\textures\\v14d-01234-face-shadow-state-2.png";
const MASK_NAME = "v14d-01234-face-shadow-state-2.png";
const WIDTH = 1440;
const HEIGHT = 960;
const USER_ID = "8X29-AF3E";
const RUNS = Number(process.env.V14D_REPRO_RUNS || 1);

fs.mkdirSync(OUT, { recursive: true });

function linkTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const source = path.join(src, entry.name);
    const target = path.join(dst, entry.name);
    if (entry.isDirectory()) linkTree(source, target);
    else if (!fs.existsSync(target)) {
      try { fs.linkSync(source, target); } catch { fs.copyFileSync(source, target); }
    }
  }
}

function findKoledaAsset(relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  let current = KOLEDA_DIR;
  for (const part of parts) {
    if (!fs.existsSync(current)) return null;
    const hit = fs.readdirSync(current, { withFileTypes: true })
      .find((entry) => entry.name.toLowerCase() === part.toLowerCase());
    if (!hit) return null;
    current = path.join(current, hit.name);
  }
  return fs.existsSync(current) && fs.statSync(current).isFile() ? current : null;
}

const importDir = path.join(OUT, "import-koleda");
if (!fs.existsSync(path.join(importDir, PMX_NAME))) linkTree(KOLEDA_DIR, importDir);
const maskLink = path.join(importDir, "Textures", MASK_NAME);
if (!fs.existsSync(maskLink)) {
  fs.mkdirSync(path.dirname(maskLink), { recursive: true });
  try { fs.linkSync(STATE2_MASK, maskLink); } catch { fs.copyFileSync(STATE2_MASK, maskLink); }
}

const report = {
  ticket: "Stage 2C-M2a.3 Brows/Lashes display chain minimum repro",
  origin: ORIGIN,
  viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  authority: { pmx: PMX, vmd: VMD_URL, seconds: 4, frame: 120, fps: 30, camera: "face" },
  runs: [],
  pageErrors: [],
  failedRequests: [],
  httpBad: [],
  failures: [],
};

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installRoutes(page) {
  const stubModel = {
    name: PMX_NAME,
    label: "克莱妲",
    relative_path: PMX_NAME,
    size_bytes: 0,
    url: "/assets/mmd/models/" + encodeURIComponent(PMX_NAME),
  };
  await page.route("**/api/backend/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace(/^\/api\/backend/, "");
    if (endpoint.startsWith("/codex/knowledge/review-summary")) return json(route, { workspace_key: null, total: 0, pending: 0, by_status: {} });
    if (endpoint.startsWith("/assets/mmd/models")) return json(route, { items: [stubModel] });
    if (endpoint.startsWith("/assets/vmd")) return json(route, { items: [] });
    if (endpoint.startsWith("/config/mapping/resolved/")) return json(route, { mappings: {} });
    if (endpoint === "/sessions" && route.request().method() === "GET") return json(route, { items: [] });
    if (endpoint === "/sessions" && route.request().method() === "POST") return json(route, { session: { id: "stub-session-1", title: "显示链复现", selected_model_path: null } });
    if (/^\/sessions\/[^/]+\/messages/.test(endpoint)) return json(route, { items: [] });
    if (endpoint.startsWith("/companion") || endpoint.startsWith("/config/companion")) return json(route, { user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3", reze_stage_document: null, updated_at: null });
    return json(route, { items: [] });
  });
  await page.route("**://127.0.0.1:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname;
    if (/\\.pmx$/i.test(endpoint)) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(PMX) });
    if (/\\.(png|jpe?g|webp|bmp|tga|sph|spa)$/i.test(endpoint)) {
      const relative = endpoint.replace(/^\/assets\/mmd\/models\/?/i, "");
      const found = findKoledaAsset(relative);
      if (found) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(found) });
      return json(route, { detail: "texture not found: " + relative }, 404);
    }
    if (endpoint.startsWith("/desktop-pet/shared-config")) return json(route, { user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3" });
    if (endpoint.startsWith("/assets/mmd/models")) return json(route, { items: [stubModel] });
    if (endpoint.startsWith("/assets/mmd/vmds") || endpoint.startsWith("/assets/vmd")) return json(route, { items: [] });
    return json(route, { items: [] });
  });
  await page.route("**/*.vmd", (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(VMD) }));
}

async function preparePage(page) {
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.stack || error)));
  page.on("requestfailed", (request) => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "unknown" }));
  page.on("response", (response) => {
    if (response.status() >= 400) report.httpBad.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript((uid) => {
    window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: uid, renderPipeline: "mio-reference", ttsEnabled: false }));
  }, USER_ID);
  await installRoutes(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.click("button.mio-advanced-mode");
  await page.waitForSelector("[data-testid=mio-advanced-panel]", { timeout: 15000 });
  await page.click('.mio-pipeline-option:has-text("Reze K3")');
  await page.waitForTimeout(800);
  await page.click('button.mio-nav-button[aria-label="打开 Reze 材质与场景编辑器"]', { force: true });
  await page.waitForSelector('button.mio-reze-editor-tool[aria-label="资产"]', { timeout: 20000 });
  await page.click('button.mio-reze-editor-tool[aria-label="资产"]');
  await page.waitForSelector("input[type=file][webkitdirectory]", { timeout: 20000 });
  await page.locator("input[type=file][webkitdirectory]").first().setInputFiles(importDir);
  await page.waitForSelector('canvas[data-webgpu-status="ready"]', { timeout: 120000 });
  await page.click("button.mio-advanced-mode").catch(() => {});
  await page.waitForTimeout(500);
  await page.click('[data-testid="reze-k3-skin-variant-v1"]');
  await page.waitForSelector('canvas[data-webgpu-status="ready"]', { timeout: 120000 });
  await page.waitForTimeout(500);
}

async function captureState(page, mode) {
  return page.evaluate(async ({ vmdUrl, mode }) => {
    const stage = window.__rezeStageProbe;
    if (!stage?.playVmd || !stage.captureHairTriUv) return { error: "stage probe unavailable" };
    if (mode === "identity") {
      const v1 = document.querySelector('[data-testid="reze-k3-skin-variant-v1"]');
      if (v1) v1.click();
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      const applied = await stage.applyBadSkinGraph("wrongBrowsLashesTint");
      if (!applied?.ok) return { error: "wrongTint apply failed", applied };
    }
    await stage.playVmd(vmdUrl);
    stage.pauseVmd();
    stage.seekVmd(4);
    stage.pauseVmd();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    stage.cameraOrbit("face");
    const engine = stage.engineRef?.current;
    const model = stage.modelRef?.current;
    if (!engine || !model) return { error: "engine/model unavailable" };
    model.pause();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const ids = window.__v14dDisplayChainObjectIds || { next: 1, map: new WeakMap() };
    window.__v14dDisplayChainObjectIds = ids;
    const objectId = (value) => {
      if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
      let id = ids.map.get(value);
      if (!id) { id = "gpu-" + ids.next++; ids.map.set(value, id); }
      return id;
    };
    const groupId = "v14d-skin-variant-brows-lashes";
    const inst = engine.modelInstances?.get("companion");
    const install = inst?.styleGroups?.get(groupId);
    const targetDraws = (inst?.drawCalls || []).filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes");
    const runtime = {
      mode,
      graphName: install?.group?.graph?.name || null,
      tint: install?.group?.graph?.nodes?.find((node) => node.id === "v14d_brows_lashes_tint")?.inputs?.color || null,
      signature: install?.signature || null,
      pipeline: objectId(install?.pipeline),
      pipelineNoDepthWrite: objectId(install?.pipelineNoDepthWrite),
      renderLoopRunningBeforeCapture: engine.animationFrameId !== null && engine.animationFrameId !== undefined,
      drawCalls: targetDraws.map((draw) => ({
        materialName: draw.materialName,
        type: draw.type,
        count: draw.count,
        firstIndex: draw.firstIndex,
        drawIndex: inst.drawCalls.indexOf(draw),
        groupId: draw.groupId,
        bindGroup: objectId(draw.bindGroup),
        baseBindGroupEntries: (draw.baseBindGroupEntries || []).map((entry) => ({ binding: entry.binding, resourcePresent: entry.resource != null })),
        pipelineUsedByLookup: objectId(draw.groupId ? inst.styleGroups.get(draw.groupId)?.pipeline : null),
      })),
      viewTransform: typeof engine.getViewTransformOptions === "function" ? engine.getViewTransformOptions() : null,
    };

    const raw = await stage.captureHairTriUv(["Brows", "Lashes"], {
      useForegroundDepth: true,
      nearClipOverride: 1.0,
      sourceMode: "production-draw-call",
    });
    if (!raw || raw.error) return { error: raw?.error || "capture failed", runtime };
    const decode = async (dataUrl) => {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
      const canvas = document.createElement("canvas");
      canvas.width = raw.width; canvas.height = raw.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, raw.width, raw.height).data;
    };
    const pixels = await decode(raw.canvasDataUrl);
    const mask = await decode(raw.materialMaskPng);
    const idsByName = raw.materialIdByName || {};
    const slotStats = {};
    for (const name of ["Brows", "Lashes"]) {
      const materialId = Number(idsByName[name]);
      let pixelsInSlot = 0;
      let sumR = 0; let sumG = 0; let sumB = 0;
      let minR = 255; let maxR = 0;
      for (let i = 0; i < raw.width * raw.height; i += 1) {
        if (mask[i * 4] === 0 || mask[i * 4 + 1] !== materialId) continue;
        pixelsInSlot += 1;
        const off = i * 4;
        sumR += pixels[off]; sumG += pixels[off + 1]; sumB += pixels[off + 2];
        minR = Math.min(minR, pixels[off]); maxR = Math.max(maxR, pixels[off]);
      }
      slotStats[name] = {
        materialId,
        pixels: pixelsInSlot,
        meanRgb: pixelsInSlot ? [sumR / pixelsInSlot, sumG / pixelsInSlot, sumB / pixelsInSlot].map((value) => Number(value.toFixed(3))) : null,
        redRange: pixelsInSlot ? [minR, maxR] : null,
      };
    }
    return {
      runtime,
      capture: {
        captureId: raw.captureId,
        source: raw.source,
        sourceMode: raw.sourceMode,
        width: raw.width,
        height: raw.height,
        currentFrame: raw.captureEvidence?.pixel?.currentFrame ?? null,
        captureEvidence: raw.captureEvidence || null,
        productionSource: raw.productionSource || null,
        slotStats,
        materialIdByName: idsByName,
        canvasDataUrl: raw.canvasDataUrl,
        materialMaskPng: raw.materialMaskPng,
      },
    };
  }, { vmdUrl: VMD_URL, mode });
}

const FAULT_NO_RENDER = process.argv.includes("--fault-no-render");

async function runOnce(index) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v14d-bl-chain-repro-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME_EXE,
    headless: true,
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    args: ["--enable-unsafe-webgpu"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await preparePage(page);
    const setup = await page.evaluate(async ({ vmdUrl }) => {
      const stage = window.__rezeStageProbe;
      if (!stage?.playVmd || !stage?.cameraOrbit) return { error: "display chain setup probe unavailable" };
      await stage.playVmd(vmdUrl);
      stage.pauseVmd();
      stage.seekVmd(4);
      stage.pauseVmd();
      stage.cameraOrbit("face");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { frame: Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || 0) * 30 };
    }, { vmdUrl: VMD_URL });
    if (setup.error) return { index, error: setup.error };
    const traceInstalled = await page.evaluate(() => window.__rezeStageProbe?.installDisplayChainTrace?.() || { ok: false, error: "trace install unavailable" });
    if (!traceInstalled?.ok) return { index, error: "display chain trace install failed", traceInstalled };
    const identity = await page.evaluate(() => window.__rezeStageProbe.captureDisplayChainState({ captureId: "v14d-bl-pair-identity", frame: 120, render: true }));
    if (identity.error) return { index, error: identity.error, identity };
    await page.evaluate(() => {
      const stage = window.__rezeStageProbe;
      stage.setDisplayChainTraceCapture("v14d-bl-pair-sentinel", 120);
      stage.engineRef.current.stopRenderLoop();
      stage.modelRef.current.pause();
    });
    const applied = await page.evaluate(async (faultNoRender) => {
      const stage = window.__rezeStageProbe;
      return stage.applyBadSkinGraph("wrongBrowsLashesTint", faultNoRender ? { render: false } : undefined);
    }, FAULT_NO_RENDER);
    const sentinel = await page.evaluate(() => window.__rezeStageProbe.captureDisplayChainState({ captureId: "v14d-bl-pair-sentinel", frame: 120, render: false }));
    if (sentinel.error) return { index, error: sentinel.error, identity, sentinel };
    const diff = await page.evaluate(async ({ identityDataUrl, sentinelDataUrl, maskDataUrl, materialIds, width, height }) => {
      const decode = async (dataUrl) => {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = dataUrl; });
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const identityPixels = await decode(identityDataUrl);
      const sentinelPixels = await decode(sentinelDataUrl);
      const mask = await decode(maskDataUrl);
      const ids = {
        Brows: Number(materialIds.Brows),
        Lashes: Number(materialIds.Lashes),
      };
      let sampled = 0; let changed = 0; let sumAbs = 0; let maxAbs = 0; let redAbs = 0;
      const histogram = new Map();
      for (let i = 0; i < width * height; i += 1) {
        const materialId = mask[i * 4 + 1];
        if (materialId !== ids.Brows && materialId !== ids.Lashes) continue;
        sampled += 1;
        const io = i * 4;
        const dr = Math.abs(identityPixels[io] - sentinelPixels[io]);
        const dg = Math.abs(identityPixels[io + 1] - sentinelPixels[io + 1]);
        const db = Math.abs(identityPixels[io + 2] - sentinelPixels[io + 2]);
        const d = dr + dg + db;
        if (d > 0) changed += 1;
        sumAbs += d; redAbs += dr; maxAbs = Math.max(maxAbs, d);
        histogram.set(d, (histogram.get(d) || 0) + 1);
      }
      const values = [...histogram.entries()].flatMap(([value, count]) => Array.from({ length: count }, () => value)).sort((a, b) => a - b);
      return {
        sampled,
        changed,
        changedRatio: sampled ? Number((changed / sampled).toFixed(6)) : 0,
        meanAbsRgbSum: sampled ? Number((sumAbs / sampled).toFixed(6)) : 0,
        meanAbsRed: sampled ? Number((redAbs / sampled).toFixed(6)) : 0,
        maxAbsRgbSum: maxAbs,
        p95AbsRgbSum: values.length ? values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] : 0,
      };
    }, {
      identityDataUrl: identity.canvasDataUrl,
      sentinelDataUrl: sentinel.canvasDataUrl,
      maskDataUrl: identity.materialMaskPng,
      materialIds: { Brows: identity.slotStats.Brows.materialId, Lashes: identity.slotStats.Lashes.materialId },
      width: identity.width,
      height: identity.height,
    });
    const normalizeState = (state) => ({
      runtime: {
        graphName: state.graphName,
        tint: state.tint,
        signature: state.signature,
        pipeline: state.targetDraws?.[0]?.compileInstallPipeline || null,
        drawCalls: (state.targetDraws || []).map((draw) => ({
          materialName: draw.materialName,
          type: "opaque",
          count: draw.count,
          firstIndex: draw.firstIndex,
          drawIndex: draw.drawIndex,
          groupId: draw.groupId,
          bindGroup: draw.bindGroup,
          pipelineUsedByLookup: draw.compileInstallPipeline,
        })),
      },
      capture: {
        captureId: state.captureId,
        source: "display-chain-state",
        width: state.width,
        height: state.height,
        currentFrame: state.currentFrame,
        captureEvidence: { pixel: { captureId: state.captureId, currentFrame: state.currentFrame, width: state.width, height: state.height } },
        slotStats: state.slotStats,
        materialIdByName: Object.fromEntries(Object.entries(state.slotStats || {}).map(([name, slot]) => [name, slot.materialId])),
        canvasDataUrl: state.canvasDataUrl,
        materialMaskPng: state.materialMaskPng,
        displayChain: {
          requestedRender: state.requestedRender,
          renderObserved: state.renderObserved,
          renderLoopRunningBefore: state.renderLoopRunningBefore,
          renderLoopRunningAfter: state.renderLoopRunningAfter,
          hdr: state.hdr,
          trace: state.trace,
        },
      },
    });
    return { index, setup, applied, traceInstalled, identity: normalizeState(identity), sentinel: normalizeState(sentinel), diff };
  } finally {
    await context.close();
  }
}

for (let i = 0; i < RUNS; i += 1) {
  try {
    const result = await runOnce(i + 1);
    report.runs.push(result);
  } catch (error) {
    report.runs.push({ index: i + 1, error: String(error?.stack || error) });
  }
}

for (const run of report.runs) {
  if (run.error) report.failures.push("run " + run.index + ": " + run.error);
  if (!run.identity?.capture || !run.sentinel?.capture) continue;
  if (run.identity.capture.currentFrame == null || Math.abs(Number(run.identity.capture.currentFrame) - 120) > 1e-6) report.failures.push("run " + run.index + ": identity frame is not 120");
  if (run.sentinel.capture.currentFrame == null || Math.abs(Number(run.sentinel.capture.currentFrame) - 120) > 1e-6) report.failures.push("run " + run.index + ": sentinel frame is not 120");
  if (run.identity.runtime.graphName !== "V14D Brows Lashes V1 Composite") report.failures.push("run " + run.index + ": identity graph is not Brows/Lashes V1");
  if (run.sentinel.runtime.graphName !== "V14D Brows Lashes V1 Composite") report.failures.push("run " + run.index + ": sentinel graph is not Brows/Lashes V1");
  if (JSON.stringify(run.identity.runtime.drawCalls.map((draw) => [draw.materialName, draw.count, draw.firstIndex])) !== JSON.stringify(run.sentinel.runtime.drawCalls.map((draw) => [draw.materialName, draw.count, draw.firstIndex]))) report.failures.push("run " + run.index + ": draw ranges changed");
  if (run.identity.runtime.pipeline === run.sentinel.runtime.pipeline) report.failures.push("run " + run.index + ": sentinel compile/install pipeline identity was reused");
  if (JSON.stringify(run.sentinel.runtime.tint) !== JSON.stringify([0, 1, 1])) report.failures.push("run " + run.index + ": sentinel tint did not enter runtime graph");
  if (!(run.diff?.sampled > 0)) report.failures.push("run " + run.index + ": no Brows/Lashes pixels in final canvas mask");
  if (!(run.sentinel.capture.displayChain?.renderObserved === true)) report.failures.push("run " + run.index + ": sentinel actual render/setPipeline was not observed");
  const actualSentinelPipelines = new Set((run.sentinel.capture.displayChain?.trace?.draws || [])
    .filter((draw) => draw.materialName === "Brows" || draw.materialName === "Lashes")
    .map((draw) => draw.pipeline));
  if (run.sentinel.capture.displayChain?.renderObserved === true && !actualSentinelPipelines.has(run.sentinel.runtime.pipeline)) {
    report.failures.push("run " + run.index + ": sentinel draw used a pipeline different from compile/install");
  }
  if (!((run.diff?.meanAbsRgbSum ?? 0) > 1)) report.failures.push("run " + run.index + ": final canvas no-effect");
}

const reportPath = path.join(OUT, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  report: reportPath,
  runs: report.runs.map((run) => ({
    index: run.index,
    error: run.error || null,
    identity: run.identity ? { captureId: run.identity.capture?.captureId || null, graph: run.identity.runtime?.graphName || null, tint: run.identity.runtime?.tint || null, pipeline: run.identity.runtime?.pipeline || null, renderObserved: run.identity.capture?.displayChain?.renderObserved || false, hdr: run.identity.capture?.slotStats || null } : null,
    sentinel: run.sentinel ? { captureId: run.sentinel.capture?.captureId || null, graph: run.sentinel.runtime?.graphName || null, tint: run.sentinel.runtime?.tint || null, pipeline: run.sentinel.runtime?.pipeline || null, renderObserved: run.sentinel.capture?.displayChain?.renderObserved || false, hdr: run.sentinel.capture?.slotStats || null } : null,
    diff: run.diff || null,
  })),
  pageErrors: report.pageErrors,
  failedRequests: report.failedRequests,
  httpBad: report.httpBad,
  failures: report.failures,
}, null, 2));
if (report.failures.length) {
  console.error("===V14D-BROWS-LASHES-DISPLAY-CHAIN-RED===");
  process.exit(1);
}
console.log("===V14D-BROWS-LASHES-DISPLAY-CHAIN-GREEN===");
process.exit(0);
