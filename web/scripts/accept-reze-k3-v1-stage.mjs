// Reze K3 V1（V14D）真实舞台视觉与 VMD 验收（票据 reze-k3-v1-stage-visual-acceptance）。
// 在真实生产 /companion（非 /mmd-calibration-render）端到端验收「原始 Reze K3 / V1」切换。
// 覆盖 G1-G6；任一硬断言失败 exitCode=1。报告写 .scratch/reze-k3-v1-stage/gate-report.json。
import { chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.V14D_CAPTURE_ORIGIN || "http://127.0.0.1:3114";
const BASE = ORIGIN + "/companion?v14dAcceptanceProbe=1";
const OUT = path.resolve(".scratch/reze-k3-v1-stage");
fs.mkdirSync(OUT, { recursive: true });

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

const report = { origin: ORIGIN, base: BASE, assets: { pmx: PMX, vmd: VMD, mask: STATE2_MASK, maskSha256: sha256(STATE2_MASK), vmdSha256: fs.existsSync(VMD) ? sha256(VMD) : null }, gates: {}, pageErrors: [], httpBad: [], failedReqs: [], screenshots: {} };
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
    return { webgpuStatus: d.webgpuStatus || "", variant: d.v14dSkinVariant || "(unset)", faceGraph: d.v14dSkinVariantFaceGraph || "", faceDrawCalls: d.v14dSkinVariantFaceDrawCalls || "", faceOnComposite: d.v14dSkinVariantFaceOnComposite || "", bodyDrawCalls: d.v14dSkinVariantBodyDrawCalls || "", bodyOnComposite: d.v14dSkinVariantBodyOnComposite || "", hairADrawCalls: d.v14dSkinVariantHairADrawCalls || "", hairAOnComposite: d.v14dSkinVariantHairAOnComposite || "", hairBDrawCalls: d.v14dSkinVariantHairBDrawCalls || "", hairBOnComposite: d.v14dSkinVariantHairBOnComposite || "", idMismatch: d.v14dSkinVariantIdentifierMismatch || "", vmdName: d.vmdPlaybackName || "", vmdCurrent: d.vmdPlaybackCurrent || "", vmdDuration: d.vmdPlaybackDuration || "", vmdPlaying: d.vmdPlaybackPlaying || "" };
  });
}
async function readUiVariant() { return page.evaluate(() => { const a = document.querySelector("[data-testid=\"reze-k3-skin-variant-bar\"] .mio-pipeline-option.is-active"); return a ? a.getAttribute("data-testid").replace("reze-k3-skin-variant-", "") : null; }); }
async function variantBarVisible() { const n = await page.locator(sel.variantBar).count(); if (!n) return false; return page.locator(sel.variantBar).first().isVisible(); }
async function shot(name) { const f = path.join(OUT, name + ".png"); await page.screenshot({ path: f }); report.screenshots[name] = f; return f; }
async function captureStagePixels() { return page.evaluate(() => { const c = document.querySelector("canvas"); if (!c) return { error: "no canvas" }; try { return { dataUrl: c.toDataURL("image/png"), width: c.width, height: c.height }; } catch (e) { return { error: String(e) }; } }); }
function saveDataUrl(du, name) { if (!du || !du.startsWith("data:image/png")) return null; const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(du.split(",")[1], "base64")); report.screenshots[name.replace(/\.png$/, "")] = f; return f; }

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
  note("G2", "PASS");
} catch (e) { fail("G2", "exception: " + (e?.stack || e)); }

// ── G3：完整模型视觉 A/B（original/V1 画布像素）─────────────────────────
try {
  note("G3", "采集 original/V1 画布像素 A/B");
  // G2 末尾已整页刷新+重导入权威目录并恢复 V1 绑定，变体条已出现；此处不再重复 importDir
  //（重复导入会触发重建使变体条暂时不可点击）。直接切 original→V1 采 A/B。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  const sceneOrig = await page.evaluate(() => window.__rezeStageProbe?.sceneSnapshot?.() || null);
  const origPix = await captureStagePixels(); await shot("g3-original-full");
  // 同变体连拍（Stage 2C-M1 噪声基线）：original 再采一帧，用于把「original↔V1 的
  // 衣服/装备差异」与「同变体待机微动帧间噪声」区分，避免把微动误判为材质泄漏。
  const origPix2 = await captureStagePixels();
  if (!origPix2.error) saveDataUrl(origPix2.dataUrl, "g3-original-canvas-b.png");
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  const sceneV1 = await page.evaluate(() => window.__rezeStageProbe?.sceneSnapshot?.() || null);
  const v1Pix = await captureStagePixels(); await shot("g3-v1-full");
  if (origPix.error || v1Pix.error) fail("G3", "画布像素捕获失败 " + (origPix.error || v1Pix.error));
 const oPng = saveDataUrl(origPix.dataUrl, "g3-original-canvas.png");
 const vPng = saveDataUrl(v1Pix.dataUrl, "g3-v1-canvas.png");
 report.gates.G3 = report.gates.G3 || { status: "pass", failures: [] };
 report.gates.G3.canvasSize = { width: v1Pix.width, height: v1Pix.height };
 report.gates.G3.origCanvas = oPng; report.gates.G3.v1Canvas = vPng;
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
 // 硬阻断：区域差异分析以退出码判定（皮肤收敛 + 非皮肤/背景稳定），不允许只算 verdict 强过。
 const { execSync } = await import("node:child_process");
 try {
   execSync("node scripts/analyze-reze-k3-v1-diff.mjs", { cwd: process.cwd(), stdio: "pipe" });
   note("G3", "区域差异硬阻断 PASS");
 } catch (err) {
   fail("G3", "区域差异分析硬阻断失败: " + (err.stdout || err.message || err).toString().slice(0, 400));
 }
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
  // 恢复全身取景 + V1 绑定（供 G4/G5 后续 Gate）。
  await page.click(sel.variantBtn("original")); await waitRebuilt();
  await page.click(sel.variantBtn("v1")); await waitRebuilt();
  // wrongTint 负测（Stage 2C-M1 修正轮）：注入错误青绿 tint 的头发 graph，采 V1 画布，
  // 跑 analyze --neg-wrongtint；同一收敛 Gate 必须非零退出（错误颜色被判不收敛）。
  note("G3", "wrongTint 负测：注入错误 tint 画布");
  const negTint = await page.evaluate(async () => {
    const r = await window.__rezeStageProbe.applyBadSkinGraph("wrongTint");
    const c = document.querySelector("canvas").dataset;
    return { ok: r.ok, variant: c.v14dSkinVariant, hairAOnComposite: c.v14dSkinVariantHairAOnComposite, hairBOnComposite: c.v14dSkinVariantHairBOnComposite };
  });
  await page.waitForTimeout(400);
  const negTintPix = await captureStagePixels();
  if (!negTintPix.error) saveDataUrl(negTintPix.dataUrl, "g3-v1-canvas-wrongtint.png");
  let wrongTintRejected = false;
  try {
    execSync("node scripts/analyze-reze-k3-v1-diff.mjs --neg-wrongtint", { cwd: process.cwd(), stdio: "pipe" });
  } catch { wrongTintRejected = true; }
  report.gates.G3.wrongTint = { applied: negTint, canvasSaved: !negTintPix.error, rejected: wrongTintRejected };
  if (!wrongTintRejected) fail("G3", "wrongTint 负测失效：错误 tint 未被收敛 Gate 拒绝 " + JSON.stringify(negTint));
  else note("G3", "wrongTint 负测 PASS（错误颜色被收敛 Gate 非零拒绝）");
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

if (report.pageErrors.length) fail("G1", "pageErrors: " + report.pageErrors.slice(0, 3).join(" | "));
// 硬阻断：API 失败请求与 HTTP 错误必须进入 Gate 判定（存根环境下应为 0）。
if (report.failedReqs.length) fail("G1", "failedRequests=" + report.failedReqs.length + ": " + report.failedReqs.slice(0, 3).map((r) => r.url).join(" | "));
if (report.httpBad.length) fail("G1", "httpBad=" + report.httpBad.length + ": " + report.httpBad.slice(0, 3).map((r) => r.status + " " + r.url).join(" | "));
const summary = { allPass: !process.exitCode, gates: Object.fromEntries(Object.entries(report.gates).map(([k, v]) => [k, v.status])) };
fs.writeFileSync(path.join(OUT, "gate-report.json"), JSON.stringify({ ...report, summary }, null, 2));
console.log("===GATES=== " + JSON.stringify(summary));
console.log(process.exitCode ? "===STAGE-V1-FAIL===" : "===STAGE-V1-OK===");
await context.close();
