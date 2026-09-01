/**
 * 幂等修补 node_modules/reze-engine 的 PMX 文本长度上限。
 *
 * 第二处补丁：给 files 版 Engine.loadModel 增加默认关闭的 materialDiffuseOverrides
 * （材质名 → 唯一 logicalPath）。在 PmxLoader.loadFromReader() 之后、
 * addModel()/setupMaterialsForInstance()（GPU 纹理上传与 bind group 建立）之前，
 * 为每个目标材质**追加独立 texture entry 并改 diffuseTextureIndex**。这才是真实
 * GPU 绑定：修正此前在 loadModel 返回后才改 tex.path（不会重传 GPUTexture/重建
 * bind group）的伪绑定。不改磁盘 PMX、材质槽、拓扑或 VMD。
 *
 * 背景：上游 0.26.0 在 getText() 里有 1000 字节的任意防御上限（"Suspicious
 * string length"）。合法 PMX 的模型备注（如「克莱妲原皮」英文备注 1006 字节）
 * 会触发该上限，导致整个模型加载失败、WebGPU 舞台空白。Three.js MMDLoader 无
 * 此限制。这里移除该上限，保留真正的越界检查。
 *
 * 每次 dev/build 前由 predev/prebuild 钩子执行；npm install 重装依赖后也会
 * 自动重打。幂等：已打过则跳过。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// ─── --self-test 早退分流（必须在任何真实 node_modules 写入/patch target 遍历/strict verify 之前）───
// 本块自包含、只操作临时目录：构造干净 reze-engine 0.26.0 隔离 fixture，
// 用子进程调用同一脚本文件（重写 rootDir 指向临时 fixture）跑真实生产控制流，
// 验证首次注入/二次幂等/anchor-miss 负测；真实 web/node_modules 前后 SHA256 不变自证不触碰。
if (process.argv.includes("--self-test")) {
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const sha = (fp) => createHash("sha256").update(fs.readFileSync(fp)).digest("hex");
  const realRoot = rootDir;
  const selfSrc = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const fails = [];
  const ok = (c, m) => { if (c) console.log("[self-test ok] " + m); else { fails.push(m); console.error("[self-test FAIL] " + m); } };
  // 真实 node_modules 关键文件前后 SHA256（证明本自测不触碰真实依赖）。
  const realKeyFiles = ["src/graph/slots.ts", "dist/graph/slots.js", "src/graph/compile.ts", "dist/graph/compile.js", "src/engine.ts", "dist/engine.js"].map((r) => path.join(realRoot, "node_modules", "reze-engine", r));
  const realShaBefore = realKeyFiles.map((f) => (fs.existsSync(f) ? sha(f) : "missing"));
  // 1) 构造干净隔离 fixture：需要一份未打本票补丁的 reze-engine 0.26.0。
  //    从 npm registry tarball 解出（registry.npmjs.org/reze-engine/-/reze-engine-0.26.0.tgz）。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "state2-fresh-root-"));
  const fixtureRoot = path.join(tmp, "web"); // patch 脚本 rootDir = <fixture>/web，其下需 node_modules/reze-engine
  fs.mkdirSync(path.join(fixtureRoot, "node_modules"), { recursive: true });
  const tgz = path.join(tmp, "reze.tgz");
  const { get } = await import("node:https");
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tgz);
    get("https://registry.npmjs.org/reze-engine/-/reze-engine-0.26.0.tgz", (res) => {
      if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
      res.pipe(out); out.on("finish", () => out.close(resolve));
    }).on("error", reject);
  });
  const { execSync } = await import("node:child_process");
  const unpack = path.join(tmp, "unpack"); fs.mkdirSync(unpack, { recursive: true });
  execSync("tar -xzf " + JSON.stringify(tgz) + " -C " + JSON.stringify(unpack), { stdio: "pipe" });
  fs.cpSync(path.join(unpack, "package"), path.join(fixtureRoot, "node_modules", "reze-engine"), { recursive: true });
  // fixture 初始必须未打 State2 补丁（helper 不存在 / 走旧路径）。
  const fixSlotsSrc = path.join(fixtureRoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  const fixSlotsDist = path.join(fixtureRoot, "node_modules", "reze-engine", "dist", "graph", "slots.js");
  const fixSrc0 = fs.readFileSync(fixSlotsSrc, "utf8");
  ok(fixSrc0.indexOf("V14D_STATE2_HELPERS_WGSL") < 0 && fixSrc0.indexOf("includeState2Mask") < 0, "断点C fixture 初始未打 State2 补丁（helper 不存在，走旧路径）");
  // 2) 子进程调用同一脚本生产控制流：重写 rootDir 指向 fixture。
  const fakeScript = path.join(tmp, "patch-run.mjs");
  const redirected = selfSrc.replace('const rootDir = path.resolve(__dirname, "..");', 'const rootDir = ' + JSON.stringify(fixtureRoot) + ';');
  ok(redirected !== selfSrc, "self-test rootDir 重定向成功（子进程跑真实生产控制流，非 replace 仿真）");
  fs.writeFileSync(fakeScript, redirected, "utf8");
  const runScript = (script) => {
    try {
      const stdout = execFileSync(process.execPath, [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { exit: 0, stdout, stderr: "" };
    } catch (e) {
      return {
        exit: e.status == null ? 1 : e.status,
        stdout: String(e.stdout ?? ""),
        stderr: String(e.stderr ?? ""),
      };
    }
  };
  const runPatch = () => runScript(fakeScript);
  const makeRunner = (label, sourceRoot) => {
    const script = path.join(tmp, label + "-patch-run.mjs");
    const source = selfSrc.replace('const rootDir = path.resolve(__dirname, "..");', 'const rootDir = ' + JSON.stringify(sourceRoot) + ';');
    fs.writeFileSync(script, source, "utf8");
    return () => runScript(script);
  };
  const reportPatchFailure = (label, result) => {
    const lines = (result.stdout + "\n" + result.stderr)
      .split(/\r?\n/)
      .filter((line) => /(?:FAIL|missing-file|anchor-miss|PATCH-VERIFY|patch-reze-engine|锚点)/.test(line));
    for (const line of lines) console.error("[self-test detail] " + label + ": " + line);
  };
  // 首次运行必须真正 exit 0；fixture 内任一严格校验失败都让 self-test 变红。
  const first = runPatch();
  const firstExit = first.exit;
  if (firstExit !== 0) reportPatchFailure("首次运行", first);
  ok(firstExit === 0, "首次完整 fixture 生产补丁 exit=0（实际得到 " + firstExit + "）");
  const orderOk = (fp) => { const c = fs.readFileSync(fp, "utf8"); const ai = c.indexOf("export function assembleModule"); const seg = ai >= 0 ? c.slice(ai, ai + 900) : ""; const hi = seg.indexOf("V14D_STATE2_HELPERS_WGSL : "); const pi = seg.indexOf("prelude(renderClass, alphaMode)"); return hi >= 0 && pi >= 0 && hi < pi; };
  ok(orderOk(fixSlotsSrc), "断点C 首次注入后 src assembleModule 内 helperIndex < preludeIndex");
  ok(orderOk(fixSlotsDist), "断点C 首次注入后 dist assembleModule 内 helperIndex < preludeIndex");
  // 二次运行必须 exit 0 且文件 hash 不变（幂等）。
  const hashAfterFirst = sha(fixSlotsSrc) + "|" + sha(fixSlotsDist);
  const second = runPatch();
  const secondExit = second.exit;
  if (secondExit !== 0) reportPatchFailure("二次运行", second);
  const hashAfterSecond = sha(fixSlotsSrc) + "|" + sha(fixSlotsDist);
  ok(secondExit === 0, "二次完整 fixture 生产补丁 exit=0（实际得到 " + secondExit + "）");
  ok(hashAfterFirst === hashAfterSecond, "断点C 二次运行文件 hash 不变（幂等，无重复注入）");
  const expectRejected = (label, runner) => {
    const result = runner();
    if (result.exit === 0) reportPatchFailure(label, result);
    ok(result.exit !== 0, label + " 非0退出（得到 " + result.exit + "）");
  };
  const copyFixture = (label) => {
    const targetRoot = path.join(tmp, label + "-web");
    fs.cpSync(fixtureRoot, targetRoot, { recursive: true });
    return targetRoot;
  };
  // anchor-miss 负测：破坏 assembleModule anchor，patch 必须拒绝继续。
  const anchorRoot = copyFixture("anchor-miss");
  const anchorSlots = path.join(anchorRoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  let anchorContent = fs.readFileSync(anchorSlots, "utf8");
  anchorContent = anchorContent.split("export function assembleModule").join("export function assembleModule_BROKEN");
  anchorContent = anchorContent.split("includeState2Mask = false").join("includeStyleUniformsOnly = false");
  fs.writeFileSync(anchorSlots, anchorContent, "utf8");
  expectRejected("断点C anchor-miss fixture", makeRunner("anchor-miss", anchorRoot));

  // missing-file 负测：删除一个声明目标文件，严格校验必须非0。
  const missingRoot = copyFixture("missing-file");
  fs.rmSync(path.join(missingRoot, "node_modules", "reze-engine", "dist", "graph", "compile.js"), { force: true });
  expectRejected("missing-file fixture", makeRunner("missing-file", missingRoot));

  // 重复 marker 负测：已有完成态再追加同一机器 marker，必须被恰好一次校验拒绝。
  const duplicateRoot = copyFixture("duplicate-marker");
  const duplicateSlots = path.join(duplicateRoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  fs.appendFileSync(duplicateSlots, String.fromCharCode(10) + "// duplicate const V14D_STATE2_HELPERS_WGSL marker" + String.fromCharCode(10), "utf8");
  expectRejected("重复 marker fixture", makeRunner("duplicate-marker", duplicateRoot));

  // 断点 A 缺失负测：同时破坏函数锚点与已注入函数，不能被静默当作已完成。
  const missingARoot = copyFixture("missing-a");
  const missingASlots = path.join(missingARoot, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  let missingAContent = fs.readFileSync(missingASlots, "utf8");
  missingAContent = missingAContent.split("v14dState2OverrideFsBodyFixed").join("v14dState2OverrideFsBodyFixed_BROKEN");
  missingAContent = missingAContent.split("const HASHED_ALPHA_DECLS").join("const HASHED_ALPHA_DECLS_BROKEN");
  fs.writeFileSync(missingASlots, missingAContent, "utf8");
  expectRejected("断点A 缺失 fixture", makeRunner("missing-a", missingARoot));

  // 断点 B 缺失负测：移除 binding(5) 与 baseEntries anchor，必须非0。
  const missingBRoot = copyFixture("missing-b");
  const missingBEngine = path.join(missingBRoot, "node_modules", "reze-engine", "src", "engine.ts");
  let missingBContent = fs.readFileSync(missingBEngine, "utf8");
  missingBContent = missingBContent.split("        { binding: 5, resource: __auxMaskView }," + String.fromCharCode(10)).join("");
  missingBContent = missingBContent.split("const baseBindGroupEntries").join("const baseBindGroupEntries_BROKEN");
  fs.writeFileSync(missingBEngine, missingBContent, "utf8");
  expectRejected("断点B 缺失 fixture", makeRunner("missing-b", missingBRoot));
  fs.rmSync(tmp, { recursive: true, force: true });
  // 3) 真实 node_modules 前后 SHA256 不变。
  const realShaAfter = realKeyFiles.map((f) => (fs.existsSync(f) ? sha(f) : "missing"));
  const shaSame = realShaBefore.every((h, i) => h === realShaAfter[i]);
  ok(shaSame, "self-test 不触碰真实 web/node_modules（关键文件 SHA256 前后一致）");
  if (fails.length) { console.error("===PATCH-SELF-TEST-FAIL===" + String.fromCharCode(10) + fails.join(String.fromCharCode(10))); process.exit(1); }
  console.log("===PATCH-SELF-TEST-OK=== 真实隔离 fixture fresh-patch 首次/二次幂等通过；anchor-miss、missing-file、重复 marker、断点A缺失、断点B缺失负测全部拒绝；真实 node_modules SHA256 不变");
  process.exit(0);
}

const OLD_SRC = `    // Debug: log problematic string lengths
    if (len > 1000 || len < -1000) {
      throw new RangeError(\`Suspicious string length: \${len} at offset \${this.offset - 4}\`)
    }

`;
const OLD_DIST = `        // Debug: log problematic string lengths
        if (len > 1000 || len < -1000) {
            throw new RangeError(\`Suspicious string length: \${len} at offset \${this.offset - 4}\`);
        }
`;

const targets = [
  { file: path.join(rootDir, "node_modules", "reze-engine", "src", "pmx-loader.ts"), marker: OLD_SRC },
  { file: path.join(rootDir, "node_modules", "reze-engine", "dist", "pmx-loader.js"), marker: OLD_DIST },
];

let patched = 0;
for (const { file, marker } of targets) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, "utf8");
  if (!content.includes("Suspicious string length")) continue; // 已打过
  if (!content.includes(marker)) {
    console.warn(`[patch-reze-engine] 未匹配预期片段，跳过（上游可能已变更）: ${path.basename(file)}`);
    continue;
  }
  fs.writeFileSync(file, content.replace(marker, ""), "utf8");
  patched += 1;
  console.log(`[patch-reze-engine] 已移除 PMX 文本长度上限: ${path.basename(file)}`);
}
if (patched === 0) {
  console.log("[patch-reze-engine] 已是修补后状态，无需处理");
}

// ─── 补丁二：materialDiffuseOverrides（真实 GPU 绑定，默认关闭） ─────────────
// 注入点：files 版 loadModel 中 loadFromReader 之后、addModel 之前。
// 对每个目标材质：push 一条新 texture entry（path=唯一 logicalPath），把该材质
// diffuseTextureIndex 指向新 entry。setupMaterialsForInstance 据此在 GPU 材质建立时
// 读取正确烘焙纹理，真正替换 GPUTexture/bind group。overrides 为空对象时完全 no-op。
const OVERRIDE_HELPER_SRC = `      const __mdo = pathOrOptions.materialDiffuseOverrides
      if (__mdo) {
        const texs = model.getTextures()
        const __mdoStart = texs.length
        for (const m of model.getMaterials()) {
          const p = __mdo[m.name]
          if (p !== undefined) {
            texs.push({ path: p, name: p.split(\"/\").pop() || p })
            m.diffuseTextureIndex = texs.length - 1
          }
        }
        model.__v14dBakedTextureRange = { start: __mdoStart, count: texs.length - __mdoStart }
        // 显示字节闭环（GF4）：反投影/烘焙诊断纹理在近距离 minification 下会采到
        // 被 dilation 均值填充污染的低 mip 级（实测 UV 梯度 ~6 纹素/像素, LOD≈2.7-4,
        // Web MAE 27 vs 离线 mip0 MAE 8）。记录诊断纹理集合，createTextureFromLogicalPath
        // 对其禁用 mipmap（mipLevelCount=1，强制 mip0 双线性 = 离线口径）。默认空集 no-op。
        this.__v14dNoMipmapPaths = new Set(Object.values(__mdo))
      }
`;
const OVERRIDE_HELPER_DIST = `            const __mdo = pathOrOptions.materialDiffuseOverrides;
            if (__mdo) {
                const texs = model.getTextures();
                const __mdoStart = texs.length;
                for (const m of model.getMaterials()) {
                    const p = __mdo[m.name];
                    if (p !== undefined) {
                        texs.push({ path: p, name: p.split(\"/\").pop() || p });
                        m.diffuseTextureIndex = texs.length - 1;
                    }
                }
                model.__v14dBakedTextureRange = { start: __mdoStart, count: texs.length - __mdoStart };
                this.__v14dNoMipmapPaths = new Set(Object.values(__mdo));
            }
`;

const SRC_ANCHOR = `      const model = await PmxLoader.loadFromReader(reader, pmxKey)
      model.setName(name)`;
const DIST_ANCHOR = `            const model = await PmxLoader.loadFromReader(reader, pmxKey);
            model.setName(name);`;

const overrideTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: SRC_ANCHOR,
    replacement: `      const model = await PmxLoader.loadFromReader(reader, pmxKey)\n${OVERRIDE_HELPER_SRC}      model.setName(name)`,
    doneMarker: "__mdo",
    label: "src/engine.ts 实现",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: DIST_ANCHOR,
    replacement: `            const model = await PmxLoader.loadFromReader(reader, pmxKey);\n${OVERRIDE_HELPER_DIST}            model.setName(name);`,
    doneMarker: "__mdo",
    label: "dist/engine.js 实现",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts"),
    anchors: [
      "    pmxFile?: File;\n};",
      "    pmxFile?: File;\n    /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n    materialDiffuseOverrides?: Record<string, string>;\n};",
    ],
    replacement: "    pmxFile?: File;\n    /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n    materialDiffuseOverrides?: Record<string, string>;\n    /** Per-material auxiliary texture override (material name -> unique logicalPath). Default off. */\n    materialAuxTextures?: Record<string, string>;\n};",
    doneMarker: "materialAuxTextures?: Record<string, string>;",
    label: "dist/engine.d.ts 类型",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchors: [
      "  pmxFile?: File\n}",
      "  pmxFile?: File\n  /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n  materialDiffuseOverrides?: Record<string, string>\n}",
    ],
    replacement: "  pmxFile?: File\n  /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n  materialDiffuseOverrides?: Record<string, string>\n  /** Per-material auxiliary texture override (material name -> unique logicalPath). Default off. */\n  materialAuxTextures?: Record<string, string>\n}",
    doneMarker: "materialAuxTextures?: Record<string, string>\n",
    label: "src/engine.ts 类型",
  },
];

// 每个 target 独立 marker（实现用 __mdo、类型用完整字段声明），避免同文件内实现/类型互相跳过。
// 所有生产注入均通过这一份 manifest 执行。一个 target 可以声明互斥 anchors，
// 用于把 fresh/部分已修补状态收敛到同一最终文本；若出现 0 个或多个匹配，
// 都必须硬失败，不能依赖数组顺序“碰巧”完成。
const patchLog = [];
function applyPatchManifest(targets, phase) {
  for (const t of targets) {
    if (!fs.existsSync(t.file)) { patchLog.push({ label: t.label, status: "missing-file" }); continue; }
    const content = fs.readFileSync(t.file, "utf8");
    if (content.includes(t.doneMarker)) { patchLog.push({ label: t.label, status: "already" }); continue; }
    const anchors = t.anchors ?? [t.anchor];
    const matches = anchors.filter((anchor) => content.includes(anchor));
    if (matches.length !== 1) {
      const status = matches.length === 0 ? "anchor-miss" : "ambiguous-anchor";
      console.warn("[patch-reze-engine] " + phase + " 锚点" + (status === "anchor-miss" ? "未匹配" : "不唯一") + "，拒绝继续: " + t.label);
      patchLog.push({ label: t.label, status });
      continue;
    }
    fs.writeFileSync(t.file, content.replace(matches[0], t.replacement), "utf8");
    patchLog.push({ label: t.label, status: "injected" });
    console.log("[patch-reze-engine] 已注入 " + phase + ": " + t.label);
  }
}

applyPatchManifest(overrideTargets, "materialDiffuseOverrides");
// 上方注入循环后立即进行统一严格校验定义；predev/prebuild 与 --verify 共用。
// ─── 统一严格校验（predev/prebuild 与 --verify 共用）：全部 marker 恰好一次。 ──
// 不只在 --verify 才计数；普通 predev/prebuild 也必须拦截重复/缺失 marker，
// 否则生命周期内重复注入或部分注入不会被发现。任一 marker 非恰好一次即 exit 1。
const STATE2_VERIFY_CHECKS = (() => {
  const slotsSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts");
  const slotsDist = path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js");
  const compileSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts");
  const compileDist = path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js");
  const engineSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts");
  const engineDistJs = path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js");
  return [
    { label: "src/engine.ts materialAuxTextures 注入", file: engineSrc, marker: "const __aux = pathOrOptions.materialAuxTextures" },
    { label: "dist/engine.js materialAuxTextures 注入", file: engineDistJs, marker: "const __aux = pathOrOptions.materialAuxTextures;" },
    { label: "src/engine.ts materialAuxTextures 类型声明", file: engineSrc, marker: "materialAuxTextures?: Record<string, string>" },
    { label: "dist/engine.d.ts materialAuxTextures 类型声明", file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts"), marker: "materialAuxTextures?: Record<string, string>;" },
    { label: "src/engine.ts aux mask 禁 mipmap", file: engineSrc, marker: "__v14dAuxTexturePaths?.has(logicalPath)" },
    { label: "dist/engine.js aux mask 禁 mipmap", file: engineDistJs, marker: "__v14dAuxTexturePaths?.has(logicalPath)" },
    { label: "src/engine.ts aux mask 非 sRGB 视图", file: engineSrc, marker: "__isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\"" },
    { label: "dist/engine.js aux mask 非 sRGB 视图", file: engineDistJs, marker: "__isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\"" },
    { label: "src/engine.ts bind group 布局 binding(5)", file: engineSrc, marker: "// V14D State2 实时合成：extra mask texture" },
    { label: "dist/engine.js bind group 布局 binding(5)", file: engineDistJs, marker: "// V14D State2 实时合成：extra mask texture" },
    { label: "src/engine.ts createMaterialBindGroup binding(5)", file: engineSrc, marker: "maskView ?? this.fallbackMaterialTexture.createView()" },
    { label: "dist/engine.js createMaterialBindGroup binding(5)", file: engineDistJs, marker: "maskView ?? this.fallbackMaterialTexture.createView()" },
    { label: "src/engine.ts setupMaterialsForInstance mask 加载", file: engineSrc, marker: "const __auxMaskView = __auxTexture ? __auxTexture.createView() : undefined" },
    { label: "dist/engine.js setupMaterialsForInstance mask 加载", file: engineDistJs, marker: "const __auxMaskView = __auxTexture ? __auxTexture.createView() : undefined;" },
    { label: "src/graph/slots.ts state2 helper 声明", file: slotsSrc, marker: "const V14D_STATE2_HELPERS_WGSL" },
    { label: "dist/graph/slots.js state2 helper 声明", file: slotsDist, marker: "const V14D_STATE2_HELPERS_WGSL" },
    { label: "src/graph/slots.ts assembleModule state2 门控", file: slotsSrc, marker: "includeState2Mask = false" },
    { label: "dist/graph/slots.js assembleModule state2 门控", file: slotsDist, marker: "includeState2Mask = false" },
    { label: "src/graph/compile.ts state2 门控", file: compileSrc, marker: "graph.tags?.includes(\"v14d-state2-face\")" },
    { label: "dist/graph/compile.js state2 门控", file: compileDist, marker: "graph.tags?.includes(\"v14d-state2-face\")" },
  // 断点 A 修正轮（src + dist 生效路径）：健壮行匹配 override 存在且被 compile 接线。
  { label: "src/graph/slots.ts state2 override 修正函数", file: slotsSrc, marker: "export function v14dState2OverrideFsBodyFixed(graphName: string, fsBody: string): string" },
  { label: "dist/graph/slots.js state2 override 修正函数", file: slotsDist, marker: "export function v14dState2OverrideFsBodyFixed(graphName, fsBody)" },
  { label: "src/graph/compile.ts state2 override 修正接线", file: compileSrc, marker: "const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody)" },
  { label: "dist/graph/compile.js state2 override 修正接线", file: compileDist, marker: "const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody);" },
  // 断点 B 修正轮：aux mask view 并入 baseEntries (binding 5) 且重绑展开不丢失。
  { label: "src/engine.ts binding5 baseEntries", file: engineSrc, marker: "binding: 5, resource: __auxMaskView" },
  { label: "dist/engine.js binding5 baseEntries", file: engineDistJs, marker: "binding: 5, resource: __auxMaskView" },
  { label: "src/engine.ts createMaterialBindGroup binding5 门控 fallback", file: engineSrc, marker: "baseEntries.some((e) => e.binding === 5)" },
  { label: "dist/engine.js createMaterialBindGroup binding5 门控 fallback", file: engineDistJs, marker: "baseEntries.some((e) => e.binding === 5)" },
  { label: "src/engine.ts assignDrawCallGroups 展开 baseEntries", file: engineSrc, marker: "...dc.baseBindGroupEntries" },
  { label: "dist/engine.js assignDrawCallGroups 展开 baseEntries", file: engineDistJs, marker: "...dc.baseBindGroupEntries" },
  // 断点 A 生效性（换行语义）：override 必须以真实换行拆分 fsBody 行；
  // "\\n" 两字符转义会让 findIndex 找不到 final_color（表达式含空格），静默不生效。
  { label: "src/graph/slots.ts override 真实换行 split", file: slotsSrc, marker: 'fsBody.split("\\n")' },
  { label: "dist/graph/slots.js override 真实换行 split", file: slotsDist, marker: "fsBody.split(String.fromCharCode(10))" },
  // 断点 A 生效性（fence 完整闭合）：fence 结束标记必须恰好一次且无残缺变体，
  // 否则 "FIX_ENDD" 一类残缺注释会让后续 WGSL 函数体不闭合（expected '}'）。
  { label: "dist/graph/slots.js fence 结束标记完整", file: slotsDist, marker: "V14D_STATE2_OVERRIDE_FIX_END" + "\n" },
  // 断点 A 生效性（helper 注入位置）：state2 helper 必须在 prelude（fn fs 开头）之前，
  // 否则 WGSL 函数嵌套 → expected '}' for function body，Face graph 应用失败静默回退。
  { label: "src/graph/slots.ts helper 在 prelude 前注入", file: slotsSrc, marker: 'V14D_STATE2_HELPERS_WGSL : "") +' + "\n" + "    prelude(renderClass, alphaMode)" },
  { label: "dist/graph/slots.js helper 在 prelude 前注入", file: slotsDist, marker: 'V14D_STATE2_HELPERS_WGSL : "") +' + "\n" + "        prelude(renderClass, alphaMode)" },
  ];
})();

function strictVerifyAll() {
  const engineSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts");
  const engineDistJs = path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js");
  const engineDistDts = path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts");
  const compSrc = path.join(rootDir, "node_modules", "reze-engine", "src", "shaders", "passes", "composite.ts");
  const compDist = path.join(rootDir, "node_modules", "reze-engine", "dist", "shaders", "passes", "composite.js");
  const checks = [
    { label: "src/engine.ts 实现", file: engineSrc, marker: "__mdoStart = texs.length" },
    { label: "dist/engine.js 实现", file: engineDistJs, marker: "__mdoStart = texs.length" },
    { label: "dist/engine.d.ts 类型", file: engineDistDts, marker: "materialDiffuseOverrides?: Record<string, string>;" },
    { label: "src/engine.ts 类型", file: engineSrc, marker: "materialDiffuseOverrides?: Record<string, string>\n" },

    { label: "src/engine.ts setter", file: engineSrc, marker: "v.displayPassthrough = patch.displayPassthrough" },
    { label: "dist/engine.js setter", file: engineDistJs, marker: "v.displayPassthrough = patch.displayPassthrough" },
    { label: "src/engine.ts uniform u[2]", file: engineSrc, marker: "u[2] = v.displayPassthrough ? 1.0 : 0.0" },
    { label: "dist/engine.js uniform u[2]", file: engineDistJs, marker: "u[2] = v.displayPassthrough ? 1.0 : 0.0" },
    { label: "src merge 默认 false", file: engineSrc, marker: "displayPassthrough: partial?.displayPassthrough" },
    { label: "dist merge 默认 false", file: engineDistJs, marker: "displayPassthrough: partial?.displayPassthrough" },
    { label: "src ViewTransformOptions 类型", file: engineSrc, marker: "displayPassthrough?: boolean\n" },

    { label: "dist ViewTransformOptions 类型", file: engineDistDts, marker: "displayPassthrough?: boolean;" },
    { label: "src shader srgb_encode helper", file: compSrc, marker: "fn v14d_srgb_encode" },
    { label: "dist shader srgb_encode helper", file: compDist, marker: "fn v14d_srgb_encode" },
    { label: "src shader passthrough 早退", file: compSrc, marker: "viewU[0].z > 0.5" },
    { label: "dist shader passthrough 早退", file: compDist, marker: "viewU[0].z > 0.5" },
    { label: "src shader grade/gamma 门控", file: compSrc, marker: "viewU[0].z <= 0.5 && APPLY_GAMMA" },
    { label: "dist shader grade/gamma 门控", file: compDist, marker: "viewU[0].z <= 0.5 && APPLY_GAMMA" },
    { label: "src 诊断纹理禁 mipmap", file: engineSrc, marker: "__v14dNoMipmapPaths?.has(logicalPath)" },
    { label: "dist 诊断纹理禁 mipmap", file: engineDistJs, marker: "__v14dNoMipmapPaths?.has(logicalPath)" },
    { label: "override 记录诊断纹理集合", file: engineDistJs, marker: "this.__v14dNoMipmapPaths = new Set(Object.values(__mdo))" },
    // ─── 补丁五（State2 实时合成）不变量：各恰好一次 ───
    ...STATE2_VERIFY_CHECKS,
  ];
  let allOk = true;
  for (const c of checks) {
    const content = fs.existsSync(c.file) ? fs.readFileSync(c.file, "utf8") : "";
    // CRLF 文件：marker 末尾换行写成 LF 时 split 不命中。按 "marker 或其 CRLF 形式" 统一计数。
    const markers = [c.marker, c.marker.replace(/\n$/, "\r\n")].filter((m, i, a) => a.indexOf(m) === i);
    let count = 0;
    for (const m of markers) count += content.split(m).length - 1;
    const ok = count === 1;
    if (!ok) allOk = false;
    console.log("[verify] " + c.label + ": marker 出现 " + count + " 次 " + (ok ? "OK" : "FAIL(应恰好1次)"));
  }
  if (!allOk) { console.error("===PATCH-VERIFY-FAIL=== 存在非恰好一次的 marker"); return false; }
  console.log("===PATCH-VERIFY-OK=== 全部 " + checks.length + " 项不变量恰好一次");
  return true;
}
if (process.argv.includes("--verify")) { if (!strictVerifyAll()) process.exit(1); else process.exit(0); }

// ─── 补丁三：display-passthrough 视图变换模式（默认关闭，绕过 Filmic/grade/gamma） ──
// 目标（Stage 2A-GF4 AgX 显示字节 Face 捕获闭环）：bakedGolden 诊断把「磁盘权威
// AgX PNG 的原始 8-bit 显示字节」反投影到 Face atlas 后，Web 端必须**原样直通**
// 这些显示字节，不能再过引擎默认的 Filmic LUT + color grading + gamma（否则等于把
// 已是显示域的字节二次调色，破坏「显示字节 = 显示字节」的闭环不变量）。
//
// 最小注入：复用 composite uniform 的 viewU[0] 空槽 z 分量（u[2]）作 passthrough
// 标志。默认 false（u[2]=0），生产路径完全不变；仅显式 setViewTransformOptions({
// displayPassthrough: true }) 时 u[2]=1，composite fragment 在 filmic/grade/gamma
// 之前早退 disp=exposed（仅保留 exposure 缩放的线性色，不做任何色调映射）。
//
// 精确不变量（--verify 校验，各恰好一次）：
//   1) setter 接受 displayPassthrough 字段（src/dist 各一处）；
//   2) uniform 写入 u[2] = passthrough?1:0（src/dist 各一处）；
//   3) mergeViewTransformDefaults 默认 displayPassthrough=false（src/dist 各一处）；
//   4) ViewTransformOptions 类型含 displayPassthrough?: boolean（src.ts/dist.d.ts 各一处）；
//   5) composite shader 含 passthrough 早退分支（src.ts/dist.js 各一处）。
const PASSTHROUGH_SETTER_ANCHOR_SRC = "    if (patch.look !== undefined) v.look = patch.look\n";
const PASSTHROUGH_SETTER_ANCHOR_DIST = "        if (patch.look !== undefined)\n            v.look = patch.look;\n";
const PASSTHROUGH_UNIFORM_SRC = "    u[2] = 0.0\n";
const PASSTHROUGH_UNIFORM_DIST = "        u[2] = 0.0;\n";
const PASSTHROUGH_MERGE_SRC = "      look: partial?.look ?? d.look,\n";
const PASSTHROUGH_MERGE_DIST = "            look: partial?.look ?? d.look,\n";
const PASSTHROUGH_TYPE_SRC = '  look: "default" | "medium_high_contrast"\n}';
const PASSTHROUGH_TYPE_DIST = '    look: "default" | "medium_high_contrast";\n};';
// composite shader helper：sRGB OETF（linear→显示字节域）。display-passthrough 把
// 纹理解码后的 linear 值重新编码回 sRGB 显示字节，使「磁盘 PNG 字节 ⇄ 显示字节」闭环。
const PASSTHROUGH_HELPER_ANCHOR = "const FILMIC_LUT_W: f32 = 256.0;\n";
const PASSTHROUGH_HELPER_REPLACEMENT =
  "const FILMIC_LUT_W: f32 = 256.0;\n" +
  "// V14D display passthrough: linear→sRGB OETF (IEC 61966-2-1).\n" +
  "fn v14d_srgb_encode(x: f32) -> f32 {\n" +
  "  let c = max(x, 0.0);\n" +
  "  return select(1.055 * pow(c, 1.0 / 2.4) - 0.055, 12.92 * c, c <= 0.0031308);\n" +
  "}\n";
// composite shader：filmic/grade/gamma 三层整体包进 else，passthrough 时早退并做
// linear→sRGB 编码（纹理由 rgba8unorm-srgb 硬件解码为 linear，passthrough 须还原字节）。
const PASSTHROUGH_SHADER_ANCHOR =
  "  let exposed = combined * exp2(viewU[0].x);\n" +
  "  let tm = vec3f(filmic(exposed.r), filmic(exposed.g), filmic(exposed.b));\n" +
  "  var disp = max(tm, vec3f(0.0));\n";
const PASSTHROUGH_SHADER_REPLACEMENT =
  "  let exposed = combined * exp2(viewU[0].x);\n" +
  "  // V14D display passthrough (viewU[0].z>0.5): bypass Filmic LUT + grade + gamma.\n" +
  "  // 纹理由硬件 sRGB→linear 解码；passthrough 重新 linear→sRGB 编码，使最终显示\n" +
  "  // 字节等于注入纹理的原始 sRGB 字节（显示字节闭环）。Default off (viewU[0].z==0).\n" +
  "  var disp = max(vec3f(filmic(exposed.r), filmic(exposed.g), filmic(exposed.b)), vec3f(0.0));\n" +
  "  if (viewU[0].z > 0.5) {\n" +
  "    let le = max(exposed, vec3f(0.0));\n" +
  "    disp = vec3f(v14d_srgb_encode(le.r), v14d_srgb_encode(le.g), v14d_srgb_encode(le.b));\n" +
  "  }\n";
// grade/gamma 块：仅在非 passthrough 时执行（passthrough 已早退，跳过这两层）。
const GRADE_BLOCK_ANCHOR =
  "  if (viewU[9].w > 0.5) {\n" +
  "    disp = grade(disp);\n" +
  "  }\n" +
  "  if (APPLY_GAMMA) {\n" +
  "    disp = pow(disp, vec3f(viewU[0].y));\n" +
  "  }\n";
const GRADE_BLOCK_REPLACEMENT =
  "  if (viewU[0].z <= 0.5 && viewU[9].w > 0.5) {\n" +
  "    disp = grade(disp);\n" +
  "  }\n" +
  "  if (viewU[0].z <= 0.5 && APPLY_GAMMA) {\n" +
  "    disp = pow(disp, vec3f(viewU[0].y));\n" +
  "  }\n";

const passthroughTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: PASSTHROUGH_SETTER_ANCHOR_SRC,
    replacement: PASSTHROUGH_SETTER_ANCHOR_SRC + "    if (patch.displayPassthrough !== undefined) v.displayPassthrough = patch.displayPassthrough\n",
    doneMarker: "v.displayPassthrough = patch.displayPassthrough",
    label: "src/engine.ts setter",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: PASSTHROUGH_SETTER_ANCHOR_DIST,
    replacement: PASSTHROUGH_SETTER_ANCHOR_DIST + "        if (patch.displayPassthrough !== undefined)\n            v.displayPassthrough = patch.displayPassthrough;\n",
    doneMarker: "v.displayPassthrough = patch.displayPassthrough",
    label: "dist/engine.js setter",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: PASSTHROUGH_UNIFORM_SRC,
    replacement: "    u[2] = v.displayPassthrough ? 1.0 : 0.0\n",
    doneMarker: "u[2] = v.displayPassthrough ? 1.0 : 0.0",
    label: "src/engine.ts uniform u[2]",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: PASSTHROUGH_UNIFORM_DIST,
    replacement: "        u[2] = v.displayPassthrough ? 1.0 : 0.0;\n",
    doneMarker: "u[2] = v.displayPassthrough ? 1.0 : 0.0",
    label: "dist/engine.js uniform u[2]",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: PASSTHROUGH_MERGE_SRC,
    replacement: PASSTHROUGH_MERGE_SRC + "      displayPassthrough: partial?.displayPassthrough ?? d.displayPassthrough ?? false,\n",
    doneMarker: "displayPassthrough: partial?.displayPassthrough",
    label: "src/engine.ts merge 默认 false",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: PASSTHROUGH_MERGE_DIST,
    replacement: PASSTHROUGH_MERGE_DIST + "            displayPassthrough: partial?.displayPassthrough ?? d.displayPassthrough ?? false,\n",
    doneMarker: "displayPassthrough: partial?.displayPassthrough",
    label: "dist/engine.js merge 默认 false",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: PASSTHROUGH_TYPE_SRC,
    replacement: '  look: "default" | "medium_high_contrast"\n  /** Display passthrough (default false): bypass Filmic/grade/gamma in composite. */\n  displayPassthrough?: boolean\n}',
    doneMarker: "displayPassthrough?: boolean",
    label: "src/engine.ts ViewTransformOptions 类型",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.d.ts"),
    anchor: PASSTHROUGH_TYPE_DIST,
    replacement: '    look: "default" | "medium_high_contrast";\n    /** Display passthrough (default false): bypass Filmic/grade/gamma in composite. */\n    displayPassthrough?: boolean;\n};',
    doneMarker: "displayPassthrough?: boolean;",
    label: "dist/engine.d.ts ViewTransformOptions 类型",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "shaders", "passes", "composite.ts"),
    anchor: PASSTHROUGH_SHADER_ANCHOR,
    replacement: PASSTHROUGH_SHADER_REPLACEMENT,
    doneMarker: "viewU[0].z > 0.5",
    label: "src/shaders/passes/composite.ts passthrough 早退",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "shaders", "passes", "composite.ts"),
    anchor: PASSTHROUGH_HELPER_ANCHOR,
    replacement: PASSTHROUGH_HELPER_REPLACEMENT,
    doneMarker: "fn v14d_srgb_encode",
    label: "src/shaders/passes/composite.ts srgb_encode helper",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "shaders", "passes", "composite.js"),
    anchor: PASSTHROUGH_HELPER_ANCHOR,
    replacement: PASSTHROUGH_HELPER_REPLACEMENT,
    doneMarker: "fn v14d_srgb_encode",
    label: "dist/shaders/passes/composite.js srgb_encode helper",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "shaders", "passes", "composite.js"),
    anchor: PASSTHROUGH_SHADER_ANCHOR,
    replacement: PASSTHROUGH_SHADER_REPLACEMENT,
    doneMarker: "viewU[0].z > 0.5",
    label: "dist/shaders/passes/composite.js passthrough 早退",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "shaders", "passes", "composite.ts"),
    anchor: GRADE_BLOCK_ANCHOR,
    replacement: GRADE_BLOCK_REPLACEMENT,
    doneMarker: "viewU[0].z <= 0.5 && APPLY_GAMMA",
    label: "src/shaders/passes/composite.ts grade/gamma 门控",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "shaders", "passes", "composite.js"),
    anchor: GRADE_BLOCK_ANCHOR,
    replacement: GRADE_BLOCK_REPLACEMENT,
    doneMarker: "viewU[0].z <= 0.5 && APPLY_GAMMA",
    label: "dist/shaders/passes/composite.js grade/gamma 门控",
  },
];

// ─── 补丁四：诊断纹理禁用 mipmap（默认关闭，仅 materialDiffuseOverrides 命中的纹理） ──
// 见 OVERRIDE_HELPER 注释：反投影/烘焙诊断纹理在 minification 下采被 dilation 污染的
// 低 mip 级。对 __v14dNoMipmapPaths 集合内的 logicalPath 强制 mipLevelCount=1。
const MIPMAP_SRC_ANCHOR = "    const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1\n";
const MIPMAP_DIST_ANCHOR = "        const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;\n";
const mipmapTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: MIPMAP_SRC_ANCHOR,
    replacement: "    const mipLevelCount = this.__v14dNoMipmapPaths?.has(logicalPath) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1\n",
    doneMarker: "__v14dNoMipmapPaths?.has(logicalPath)",
    label: "src/engine.ts 诊断纹理禁 mipmap",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: MIPMAP_DIST_ANCHOR,
    replacement: "        const mipLevelCount = this.__v14dNoMipmapPaths?.has(logicalPath) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1;\n",
    doneMarker: "__v14dNoMipmapPaths?.has(logicalPath)",
    label: "dist/engine.js 诊断纹理禁 mipmap",
  },
];
passthroughTargets.push(...mipmapTargets);

// ─── 补丁五：V14D State2 实时脸部合成（默认关闭，Stage 2B-M1） ────────────────
// 目标：Face 材质在 Web 线性空间逐像素从「原始 face_d + State2 packed mask +
// Blender 节点常量」实时执行 warm/art/fringe 合成，不再使用整张预烘焙脸图。
//
// 最小注入面：
//   1) loadModel options.materialAuxTextures（材质名 → 辅助纹理 logicalPath，默认关）：
//      在 materialDiffuseOverrides 同一点（loadFromReader 之后、addModel 之前）
//      追加独立 texture entry，记 model.__v14dAuxTexturePaths。不改磁盘 PMX、材质槽、
//      拓扑或 VMD。
//   2) createTextureFromLogicalPath：对 __v14dAuxTexturePaths 命中的路径创建
//      rgba8unorm（无 sRGB 硬件解码，mask 是 Non-Color 线性数据）且禁用 mipmap
//      （mip0 双线性 = 离线逐纹素口径，避免被 dilation/填充污染的低 mip 级）。
//   3) mainPerMaterialBindGroupLayout 追加 binding(5) 纹理槽（extra mask texture）；
//      createMaterialBindGroup 统一绑定（无 mask 的材质回退 fallbackMaterialTexture）。
//      绑定必须在 GPU 材质建立前闭合并由 Gate 读取 dataset 证据。
//   4) 编译 graph（graph.tags 含 "v14d-state2-face"）时注入 mask 纹理声明 + 合成
//      helper（warm/art/fringe/occlusion 常量来自权威 blend 取证，硬编码于 WGSL）。
//      仅 Face 材质走实时合成 graph；其余材质（EyeWhite/Eyes/Eyes+/Hair/Body/Clothes）
//      保持 reze-k3 正常路径，不引用新纹理。
const AUX_HELPER_SRC = [
  "      const __aux = pathOrOptions.materialAuxTextures",
  "      if (__aux) {",
  "        const texs = model.getTextures()",
  "        for (const m of model.getMaterials()) {",
  "          const p = __aux[m.name]",
  "          if (p !== undefined) {",
  '            texs.push({ path: p, name: p.split("/").pop() || p })',
  "            model.__v14dAuxTextureIndex = model.__v14dAuxTextureIndex || {}",
  "            model.__v14dAuxTextureIndex[m.name] = texs.length - 1",
  "          }",
  "        }",
  "        model.__v14dAuxTexturePaths = new Set(Object.values(__aux))",
  "      }",
  "",
].join("\n");
const AUX_HELPER_DIST = [
  "            const __aux = pathOrOptions.materialAuxTextures;",
  "            if (__aux) {",
  "                const texs = model.getTextures();",
  "                for (const m of model.getMaterials()) {",
  "                    const p = __aux[m.name];",
  "                    if (p !== undefined) {",
  '                        texs.push({ path: p, name: p.split("/").pop() || p });',
  "                        model.__v14dAuxTextureIndex = model.__v14dAuxTextureIndex || {};",
  "                        model.__v14dAuxTextureIndex[m.name] = texs.length - 1;",
  "                    }",
  "                }",
  "                model.__v14dAuxTexturePaths = new Set(Object.values(__aux));",
  "            }",
  "",
].join("\n");
const AUX_ANCHOR_SRC = OVERRIDE_HELPER_SRC + "      model.setName(name)";
const AUX_ANCHOR_DIST = OVERRIDE_HELPER_DIST + "            model.setName(name);";
const AUX_REPLACEMENT_SRC = OVERRIDE_HELPER_SRC + AUX_HELPER_SRC + "      model.setName(name)";
const AUX_REPLACEMENT_DIST = OVERRIDE_HELPER_DIST + AUX_HELPER_DIST + "            model.setName(name);";

// createTextureFromLogicalPath：aux mask 纹理用 rgba8unorm（非 sRGB）+ 禁 mipmap。
const AUX_TEX_SRC_ANCHOR = "    const mipLevelCount = this.__v14dNoMipmapPaths?.has(logicalPath) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1\n";
const AUX_TEX_SRC_REPLACEMENT =
  "    const __isAuxMask = inst.model.__v14dAuxTexturePaths?.has(logicalPath)\n" +
  "    const mipLevelCount = (__isAuxMask || this.__v14dNoMipmapPaths?.has(logicalPath)) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1\n";
const AUX_TEX_DIST_ANCHOR = "        const mipLevelCount = this.__v14dNoMipmapPaths?.has(logicalPath) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1;\n";
const AUX_TEX_DIST_REPLACEMENT =
  "        const __isAuxMask = inst.model.__v14dAuxTexturePaths?.has(logicalPath);\n" +
  "        const mipLevelCount = (__isAuxMask || this.__v14dNoMipmapPaths?.has(logicalPath)) ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1;\n";
const TEX_FORMAT_SRC_ANCHOR = "      format: \"rgba8unorm-srgb\",\n";
const TEX_FORMAT_SRC_REPLACEMENT = '      format: __isAuxMask ? "rgba8unorm" : "rgba8unorm-srgb",\n';
const TEX_FORMAT_DIST_ANCHOR = "            format: \"rgba8unorm-srgb\",\n";
const TEX_FORMAT_DIST_REPLACEMENT = '            format: __isAuxMask ? "rgba8unorm" : "rgba8unorm-srgb",\n';

// bind group 布局：binding(5) = extra mask texture（v14d state2）。默认材质回退 fallback。
const BINDGROUP_LAYOUT_SRC_ANCHOR =
  '        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },\n      ],\n    })\n\n    // Shared zero StyleUniforms buffer';
const BINDGROUP_LAYOUT_SRC_REPLACEMENT =
  '        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },\n        // V14D State2 实时合成：extra mask texture（默认回退 fallbackMaterialTexture）。\n        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },\n      ],\n    })\n\n    // Shared zero StyleUniforms buffer';
const BINDGROUP_LAYOUT_DIST_ANCHOR =
  '                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },\n            ],\n        });\n        // Shared zero StyleUniforms buffer';
const BINDGROUP_LAYOUT_DIST_REPLACEMENT =
  '                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },\n                // V14D State2 实时合成：extra mask texture（默认回退 fallbackMaterialTexture）。\n                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },\n            ],\n        });\n        // Shared zero StyleUniforms buffer';

const CREATE_BINDGROUP_SRC_ANCHOR = [
  "  private createMaterialBindGroup(label: string, baseEntries: GPUBindGroupEntry[], styleBuffer: GPUBuffer): GPUBindGroup {",
  "    return this.device.createBindGroup({",
  "      label,",
  "      layout: this.mainPerMaterialBindGroupLayout,",
  "      entries: [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }],",
  "    })",
  "  }",
].join("\n");
const CREATE_BINDGROUP_SRC_REPLACEMENT = [
  "  private createMaterialBindGroup(label: string, baseEntries: GPUBindGroupEntry[], styleBuffer: GPUBuffer, maskView?: GPUTextureView): GPUBindGroup {",
  "    return this.device.createBindGroup({",
  "      label,",
  "      layout: this.mainPerMaterialBindGroupLayout,",
  "      entries: [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }, { binding: 5, resource: maskView ?? this.fallbackMaterialTexture.createView() }],",
  "    })",
  "  }",
].join("\n");
const CREATE_BINDGROUP_DIST_ANCHOR = [
  "    createMaterialBindGroup(label, baseEntries, styleBuffer) {",
  "        return this.device.createBindGroup({",
  "            label,",
  "            layout: this.mainPerMaterialBindGroupLayout,",
  "            entries: [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }],",
  "        });",
  "    }",
].join("\n");
const CREATE_BINDGROUP_DIST_REPLACEMENT = [
  "    createMaterialBindGroup(label, baseEntries, styleBuffer, maskView) {",
  "        return this.device.createBindGroup({",
  "            label,",
  "            layout: this.mainPerMaterialBindGroupLayout,",
  "            entries: [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }, { binding: 5, resource: maskView ?? this.fallbackMaterialTexture.createView() }],",
  "        });",
  "    }",
].join("\n");

// Fresh 0.26.0 上游布局的后续说明文字可能变化，target 只锁定结构闭合行。
const BINDGROUP_LAYOUT_SRC_ANCHOR_FIXED = [
  "        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "      ],",
  "    })",
].join("\n");
const BINDGROUP_LAYOUT_SRC_REPLACEMENT_FIXED = [
  "        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "        // V14D State2 实时合成：extra mask 纹理（默认回退 fallbackMaterialTexture）。",
  "        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "      ],",
  "    })",
].join("\n");
const BINDGROUP_LAYOUT_DIST_ANCHOR_FIXED = [
  "                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "            ],",
  "        });",
].join("\n");
const BINDGROUP_LAYOUT_DIST_REPLACEMENT_FIXED = [
  "                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "                // V14D State2 实时合成：extra mask 纹理（默认回退 fallbackMaterialTexture）。",
  "                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "            ],",
  "        });",
].join("\n");

const CREATE_BINDGROUP_SRC_REPLACEMENT_FIXED = [
  "  private createMaterialBindGroup(label: string, baseEntries: GPUBindGroupEntry[], styleBuffer: GPUBuffer, maskView?: GPUTextureView): GPUBindGroup {",
  "    const entries: GPUBindGroupEntry[] = [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }]",
  "    if (!baseEntries.some((e) => e.binding === 5)) {",
  "      entries.push({ binding: 5, resource: maskView ?? this.fallbackMaterialTexture.createView() })",
  "    }",
  "    return this.device.createBindGroup({",
  "      label,",
  "      layout: this.mainPerMaterialBindGroupLayout,",
  "      entries,",
  "    })",
  "  }",
].join("\n");
const CREATE_BINDGROUP_DIST_REPLACEMENT_FIXED = [
  "    createMaterialBindGroup(label, baseEntries, styleBuffer, maskView) {",
  "        const entries = [...baseEntries, { binding: 4, resource: { buffer: styleBuffer } }];",
  "        if (!baseEntries.some((e) => e.binding === 5)) {",
  "            entries.push({ binding: 5, resource: maskView ?? this.fallbackMaterialTexture.createView() });",
  "        }",
  "        return this.device.createBindGroup({",
  "            label,",
  "            layout: this.mainPerMaterialBindGroupLayout,",
  "            entries,",
  "        });",
  "    }",
].join("\n");

const BINDGROUP_LAYOUT_SRC_ANCHOR_STRUCTURED = [
  "    this.mainPerMaterialBindGroupLayout = this.device.createBindGroupLayout({",
  "      label: \"main per-material bind group layout\",",
  "      entries: [",
  "        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        // StyleUniforms for compiled graph shaders (adjust-tier sliders). Hand-written",
  "        // presets simply don't declare it — a layout may carry bindings a shader ignores.",
  "        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "      ],",
  "    })",
].join("\n");
const BINDGROUP_LAYOUT_SRC_REPLACEMENT_STRUCTURED = [
  "    this.mainPerMaterialBindGroupLayout = this.device.createBindGroupLayout({",
  "      label: \"main per-material bind group layout\",",
  "      entries: [",
  "        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "        // StyleUniforms for compiled graph shaders (adjust-tier sliders). Hand-written",
  "        // presets simply don't declare it — a layout may carry bindings a shader ignores.",
  "        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "        // V14D State2 实时合成：extra mask texture（默认回退 fallbackMaterialTexture）。",
  "        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "      ],",
  "    })",
].join("\n");
const BINDGROUP_LAYOUT_DIST_ANCHOR_STRUCTURED = [
  "        this.mainPerMaterialBindGroupLayout = this.device.createBindGroupLayout({",
  "            label: \"main per-material bind group layout\",",
  "            entries: [",
  "                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                // StyleUniforms for compiled graph shaders (adjust-tier sliders). Hand-written",
  "                // presets simply don't declare it — a layout may carry bindings a shader ignores.",
  "                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "            ],",
  "        });",
].join("\n");
const BINDGROUP_LAYOUT_DIST_REPLACEMENT_STRUCTURED = [
  "        this.mainPerMaterialBindGroupLayout = this.device.createBindGroupLayout({",
  "            label: \"main per-material bind group layout\",",
  "            entries: [",
  "                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "                // StyleUniforms for compiled graph shaders (adjust-tier sliders). Hand-written",
  "                // presets simply don't declare it — a layout may carry bindings a shader ignores.",
  "                { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: \"uniform\" } },",
  "                // V14D State2 实时合成：extra mask texture（默认回退 fallbackMaterialTexture）。",
  "                { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },",
  "            ],",
  "        });",
].join("\n");

const SETUP_MASK_SRC_ANCHOR = "      const textureView = diffuseTexture.createView()\n";
const SETUP_MASK_SRC_REPLACEMENT = [
  "      const textureView = diffuseTexture.createView()",
  "      // V14D State2 实时合成：aux mask 纹理（仅 materialAuxTextures 命中的材质）。",
  "      const __auxIdx = inst.model.__v14dAuxTextureIndex?.[mat.name]",
  "      const __auxTexture = __auxIdx !== undefined ? await loadTextureByIndex(__auxIdx) : null",
  "      const __auxMaskView = __auxTexture ? __auxTexture.createView() : undefined",
  "",
].join("\n");
const SETUP_MASK_DIST_ANCHOR = "            const textureView = diffuseTexture.createView();\n";
const SETUP_MASK_DIST_REPLACEMENT = [
  "            const textureView = diffuseTexture.createView();",
  "            // V14D State2 实时合成：aux mask 纹理（仅 materialAuxTextures 命中的材质）。",
  "            const __auxIdx = inst.model.__v14dAuxTextureIndex?.[mat.name];",
  "            const __auxTexture = __auxIdx !== undefined ? await loadTextureByIndex(__auxIdx) : null;",
  "            const __auxMaskView = __auxTexture ? __auxTexture.createView() : undefined;",
  "",
].join("\n");
const SETUP_BINDGROUP_SRC_ANCHOR = [
  "      const bindGroup = this.createMaterialBindGroup(",
  "        `${prefix}material: ${mat.name}`,",
  "        baseBindGroupEntries,",
  "        this.zeroStyleBuffer,",
  "      )",
].join("\n");
const SETUP_BINDGROUP_SRC_REPLACEMENT = [
  "      const bindGroup = this.createMaterialBindGroup(",
  "        `${prefix}material: ${mat.name}`,",
  "        baseBindGroupEntries,",
  "        this.zeroStyleBuffer,",
  "        __auxMaskView,",
  "      )",
].join("\n");
const SETUP_BINDGROUP_DIST_ANCHOR = "            const bindGroup = this.createMaterialBindGroup(`${prefix}material: ${mat.name}`, baseBindGroupEntries, this.zeroStyleBuffer);";
const SETUP_BINDGROUP_DIST_REPLACEMENT = "            const bindGroup = this.createMaterialBindGroup(`${prefix}material: ${mat.name}`, baseBindGroupEntries, this.zeroStyleBuffer, __auxMaskView);";

const state2Targets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: AUX_ANCHOR_SRC,
    replacement: AUX_REPLACEMENT_SRC,
    doneMarker: "const __aux = pathOrOptions.materialAuxTextures",
    label: "src/engine.ts materialAuxTextures 注入",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: AUX_ANCHOR_DIST,
    replacement: AUX_REPLACEMENT_DIST,
    doneMarker: "const __aux = pathOrOptions.materialAuxTextures;",
    label: "dist/engine.js materialAuxTextures 注入",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: AUX_TEX_SRC_ANCHOR,
    replacement: AUX_TEX_SRC_REPLACEMENT,
    doneMarker: "__v14dAuxTexturePaths?.has(logicalPath)",
    label: "src/engine.ts aux mask 禁 mipmap",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: AUX_TEX_DIST_ANCHOR,
    replacement: AUX_TEX_DIST_REPLACEMENT,
    doneMarker: "__v14dAuxTexturePaths?.has(logicalPath)",
    label: "dist/engine.js aux mask 禁 mipmap",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: TEX_FORMAT_SRC_ANCHOR,
    replacement: TEX_FORMAT_SRC_REPLACEMENT,
    doneMarker: "__isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\"",
    label: "src/engine.ts aux mask 非 sRGB 视图",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: TEX_FORMAT_DIST_ANCHOR,
    replacement: TEX_FORMAT_DIST_REPLACEMENT,
    doneMarker: "__isAuxMask ? \"rgba8unorm\" : \"rgba8unorm-srgb\"",
    label: "dist/engine.js aux mask 非 sRGB 视图",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: BINDGROUP_LAYOUT_SRC_ANCHOR_STRUCTURED,
    replacement: BINDGROUP_LAYOUT_SRC_REPLACEMENT_STRUCTURED,
    doneMarker: "// V14D State2 实时合成：extra mask texture",
    label: "src/engine.ts bind group 布局 binding(5)",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: BINDGROUP_LAYOUT_DIST_ANCHOR_STRUCTURED,
    replacement: BINDGROUP_LAYOUT_DIST_REPLACEMENT_STRUCTURED,
    doneMarker: "// V14D State2 实时合成：extra mask texture",
    label: "dist/engine.js bind group 布局 binding(5)",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: CREATE_BINDGROUP_SRC_ANCHOR,
    replacement: CREATE_BINDGROUP_SRC_REPLACEMENT_FIXED,
    doneMarker: "baseEntries.some((e) => e.binding === 5)",
    label: "src/engine.ts createMaterialBindGroup binding(5)",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: CREATE_BINDGROUP_DIST_ANCHOR,
    replacement: CREATE_BINDGROUP_DIST_REPLACEMENT_FIXED,
    doneMarker: "baseEntries.some((e) => e.binding === 5)",
    label: "dist/engine.js createMaterialBindGroup binding(5)",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: SETUP_MASK_SRC_ANCHOR,
    replacement: SETUP_MASK_SRC_REPLACEMENT,
    doneMarker: "__auxMaskView",
    label: "src/engine.ts setupMaterialsForInstance mask 加载",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: SETUP_MASK_DIST_ANCHOR,
    replacement: SETUP_MASK_DIST_REPLACEMENT,
    doneMarker: "__auxMaskView",
    label: "dist/engine.js setupMaterialsForInstance mask 加载",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: SETUP_BINDGROUP_SRC_ANCHOR,
    replacement: SETUP_BINDGROUP_SRC_REPLACEMENT,
    doneMarker: "this.zeroStyleBuffer,\n        __auxMaskView,",
    label: "src/engine.ts setupMaterialsForInstance bindGroup 传 mask",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: SETUP_BINDGROUP_DIST_ANCHOR,
    replacement: SETUP_BINDGROUP_DIST_REPLACEMENT,
    doneMarker: "this.zeroStyleBuffer, __auxMaskView);",
    label: "dist/engine.js setupMaterialsForInstance bindGroup 传 mask",
  },
];

// slots.ts/compile.ts：v14d-state2-face graph 编译时注入 mask 纹理声明 + 合成 helper。
// 常量来自权威 blend 取证（web/scripts/forensic-v14d-face-state2.py 输出 manifest）。
const SLOTS_STATE2_ANCHOR = "const HAIR_OVER_EYES_DECL = `override IS_OVER_EYES: bool = false;\n\n`\n";
const SLOTS_STATE2_REPLACEMENT = "const HAIR_OVER_EYES_DECL = `override IS_OVER_EYES: bool = false;\n\n`\n\n// V14D State2 实时合成（Stage 2B-M1）：extra mask 纹理声明 + 合成 helper。\n// 常量来自权威 blend 取证（web/scripts/forensic-v14d-face-state2.py 输出 manifest）：\n//   warm=[1,0.935,0.89], shadowTint=[0.66,0.58,0.60], fringeTint=[0.70,0.64,0.69]。\n// mask 纹理为 rgba8unorm（非 sRGB 解码视图），采样即线性值；仅在编译 tags 含\n// \"v14d-state2-face\" 的 graph 时注入，默认关闭。\nconst V14D_STATE2_MASK_DECL = `@group(2) @binding(5) var v14d_state2_mask: texture_2d<f32>;\n\n`;\n\nconst V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor(mask: vec3f) -> vec3f {\n  let inv_b = 1.0 - mask.b;\n  let art = mix(vec3f(1.0, 1.0, 1.0), vec3f(0.66, 0.58, 0.60), mask.r * inv_b);\n  let fringe = mix(vec3f(1.0, 1.0, 1.0), vec3f(0.70, 0.64, 0.69), mask.g * inv_b);\n  return art * fringe;\n}\n\nfn v14d_state2_composite(base: vec3f, mask: vec3f) -> vec3f {\n  let warm = base * vec3f(1.0, 0.935, 0.89);\n  return warm * v14d_state2_shadow_factor(mask);\n}\n\n`;\n";
const SLOTS_STATE2_DIST_ANCHOR = "const HAIR_OVER_EYES_DECL = `override IS_OVER_EYES: bool = false;\n\n`;\n";
const SLOTS_STATE2_DIST_REPLACEMENT = "const HAIR_OVER_EYES_DECL = `override IS_OVER_EYES: bool = false;\n\n`;\n// V14D State2 实时合成（Stage 2B-M1）：extra mask 纹理声明 + 合成 helper。\n// 常量来自权威 blend 取证（web/scripts/forensic-v14d-face-state2.py 输出 manifest）：\n//   warm=[1,0.935,0.89], shadowTint=[0.66,0.58,0.60], fringeTint=[0.70,0.64,0.69]。\n// mask 纹理为 rgba8unorm（非 sRGB 解码视图），采样即线性值；仅在编译 tags 含\n// \"v14d-state2-face\" 的 graph 时注入，默认关闭。\nconst V14D_STATE2_MASK_DECL = `@group(2) @binding(5) var v14d_state2_mask: texture_2d<f32>;\n\n`;\n\nconst V14D_STATE2_HELPERS_WGSL = `fn v14d_state2_shadow_factor(mask: vec3f) -> vec3f {\n  let inv_b = 1.0 - mask.b;\n  let art = mix(vec3f(1.0, 1.0, 1.0), vec3f(0.66, 0.58, 0.60), mask.r * inv_b);\n  let fringe = mix(vec3f(1.0, 1.0, 1.0), vec3f(0.70, 0.64, 0.69), mask.g * inv_b);\n  return art * fringe;\n}\n\nfn v14d_state2_composite(base: vec3f, mask: vec3f) -> vec3f {\n  let warm = base * vec3f(1.0, 0.935, 0.89);\n  return warm * v14d_state2_shadow_factor(mask);\n}\n\n`;\n";
const SLOTS_ASSEMBLE_SRC_ANCHOR = "export function assembleModule(\n  renderClass: RenderClass,\n  alphaMode: AlphaMode,\n  fsBody: string,\n  includeStyleUniforms: boolean,\n): string {\n  return (\n    NODES_WGSL +\n    COMMON_MATERIAL_PRELUDE_WGSL +\n    (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n    decls(renderClass, alphaMode) +\n    prelude(renderClass, alphaMode) +\n    fsBody +\n    \"\\n\" +\n    epilogue(renderClass, alphaMode) +\n    \"}\\n\"\n  )\n}";
const SLOTS_ASSEMBLE_SRC_REPLACEMENT = "export function assembleModule(\n  renderClass: RenderClass,\n  alphaMode: AlphaMode,\n  fsBody: string,\n  includeStyleUniforms: boolean,\n  includeState2Mask = false,\n): string {\n  return (\n    NODES_WGSL +\n    COMMON_MATERIAL_PRELUDE_WGSL +\n    (includeState2Mask ? V14D_STATE2_MASK_DECL : \"\") +\n    (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n    decls(renderClass, alphaMode) +\n    (includeState2Mask ? V14D_STATE2_HELPERS_WGSL : \"\") +\n    prelude(renderClass, alphaMode) +\n    fsBody +\n    \"\\n\" +\n    epilogue(renderClass, alphaMode) +\n    \"}\\n\"\n  )\n}";
const SLOTS_ASSEMBLE_DIST_ANCHOR = "export function assembleModule(renderClass, alphaMode, fsBody, includeStyleUniforms) {\n    return (NODES_WGSL +\n        COMMON_MATERIAL_PRELUDE_WGSL +\n        (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n        decls(renderClass, alphaMode) +\n        prelude(renderClass, alphaMode) +\n        fsBody +\n        \"\\n\" +\n        epilogue(renderClass, alphaMode) +\n        \"}\\n\");\n}";
const SLOTS_ASSEMBLE_DIST_REPLACEMENT = "export function assembleModule(renderClass, alphaMode, fsBody, includeStyleUniforms, includeState2Mask = false) {\n    return (NODES_WGSL +\n        COMMON_MATERIAL_PRELUDE_WGSL +\n        (includeState2Mask ? V14D_STATE2_MASK_DECL : \"\") +\n        (includeStyleUniforms ? STYLE_UNIFORMS_WGSL : \"\") +\n        decls(renderClass, alphaMode) +\n        (includeState2Mask ? V14D_STATE2_HELPERS_WGSL : \"\") +\n        prelude(renderClass, alphaMode) +\n        fsBody +\n        \"\\n\" +\n        epilogue(renderClass, alphaMode) +\n        \"}\\n\");\n}";
const COMPILE_ASSEMBLE_SRC_ANCHOR = "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current)";
const COMPILE_ASSEMBLE_SRC_REPLACEMENT = "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false)";
const COMPILE_ASSEMBLE_DIST_ANCHOR = "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current);";
const COMPILE_ASSEMBLE_DIST_REPLACEMENT = "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false);";

// 断点 A：以 graph.name 精确覆写编译器生成的 final_color 行。函数使用真实换行
// 拆分，并保留 node 注释；非 State2 graph 原样返回。src/dist 的表达式保持同构。
const STATE2_OVERRIDE_SRC = [
  "// V14D_STATE2_OVERRIDE_FIX_BEGIN",
  "export function v14dState2OverrideFsBodyFixed(graphName: string, fsBody: string): string {",
  "  if (graphName !== \"V14D Face State2 Live ShadowFactor\" && graphName !== \"V14D Face State2 Live Composite\") return fsBody",
  "  const lines = fsBody.split(\"\\n\")",
  "  const finalIndex = lines.findIndex((line) => /\\blet final_color\\s*=/.test(line))",
  "  if (finalIndex < 0) return fsBody",
  "  const tag = lines[finalIndex].match(/\\s+(\\/\\/.*)$/)?.[1] ?? \"\"",
  "  const mask = \"textureSample(v14d_state2_mask, diffuseSampler, input.uv).rgb\"",
  "  const expr = graphName === \"V14D Face State2 Live ShadowFactor\" ? \"v14d_state2_shadow_factor(\" + mask + \")\" : \"v14d_state2_composite(tex_color, \" + mask + \")\"",
  "  lines[finalIndex] = \"  let final_color = \" + expr + \";\" + tag",
  "  return lines.join(\"\\n\")",
  "}",
  "// V14D_STATE2_OVERRIDE_FIX_END",
].join("\n");
const STATE2_OVERRIDE_DIST = [
  "// V14D_STATE2_OVERRIDE_FIX_BEGIN",
  "export function v14dState2OverrideFsBodyFixed(graphName, fsBody) {",
  "    if (graphName !== \"V14D Face State2 Live ShadowFactor\" && graphName !== \"V14D Face State2 Live Composite\") return fsBody;",
  "    const lines = fsBody.split(String.fromCharCode(10));",
  "    const finalIndex = lines.findIndex((line) => /\\blet final_color\\s*=/.test(line));",
  "    if (finalIndex < 0) return fsBody;",
  "    const tag = lines[finalIndex].match(/\\s+(\\/\\/.*)$/)?.[1] ?? \"\";",
  "    const mask = \"textureSample(v14d_state2_mask, diffuseSampler, input.uv).rgb\";",
  "    const expr = graphName === \"V14D Face State2 Live ShadowFactor\" ? \"v14d_state2_shadow_factor(\" + mask + \")\" : \"v14d_state2_composite(tex_color, \" + mask + \")\";",
  "    lines[finalIndex] = \"  let final_color = \" + expr + \";\" + tag;",
  "    return lines.join(String.fromCharCode(10));",
  "}",
  "// V14D_STATE2_OVERRIDE_FIX_END",
].join("\n");
const HASHED_ALPHA_ANCHOR = "const HASHED_ALPHA_DECLS = " + String.fromCharCode(96);

// compile/assembleModule 的同一调用行必须由一个 manifest target 一次性收敛，
// 同时完成 A 的 fsBody 覆写接线与 State2 tag 门控，避免多个 replace 依赖先后顺序。
const COMPILE_STATE2_IMPORT_SRC_ANCHOR = "import { assembleModule } from \"./slots\"\n";
const COMPILE_STATE2_IMPORT_SRC_REPLACEMENT = "import { assembleModule, v14dState2OverrideFsBodyFixed } from \"./slots\"\n";
const COMPILE_STATE2_IMPORT_DIST_ANCHOR = "import { assembleModule } from \"./slots\";\n";
const COMPILE_STATE2_IMPORT_DIST_REPLACEMENT = "import { assembleModule, v14dState2OverrideFsBodyFixed } from \"./slots\";\n";
const COMPILE_STATE2_SRC_FRESH_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current)",
].join("\n");
const COMPILE_STATE2_SRC_STATE2_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false)",
].join("\n");
const COMPILE_STATE2_SRC_A_ANCHOR = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody)",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current)",
].join("\n");
const COMPILE_STATE2_SRC_FINAL = [
  "  const fsBody = lines.join(\"\\n\")",
  "  const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody)",
  "  const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false)",
].join("\n");
const COMPILE_STATE2_DIST_FRESH_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current);",
].join("\n");
const COMPILE_STATE2_DIST_STATE2_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBody, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false);",
].join("\n");
const COMPILE_STATE2_DIST_A_ANCHOR = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody);",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current);",
].join("\n");
const COMPILE_STATE2_DIST_FINAL = [
  "    const fsBody = lines.join(\"\\n\");",
  "    const fsBodyLive = v14dState2OverrideFsBodyFixed(graph.name, fsBody);",
  "    const wgsl = assembleModule(opts.renderClass ?? \"auto\", opts.alphaMode ?? \"opaque\", fsBodyLive, usesStyle.current, graph.tags?.includes(\"v14d-state2-face\") ?? false);",
].join("\n");

const BASE_BIND_ENTRIES_SRC_ANCHOR = [
  "      const baseBindGroupEntries: GPUBindGroupEntry[] = [",
  "        { binding: 0, resource: textureView },",
  "        { binding: 1, resource: { buffer: materialUniformBuffer } },",
  "        { binding: 2, resource: (toonTexture ?? this.fallbackMaterialTexture).createView() },",
  "        { binding: 3, resource: (sphereTexture ?? this.fallbackMaterialTexture).createView() },",
  "      ]",
].join("\n");
const BASE_BIND_ENTRIES_SRC_REPLACEMENT = [
  "      const baseBindGroupEntries: GPUBindGroupEntry[] = [",
  "        { binding: 0, resource: textureView },",
  "        { binding: 1, resource: { buffer: materialUniformBuffer } },",
  "        { binding: 2, resource: (toonTexture ?? this.fallbackMaterialTexture).createView() },",
  "        { binding: 3, resource: (sphereTexture ?? this.fallbackMaterialTexture).createView() },",
  "        { binding: 5, resource: __auxMaskView },",
  "      ]",
].join("\n");
const BASE_BIND_ENTRIES_DIST_ANCHOR = [
  "            const baseBindGroupEntries = [",
  "                { binding: 0, resource: textureView },",
  "                { binding: 1, resource: { buffer: materialUniformBuffer } },",
  "                { binding: 2, resource: (toonTexture ?? this.fallbackMaterialTexture).createView() },",
  "                { binding: 3, resource: (sphereTexture ?? this.fallbackMaterialTexture).createView() },",
  "            ];",
].join("\n");
const BASE_BIND_ENTRIES_DIST_REPLACEMENT = [
  "            const baseBindGroupEntries = [",
  "                { binding: 0, resource: textureView },",
  "                { binding: 1, resource: { buffer: materialUniformBuffer } },",
  "                { binding: 2, resource: (toonTexture ?? this.fallbackMaterialTexture).createView() },",
  "                { binding: 3, resource: (sphereTexture ?? this.fallbackMaterialTexture).createView() },",
  "                { binding: 5, resource: __auxMaskView },",
  "            ];",
].join("\n");

const ASSIGN_GROUP_SRC_ANCHOR = [
  "      dc.bindGroup = this.createMaterialBindGroup(",
  "        " + String.fromCharCode(96) + "material: \${dc.materialName}" + String.fromCharCode(96) + ",",
  "        dc.baseBindGroupEntries,",
  "        install ? install.uniformBuffer : this.zeroStyleBuffer,",
  "      )",
].join("\n");
const ASSIGN_GROUP_SRC_REPLACEMENT = [
  "      dc.bindGroup = this.createMaterialBindGroup(",
  "        " + String.fromCharCode(96) + "material: \${dc.materialName}" + String.fromCharCode(96) + ",",
  "        [...dc.baseBindGroupEntries],",
  "        install ? install.uniformBuffer : this.zeroStyleBuffer,",
  "      )",
].join("\n");
const ASSIGN_GROUP_DIST_ANCHOR =
  "            dc.bindGroup = this.createMaterialBindGroup(" + String.fromCharCode(96) + "material: \${dc.materialName}" + String.fromCharCode(96) + ", dc.baseBindGroupEntries, install ? install.uniformBuffer : this.zeroStyleBuffer);";
const ASSIGN_GROUP_DIST_REPLACEMENT =
  "            dc.bindGroup = this.createMaterialBindGroup(" + String.fromCharCode(96) + "material: \${dc.materialName}" + String.fromCharCode(96) + ", [...dc.baseBindGroupEntries], install ? install.uniformBuffer : this.zeroStyleBuffer);";

const state2CompletenessTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: HASHED_ALPHA_ANCHOR,
    replacement: STATE2_OVERRIDE_SRC + "\n" + HASHED_ALPHA_ANCHOR,
    doneMarker: "export function v14dState2OverrideFsBodyFixed(graphName: string, fsBody: string): string",
    label: "src/graph/slots.ts state2 override 修正函数",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: HASHED_ALPHA_ANCHOR,
    replacement: STATE2_OVERRIDE_DIST + "\n" + HASHED_ALPHA_ANCHOR,
    doneMarker: "export function v14dState2OverrideFsBodyFixed(graphName, fsBody)",
    label: "dist/graph/slots.js state2 override 修正函数",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts"),
    anchor: COMPILE_STATE2_IMPORT_SRC_ANCHOR,
    replacement: COMPILE_STATE2_IMPORT_SRC_REPLACEMENT,
    doneMarker: "import { assembleModule, v14dState2OverrideFsBodyFixed } from \"./slots\"",
    label: "src/graph/compile.ts state2 override import 接线",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js"),
    anchor: COMPILE_STATE2_IMPORT_DIST_ANCHOR,
    replacement: COMPILE_STATE2_IMPORT_DIST_REPLACEMENT,
    doneMarker: "import { assembleModule, v14dState2OverrideFsBodyFixed } from \"./slots\"",
    label: "dist/graph/compile.js state2 override import 接线",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "compile.ts"),
    anchors: [COMPILE_STATE2_SRC_FRESH_ANCHOR, COMPILE_STATE2_SRC_STATE2_ANCHOR, COMPILE_STATE2_SRC_A_ANCHOR],
    replacement: COMPILE_STATE2_SRC_FINAL,
    doneMarker: COMPILE_STATE2_SRC_FINAL,
    label: "src/graph/compile.ts state2 override + tag 门控接线",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "compile.js"),
    anchors: [COMPILE_STATE2_DIST_FRESH_ANCHOR, COMPILE_STATE2_DIST_STATE2_ANCHOR, COMPILE_STATE2_DIST_A_ANCHOR],
    replacement: COMPILE_STATE2_DIST_FINAL,
    doneMarker: COMPILE_STATE2_DIST_FINAL,
    label: "dist/graph/compile.js state2 override + tag 门控接线",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: BASE_BIND_ENTRIES_SRC_ANCHOR,
    replacement: BASE_BIND_ENTRIES_SRC_REPLACEMENT,
    doneMarker: "binding: 5, resource: __auxMaskView",
    label: "src/engine.ts binding5 baseEntries",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: BASE_BIND_ENTRIES_DIST_ANCHOR,
    replacement: BASE_BIND_ENTRIES_DIST_REPLACEMENT,
    doneMarker: "binding: 5, resource: __auxMaskView",
    label: "dist/engine.js binding5 baseEntries",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: ASSIGN_GROUP_SRC_ANCHOR,
    replacement: ASSIGN_GROUP_SRC_REPLACEMENT,
    doneMarker: "...dc.baseBindGroupEntries",
    label: "src/engine.ts assignDrawCallGroups 展开 baseEntries",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "engine.js"),
    anchor: ASSIGN_GROUP_DIST_ANCHOR,
    replacement: ASSIGN_GROUP_DIST_REPLACEMENT,
    doneMarker: "...dc.baseBindGroupEntries",
    label: "dist/engine.js assignDrawCallGroups 展开 baseEntries",
  },
];

const state2SlotTargets = [
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: SLOTS_STATE2_ANCHOR,
    replacement: SLOTS_STATE2_REPLACEMENT,
    doneMarker: "const V14D_STATE2_HELPERS_WGSL",
    label: "src/graph/slots.ts state2 helper 声明",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: SLOTS_STATE2_DIST_ANCHOR,
    replacement: SLOTS_STATE2_DIST_REPLACEMENT,
    doneMarker: "const V14D_STATE2_HELPERS_WGSL",
    label: "dist/graph/slots.js state2 helper 声明",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "graph", "slots.ts"),
    anchor: SLOTS_ASSEMBLE_SRC_ANCHOR,
    replacement: SLOTS_ASSEMBLE_SRC_REPLACEMENT,
    doneMarker: "includeState2Mask",
    label: "src/graph/slots.ts assembleModule state2 门控",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js"),
    anchor: SLOTS_ASSEMBLE_DIST_ANCHOR,
    replacement: SLOTS_ASSEMBLE_DIST_REPLACEMENT,
    doneMarker: "includeState2Mask",
    label: "dist/graph/slots.js assembleModule state2 门控",
  },
];
state2Targets.push(...state2CompletenessTargets, ...state2SlotTargets);
passthroughTargets.push(...state2Targets);

applyPatchManifest(passthroughTargets, "display-passthrough");

// ─── 断点 C 幂等顺序修正:fresh install 后 dist slots.js 可能是旧顺序(helper 嵌套在 prelude/fn fs 内)。
// doneMarker=includeState2Mask 会让上面的 assembleModule target 跳过,掩盖模板旧顺序。
// 这里直接检测 dist slots.js 真实文本的 helper/prelude 先后,旧顺序则幂等替换为新顺序。
{
  const distSlots = path.join(rootDir, "node_modules", "reze-engine", "dist", "graph", "slots.js");
  if (fs.existsSync(distSlots)) {
    const NL = String.fromCharCode(10);
    const Q = String.fromCharCode(34);
    const helperRef = "(includeState2Mask ? V14D_STATE2_HELPERS_WGSL : " + Q + Q + ") +";
    const preludeRef = "prelude(renderClass, alphaMode) +";
    const oldOrder = "decls(renderClass, alphaMode) +" + NL + "        " + preludeRef + NL + "        " + helperRef;
    const newOrder = "decls(renderClass, alphaMode) +" + NL + "        " + helperRef + NL + "        " + preludeRef;
    let content = fs.readFileSync(distSlots, "utf8");
    if (content.includes(oldOrder)) {
      content = content.replace(oldOrder, newOrder);
      fs.writeFileSync(distSlots, content, "utf8");
      console.log("[patch-reze-engine] 断点C 顺序修正: dist slots.js helper 移到 prelude 之前");
      patchLog.push({ label: "dist slots.js 断点C 顺序修正", status: "injected" });
    } else if (content.includes(newOrder)) {
      patchLog.push({ label: "dist slots.js 断点C 顺序修正", status: "already" });
    }
  }
}


// ─── prebuild/predev 硬性失败：anchor miss / 目标文件缺失 / 注入计数异常非零退出 ──
// 静默跳过的补丁会让引擎行为与代码假设不一致（生产 Filmic/诊断 passthrough 错乱），
// 必须在普通 predev/prebuild 路径失败，而不是仅 warn 继续。
{
  const bad = patchLog.filter((e) => e.status === "anchor-miss" || e.status === "ambiguous-anchor" || e.status === "missing-file");
  if (bad.length) {
    console.error("===PATCH-APPLY-FAIL=== 以下补丁目标异常（anchor-miss/ambiguous-anchor/missing-file）：");
    for (const e of bad) console.error("  [" + e.status + "] " + e.label);
    process.exit(1);
  }
  // 普通 predev/prebuild 也做完整严格计数（拦截重复/缺失 marker，不只 anchor-miss）。
  if (!strictVerifyAll()) process.exit(1);
}
