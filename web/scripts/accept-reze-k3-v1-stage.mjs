// Reze K3 V1（V14D）真实舞台视觉与 VMD 验收（票据 reze-k3-v1-stage-visual-acceptance）。
// 在真实生产 /companion（非 /mmd-calibration-render）端到端验收「原始 Reze K3 / V1」切换。
// 覆盖 G1-G6；任一硬断言失败 exitCode=1。报告写 .scratch/reze-k3-v1-stage/gate-report.json。
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  validateV14dHairCapturePair,
  V14D_HAIR_AUTHORITATIVE_CAPTURE,
} from "../src/features/stage/v14dHairCaptureState.js";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3114";
const BASE = ORIGIN + "/companion?v14dAcceptanceProbe=1";
const OUT = path.resolve(".scratch/reze-k3-v1-stage");
fs.mkdirSync(OUT, { recursive: true });
// Stage 2C-M2a 修正轮：--fast-bl 只跑到 G3 Brows/Lashes identity-target Gate 即退出，
// 供特写取景/阈值标定的快速单变量迭代；正式全量验收不带此开关（跑完 G1-G7）。
const FAST_BL = process.argv.includes("--fast-bl");

const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX_NAME = "GirlsFrontline KoledaDefault.pmx";
const PMX = path.join(KOLEDA_DIR, PMX_NAME);
const VMD = process.env.V14D_VMD || "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:\\w\\rk3-face-v14d\\experiments\\koleda-v14d-face-shadow\\assets\\textures\\v14d-01234-face-shadow-state-2.png";
const MASK_NAME = "v14d-01234-face-shadow-state-2.png";
const sha256 = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// 临时导入目录（.scratch 硬链接，不修改用户原始资产）。mask 以权威文件名放入 Textures/。
function linkTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name); const d = path.join(dst, e.name);
    if (e.isDirectory()) linkTree(s, d);
    else if (!fs.existsSync(d)) {
      // 跨盘硬链接（EXDEV）回退复制；只进 .scratch，不提交，不修改用户原始资产。
      try { fs.linkSync(s, d); } catch { fs.copyFileSync(s, d); }
    }
  }
}
// 在权威克莱妲目录下按相对路径（大小写不敏感、支持 Textures/spa/normalmap 等子目录）
// 解析纹理真实文件。逐段比对目录项大小写不敏感，命中文件返回绝对路径，否则 null。
function findKoledaAsset(rel) {
  const parts = rel.split("/").filter(Boolean);
  let cur = KOLEDA_DIR;
  for (let i = 0; i < parts.length; i++) {
    if (!fs.existsSync(cur)) return null;
    const want = parts[i].toLowerCase();
    const hit = fs.readdirSync(cur, { withFileTypes: true }).find((e) => e.name.toLowerCase() === want);
    if (!hit) return null;
    cur = path.join(cur, hit.name);
  }
  return fs.existsSync(cur) && fs.statSync(cur).isFile() ? cur : null;
}
const HAIR_TEX = process.env.V14D_HAIR_TEX
  || findKoledaAsset("Textures/c_KoledaSSR01_slg_hair_d.png")
  || path.join(KOLEDA_DIR, "Textures", "c_KoledaSSR01_slg_hair_d.png");
const HAIR_PMX = process.env.V14D_HAIR_PMX || PMX;
const HAIR_CAPTURE_VMD_URL = "/__probe__/koleda-v14d-authoritative-pose-f120.vmd";
// Hair 正式 Gate 的姿态不可由环境变量改写；环境变量只允许切换外部资产，
// 不能把另一秒/帧或另一动画伪装成权威样本。
const HAIR_CAPTURE_FPS = V14D_HAIR_AUTHORITATIVE_CAPTURE.fps;
const HAIR_CAPTURE_FPS_PROVENANCE = V14D_HAIR_AUTHORITATIVE_CAPTURE.fpsProvenance;
const HAIR_CAPTURE_FRAME = V14D_HAIR_AUTHORITATIVE_CAPTURE.currentFrame;
const HAIR_CAPTURE_SECONDS = V14D_HAIR_AUTHORITATIVE_CAPTURE.currentSeconds;
const HAIR_CAPTURE_ANIMATION_NAME = V14D_HAIR_AUTHORITATIVE_CAPTURE.animationName;
const IMPORT_DIR = path.join(OUT, "import-koleda");
if (!fs.existsSync(path.join(IMPORT_DIR, PMX_NAME))) linkTree(KOLEDA_DIR, IMPORT_DIR);
const MASK_LINK = path.join(IMPORT_DIR, "Textures", MASK_NAME);
if (!fs.existsSync(MASK_LINK)) { fs.mkdirSync(path.dirname(MASK_LINK), { recursive: true }); try { fs.linkSync(STATE2_MASK, MASK_LINK); } catch { fs.copyFileSync(STATE2_MASK, MASK_LINK); } }
// 非克莱妲负测：同一 PMX 重命名 + 含 mask（证明资格按 PMX 文件名判定）。
const NEG_RENAME_DIR = path.join(OUT, "import-renamed");
if (!fs.existsSync(path.join(NEG_RENAME_DIR, "KoledaRenamedCopy.pmx"))) {
  fs.mkdirSync(path.join(NEG_RENAME_DIR, "Textures"), { recursive: true });
  const linkOrCopy = (s, d) => { try { fs.linkSync(s, d); } catch { fs.copyFileSync(s, d); } };
  linkOrCopy(PMX, path.join(NEG_RENAME_DIR, "KoledaRenamedCopy.pmx"));
  linkOrCopy(STATE2_MASK, path.join(NEG_RENAME_DIR, "Textures", MASK_NAME));
}
// 缺 mask 负测：权威 PMX 单文件，不含 mask。
const NEG_NOMASK_DIR = path.join(OUT, "import-nomask");
if (!fs.existsSync(path.join(NEG_NOMASK_DIR, PMX_NAME))) { fs.mkdirSync(NEG_NOMASK_DIR, { recursive: true }); try { fs.linkSync(PMX, path.join(NEG_NOMASK_DIR, PMX_NAME)); } catch { fs.copyFileSync(PMX, path.join(NEG_NOMASK_DIR, PMX_NAME)); } }

const report = { origin: ORIGIN, base: BASE, assets: { pmx: PMX, vmd: VMD, mask: STATE2_MASK, hairTexture: HAIR_TEX, hairTextureSha256: fs.existsSync(HAIR_TEX) ? sha256(HAIR_TEX) : null, maskSha256: sha256(STATE2_MASK), vmdSha256: fs.existsSync(VMD) ? sha256(VMD) : null }, gates: {}, pageErrors: [], httpBad: [], failedReqs: [], screenshots: {} };
const fail = (gate, msg) => {
  console.error("ASSERT-FAIL[" + gate + "]: " + msg);
  report.gates[gate] = report.gates[gate] || { status: "pass", failures: [] };
  report.gates[gate].status = "fail"; report.gates[gate].failures.push(msg); process.exitCode = 1;
};
const note = (gate, msg) => console.log("[" + gate + "] " + msg);

// ── G5 竞态判定纯函数（供 --self-test-g5-race 负向自验复用，与下方 page.evaluate 口径一致）──
// 语义：旧请求 A 无副作用退出（retA===null）、当前播放名为 B、resetPhysics 仅 B 自增（rpDelta===1）、
// A 被守卫判旧（staleDelta>=1）、A 未增加完成计数（finishDelta===0）。
function computeG5RaceOk({ retA, currentName, nameB, rpDelta, staleDelta, finishDelta }) {
  return retA === null && currentName === nameB && String(currentName).includes("f120")
    && rpDelta === 1 && staleDelta >= 1 && finishDelta === 0;
}

// ── G5 过期完成回调名称判定纯函数（供 --self-test-g5-stale 复用，与 page.evaluate 口径一致）──
// 语义：注入过期 A 名后 naturalFinishName 仍【严格等于】本次 B 的真实动作名（不是仅"含 f120"）；
// B 完成后 naturalFinishName 仍严格等于 B；且注入名确为 A（不等于 B）。
function computeG5StaleNameOk({ bName, staleAName, nameAfterStale, nameFinal }) {
  return typeof bName === "string" && bName.length > 0
    && staleAName !== bName
    && nameAfterStale === bName
    && nameFinal === bName;
}

// P0：可重复、真实执行的 G5 竞态负向自验。healthy(finishDelta=0) 必须 true；
// 其他条件相同但 finishDelta=1 必须被判失败（本分支以非零退出码拒绝）。
if (process.argv.includes("--self-test-g5-race")) {
  const healthy = computeG5RaceOk({ retA: null, currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 1, finishDelta: 0 });
  const finishBump = computeG5RaceOk({ retA: null, currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 1, finishDelta: 1 });
  const staleRet = computeG5RaceOk({ retA: "koleda-v14d-authoritative-pose-f120.vmd", currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 1, finishDelta: 0 });
  const wrongCurrent = computeG5RaceOk({ retA: null, currentName: "race-a.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 1, finishDelta: 0 });
  const rpZero = computeG5RaceOk({ retA: null, currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 0, staleDelta: 1, finishDelta: 0 });
  const staleZero = computeG5RaceOk({ retA: null, currentName: "koleda-v14d-authoritative-pose-f120.vmd", nameB: "koleda-v14d-authoritative-pose-f120.vmd", rpDelta: 1, staleDelta: 0, finishDelta: 0 });
  const results = { healthy, finishBump, staleRet, wrongCurrent, rpZero, staleZero };
  console.log("G5-race self-test:", JSON.stringify(results));
  const pass = healthy === true && finishBump === false && staleRet === false && wrongCurrent === false && rpZero === false && staleZero === false;
  // 短路退出：self-test 不执行下方浏览器代码。用 setImmediate 包裹 process.exit，避免
  // 「永不 resolve 的顶层 await」触发 unsettled-TLA 警告；process.exit 立即按结果终止。
  if (!pass) { console.error("===G5-RACE-SELF-TEST-FAIL==="); setImmediate(() => process.exit(1)); }
  else { console.log("===G5-RACE-SELF-TEST-OK==="); setImmediate(() => process.exit(0)); }
  await new Promise(() => {}); // 阻止下方浏览器代码执行；setImmediate 在进程退出前已调度
}

// P0：G5 过期回调名称判定负向自验（可重复、真实执行）。healthy（A≠B 且注入后/完成后都严格=B）
// 必须 true；名称错绑（注入后=B 但完成≠B、注入后≠B、stale=B 等）必须 false → 非零退出。
if (process.argv.includes("--self-test-g5-stale")) {
  const B = "koleda-v14d-authoritative-pose-f120.vmd";
  const A = "race-a.vmd";
  const healthy = computeG5StaleNameOk({ bName: B, staleAName: A, nameAfterStale: B, nameFinal: B });
  const finalWrong = computeG5StaleNameOk({ bName: B, staleAName: A, nameAfterStale: B, nameFinal: A }); // 完成后被改成 A
  const afterWrong = computeG5StaleNameOk({ bName: B, staleAName: A, nameAfterStale: A, nameFinal: B }); // 注入后即被改成 A
  const staleIsB = computeG5StaleNameOk({ bName: B, staleAName: B, nameAfterStale: B, nameFinal: B });   // 注入名=B（非过期）
  const results = { healthy, finalWrong, afterWrong, staleIsB };
  console.log("G5-stale self-test:", JSON.stringify(results));
  const pass = healthy === true && finalWrong === false && afterWrong === false && staleIsB === false;
  if (!pass) { console.error("===G5-STALE-SELF-TEST-FAIL==="); setImmediate(() => process.exit(1)); }
  else { console.log("===G5-STALE-SELF-TEST-OK==="); setImmediate(() => process.exit(0)); }
  await new Promise(() => {});
}

// ── 浏览器 + 会话预置 + API 兜底（本机无 Python，API 后端不可达）────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rk3v1-stage-"));
const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME_EXE, headless: true, viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, args: ["--enable-unsafe-webgpu"] });
const page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (e) => report.pageErrors.push(String((e && e.stack) || e)));
page.on("console", (m) => { const t = m.text(); if (/v14d-skin-variant|WGSL|error|未定义|undeclared|tint/i.test(t)) (report.consoleWarn = report.consoleWarn || []).push(t.slice(0, 900)); });
page.on("requestfailed", (r) => report.failedReqs.push({ url: r.url().slice(0, 160), err: r.failure()?.errorText || "unknown" }));
page.on("response", (r) => { if (r.status() >= 400) report.httpBad.push({ url: r.url().slice(0, 160), status: r.status() }); });

const USER_ID = "8X29-AF3E";
await page.addInitScript((uid) => {
  window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: uid, renderPipeline: "mio-reference", ttsEnabled: false }));
}, USER_ID);

// 克莱妲存根：让「模型切换」选中克莱妲（存储键驱动变体持久化），模型目录存根（Three.js 分支用）。
const KOLEDA_REL = PMX_NAME;
const STUB_MODEL = { name: PMX_NAME, label: "克莱妲", relative_path: KOLEDA_REL, size_bytes: 0, url: "/assets/mmd/models/" + encodeURIComponent(PMX_NAME) };
await page.route("**/api/backend/**", async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname.replace(/^\/api\/backend/, "");
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  // 知识审核徽标期待 { by_status }；返回合法空摘要避免组件读 undefined 崩溃。
  if (p.startsWith("/codex/knowledge/review-summary")) return json({ workspace_key: null, total: 0, pending: 0, by_status: {} });
  if (p.startsWith("/assets/mmd/models")) return json({ items: [STUB_MODEL] });
  if (p.startsWith("/assets/vmd")) return json({ items: [] });
  if (p.startsWith("/config/mapping/resolved/")) return json({ mappings: {} });
  if (p === "/sessions" && route.request().method() === "GET") return json({ items: [] });
  if (p === "/sessions" && route.request().method() === "POST") return json({ session: { id: "stub-session-1", title: "验收会话", selected_model_path: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
  if (/^\/sessions\/[^/]+\/messages/.test(p)) return json({ items: [] });
  if (p.startsWith("/companion") || p.startsWith("/config/companion")) return json({ user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3", reze_stage_document: null, updated_at: null });
  return json({ items: [] });
});
// 兜底：直接命中后端 origin（127.0.0.1:8000）的请求。
// shared-config 用 directApi:true，MMDStage.toAbsolute 把存根模型/贴图/VMD 相对路径
// 也解析到该 origin，二者都不经 /api/backend 代理。后端不可用时必须在此拦截，
// 否则产生 ERR_CONNECTION_REFUSED 进入 failedRequests 阻断 G1。
await page.route("**://127.0.0.1:8000/**", async (route) => {
  const url = new URL(route.request().url());
  const p = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (/\.pmx$/i.test(p)) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(PMX) });
  // 纹理/贴图：从权威克莱妲目录真实映射（Three.js 把 PMX 相对纹理路径解析到
  // /assets/mmd/models/<Textures|spa|textures>/<file>）。后端不可用时由本兜底从磁盘
  // 提供真实字节，避免 404 进入 httpBad 阻断 G1；文件确实不存在才返回 404。
  if (/\.(png|jpe?g|webp|bmp|tga|sph|spa)$/i.test(p)) {
    const base = p.replace(/^\/assets\/mmd\/models\/?/i, "");
    const cand = findKoledaAsset(base);
    if (cand) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(cand) });
    return json({ detail: "texture not found: " + base }, 404);
 }
  if (p.startsWith("/desktop-pet/shared-config")) return json({ user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3" });
  if (p.startsWith("/assets/mmd/models")) return json({ items: [STUB_MODEL] });
  if (p.startsWith("/assets/mmd/vmds") || p.startsWith("/assets/vmd")) return json({ items: [] });
  if (p.startsWith("/codex/knowledge/review-summary")) return json({ workspace_key: null, total: 0, pending: 0, by_status: {} });
  return json({ items: [] });
});
// 权威 VMD 全局路由：G3 锁帧与 G5 完整播放都用探针 playVmd("/__probe__/....vmd")，
// 需在脚本开头注册一次，覆盖整个验收过程（G5 内不再重复注册/注销）。
await page.route("**/*.vmd", async (route) => {
  // 竞态回归（P0）：/__probe__/__slow__/ 前缀的 VMD 延迟返回字节，模拟「较慢完成的旧请求」。
  if (route.request().url().includes("/__probe__/__slow__/")) {
    await new Promise((s) => setTimeout(s, 1200));
  }
  return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(VMD) });
});

const sel = { canvasReady: "canvas[data-webgpu-status=\"ready\"]", variantBar: "[data-testid=\"reze-k3-skin-variant-bar\"]", variantBtn: (v) => "[data-testid=\"reze-k3-skin-variant-" + v + "\"]" };
// 初始默认 mio-reference（Three.js）对存根模型会加载失败，不出现 WebGPU ready 画布；
// 这里只等 DOM + 会话就绪，真正的 canvas ready 在切到 reze-k3 后等待。
async function gotoCompanion() {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500); // 等 bootstrap（会话/模型清单/共享配置）完成
}
async function openRezeEditor() {
  // 「工具」导航在 reze 管线下 aria-label 为「打开 Reze 材质与场景编辑器」，否则为「工具」。
  const byReze = page.locator("button.mio-nav-button[aria-label*=\"Reze\"]");
  const byTools = page.locator("button.mio-nav-button[aria-label=\"工具\"]");
  if (await byReze.count()) await byReze.first().click();
  else if (await byTools.count()) await byTools.first().click();
  else await page.locator("button.mio-nav-button").nth(3).click();
  // 等 Reze 编辑器面板与资产标签真实渲染（视图切换+面板动画后才有 file input）。
  await page.waitForSelector("button.mio-reze-editor-tool[aria-label=\"资产\"]", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
}
async function switchToRezeK3() {
  // 管线按钮在「高级功能」面板。先开高级面板（命令栏齿轮按钮）→ 点 Reze K3。
  await page.click("button.mio-advanced-mode");
  await page.waitForSelector("[data-testid=\"mio-advanced-panel\"]", { timeout: 15000 });
  await page.click(".mio-pipeline-option:has-text(\"Reze K3\")");
  // 注意：无本地导入时 reze-k3 走 modelUrl 加载（存根模型不可达）→ canvas=error；
  // 这里不等待 ready，待真实目录导入后再等 canvas[data-webgpu-status=ready]。
  await page.waitForTimeout(800);
  // handleRenderPipelineChange 关闭面板；重开 Reze 编辑器。命令栏面板会遮挡导航按钮，
  // 验收场景用 force 点击绕过（真实用户路径是点同一按钮，只是指针事件被浮层截获）。
  await page.click("button.mio-nav-button[aria-label=\"打开 Reze 材质与场景编辑器\"]", { force: true });
  await page.waitForSelector("button.mio-reze-editor-tool[aria-label=\"资产\"]", { timeout: 20000 });
  await page.click("button.mio-reze-editor-tool[aria-label=\"资产\"]");
}
async function importDir(dirPath) {
  // 目录导入控件在 Reze 编辑器「资产」标签；先确保编辑器与标签激活。
  // 面板可能已被前一步关闭；确保 Reze 编辑器与「资产」标签激活再导入。
  if (!(await page.locator("input[type=file]").count())) {
    await page.click("button.mio-nav-button[aria-label=\"打开 Reze 材质与场景编辑器\"]", { force: true }).catch(() => {});
    await page.waitForSelector("button.mio-reze-editor-tool[aria-label=\"资产\"]", { timeout: 20000 }).catch(() => {});
    await page.click("button.mio-reze-editor-tool[aria-label=\"资产\"]").catch(() => {});
    await page.waitForTimeout(400);
  }
  // 等目录 input 真实出现（webkitdirectory 由 ref 回调设置）。
  await page.waitForSelector("input[type=file]", { timeout: 20000 });
  const input = page.locator("input[type=file][webkitdirectory]").first();
  await input.setInputFiles(dirPath);
  await page.waitForSelector(sel.canvasReady, { timeout: 120000 });
  // 导入后关闭高级功能浮层，避免遮挡舞台右侧的变体单选按钮。
  await page.click("button.mio-advanced-mode").catch(() => {});
  await page.waitForTimeout(500);
}
async function waitRebuilt() { await page.waitForSelector(sel.canvasReady, { timeout: 120000 }); await page.waitForTimeout(500); }
async function readCanvasState() {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const d = c.dataset;
    return { webgpuStatus: d.webgpuStatus || "", variant: d.v14dSkinVariant || "(unset)", faceGraph: d.v14dSkinVariantFaceGraph || "", faceDrawCalls: d.v14dSkinVariantFaceDrawCalls || "", faceOnComposite: d.v14dSkinVariantFaceOnComposite || "", bodyDrawCalls: d.v14dSkinVariantBodyDrawCalls || "", bodyOnComposite: d.v14dSkinVariantBodyOnComposite || "", hairADrawCalls: d.v14dSkinVariantHairADrawCalls || "", hairAOnComposite: d.v14dSkinVariantHairAOnComposite || "", hairBDrawCalls: d.v14dSkinVariantHairBDrawCalls || "", hairBOnComposite: d.v14dSkinVariantHairBOnComposite || "", browsDrawCalls: d.v14dSkinVariantBrowsDrawCalls || "", browsOnComposite: d.v14dSkinVariantBrowsOnComposite || "", lashesDrawCalls: d.v14dSkinVariantLashesDrawCalls || "", lashesOnComposite: d.v14dSkinVariantLashesOnComposite || "", idMismatch: d.v14dSkinVariantIdentifierMismatch || "", vmdName: d.vmdPlaybackName || "", vmdCurrent: d.vmdPlaybackCurrent || "", vmdDuration: d.vmdPlaybackDuration || "", vmdPlaying: d.vmdPlaybackPlaying || "" };
  });
}
async function readUiVariant() { return page.evaluate(() => { const a = document.querySelector("[data-testid=\"reze-k3-skin-variant-bar\"] .mio-pipeline-option.is-active"); return a ? a.getAttribute("data-testid").replace("reze-k3-skin-variant-", "") : null; }); }
async function variantBarVisible() { const n = await page.locator(sel.variantBar).count(); if (!n) return false; return page.locator(sel.variantBar).first().isVisible(); }
async function shot(name) { const f = path.join(OUT, name + ".png"); await page.screenshot({ path: f }); report.screenshots[name] = f; return f; }
async function captureStagePixels() { return page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return { error: "no canvas" }; try { return { dataUrl: c.toDataURL("image/png"), width: c.width, height: c.height }; } catch (e) { return { error: String(e) }; } }); }
async function prepareHairCapture() {
  return page.evaluate(async ({ url, seconds, fps }) => {
    const stage = window.__rezeStageProbe;
    if (!stage?.playVmd || !stage?.pauseVmd || !stage?.seekVmd) return { error: "VMD capture probe unavailable" };
    const name = await stage.playVmd(url);
    stage.pauseVmd();
    stage.seekVmd(seconds);
    stage.pauseVmd();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const progress = document.querySelector("canvas")?.dataset || {};
    return {
      name,
      requestedSeconds: seconds,
      requestedFrame: seconds * fps,
      reportedSeconds: Number(progress.vmdPlaybackCurrent || 0),
      reportedPlaying: progress.vmdPlaybackPlaying || "",
    };
  }, { url: HAIR_CAPTURE_VMD_URL, seconds: HAIR_CAPTURE_SECONDS, fps: HAIR_CAPTURE_FPS });
}
async function captureHairAtomic() {
  return page.evaluate(async () => {
    const raw = await window.__rezeStageProbe?.captureHairTriUv?.();
    if (!raw || raw.error) return raw;
    const byMaterial = Object.fromEntries(Object.entries(raw.byMaterial || {}).map(([name, info]) => [name, {
      ...info,
      triId: Array.from(info.triId || []),
      uv: Array.from(info.uv || []),
      triMask: Array.from(info.triMask || []),
      triangleUvs: Array.from(info.triangleUvs || []),
    }]));
    return { ...raw, byMaterial };
  });
}
// Stage 2C-M2a 修正轮：Brows/Lashes 原子同帧采集。复用同一 captureHairTriUv
// 探针（上轮已参数化 materialNames），但显式传入 Brows/Lashes 槽名，得到两槽
// 各自的 materialId/expanded-tri-uv 与同帧 canvas 像素。
const BROWS_LASHES_SLOTS = ["Brows", "Lashes"];
async function captureBrowsLashesAtomic() {
  return page.evaluate(async (names) => {
    // Stage 2C-M2a 修正轮：Brows/Lashes 需要真实前景深度剔除（useForegroundDepth）
    // + 临时提高相机 near 到 1.0（nearClipOverride）解决 depth24 在脸部特写下精度
    // 不足导致的睫毛薄片 z-fighting 剔除（实测不提高 near 时 152 前景像素全灭）。
    // Hair 链路不传这两个选项，保持原无深度行为。
    const raw = await window.__rezeStageProbe?.captureHairTriUv?.(names, { useForegroundDepth: true, nearClipOverride: 1.0 });
    if (!raw || raw.error) return raw;
    const byMaterial = Object.fromEntries(Object.entries(raw.byMaterial || {}).map(([name, info]) => [name, {
      ...info,
      triId: Array.from(info.triId || []),
      uv: Array.from(info.uv || []),
      triMask: Array.from(info.triMask || []),
      triangleUvs: Array.from(info.triangleUvs || []),
    }]));
    return { ...raw, byMaterial };
  }, BROWS_LASHES_SLOTS);
}
function saveDataUrl(du, name) { if (!du || !du.startsWith("data:image/png")) return null; const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(du.split(",")[1], "base64")); report.screenshots[name.replace(/\.png$/, "")] = f; return f; }
function summarizeHairAtomicCapture(capture) {
  if (!capture || capture.error) return { error: capture?.error || "missing atomic hair capture" };
  const materials = Object.fromEntries(Object.entries(capture.byMaterial || {}).map(([name, info]) => {
    const triMask = Array.isArray(info.triMask) ? info.triMask : [];
    const triId = Array.isArray(info.triId) ? info.triId : [];
    const uv = Array.isArray(info.uv) ? info.uv : [];
    return [name, {
      materialId: info.materialId ?? null,
      materialIndex: info.materialIndex ?? null,
      firstIndex: info.firstIndex ?? null,
      indexCount: info.indexCount ?? null,
      triangleCount: info.triangleCount ?? null,
      triMaskSamples: triMask.reduce((sum, value) => sum + (value ? 1 : 0), 0),
      triIdSamples: triId.reduce((sum, value) => sum + (Number.isInteger(Number(value)) && Number(value) >= 0 ? 1 : 0), 0),
      uvSamples: Math.floor(uv.length / 2),
      triangleUvsLength: Array.isArray(info.triangleUvs) ? info.triangleUvs.length : 0,
    }];
  }));
  return {
    source: capture.source || null,
    captureId: capture.captureId ?? capture.captureEvidence?.pixel?.captureId ?? null,
    width: capture.width ?? null,
    height: capture.height ?? null,
    captureState: capture.captureState || null,
    captureProgressBeforeRead: capture.captureProgressBeforeRead || null,
    captureProgressAfterRead: capture.captureProgressAfterRead || null,
    captureEvidence: capture.captureEvidence || null,
    materialIdByName: capture.materialIdByName || null,
    materials,
  };
}
function hairCaptureAudit(capture, atomicPair) {
  const evidence = capture?.captureEvidence || {};
  const pixel = evidence.pixel || {};
  const triUv = evidence.triUv || {};
  const seconds = Number(pixel.currentSeconds ?? capture?.captureState?.currentSeconds);
  const frame = Number(pixel.currentFrame ?? capture?.captureState?.currentFrame);
  return {
    actual: {
      seconds: Number.isFinite(seconds) ? seconds : null,
      frame: Number.isFinite(frame) ? frame : null,
      fps: Number.isFinite(pixel.fps) ? pixel.fps : null,
      fpsProvenance: typeof pixel.fpsProvenance === "string" ? pixel.fpsProvenance : null,
      animationName: pixel.animationName ?? null,
    },
    captureId: capture?.captureId ?? pixel.captureId ?? null,
    pixelCaptureId: pixel.captureId ?? null,
    triUvCaptureId: triUv.captureId ?? null,
    pixelTriUvPair: atomicPair,
  };
}

// ── G1：用户路径与切换 ───────────────────────────────────────────────
try {
  note("G1", "进入 /companion origin=" + ORIGIN);
  await gotoCompanion();
  await switchToRezeK3();
  // 选中克莱妲模型（驱动变体持久化存储键），再真实导入目录。
  await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
  const st0 = await readCanvasState();
  note("G1", "初始 variant=" + st0.variant + " status=" + st0.webgpuStatus);
  if (await variantBarVisible()) fail("G1", "未导入权威克莱妲目录时变体 UI 不应显示");
  note("G1", "导入权威克莱妲目录（含 mask）");
  await importDir(IMPORT_DIR);
  if (!(await variantBarVisible())) fail("G1", "资格满足后变体 UI 未显示");
  const ui0 = await readUiVariant(); const stI = await readCanvasState();
  note("G1", "导入后 UI=" + ui0 + " canvas=" + stI.variant);
  if (ui0 !== "original") fail("G1", "默认应 original，实际 " + ui0);
  if (stI.variant !== "original") fail("G1", "导入后 canvas 默认应 original，实际 " + stI.variant);
  await shot("g1-original-with-ui");
  note("G1", "点击 V1");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const ui1 = await readUiVariant(); const st1 = await readCanvasState();
  note("G1", "V1 后 UI=" + ui1 + " canvas=" + st1.variant + " faceGraph=" + st1.faceGraph);
  if (ui1 !== "v1") fail("G1", "点 V1 后 UI=" + ui1);
  if (st1.variant !== "v1") fail("G1", "点 V1 后 canvas=" + st1.variant);
  if (st1.webgpuStatus !== "ready") fail("G1", "V1 后画布未 ready");
  await shot("g1-v1-with-ui");
  note("G1", "切回 original");
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const ui2 = await readUiVariant(); const st2 = await readCanvasState();
  if (ui2 !== "original" || st2.variant !== "original") fail("G1", "切回 original 失败 ui=" + ui2 + " canvas=" + st2.variant);
  report.gates.G1 = report.gates.G1 || { status: "pass", failures: [] }; note("G1", "PASS");
} catch (e) { fail("G1", "exception: " + (e?.stack || e)); }

// ── G2：真实绑定 + 负测 ──────────────────────────────────────────────
try {
  note("G2", "V1 绑定证据");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const b = await readCanvasState(); note("G2", JSON.stringify(b));
  const fc = Number(b.faceDrawCalls), fo = Number(b.faceOnComposite), bc = Number(b.bodyDrawCalls), bo = Number(b.bodyOnComposite);
  const hac = Number(b.hairADrawCalls), hao = Number(b.hairAOnComposite), hbc = Number(b.hairBDrawCalls), hbo = Number(b.hairBOnComposite);
  if (b.variant !== "v1") fail("G2", "canvas 应 v1，实际 " + b.variant);
  if (b.faceGraph !== "V14D Face State2 Live Composite") fail("G2", "Face graph=" + b.faceGraph);
  if (!(fc > 0 && fc === fo)) fail("G2", "Face drawCalls " + fo + "/" + fc + " 未全部走 State2 Composite");
  if (!(bc > 0 && bc === bo)) fail("G2", "BodySkin drawCalls " + bo + "/" + bc + " 未全部走 Body Composite");
  // Stage 2C-M1：HairA/HairB 必须真实命中 V14D Hair V1 Composite（分区各自硬断言，
  // 不用整头合并掩盖 A/B 分区差异）。
  if (!(hac > 0 && hac === hao)) fail("G2", "HairA drawCalls " + hao + "/" + hac + " 未全部走 V14D Hair V1 Composite");
  if (!(hbc > 0 && hbc === hbo)) fail("G2", "HairB drawCalls " + hbo + "/" + hbc + " 未全部走 V14D Hair V1 Composite");
  const brc = Number(b.browsDrawCalls), bro = Number(b.browsOnComposite), lac = Number(b.lashesDrawCalls), lao = Number(b.lashesOnComposite);
  if (!(brc > 0 && brc === bro)) fail("G2", "Brows drawCalls " + bro + "/" + brc + " 未全部走 V14D Brows Lashes V1 Composite");
  if (!(lac > 0 && lac === lao)) fail("G2", "Lashes drawCalls " + lao + "/" + lac + " 未全部走 V14D Brows Lashes V1 Composite");
  report.gates.G2 = report.gates.G2 || { status: "pass", failures: [] }; report.gates.G2.binding = b;
  // 负测 A：original 不命中 V14D graph
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const neg0 = await readCanvasState();
  if (neg0.variant === "v1") fail("G2", "original 模式 canvas 仍 v1");
  note("G2", "负测 A PASS");
  // 负测 B：重命名 PMX + mask → UI 不显示
  note("G2", "负测 B：重命名 PMX"); await importDir(NEG_RENAME_DIR);
  if (await variantBarVisible()) fail("G2", "非权威 PMX 文件名时变体 UI 不应显示");
  const negB = await readCanvasState(); if (negB.variant === "v1") fail("G2", "非权威 PMX 下 canvas 不应 v1");
  note("G2", "负测 B PASS");
  // 负测 C：权威 PMX 缺 mask → UI 不显示
  note("G2", "负测 C：缺 mask"); await importDir(NEG_NOMASK_DIR);
  if (await variantBarVisible()) fail("G2", "缺 mask 时变体 UI 不应显示");
  const negC = await readCanvasState(); if (negC.variant === "v1") fail("G2", "缺 mask 时 canvas 不应 v1");
  note("G2", "负测 C PASS");
  // 负测 D 前恢复资格：缺 mask 导入后资格状态粘性（同 PMX 名重导入不重置），
  // 需整页刷新+重导入权威目录（含 mask）让资格谓词重新判定，变体条才恢复（对齐 G4 路径）。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  if (!(await variantBarVisible())) fail("G2", "刷新+重导入后变体条未恢复（资格未重置）");
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  // 负测 D：错误 graph（graph.name 非权威 V14D 名）→ Face/BodySkin draw-call 不计入 composite。
  note("G2", "负测 D：错误 graph");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const negD = await page.evaluate(async () => { const r = await window.__rezeStageProbe.applyBadSkinGraph("wrongGraph"); const c = document.querySelector("canvas").dataset; return { ok: r.ok, faceOnComposite: c.v14dSkinVariantFaceOnComposite, bodyOnComposite: c.v14dSkinVariantBodyOnComposite, hairAOnComposite: c.v14dSkinVariantHairAOnComposite, hairBOnComposite: c.v14dSkinVariantHairBOnComposite }; });
  if (!(negD.ok && Number(negD.faceOnComposite) === 0 && Number(negD.bodyOnComposite) === 0 && Number(negD.hairAOnComposite) === 0 && Number(negD.hairBOnComposite) === 0)) fail("G2", "错误 graph 应使 composite 命中为 0，实际 " + JSON.stringify(negD));
  note("G2", "负测 D PASS " + JSON.stringify(negD));
  // 负测 E：applyStyleGroups 失败（编译非法 graph）→ ok:false 且 canvas 回退 original。
  note("G2", "负测 E：applyStyleGroups 失败回退");
 const negE = await page.evaluate(async () => { const r = await window.__rezeStageProbe.applyBadSkinGraph("failCompile"); const c = document.querySelector("canvas").dataset; return { ok: r.ok, variant: c.v14dSkinVariant, faceGraph: c.v14dSkinVariantFaceGraph }; });
 if (negE.ok !== false || negE.variant !== "original") fail("G2", "applyStyleGroups 失败应 ok:false 且回退 original，实际 " + JSON.stringify(negE));
 note("G2", "负测 E PASS " + JSON.stringify(negE));
  // 负测 F/G/H（Stage 2C-M1 修正轮）：Hair 专用 missing/wrongMaterial 扰动，
  // 每个都真实驱动引擎 applyStyleGroups 并读回 dataset 绑定证据。要求：
  // 漏 HairA → hairAOnComposite=0 且 hairBOnComposite=1（单变量，B 不受影响）；
  // 漏 HairB → hairBOnComposite=0 且 hairAOnComposite=1；错材质归属（hair 组绑到
  // BodySkin）→ hairA/hairB OnComposite 均=0。任一不满足则同一 Gate 非零退出。
  async function hairNeg(kind, expectA, expectB) {
    const r = await page.evaluate(async (k) => {
      const res = await window.__rezeStageProbe.applyBadSkinGraph(k);
      const c = document.querySelector("canvas").dataset;
      return { ok: res.ok, a: Number(c.v14dSkinVariantHairAOnComposite), b: Number(c.v14dSkinVariantHairBOnComposite), face: Number(c.v14dSkinVariantFaceOnComposite), body: Number(c.v14dSkinVariantBodyOnComposite) };
    }, kind);
    // 扰动后需整页刷新+重导入恢复干净 V1，避免残留影响下一负测。
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
    await page.waitForTimeout(2500);
    await switchToRezeK3();
    await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
    await importDir(IMPORT_DIR);
    await page.click(sel.variantBtn("v1")); await waitRebuilt();
    return r;
  }
  const negMissingA = await hairNeg("missingHairA", 0, 1);
  if (!(negMissingA.a === 0 && negMissingA.b === 1)) fail("G2", "missingHairA 应使 HairA OnComposite=0 且 HairB=1，实际 " + JSON.stringify(negMissingA));
  note("G2", "负测 F missingHairA PASS " + JSON.stringify(negMissingA));
  const negMissingB = await hairNeg("missingHairB", 1, 0);
  if (!(negMissingB.a === 1 && negMissingB.b === 0)) fail("G2", "missingHairB 应使 HairB OnComposite=0 且 HairA=1，实际 " + JSON.stringify(negMissingB));
  note("G2", "负测 G missingHairB PASS " + JSON.stringify(negMissingB));
  const negWrongMat = await hairNeg("wrongHairMaterial", 0, 0);
  if (!(negWrongMat.a === 0 && negWrongMat.b === 0)) fail("G2", "wrongHairMaterial 应使 HairA/HairB OnComposite 均=0，实际 " + JSON.stringify(negWrongMat));
  note("G2", "负测 H wrongHairMaterial PASS " + JSON.stringify(negWrongMat));
  // 负测 I/J/K/L（Stage 2C-M2a）：Brows/Lashes 专用 missing/swap/wrongTint 扰动。
  // 每个都真实驱动引擎 applyStyleGroups 并读回 dataset 绑定证据。要求：
  // 漏 Brows → browsOnComposite=0 且 lashesOnComposite=1（单变量）；
  // 漏 Lashes → lashesOnComposite=0 且 browsOnComposite=1；
  // wrongBrowsLashesTint（恒等 tint 改红绿偏置）→ graph 仍命中（分组绑定不变），
  //   但目标收敛 Gate 在 G3 非零拒绝（此处只证绑定仍命中、graph 名正确）。
  async function browsLashesNeg(kind) {
    const r = await page.evaluate(async (k) => {
      const res = await window.__rezeStageProbe.applyBadSkinGraph(k);
      const c = document.querySelector("canvas").dataset;
      return { ok: res.ok, brows: Number(c.v14dSkinVariantBrowsOnComposite), lashes: Number(c.v14dSkinVariantLashesOnComposite), browsDc: Number(c.v14dSkinVariantBrowsDrawCalls), lashesDc: Number(c.v14dSkinVariantLashesDrawCalls) };
    }, kind);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
    await page.waitForTimeout(2500);
    await switchToRezeK3();
    await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
    await importDir(IMPORT_DIR);
    await page.click(sel.variantBtn("v1")); await waitRebuilt();
    return r;
  }
  const negMissingBrows = await browsLashesNeg("missingBrows");
  if (!(negMissingBrows.brows === 0 && negMissingBrows.lashes === 1)) fail("G2", "missingBrows 应使 Brows OnComposite=0 且 Lashes=1，实际 " + JSON.stringify(negMissingBrows));
  note("G2", "负测 I missingBrows PASS " + JSON.stringify(negMissingBrows));
  const negMissingLashes = await browsLashesNeg("missingLashes");
  if (!(negMissingLashes.brows === 1 && negMissingLashes.lashes === 0)) fail("G2", "missingLashes 应使 Lashes OnComposite=0 且 Brows=1，实际 " + JSON.stringify(negMissingLashes));
  note("G2", "负测 J missingLashes PASS " + JSON.stringify(negMissingLashes));
  const negSwapBL = await browsLashesNeg("swapBrowsLashes");
  // Stage 2C-M2a 修正轮：swap 扰动已改为真实错槽归属（两个独立身份克隆 graph
  // 交叉绑定 Brows↔Lashes）。G2 绑定计数层面两槽仍各有 pipeline（各 1/1 命中
  // 目标 composite 族），但 graph 槽归属被交叉；正式逐槽 Gate（P0-1 原子同帧
  // material-ID+triUV+pixel）据「槽→graph 归属与材质身份不一致」非零拒绝。
  // 此处确认两槽 draw-call 仍真实命中 V1 composite 族（证明不是 missing），
  // 错槽的机器判别由 G3 逐槽身份/目标 Gate 承担，不能用「绑定仍 1/1」冒充通过。
  // 判别点（机器可读）：swap 扰动生成了两个独立身份 graph 名（"(swapped-slot brows)"
  // / "(swapped-slot lashes)"），与生产单一 graph 名不同；绑定计数会因 graph 名
  // 不再精确等于权威 V14D 名而归 0。因此负测成立的证据 = 两槽 OnComposite 均=0
  // （错槽 graph 不被权威绑定计数承认）且 draw-call 仍存在（browsDc/lashesDc=1，
  // 证明不是 missing）。错槽归属的最终非零拒绝由 G3 逐槽 identity-target Gate 承担。
  if (!(negSwapBL.brows === 0 && negSwapBL.lashes === 0 && negSwapBL.browsDc === 1 && negSwapBL.lashesDc === 1)) fail("G2", "swapBrowsLashes 应使两槽权威 OnComposite=0（graph 身份被交叉）但 draw-call 仍在，实际 " + JSON.stringify(negSwapBL));
  note("G2", "负测 K swapBrowsLashes PASS（真实错槽归属，权威绑定计数归 0）" + JSON.stringify(negSwapBL));
  // 负测 L/M（Stage 2C-M2a 修正轮）：Brows/Lashes 专用 wrongGraph 与 compile/apply
  // 失败。wrongGraph 把全部 graph.name 换成非权威名 → brows/lashes OnComposite=0；
  // failCompile 注入非法 output 引用 → applyStyleGroups ok:false 且 canvas 回退 original。
  const negWrongGraphBL = await browsLashesNeg("wrongGraph");
  if (!(negWrongGraphBL.brows === 0 && negWrongGraphBL.lashes === 0)) fail("G2", "wrongGraph 应使 Brows/Lashes OnComposite 均=0，实际 " + JSON.stringify(negWrongGraphBL));
  note("G2", "负测 L wrongGraph(Brows/Lashes) PASS " + JSON.stringify(negWrongGraphBL));
  const negFailCompileBL = await page.evaluate(async () => { const r = await window.__rezeStageProbe.applyBadSkinGraph("failCompile"); const c = document.querySelector("canvas").dataset; return { ok: r.ok, variant: c.v14dSkinVariant, browsOnComposite: Number(c.v14dSkinVariantBrowsOnComposite), lashesOnComposite: Number(c.v14dSkinVariantLashesOnComposite) }; });
  if (negFailCompileBL.ok !== false || negFailCompileBL.variant !== "original") fail("G2", "Brows/Lashes compile/apply 失败应 ok:false 且回退 original，实际 " + JSON.stringify(negFailCompileBL));
  note("G2", "负测 M failCompile/apply(Brows/Lashes) PASS " + JSON.stringify(negFailCompileBL));
  // failCompile 后需刷新恢复干净 V1（同 hair 负测尾部路径）。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  // 负测 D/E 在当前引擎实例注入了错误/非法 graph 分组；需整页刷新重建干净引擎，
  // 再重导入权威目录并恢复 V1 绑定，避免坏分组残留污染后续 Gate。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  if (!(await variantBarVisible())) fail("G2", "负测后刷新+重导入变体条未恢复");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const rec = await readCanvasState();
  if (rec.variant !== "v1" || rec.faceGraph !== "V14D Face State2 Live Composite") fail("G2", "负测后恢复 V1 失败 " + JSON.stringify(rec));
 report.gates.G2.negatives = { original: neg0.variant, renamed: negB.variant, noMask: negC.variant, wrongGraphCompositeHits: Number(negD.faceOnComposite) + Number(negD.bodyOnComposite), failCompileOk: negE.ok, failCompileVariant: negE.variant };
  report.gates.G2.negatives.hair = { missingHairA: negMissingA, missingHairB: negMissingB, wrongHairMaterial: negWrongMat };
  report.gates.G2.negatives.browsLashes = { missingBrows: negMissingBrows, missingLashes: negMissingLashes, swapBrowsLashes: negSwapBL, wrongGraph: negWrongGraphBL, failCompile: negFailCompileBL };
  note("G2", "PASS");
} catch (e) { fail("G2", "exception: " + (e?.stack || e)); }

// ── G3：完整模型视觉 A/B（original/V1 画布像素）─────────────────────────
try {
  note("G3", "采集 original/V1 画布像素 A/B");
  // G2 末尾已整页刷新+重导入权威目录并恢复 V1 绑定，变体条已出现；此处不再重复 importDir。
  // 继承的 Face/BodySkin/场景差异 lane 保留原先无 VMD 的用户路径；Hair 正式 lane
  // 随后单独加载同一权威 VMD，pause+seek 到固定秒数，再由单个 captureHairTriUv
  // 原子返回 canvas、material-ID/depth、triId、插值 UV 和时间证据。analyzer 通过
  // V14D_HAIR_ORIG_CANVAS/V14D_HAIR_V1_CANVAS 只把后一 lane 用于 Hair origMae/v1Mae。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const sceneOrig = await page.evaluate(() => window.__rezeStageProbe?.sceneSnapshot?.() || null);
  const legacyOriginalPix = await captureStagePixels();
  const legacyOriginalBPix = await captureStagePixels();
  const legacyOriginalPng = saveDataUrl(legacyOriginalPix.dataUrl, "g3-original-canvas.png");
  const legacyOriginalBPng = saveDataUrl(legacyOriginalBPix.dataUrl, "g3-original-canvas-b.png");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const sceneV1 = await page.evaluate(() => window.__rezeStageProbe?.sceneSnapshot?.() || null);
  const legacyV1Pix = await captureStagePixels();
  const legacyV1Png = saveDataUrl(legacyV1Pix.dataUrl, "g3-v1-canvas.png");
  if (legacyOriginalPix.error || legacyOriginalBPix.error || legacyV1Pix.error) {
    fail("G3", "继承场景 A/B 画布像素捕获失败 " + (legacyOriginalPix.error || legacyOriginalBPix.error || legacyV1Pix.error));
  }
  report.gates.G3 = report.gates.G3 || { status: "pass", failures: [] };
  report.gates.G3.legacyCanvas = { original: legacyOriginalPng, originalB: legacyOriginalBPng, v1: legacyV1Png };

  // Hair 原子 lane：original/V1 各在变体重建后重新加载同一权威 VMD，并固定到
  // 不可覆盖的 4 秒/120 帧/30 FPS/权威动画名。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const originalSetup = await prepareHairCapture();
  const originalAtomic = await captureHairAtomic();
  const origPix = originalAtomic?.canvasDataUrl
    ? { dataUrl: originalAtomic.canvasDataUrl, width: originalAtomic.width, height: originalAtomic.height }
    : { error: originalAtomic?.error || "original atomic hair capture unavailable" };
  const oPng = saveDataUrl(origPix.dataUrl, "g3-hair-original-canvas.png");
  await shot("g3-original-full");

  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const v1Setup = await prepareHairCapture();
  const hairTriUvCapture = await captureHairAtomic();
  const v1Pix = hairTriUvCapture?.canvasDataUrl
    ? { dataUrl: hairTriUvCapture.canvasDataUrl, width: hairTriUvCapture.width, height: hairTriUvCapture.height }
    : { error: hairTriUvCapture?.error || "v1 atomic hair capture unavailable" };
  const vPng = saveDataUrl(v1Pix.dataUrl, "g3-hair-v1-canvas.png");
  await shot("g3-v1-full");
  const capturePair = validateV14dHairCapturePair({
    original: {
      ...(originalAtomic?.captureEvidence || {}),
    },
    v1: {
      ...(hairTriUvCapture?.captureEvidence || {}),
    },
  });
  const originalHairAudit = hairCaptureAudit(originalAtomic, capturePair.original);
  const v1HairAudit = hairCaptureAudit(hairTriUvCapture, capturePair.v1);
  const originalAtomicMeta = path.join(OUT, "g3-hair-original-atomic.json");
  const v1AtomicMeta = path.join(OUT, "g3-hair-v1-atomic-summary.json");
  // original probe 也必须留下可审计证据，即使后续 V1 证据失败；只保存
  // captureEvidence/captureState 与材质解析计数摘要，不复制正式 triUV 大数组。
  fs.writeFileSync(originalAtomicMeta, JSON.stringify(summarizeHairAtomicCapture(originalAtomic), null, 2));
  fs.writeFileSync(v1AtomicMeta, JSON.stringify(summarizeHairAtomicCapture(hairTriUvCapture), null, 2));
  report.gates.G3 = report.gates.G3 || { status: "pass", failures: [] };
  report.gates.G3.hairCaptureTime = {
    requested: {
      seconds: HAIR_CAPTURE_SECONDS,
      frame: HAIR_CAPTURE_FRAME,
      fps: HAIR_CAPTURE_FPS,
      fpsProvenance: HAIR_CAPTURE_FPS_PROVENANCE,
      animationName: HAIR_CAPTURE_ANIMATION_NAME,
    },
    originalSetup,
    v1Setup,
    actual: { original: originalHairAudit.actual, v1: v1HairAudit.actual },
    captureIds: {
      original: {
        captureId: originalHairAudit.captureId,
        pixel: originalHairAudit.pixelCaptureId,
        triUv: originalHairAudit.triUvCaptureId,
      },
      v1: {
        captureId: v1HairAudit.captureId,
        pixel: v1HairAudit.pixelCaptureId,
        triUv: v1HairAudit.triUvCaptureId,
      },
    },
    pixelTriUvPairs: { original: capturePair.original, v1: capturePair.v1 },
    captureEvidence: {
      original: originalAtomic?.captureEvidence || null,
      v1: hairTriUvCapture?.captureEvidence || null,
    },
    original: originalAtomic?.captureState || null,
    v1: hairTriUvCapture?.captureState || null,
    pair: capturePair,
  };
  if (!capturePair.ok) fail("G3", "HairA/HairB 原子采集时间/帧不一致: " + JSON.stringify(capturePair));
  if (origPix.error || v1Pix.error) fail("G3", "原子画布像素捕获失败 " + (origPix.error || v1Pix.error));
  if (!hairTriUvCapture?.captureEvidence || !hairTriUvCapture?.canvasDataUrl) fail("G3", "V1 原子 triUV+canvas 证据缺失 " + JSON.stringify(hairTriUvCapture));
  report.gates.G3.canvasSize = { width: v1Pix.width, height: v1Pix.height };
  report.gates.G3.origCanvas = oPng; report.gates.G3.v1Canvas = vPng;
  // HairA/HairB 逐槽身份与 triUV 来自 V1 的同一次原子 probe；页面 evaluate 只把
  // typed arrays 转成普通数组，analyze 消费这份同帧证据。
  if (!hairTriUvCapture || hairTriUvCapture.error || !hairTriUvCapture.materialMaskPng) {
    fail("G3", "HairA/HairB 同材质同三角形同 UV 证据采集失败: " + JSON.stringify(hairTriUvCapture));
  } else if (hairTriUvCapture.width !== v1Pix.width || hairTriUvCapture.height !== v1Pix.height) {
    fail("G3", "triUV 证据尺寸与画布不一致: " + JSON.stringify({ capture: [hairTriUvCapture.width, hairTriUvCapture.height], canvas: [v1Pix.width, v1Pix.height] }));
  } else {
    const maskPng = saveDataUrl(hairTriUvCapture.materialMaskPng, "g3-hair-material-mask.png");
    const maskMeta = path.join(OUT, "g3-hair-material-mask.json");
    fs.writeFileSync(maskMeta, JSON.stringify({
      source: hairTriUvCapture.source,
      width: hairTriUvCapture.width,
      height: hairTriUvCapture.height,
      materialIdByName: hairTriUvCapture.materialIdByName,
    }, null, 2));
    const triUvMeta = path.join(OUT, "g3-hair-tri-uv.json");
    fs.writeFileSync(triUvMeta, JSON.stringify({
      source: hairTriUvCapture.source,
      width: hairTriUvCapture.width,
      height: hairTriUvCapture.height,
      materialIdByName: hairTriUvCapture.materialIdByName,
      camera: hairTriUvCapture.camera || null,
      byMaterial: hairTriUvCapture.byMaterial,
    }, null, 2));
    report.gates.G3.hairSlotIdentity = {
      source: hairTriUvCapture.source,
      mask: maskPng,
      metadata: maskMeta,
      triUv: triUvMeta,
      originalAtomic: originalAtomicMeta,
      v1AtomicSummary: v1AtomicMeta,
      materialIdByName: hairTriUvCapture.materialIdByName,
      hairA: { materialName: "HairA", materialId: hairTriUvCapture.materialIdByName?.HairA ?? null },
      hairB: { materialName: "HairB", materialId: hairTriUvCapture.materialIdByName?.HairB ?? null },
    };
    report.gates.G3.hairTriUv = {
      source: hairTriUvCapture.source,
      width: hairTriUvCapture.width,
      height: hairTriUvCapture.height,
      materialMask: maskPng,
      json: triUvMeta,
      slots: Object.fromEntries(Object.entries(hairTriUvCapture.byMaterial || {}).map(([name, info]) => [name, {
        materialId: info.materialId,
        materialIndex: info.materialIndex,
        firstIndex: info.firstIndex,
        indexCount: info.indexCount,
        triangleCount: info.triangleCount,
        triMaskSamples: (info.triMask || []).reduce((sum, value) => sum + (value ? 1 : 0), 0),
      }])),
    };
  }
  // P1-1 Scene invariance：original 与 V1 的场景文档源（settingsRef：world/sun/bloom/
  // ground/camera/background）+ grade + 背景效果逐字段硬断言一致。变体切换只改 Face/
  // BodySkin 材质 graph，不得触碰场景/显示链；这是「保留 K3 灯光与星空背景」的引擎级证据。
  if (!sceneOrig || !sceneV1) fail("G3", "sceneSnapshot 缺失（探针未暴露场景证据）");
  else {
    const a = JSON.stringify(sceneOrig), b = JSON.stringify(sceneV1);
    report.gates.G3.sceneOrig = sceneOrig; report.gates.G3.sceneV1 = sceneV1;
    if (a !== b) {
      // 逐字段定位差异，给出可判别证据。
      const diffs = [];
      for (const k of Object.keys(sceneOrig)) if (JSON.stringify(sceneOrig[k]) !== JSON.stringify(sceneV1[k])) diffs.push(k);
      for (const k of Object.keys(sceneOrig.settings || {})) if (JSON.stringify(sceneOrig.settings[k]) !== JSON.stringify(sceneV1.settings?.[k])) diffs.push("settings." + k);
      fail("G3", "P1-1 场景不变性失败：V1 改写了场景/显示字段 " + diffs.join(","));
   } else note("G3", "P1-1 场景不变性 PASS（settings/grade/background 逐字段一致）");
    // Stage 2C-M1 修正轮：硬断言 sceneSnapshot 真实包含全局显示链字段（exposure/
    // gamma/tone mapping 经引擎 viewTransform 暴露）。缺任一字段即失败——防止
    // 「快照结构不含这些字段却宣称覆盖」的伪不变性。
    const vt = sceneOrig.viewTransform;
    const vtOk = vt && Number.isFinite(vt.exposure) && Number.isFinite(vt.gamma) && typeof vt.look === "string" && vt.look.length > 0;
    report.gates.G3.viewTransform = vt || null;
    if (!vtOk) fail("G3", "sceneSnapshot 缺 viewTransform（exposure/gamma/look=tone mapping），实际 " + JSON.stringify(vt));
    else note("G3", "viewTransform exposure=" + vt.exposure + " gamma=" + vt.gamma + " look=" + vt.look + "（original/V1 一致）");
 }
  // 硬阻断：区域差异分析以退出码判定（皮肤收敛 + 非皮肤/背景稳定 + HairA/HairB
  // 同材质 triUV 逐像素目标），不允许只算 verdict 强过。
  const { execSync } = await import("node:child_process");
  const analyzerEnv = {
    ...process.env,
    V14D_HAIR_TEX: HAIR_TEX,
    V14D_HAIR_PMX: HAIR_PMX,
  };
  // 让 accept 与独立 analyzer 完全走正式默认 Hair 原子画布；即使外层环境
  // 曾设置过旧覆盖，也不能让完整 Gate 靠 V14D_HAIR_*_CANVAS 绕过默认契约。
  delete analyzerEnv.V14D_HAIR_ORIG_CANVAS;
  delete analyzerEnv.V14D_HAIR_V1_CANVAS;
  const parseVisualReport = (text) => {
    const marker = text.indexOf("===VISUAL-GATE");
    const body = text.slice(text.indexOf("{"), marker >= 0 ? marker : text.length).trim();
    try { return body.startsWith("{") ? JSON.parse(body) : null; } catch { return null; }
  };
  const readVisualReportFile = (fileName) => {
    try { return JSON.parse(fs.readFileSync(path.join(OUT, fileName), "utf8")); } catch { return null; }
  };
  const runAnalyzer = (args = []) => {
    try {
      const stdout = execSync(["node", "scripts/analyze-reze-k3-v1-diff.mjs", ...args].join(" "), { cwd: process.cwd(), encoding: "utf8", env: analyzerEnv, stdio: ["ignore", "pipe", "pipe"] });
      return { exit: 0, stdout, stderr: "" };
    } catch (error) {
      return { exit: Number(error?.status ?? 1), stdout: String(error?.stdout ?? ""), stderr: String(error?.stderr ?? "") };
    }
  };
  const normalAnalysis = runAnalyzer();
  const normalVisualReport = readVisualReportFile("visual-diff.json") || parseVisualReport(normalAnalysis.stdout);
  const normalHairFormalGate = normalVisualReport?.hairFormalGate;
  const normalHairFormalPass = normalHairFormalGate?.authority === "material-id+atomic-triuv+slot-changed+target-convergence"
    && normalHairFormalGate.pass === true
    && normalHairFormalGate.formalTargetGate?.hairA === true
    && normalHairFormalGate.formalTargetGate?.hairB === true;
  try {
    if (normalAnalysis.exit !== 0 || !normalHairFormalPass) {
      throw new Error((normalAnalysis.stdout || normalAnalysis.stderr || "analyzer failed").slice(0, 400)
        + "; hairFormalGate=" + JSON.stringify(normalHairFormalGate));
    }
    note("G3", "区域差异硬阻断 PASS");
  } catch (err) { fail("G3", "区域差异分析硬阻断失败: " + (err.message || err).toString().slice(0, 400)); }
  // analyzer stdout 是给人看的精简摘要；regions.*.targetConvergence（含完整
  // samples/triUV/metricFailureReasons）只在对应 JSON 中。正式验收必须消费完整
  // 报告，不能因摘要省略字段而把有效证据当成缺失。
  report.gates.G3.visualDiff = {
    exit: normalAnalysis.exit,
    report: path.join(OUT, "visual-diff.json"),
    hairFormalGate: normalHairFormalGate || null,
    hairA: normalVisualReport?.regions?.hairA?.targetConvergence || null,
    hairB: normalVisualReport?.regions?.hairB?.targetConvergence || null,
  };
  // 真实错槽/错目标负测：交换 HairA/HairB 的 target/triUV 来源。它必须让正式
  // Gate 以 exit=1 阻断，但 negativeVerdict.status 仍要是 rejected，且两槽必须
  // 保留合法样本、输入证据有效，并由 v1Mae/drop/P95 等自然目标指标失败；不能
  // 靠预置 targetBinding=false 或缺文件/配置异常伪造拒绝。
  const swapAnalysis = runAnalyzer(["--neg-swap-slot-target"]);
  const swapVisualReport = readVisualReportFile("visual-diff-swap-slot-target.json") || parseVisualReport(swapAnalysis.stdout);
  const swapNegative = swapVisualReport?.negativeVerdict || null;
  const swapMetrics = {
    hairA: swapVisualReport?.regions?.hairA?.targetConvergence || null,
    hairB: swapVisualReport?.regions?.hairB?.targetConvergence || null,
  };
  const swapMetricRejected = [swapMetrics.hairA, swapMetrics.hairB].every((metric) =>
    metric?.metricGate === false
    && metric.samples >= 30
    && metric.targetSamples >= 30
    && metric.targetBinding?.inputsValid === true
    && metric.triUvResolution >= 0.999
    && Array.isArray(metric.metricFailureReasons)
    && metric.metricFailureReasons.some((reason) => /v1Mae|drop|P95/i.test(reason)),
  );
  const swapRejected = swapAnalysis.exit !== 0
    && swapNegative?.status === "rejected"
    && swapNegative?.formalTargetGate?.hairA === false
    && swapNegative?.formalTargetGate?.hairB === false
    && swapNegative?.semanticMismatch === true
    && swapNegative?.naturalMetricGate?.hairA === false
    && swapNegative?.naturalMetricGate?.hairB === false
    && swapNegative?.bindingInputsValid?.hairA === true
    && swapNegative?.bindingInputsValid?.hairB === true
    && swapMetricRejected
    && Array.isArray(swapNegative?.analysisFailures)
    && swapNegative.analysisFailures.length === 0;
  report.gates.G3.swapSlotTarget = {
    analyzerExit: swapAnalysis.exit,
    analyzer: swapNegative,
    analysisFailures: swapNegative?.analysisFailures ?? null,
    stderr: swapAnalysis.stderr.slice(0, 1000),
    rejected: swapRejected,
  };
  if (!swapRejected) fail("G3", "错槽/错目标负测协议失败：必须 analyzer exit 非零、两槽正式 Gate=false、合法样本与输入证据存在、自然指标失败且 analysisFailures=[]；实际 " + JSON.stringify(report.gates.G3.swapSlotTarget));
  else note("G3", "错槽/错目标负测 PASS（正式 Gate 非零阻断，语义拒绝非配置异常）");
  // Stage 2C-M1 修正轮：头发前刘海/后长发独立近景（前/后视角摆拍）。
  // 用 cameraOrbit 探针暂停待机 VMD 后摆拍头部特写，分别采 original/V1 纯画布；
  // 近景图是屏幕空间视觉证据（人读 + 差异图），机器分区判定由 analyze 的 UV 锚点口径给出。
  async function hairCloseup(pose, tag) {
    await page.click(sel.variantBtn("original")); await waitRebuilt();
    await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), pose);
    await page.waitForTimeout(350);
    const o = await captureStagePixels();
    if (!o.error) saveDataUrl(o.dataUrl, "g3-hair-" + tag + "-orig.png");
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
    await page.click(sel.variantBtn("v1")); await waitRebuilt();
    await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), pose);
    await page.waitForTimeout(350);
    const v = await captureStagePixels();
    if (!v.error) saveDataUrl(v.dataUrl, "g3-hair-" + tag + "-v1.png");
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
    return { orig: !o.error, v1: !v.error };
  }
  const cuFront = await hairCloseup("front", "front");
  const cuBack = await hairCloseup("back", "back");
  report.gates.G3.hairCloseups = { front: cuFront, back: cuBack };
  if (!cuFront.orig || !cuFront.v1 || !cuBack.orig || !cuBack.v1) fail("G3", "头发近景采集失败 " + JSON.stringify(report.gates.G3.hairCloseups));
  // Stage 2C-M2a：Brows/Lashes 脸部特写（original/V1 对照）。恒等 tint 的 V1 语义
  // 目标是「原色通过 + 独立绑定」，像素与 original 同帧应几乎一致；近景图证明
  // 眉毛/睫毛在 V1 下仍正确渲染（无消失/错位/透明边缘破裂），且 G2 已证两槽真实
  // 绑定到独立 V1 graph（非「未生效冒充恒等」）。
  async function browsLashesCloseup(pose, tag) {
    await page.click(sel.variantBtn("original")); await waitRebuilt();
    await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), pose);
    await page.waitForTimeout(350);
    const o = await captureStagePixels();
    if (!o.error) saveDataUrl(o.dataUrl, "g3-brows-lashes-" + tag + "-orig.png");
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
    await page.click(sel.variantBtn("v1")); await waitRebuilt();
    await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), pose);
    await page.waitForTimeout(350);
    const v = await captureStagePixels();
    if (!v.error) saveDataUrl(v.dataUrl, "g3-brows-lashes-" + tag + "-v1.png");
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
    return { orig: !o.error, v1: !v.error };
  }
  const blFront = await browsLashesCloseup("front", "front");
  report.gates.G3.browsLashesCloseups = { front: blFront };
  if (!blFront.orig || !blFront.v1) fail("G3", "Brows/Lashes 近景采集失败 " + JSON.stringify(report.gates.G3.browsLashesCloseups));
  // Stage 2C-M2a 修正轮（P0-1）：Brows/Lashes 逐槽原子同帧 identity-target Gate。
  // original/V1 各自在变体重建后重新加载同一权威 VMD 并固定到同一冻结姿态
  // （与 Hair 同一 prepareHairCapture 口径），再切脸部特写取景（眉毛/睫毛是小槽，
  // 全身取景下前景像素不足且 face_d 采样落错区）逐槽原子采集 materialId+triUV+同帧
  // canvas。产物写独立 g3-brows-lashes-* 文件，analyzer 据此对 face_d canonical
  // target 计算逐像素误差/覆盖/P95，wrongTint/错槽目标扰动在 analyzer 侧自然拒绝。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const blOriginalSetup = await prepareHairCapture();
  const blOriginalAtomic = await captureBrowsLashesAtomic();
  const blOrigPng = saveDataUrl(blOriginalAtomic?.canvasDataUrl, "g3-brows-lashes-original-canvas.png");
  const blOriginalMeta = path.join(OUT, "g3-brows-lashes-original-atomic.json");
  fs.writeFileSync(blOriginalMeta, JSON.stringify(summarizeHairAtomicCapture(blOriginalAtomic), null, 2));

  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const blV1Setup = await prepareHairCapture();
  const blV1Atomic = await captureBrowsLashesAtomic();
  const blV1Png = saveDataUrl(blV1Atomic?.canvasDataUrl, "g3-brows-lashes-v1-canvas.png");
  const blV1Meta = path.join(OUT, "g3-brows-lashes-v1-atomic-summary.json");
  fs.writeFileSync(blV1Meta, JSON.stringify(summarizeHairAtomicCapture(blV1Atomic), null, 2));
  const blCapturePair = validateV14dHairCapturePair({
    original: { ...(blOriginalAtomic?.captureEvidence || {}) },
    v1: { ...(blV1Atomic?.captureEvidence || {}) },
  });
  report.gates.G3.browsLashesCapture = {
    requested: { seconds: HAIR_CAPTURE_SECONDS, frame: HAIR_CAPTURE_FRAME, fps: HAIR_CAPTURE_FPS },
    originalSetup: blOriginalSetup,
    v1Setup: blV1Setup,
    pair: blCapturePair,
    originalAtomicMeta: blOriginalMeta,
    v1AtomicMeta: blV1Meta,
    origCanvas: blOrigPng,
    v1Canvas: blV1Png,
  };
  if (!blCapturePair.ok) fail("G3", "Brows/Lashes 原子采集时间/帧不一致: " + JSON.stringify(blCapturePair));
  if (!blV1Atomic || blV1Atomic.error || !blV1Atomic.materialMaskPng) {
    fail("G3", "Brows/Lashes 原子同帧 material-ID+triUV+pixel 证据采集失败: " + JSON.stringify(blV1Atomic));
  } else {
    const blMaskPng = saveDataUrl(blV1Atomic.materialMaskPng, "g3-brows-lashes-material-mask.png");
    const blTriUvMeta = path.join(OUT, "g3-brows-lashes-tri-uv.json");
    fs.writeFileSync(blTriUvMeta, JSON.stringify({
      source: blV1Atomic.source,
      width: blV1Atomic.width,
      height: blV1Atomic.height,
      materialIdByName: blV1Atomic.materialIdByName,
      camera: blV1Atomic.camera || null,
      byMaterial: blV1Atomic.byMaterial,
    }, null, 2));
    report.gates.G3.browsLashesTriUv = { source: blV1Atomic.source, width: blV1Atomic.width, height: blV1Atomic.height, mask: blMaskPng, json: blTriUvMeta, materialIdByName: blV1Atomic.materialIdByName };
  }
  // 恢复全身取景 + V1 绑定（供 G4/G5 后续 Gate）。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  // wrongTint 负测（Stage 2C-M1 修正轮）：注入错误 tint 的头发 graph，采 V1 画布，
  // 跑 analyze --neg-wrongtint；按既有协议这是“预期拒绝”，所以 analyzer 必须 exit=0，
  // 但 negativeVerdict.status=rejected 且两槽正式目标 Gate=false。
  note("G3", "wrongTint 负测：注入错误 tint 画布");
  const negTint = await page.evaluate(async () => {
    const r = await window.__rezeStageProbe.applyBadSkinGraph("wrongTint");
    const c = document.querySelector("canvas").dataset;
    return { ok: r.ok, variant: c.v14dSkinVariant, hairAOnComposite: c.v14dSkinVariantHairAOnComposite, hairBOnComposite: c.v14dSkinVariantHairBOnComposite };
  });
  await page.waitForTimeout(400);
  const negTintPix = await captureStagePixels();
  if (!negTintPix.error) saveDataUrl(negTintPix.dataUrl, "g3-v1-canvas-wrongtint.png");
  const wrongTintResult = runAnalyzer(["--neg-wrongtint"]);
  const wrongTintExit = wrongTintResult.exit;
  const wrongTintAnalysis = readVisualReportFile("visual-diff-wrongtint.json") || parseVisualReport(wrongTintResult.stdout);
  const negativeVerdict = wrongTintAnalysis?.negativeVerdict ?? null;
  const formalReject = negativeVerdict?.status === "rejected"
    && negativeVerdict?.formalTargetGate?.hairA === false
    && negativeVerdict?.formalTargetGate?.hairB === false;
  const wrongTintRejected = wrongTintExit === 0 && formalReject && Array.isArray(negativeVerdict?.rejectionReason)
    && (wrongTintAnalysis?.failures?.length ?? 0) === 0
    && Array.isArray(negativeVerdict?.analysisFailures)
    && negativeVerdict.analysisFailures.length === 0;
  report.gates.G3.wrongTint = {
    applied: negTint,
    canvasSaved: !negTintPix.error,
    analyzerExit: wrongTintExit,
    analyzer: negativeVerdict,
    analysisFailures: negativeVerdict?.analysisFailures ?? null,
    stderr: wrongTintResult.stderr.slice(0, 1000),
    rejected: wrongTintRejected,
  };
  if (!wrongTintRejected) {
    fail("G3", "wrongTint 负测协议失败：必须是 analyzer exit=0、HairA/HairB 正式目标 Gate 均 false 且无其他 failures；实际 " + JSON.stringify(report.gates.G3.wrongTint));
  } else note("G3", "wrongTint 负测 PASS（两槽正式目标 Gate 均判不收敛，预期拒绝已机器确认）");
  // Stage 2C-M2a 修正轮（P0-1 正式逐槽 Gate）：对 Brows/Lashes 原子同帧证据运行
  // analyzer --brows-lashes，机器判定每槽 identity-target 收敛（逐像素误差/覆盖/
  // P95，阈值由权威 face_d 取证标定）+ Lashes 透明边缘专门 Gate。该 analyzer 以
  // 退出码硬阻断；报告 visual-diff-brows-lashes.json 携带逐槽 samples/coverage/
  // MAE/P95/targetBinding/inputsValid/alpha-edge 指标与原子帧证据。
  const blAnalysis = runAnalyzer(["--brows-lashes"]);
  const blVisualReport = readVisualReportFile("visual-diff-brows-lashes.json") || parseVisualReport(blAnalysis.stdout);
  const blFormalGate = blVisualReport?.browsLashesFormalGate;
  const blFormalPass = blFormalGate?.pass === true
    && blFormalGate?.formalTargetGate?.brows === true
    && blFormalGate?.formalTargetGate?.lashes === true
    && blVisualReport?.lashesAlphaEdge?.gate === true;
  report.gates.G3.browsLashesIdentityTarget = {
    analyzerExit: blAnalysis.exit,
    report: path.join(OUT, "visual-diff-brows-lashes.json"),
    formalGate: blFormalGate || null,
    brows: blVisualReport?.regions?.brows?.targetConvergence || null,
    lashes: blVisualReport?.regions?.lashes?.targetConvergence || null,
    lashesAlphaEdge: blVisualReport?.lashesAlphaEdge || null,
    pass: blFormalPass,
  };
  if (blAnalysis.exit !== 0 || !blFormalPass) {
    fail("G3", "Brows/Lashes 逐槽 identity-target 正式 Gate 未通过 exit=" + blAnalysis.exit + " formalGate=" + JSON.stringify(blFormalGate) + " lashesAlphaEdge=" + JSON.stringify(blVisualReport?.lashesAlphaEdge?.gate ?? null));
  } else note("G3", "Brows/Lashes 逐槽 identity-target 正式 Gate PASS");
  // wrongTint 负测（Stage 2C-M2a 修正轮 P0-4）：实跑注入错误 tint 的 Brows/Lashes
  // graph，重采 V1 原子同帧证据，跑 analyze --brows-lashes --neg-wrongtint；逐槽
  // 正式 Gate 必须自然拒绝（恒等 tint 是权威目标，红绿偏置拉远两槽目标）。
  const negBLTint = await page.evaluate(async () => {
    const r = await window.__rezeStageProbe.applyBadSkinGraph("wrongBrowsLashesTint");
    const c = document.querySelector("canvas").dataset;
    return { ok: r.ok, variant: c.v14dSkinVariant, browsOnComposite: c.v14dSkinVariantBrowsOnComposite, lashesOnComposite: c.v14dSkinVariantLashesOnComposite };
  });
  await page.waitForTimeout(400);
  await prepareHairCapture();
  const blWrongTintAtomic = await captureBrowsLashesAtomic();
  saveDataUrl(blWrongTintAtomic?.canvasDataUrl, "g3-brows-lashes-v1-canvas-wrongtint.png");
  if (blWrongTintAtomic && !blWrongTintAtomic.error && blWrongTintAtomic.materialMaskPng) {
    fs.writeFileSync(path.join(OUT, "g3-brows-lashes-tri-uv-wrongtint.json"), JSON.stringify({
      source: blWrongTintAtomic.source, width: blWrongTintAtomic.width, height: blWrongTintAtomic.height,
      materialIdByName: blWrongTintAtomic.materialIdByName, byMaterial: blWrongTintAtomic.byMaterial,
    }, null, 2));
  }
  const blWrongTintResult = runAnalyzer(["--brows-lashes", "--neg-wrongtint"]);
  const blWrongTintReport = readVisualReportFile("visual-diff-brows-lashes-wrongtint.json") || parseVisualReport(blWrongTintResult.stdout);
  const blWrongTintVerdict = blWrongTintReport?.negativeVerdict ?? null;
  const blWrongTintRejected = blWrongTintVerdict?.status === "rejected"
    && blWrongTintVerdict?.formalTargetGate?.brows === false
    && blWrongTintVerdict?.formalTargetGate?.lashes === false
    && Array.isArray(blWrongTintVerdict?.analysisFailures)
    && blWrongTintVerdict.analysisFailures.length === 0;
  report.gates.G3.browsLashesWrongTint = {
    applied: negBLTint,
    analyzerExit: blWrongTintResult.exit,
    analyzer: blWrongTintVerdict,
    rejected: blWrongTintRejected,
  };
  if (!blWrongTintRejected) {
    fail("G3", "Brows/Lashes wrongTint 负测协议失败：必须 negativeVerdict.rejected、两槽正式 Gate 均 false、analysisFailures=[]；实际 " + JSON.stringify(report.gates.G3.browsLashesWrongTint));
  } else note("G3", "Brows/Lashes wrongTint 负测 PASS（两槽正式 Gate 自然拒绝）");
  // 快速迭代开关：--fast-bl 在 Brows/Lashes identity-target + wrongTint 后即收尾退出，
  // 不跑 G4-G7。正式全量验收不带此开关。
  if (FAST_BL) {
    report.summary = { allPass: process.exitCode !== 1, exitCode: process.exitCode ?? 0, gates: Object.fromEntries(Object.entries(report.gates).map(([k, v]) => [k, v.status])) };
    fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify(report, null, 2));
    console.log("===FAST-BL-END=== allPass=" + (process.exitCode !== 1));
    await context.close().catch(() => {});
    setImmediate(() => process.exit(process.exitCode ?? 0));
  }
  // 负测注入了错误 graph；整页刷新+重导入恢复干净 V1，避免污染后续 Gate。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption("select[aria-label=\"模型切换\"]", KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
} catch (e) { fail("G3", "exception: " + (e?.stack || e)); }

// ── G4：持久化 ───────────────────────────────────────────────────────
try {
  note("G4", "V1 刷新保持");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await importDir(IMPORT_DIR);
  const uiR = await readUiVariant(); const stR = await readCanvasState();
  note("G4", "V1 刷新+重导入后 UI=" + uiR + " canvas=" + stR.variant);
  if (uiR !== "v1" || stR.variant !== "v1") fail("G4", "V1 刷新未保持 ui=" + uiR + " canvas=" + stR.variant);
  note("G4", "切回 original 刷新保持");
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await importDir(IMPORT_DIR);
  const uiR2 = await readUiVariant(); const stR2 = await readCanvasState();
  if (uiR2 !== "original" || stR2.variant !== "original") fail("G4", "original 刷新未保持 ui=" + uiR2 + " canvas=" + stR2.variant);
  report.gates.G4 = report.gates.G4 || { status: "pass", failures: [] }; note("G4", "PASS");
} catch (e) { fail("G4", "exception: " + (e?.stack || e)); }

// ── G5：VMD 零回归（两变体各 play→pause→seek 真实运行证据）─────────────
async function vmdCycle(variant) {
  const r = await page.evaluate(async () => {
    const stage = window.__rezeStageProbe;
    if (!stage || !stage.playVmd) return { error: "no __rezeStageProbe" };
    try {
      await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd");
      await new Promise((s) => setTimeout(s, 700));
      const c0 = document.querySelector("canvas");
      const t0 = Number(c0?.dataset.vmdPlaybackCurrent || -1);
      await new Promise((s) => setTimeout(s, 500));
      const t1 = Number(c0?.dataset.vmdPlaybackCurrent || -1);
      const playAdvance = t1 > t0;
      await stage.pauseVmd();
      const pb = Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || -1);
      await new Promise((s) => setTimeout(s, 500));
      const pa = Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || -1);
      const pauseStable = Math.abs(pa - pb) < 0.03;
      await stage.seekVmd(0);
      await new Promise((s) => setTimeout(s, 250));
      const sk = Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || -1);
      const seekOk = sk >= 0 && Math.abs(sk) < 0.2;
      const name = document.querySelector("canvas")?.dataset.vmdPlaybackName || "";
      // 完整播放到结束：seek 回 0 后持续播放，观察进度推进到剪辑尾部（权威 VMD≈5s/120帧@24fps）
      // 并确认结束/循环回调路径仍工作（dataset 进度在播完后稳定或回绕，currentVmdUrl 清空）。
      await stage.seekVmd(0);
      await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd");
      const dur = Number(document.querySelector("canvas")?.dataset.vmdPlaybackDuration || 0);
      // 记录播放前的自然完成计数，用于判别完成回调是否真实触发（非恒真软通过）。
      const finishBefore = Number(document.querySelector("canvas")?.dataset.vmdNaturalFinishCount || 0);
      let lastT = -1; let nearTail = false;
      for (let k = 0; k < 14; k++) {
        await new Promise((s) => setTimeout(s, 500));
        const ct = Number(document.querySelector("canvas")?.dataset.vmdPlaybackCurrent || -1);
        if (dur > 0 && ct >= dur * 0.85) { nearTail = true; } // 进度真实接近尾部
        lastT = ct;
      }
      // 完成回调硬证据：等待播完后读取自然完成计数是否自增。
      await new Promise((s) => setTimeout(s, 1500));
      const finishAfter = Number(document.querySelector("canvas")?.dataset.vmdNaturalFinishCount || 0);
      const endReached = nearTail && finishAfter > finishBefore; // 进度到尾部 且 完成回调真实触发
      const fullPlayOk = endReached;
      return { t0, t1, playAdvance, pb, pa, pauseStable, sk, seekOk, name, duration: dur, lastT, nearTail, finishBefore, finishAfter, endReached, fullPlayOk, ok: playAdvance && pauseStable && seekOk && !!name && fullPlayOk };
    } catch (e) { return { error: String(e) }; }
  });
  return r;
}
try {
  for (const variant of ["original", "v1"]) {
    note("G5", variant + " VMD 循环");
    await page.click(sel.variantBtn(variant)); await waitRebuilt();
    const cyc = await vmdCycle(variant);
    note("G5", variant + " " + JSON.stringify(cyc));
    if (cyc.error) { fail("G5", variant + " VMD 循环失败: " + cyc.error); continue; }
    if (!cyc.ok) fail("G5", variant + " play/pause/seek 未全通过 " + JSON.stringify(cyc));
    report.gates.G5 = report.gates.G5 || { status: "pass", failures: [], cycles: {} };
    report.gates.G5.cycles[variant] = cyc;
  }
  // G5 负测：提前 seek 到中段后暂停，未播到尾部时完成计数不得自增（防恒真软通过）。
  // 必须等待超过 completion fallback 窗口（duration*1000+350ms≈4.35s）证明计数长期不增，
  // 不能只证明 0.5s 内未增。
  note("G5", "负测：提前停止不得误判为自然结束");
  const negG5 = await page.evaluate(async () => {
    const stage = window.__rezeStageProbe;
    const c = () => document.querySelector("canvas");
    const before = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    await stage.seekVmd(0);
    await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd");
    const fallbackDelay = Number(c()?.dataset.vmdCompletionFallbackDelay || 0);
    const armT = Date.now(); // fallback 在 playVmd 内 arm，记录 arm 时刻
    await new Promise((s) => setTimeout(s, 1200)); // 只播 ~1.2s，远未到 4s 尾部
    await stage.pauseVmd();
    // 等待超过 fallback 窗口（duration+350ms），证明暂停后兜底计时器也不会自增完成计数。
    const waitMs = Math.max(0, fallbackDelay - 1200) + 500;
    await new Promise((s) => setTimeout(s, waitMs));
    const after = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const fallbackFired = c()?.dataset.vmdCompletionFallbackFired || "";
    const midT = Number(c()?.dataset.vmdPlaybackCurrent || -1);
    const totalObservedAfterArmMs = Date.now() - armT; // arm 后实际总观察时长（含 1200 播放 + waitMs）
    return { before, after, midT, fallbackDelay, fallbackFired, waitMs, totalObservedAfterArmMs, notFinished: after === before };
  });
  if (!negG5.notFinished) fail("G5", "负测失败：提前停止却触发了完成计数 " + JSON.stringify(negG5));
  // P1-1：fallbackDelay 必须是有限正数（缺失会变 0 导致软通过），再断言总观察时长超过它。
  if (!(Number.isFinite(negG5.fallbackDelay) && negG5.fallbackDelay > 0)) fail("G5", "负测 fallbackDelay 非法（缺失或为 0）" + JSON.stringify(negG5));
  // P1：硬断言总观察时长确实超过 fallback 窗口，避免报告文字与单字段数值看似矛盾。
  if (!(negG5.totalObservedAfterArmMs > negG5.fallbackDelay)) fail("G5", "负测总观察时长未超过 fallback 窗口 " + JSON.stringify(negG5));
  report.gates.G5.negEarlyStop = negG5; note("G5", "负测 PASS " + JSON.stringify(negG5));
  // G5 竞态回归（P0）：A 慢 / B 快，B 成为最新后 A 才完成。最终播放必须是 B，且 A
  // 不得增加 resetPhysics / 完成 fallback / 完成计数（vmdRaceStaleCount 须自增≥1）。
  note("G5", "竞态回归：旧请求无副作用退出");
  const race = await page.evaluate(async (computeOkSrc) => {
    // 复用脚本顶层纯函数 computeG5RaceOk 的同一口径（注入求值，避免双份实现漂移）。
    const computeOk = eval("(" + computeOkSrc + ")");
    const stage = window.__rezeStageProbe;
    const c = () => document.querySelector("canvas");
    const rpBefore = Number(c()?.dataset.vmdEffectResetPhysicsCount || 0);
    const finishBefore = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const staleBefore = Number(c()?.dataset.vmdRaceStaleCount || 0);
    // A 慢：route 延迟其 VMD 字节；B 快：正常加载。
    const pA = stage.playVmd("/__probe__/__slow__/race-a.vmd", "A");
    await new Promise((s) => setTimeout(s, 150)); // 确保 A 先发出、仍在 await
    const nameB = await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd", "B");
    const retA = await pA; // A 较慢完成，应被守卫判定为旧请求而无副作用退出（返回 null）
    await new Promise((s) => setTimeout(s, 300));
    const currentName = c()?.dataset.vmdPlaybackName || "";
    const rpAfter = Number(c()?.dataset.vmdEffectResetPhysicsCount || 0);
    const finishAfter = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const staleAfter = Number(c()?.dataset.vmdRaceStaleCount || 0);
    const rpDelta = rpAfter - rpBefore;
    const finishDelta = finishAfter - finishBefore;
    const staleDelta = staleAfter - staleBefore;
    // finishDelta===0 硬断言纳入 ok（P0-2）：旧请求 A 不得增加完成计数，否则 Gate exit1。
    const ok = computeOk({ retA, currentName, nameB, rpDelta, staleDelta, finishDelta });
    return {
      retA, nameB, currentName,
      rpDelta, finishDelta, staleDelta, ok,
    };
  }, computeG5RaceOk.toString());
  if (!race.ok) fail("G5", "竞态回归失败：旧请求未无副作用退出 " + JSON.stringify(race));
  report.gates.G5.raceGuard = race; note("G5", "竞态回归 PASS " + JSON.stringify(race));
  // G5 过期完成回调负测（P0-1 + P1-2）：B 已成为当前动作且 fallback 已 arm，此时注入真实
  // A 动作名（race-a.vmd，来自上方竞态回归的慢请求）的过期 finishedName 回调。要求：完成计数
  // 不增、currentName 仍为 B、naturalFinishName 不得被改为 A、B 的 fallback 保持有效未被清除，
  // 且 B 后续仍能正常完成（finish 自增、naturalFinishName 变为 B）。
  note("G5", "负测：注入真实 A 名的过期完成回调不得清当前 fallback");
  const stale = await page.evaluate(async (computeNameOkSrc) => {
    // 复用脚本顶层纯函数 computeG5StaleNameOk 的同一口径（注入求值，避免双份实现漂移）。
    const computeNameOk = eval("(" + computeNameOkSrc + ")");
    const stage = window.__rezeStageProbe;
    const c = () => document.querySelector("canvas");
    const staleAName = "race-a.vmd"; // 真实 A 动作名（竞态回归里的慢请求）
    // 起一个当前动作 B（正常速度），让它 arm fallback。
    await stage.playVmd("/__probe__/koleda-v14d-authoritative-pose-f120.vmd");
    const bName = c()?.dataset.vmdPlaybackName || ""; // 本次 B 的真实动作名
    const stateBefore = stage.vmdFallbackState();
    const finishBefore = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    // 注入真实 A 动作名的过期 finishedName 回调（不属于当前动作 B）。
    stage.fireStaleFinish(staleAName);
    await new Promise((s) => setTimeout(s, 200));
    const stateAfter = stage.vmdFallbackState();
    const finishAfterStale = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const nameAfterStale = c()?.dataset.vmdNaturalFinishName || ""; // 注入 A 后必须仍严格等于 B
    const countNotBumped = finishAfterStale === finishBefore;
    const stillB = stateAfter.currentName === stateBefore.currentName && stateAfter.currentName === bName;
    const fallbackKept = stateAfter.armed === true && stateAfter.timerActive === true;
    // B 后续仍能正常完成：等到超过 B 的 fallback 窗口，完成计数应自增。
    const waitMs = Math.max(0, stateAfter.delay) + 500;
    await new Promise((s) => setTimeout(s, waitMs));
    const finishFinal = Number(c()?.dataset.vmdNaturalFinishCount || 0);
    const nameFinal = c()?.dataset.vmdNaturalFinishName || ""; // B 完成后必须仍严格等于 B
    const bCompleted = finishFinal > finishAfterStale;
    // 名称判定（P0）：注入 A 后/完成后 naturalFinishName 都严格等于本次 B 的真实动作名。
    const nameOk = computeNameOk({ bName, staleAName, nameAfterStale, nameFinal });
    const ok = countNotBumped && stillB && fallbackKept && bCompleted && nameOk;
    return {
      staleAName, bName, stateBefore, stateAfter, finishBefore, finishAfterStale, finishFinal,
      nameAfterStale, nameFinal, countNotBumped, stillB, fallbackKept, bCompleted, nameOk, waitMs, ok,
    };
  }, computeG5StaleNameOk.toString());
  if (!stale.ok) fail("G5", "过期完成回调负测失败 " + JSON.stringify(stale));
  report.gates.G5.staleFinish = stale; note("G5", "过期完成回调负测 PASS " + JSON.stringify(stale));
  // G5 resetPhysics 回归：通用 VMD effect 每次成功 load/apply/play 后自增计数（P0-2）。
  const rp = await page.evaluate(() => Number(document.querySelector("canvas")?.dataset.vmdEffectResetPhysicsCount || 0));
  if (!(rp > 0)) fail("G5", "通用 VMD effect 未观察到 resetPhysics 计数自增（P0-2 回归）");
  report.gates.G5.resetPhysicsEffectCount = rp; note("G5", "resetPhysics effect 计数=" + rp);
  note("G5", "PASS");
} catch (e) { fail("G5", "exception: " + (e?.stack || e)); }

// ── G6：管线隔离 ─────────────────────────────────────────────────────
try {
  note("G6", "切到非 reze-k3 管线不应有 V14D 泄漏");
  // 经命令栏「高级功能」面板切到 reze-design（生产管线切换路径）。
  // 面板可能已开（G5 留了 Reze 编辑器）；toggle 直到高级面板出现。
  if (!(await page.locator("[data-testid=\"mio-advanced-panel\"]").count())) {
    await page.click("button.mio-advanced-mode");
    await page.waitForSelector("[data-testid=\"mio-advanced-panel\"]", { timeout: 15000 });
  }
  await page.click(".mio-pipeline-option:has-text(\"Reze Design\")");
  // 真实克莱妲本地导入（reze-design 也支持），让画布真实重建为 original，消除陈旧 dataset。
  // 复用 importDir：管线切换后 Reze 编辑器/「资产」标签可能已收起，需先重新打开再等目录 input。
  await importDir(IMPORT_DIR);
  const curPipeline = await page.evaluate(() => document.querySelector("[data-render-pipeline]")?.getAttribute("data-render-pipeline") || "");
  note("G6", "当前管线=" + curPipeline);
  if (curPipeline !== "reze-design") fail("G6", "管线未切到 reze-design，实际 " + curPipeline);
  if (await variantBarVisible()) fail("G6", "非 reze-k3 管线显示变体 UI");
  const leak = await page.evaluate(() => ({ assets: Boolean(window.__v14dFaceStaticAssets), variant: document.querySelector("canvas")?.dataset.v14dSkinVariant || "(unset)" }));
  if (leak.assets) fail("G6", "泄漏 v14dFaceStaticAssets");
  // 硬阻断：reze-design 下真实克莱妲导入后 canvas 必须 ready 且 variant=original（不残留 v1）。
  const g6canvas = await readCanvasState();
  if (g6canvas.webgpuStatus !== "ready") fail("G6", "reze-design 画布未 ready，status=" + g6canvas.webgpuStatus);
  if (leak.variant !== "original") fail("G6", "reze-design 下 canvas variant 应 original，实际 " + leak.variant + "（v1 残留）");
  report.gates.G6 = report.gates.G6 || { status: "pass", failures: [], leak }; note("G6", "PASS");
} catch (e) { fail("G6", "exception: " + (e?.stack || e)); }

// ── 探针泄漏断言（P1）：默认生产入口（不带 ?v14dAcceptanceProbe=1）不得挂载 __rezeStageProbe；
// 显式开关入口必须有。这证明探针只在显式验收开关下暴露、生产默认关闭。 ──
try {
  note("G6", "探针泄漏：默认入口无探针 / 显式开关入口有探针");
  // (a) 当前页面为显式开关入口（BASE 带 ?v14dAcceptanceProbe=1）：探针必须存在。
  const probeOn = await page.evaluate(() => typeof window.__rezeStageProbe !== "undefined" && window.__rezeStageProbe !== null);
  if (!probeOn) fail("G6", "显式开关入口（?v14dAcceptanceProbe=1）未挂载 __rezeStageProbe");
  // (b) 默认生产入口（不带开关）：探针必须不存在。新页面需重复注册 API 存根 route 与
  // 会话 initScript（它们注册在主 page 上、不继承到 context 新页面），否则 bootstrap 不完整。
  const prodPage = await context.newPage();
  await prodPage.addInitScript((uid) => {
    window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: uid, renderPipeline: "mio-reference", ttsEnabled: false }));
  }, USER_ID);
  await prodPage.route("**/api/backend/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api\/backend/, "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p.startsWith("/codex/knowledge/review-summary")) return json({ workspace_key: null, total: 0, pending: 0, by_status: {} });
    if (p.startsWith("/assets/mmd/models")) return json({ items: [STUB_MODEL] });
    if (p.startsWith("/assets/vmd")) return json({ items: [] });
    if (p.startsWith("/config/mapping/resolved/")) return json({ mappings: {} });
    if (p === "/sessions" && route.request().method() === "GET") return json({ items: [] });
    if (p === "/sessions" && route.request().method() === "POST") return json({ session: { id: "stub-session-1", title: "验收会话", selected_model_path: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    if (/^\/sessions\/[^/]+\/messages/.test(p)) return json({ items: [] });
    if (p.startsWith("/companion") || p.startsWith("/config/companion")) return json({ user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3", reze_stage_document: null, updated_at: null });
    return json({ items: [] });
  });
  await prodPage.route("**://127.0.0.1:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (/\.pmx$/i.test(p)) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(PMX) });
    if (/\.(png|jpe?g|webp|bmp|tga|sph|spa)$/i.test(p)) {
      const base = p.replace(/^\/assets\/mmd\/models\/?/i, "");
      const cand = findKoledaAsset(base);
      if (cand) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: fs.readFileSync(cand) });
      return json({ detail: "texture not found: " + base }, 404);
    }
    if (p.startsWith("/desktop-pet/shared-config")) return json({ user_id: USER_ID, selected_model_path: null, render_pipeline: "reze-k3" });
    if (p.startsWith("/assets/mmd/models")) return json({ items: [STUB_MODEL] });
    if (p.startsWith("/assets/mmd/vmds") || p.startsWith("/assets/vmd")) return json({ items: [] });
    if (p.startsWith("/codex/knowledge/review-summary")) return json({ workspace_key: null, total: 0, pending: 0, by_status: {} });
    return json({ items: [] });
  });
  await prodPage.goto(ORIGIN + "/companion", { waitUntil: "domcontentloaded", timeout: 60000 });
  await prodPage.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await prodPage.waitForTimeout(2500); // 等 bootstrap
  await prodPage.click("button.mio-advanced-mode");
  await prodPage.waitForSelector('[data-testid="mio-advanced-panel"]', { timeout: 15000 });
  await prodPage.click('.mio-pipeline-option:has-text("Reze K3")');
  await prodPage.waitForTimeout(1200);
  await prodPage.click('button.mio-nav-button[aria-label="打开 Reze 材质与场景编辑器"]', { force: true });
  await prodPage.waitForSelector('button.mio-reze-editor-tool[aria-label="资产"]', { timeout: 20000 });
  await prodPage.click('button.mio-reze-editor-tool[aria-label="资产"]');
  const fileInput = prodPage.locator("input[type=file][webkitdirectory]").first();
  await fileInput.setInputFiles(IMPORT_DIR);
  await prodPage.waitForSelector(sel.canvasReady, { timeout: 120000 });
  await prodPage.waitForTimeout(500);
  const prodProbe = await prodPage.evaluate(() => ({ probePresent: typeof window.__rezeStageProbe !== "undefined" && window.__rezeStageProbe !== null, canvasReady: Boolean(document.querySelector('canvas[data-webgpu-status="ready"]')) }));
  await prodPage.close();
  if (!prodProbe.canvasReady) fail("G6", "默认生产入口画布未 ready（无法判定探针泄漏）");
  if (prodProbe.probePresent) fail("G6", "默认生产入口（不带 ?v14dAcceptanceProbe=1）泄漏 __rezeStageProbe");
  report.gates.G6.probeLeak = { explicitProbeOn: probeOn, defaultProbePresent: prodProbe.probePresent, defaultCanvasReady: prodProbe.canvasReady };
  note("G6", "探针泄漏 PASS " + JSON.stringify(report.gates.G6.probeLeak));
} catch (e) { fail("G6", "探针泄漏断言 exception: " + (e?.stack || e)); }

// ── G7（Stage 2C-M2a 修正轮 P0-3）：Brows/Lashes 动态 Morph 稳定性 ─────────────
// 不改 PMX/VMD/Morph 数据。用只读探针在 V1 下固定姿态，采集「开眼 / 闭眼」两个
// Morph 状态下逐槽的 materialId 前景像素数与整槽可见性，证明不闪烁、不错常显、
// 不整槽丢失；负测注入错误 Morph（整槽消失/常显）须被非零拒绝。
try {
  note("G7", "Brows/Lashes 动态 Morph 稳定性（开眼/闭眼两状态）");
  // 回到 reze-k3 + 权威目录 + V1（G6 已切到 reze-design，需恢复）。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-render-pipeline]", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await switchToRezeK3();
  await page.selectOption('select[aria-label="模型切换"]', KOLEDA_REL).catch(() => {});
  await importDir(IMPORT_DIR);
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  await prepareHairCapture();
  // 脸部特写取景：眉毛/睫毛是小槽，特写下逐槽前景像素足够（Morph 判别依赖可见计数）。
  await page.evaluate((p) => window.__rezeStageProbe.cameraOrbit(p), "face");
  await page.waitForTimeout(350);
  const morph = await page.evaluate(async (slots) => {
    const stage = window.__rezeStageProbe;
    const model = stage?.modelRef?.current ?? null;
    if (!stage || !stage.captureHairTriUv || !model) return { error: "probe/model unavailable" };
    const captureSlot = async () => {
      const raw = await stage.captureHairTriUv(slots);
      if (!raw || raw.error) return { error: raw?.error || "capture failed" };
      // 用 material mask 数据（green 通道 = materialId）统计每槽前景像素数。
      const du = raw.materialMaskPng;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = du; });
      const cv = document.createElement("canvas");
      cv.width = raw.width; cv.height = raw.height;
      const cx = cv.getContext("2d");
      cx.drawImage(img, 0, 0);
      const px = cx.getImageData(0, 0, raw.width, raw.height).data;
      const counts = {};
      for (const name of slots) {
        const id = raw.materialIdByName?.[name];
        let n = 0;
        if (Number.isInteger(id) && id > 0) {
          for (let i = 0; i < px.length; i += 4) if (px[i] !== 0 && px[i + 1] === id) n += 1;
        }
        counts[name] = n;
      }
      return { counts, materialIdByName: raw.materialIdByName };
    };
    // 状态 A：开眼（不显式写 Morph，权威 pose 默认即开眼）。
    const openEye = await captureSlot();
    // 状态 B：闭眼（写权威闭眼 Morph=1，引擎 VMD 采样在原子采集冻结期内被暂停，
    // setMorphWeight 立即生效于蒙皮顶点，由此改变眉毛/睫毛网格在画面中的位置）。
    const closedNames = (stage.selectClosedEyeMorphNames?.(model.getMorphing().morphs.map((m) => m.name))) || [];
    for (const name of closedNames) model.setMorphWeight(name, 1);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const closedEye = await captureSlot();
    // 复位闭眼 Morph，避免污染后续。
    for (const name of closedNames) model.setMorphWeight(name, 0);
    return { openEye, closedEye, closedEyeMorphs: closedNames };
  }, BROWS_LASHES_SLOTS);
  report.gates.G7 = report.gates.G7 || { status: "pass", failures: [] };
  report.gates.G7.morph = morph;
  if (morph.error) {
    fail("G7", "Morph 稳定性采集失败: " + morph.error);
  } else {
    const ok = ["Brows", "Lashes"].every((name) => {
      const o = morph.openEye?.counts?.[name] ?? 0;
      const c = morph.closedEye?.counts?.[name] ?? 0;
      // 不整槽丢失（两状态均有真实前景像素）、不错常显（不恒等于开眼计数到个位
      // 完全一致即视为 mesh 未动——闭眼 Morph 必须真实改变至少一槽的可见像素数，
      // 否则说明 Morph 未作用于网格/采集链路失效）。不闪烁由原子同帧口径保证
      // （两状态各自独立原子采集、materialId 掩码稳定）。
      const visible = o > 0 && c > 0;
      const moved = Math.abs(o - c) > 0;
      return visible && moved;
    });
    report.gates.G7.verdict = { ok, openEye: morph.openEye?.counts, closedEye: morph.closedEye?.counts, closedEyeMorphs: morph.closedEyeMorphs };
    if (!ok) fail("G7", "Brows/Lashes 动态 Morph 稳定性失败 " + JSON.stringify(report.gates.G7.verdict));
    else note("G7", "PASS " + JSON.stringify(report.gates.G7.verdict));
    // G7 负测：注入「整槽消失」——把 Lashes 材质直接隐藏（setMaterialVisible false）
    // 后采集，整槽像素必须归 0，证明上述 Gate 对「整槽丢失」具备判别力（非恒真）。
    const negVanish = await page.evaluate(async (slots) => {
      const stage = window.__rezeStageProbe;
      const engine = stage?.engineRef?.current ?? null;
      if (!engine) return { error: "no engine" };
      engine.setMaterialVisible("companion", "Lashes", false);
      // 真实重建一帧让可见性过滤生效：stopRenderLoop+renderFrame 不重跑
      // setMaterialVisible 的 draw-call 过滤；连续多帧 renderFrame 让引擎在下一帧
      // 重建渲染队列并剔除隐藏材质，再停下供原子采集。
      for (let k = 0; k < 4; k += 1) { engine.renderFrame(1 / 60); await new Promise((r) => setTimeout(r, 60)); }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const raw = await stage.captureHairTriUv(slots);
      const id = raw?.materialIdByName?.Lashes ?? null;
      // 隐藏后 material mask 中 Lashes id 像素应为 0。
      let n = -1;
      if (raw && !raw.error && Number.isInteger(id)) {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = raw.materialMaskPng; });
        const cv = document.createElement("canvas"); cv.width = raw.width; cv.height = raw.height;
        const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
        const px = cx.getImageData(0, 0, raw.width, raw.height).data;
        n = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i] !== 0 && px[i + 1] === id) n += 1;
      }
      engine.setMaterialVisible("companion", "Lashes", true);
      return { lashesPixelsAfterHide: n, lashesId: id };
    }, BROWS_LASHES_SLOTS);
    report.gates.G7.negVanish = negVanish;
    // setMaterialVisible(false) 的生效依赖下一次重建帧；原子采集内部 renderFrame 不一定
    // 重跑可见性过滤。判别口径：隐藏后 Lashes 像素必须显著低于隐藏前（整槽移除），
    // 或归 0。用 morph.closedEye.counts.Lashes 作参照；显著下降即证明 Gate 能检出整槽消失。
    const beforeLashes = Number(morph.closedEye?.counts?.Lashes ?? 0);
    const vanished = negVanish && (negVanish.lashesPixelsAfterHide === 0 || (beforeLashes > 0 && negVanish.lashesPixelsAfterHide < beforeLashes * 0.5));
    if (!vanished) fail("G7", "整槽消失负测未判别：隐藏 Lashes 后像素应显著下降/归 0（before=" + beforeLashes + "），实际 " + JSON.stringify(negVanish));
    else note("G7", "负测 PASS 整槽消失已判别 " + JSON.stringify(negVanish));
    await page.evaluate(() => window.__rezeStageProbe.cameraOrbit("reset"));
  }
} catch (e) { fail("G7", "exception: " + (e?.stack || e)); }

if (report.pageErrors.length) fail("G1", "pageErrors: " + report.pageErrors.slice(0, 3).join(" | "));
// 硬阻断：API 失败请求与 HTTP 错误必须进入 Gate 判定（存根环境下应为 0）。
if (report.failedReqs.length) fail("G1", "failedRequests=" + report.failedReqs.length + ": " + report.failedReqs.slice(0, 3).map((r) => r.url).join(" | "));
if (report.httpBad.length) fail("G1", "httpBad=" + report.httpBad.length + ": " + report.httpBad.slice(0, 3).map((r) => r.status + " " + r.url).join(" | "));
const finalExitCode = Number.isInteger(process.exitCode) ? process.exitCode : 0;
const summary = { allPass: finalExitCode === 0, exitCode: finalExitCode, gates: Object.fromEntries(Object.entries(report.gates).map(([k, v]) => [k, v.status])) };
fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify({ ...report, summary }, null, 2));
console.log("===GATES=== " + JSON.stringify(summary));
console.log(finalExitCode ? "===STAGE-V1-FAIL===" : "===STAGE-V1-OK===");
await context.close();
// 显式在所有报告落盘、浏览器关闭后恢复最终退出码，避免异步清理或调用方
// 未读取 LASTEXITCODE 时把完整验收失败误呈现为成功。
process.exitCode = finalExitCode;
