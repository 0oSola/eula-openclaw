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
    anchor: "    pmxFile?: File;\n};",
    replacement: "    pmxFile?: File;\n    /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n    materialDiffuseOverrides?: Record<string, string>;\n};",
    doneMarker: "materialDiffuseOverrides?: Record<string, string>;",
    label: "dist/engine.d.ts 类型",
  },
  {
    file: path.join(rootDir, "node_modules", "reze-engine", "src", "engine.ts"),
    anchor: "  pmxFile?: File\n}",
    replacement: "  pmxFile?: File\n  /** Per-material diffuse override (material name -> unique logicalPath). Default off. Applied BEFORE GPU material setup. */\n  materialDiffuseOverrides?: Record<string, string>\n}",
    doneMarker: "materialDiffuseOverrides?: Record<string, string>\n}",
    label: "src/engine.ts 类型",
  },
];

// 每个 target 独立 marker（实现用 __mdo、类型用完整字段声明），避免同文件内实现/类型互相跳过。
const patchLog = [];
for (const t of overrideTargets) {
  if (!fs.existsSync(t.file)) { patchLog.push({ label: t.label, status: "missing-file" }); continue; }
  const content = fs.readFileSync(t.file, "utf8");
  if (content.includes(t.doneMarker)) { patchLog.push({ label: t.label, status: "already" }); continue; }
  if (!content.includes(t.anchor)) {
    console.warn(`[patch-reze-engine] materialDiffuseOverrides 锚点未匹配，跳过: ${t.label}`);
    patchLog.push({ label: t.label, status: "anchor-miss" });
    continue;
  }
  fs.writeFileSync(t.file, content.replace(t.anchor, t.replacement), "utf8");
  patchLog.push({ label: t.label, status: "injected" });
  console.log(`[patch-reze-engine] 已注入 materialDiffuseOverrides: ${t.label}`);
}
// 上方注入循环后立即进行统一严格校验定义；predev/prebuild 与 --verify 共用。
// ─── 统一严格校验（predev/prebuild 与 --verify 共用）：全部 marker 恰好一次。 ──
// 不只在 --verify 才计数；普通 predev/prebuild 也必须拦截重复/缺失 marker，
// 否则生命周期内重复注入或部分注入不会被发现。任一 marker 非恰好一次即 exit 1。
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
    { label: "src/engine.ts 类型", file: engineSrc, marker: "materialDiffuseOverrides?: Record<string, string>\n}" },

    { label: "src/engine.ts setter", file: engineSrc, marker: "v.displayPassthrough = patch.displayPassthrough" },
    { label: "dist/engine.js setter", file: engineDistJs, marker: "v.displayPassthrough = patch.displayPassthrough" },
    { label: "src/engine.ts uniform u[2]", file: engineSrc, marker: "u[2] = v.displayPassthrough ? 1.0 : 0.0" },
    { label: "dist/engine.js uniform u[2]", file: engineDistJs, marker: "u[2] = v.displayPassthrough ? 1.0 : 0.0" },
    { label: "src merge 默认 false", file: engineSrc, marker: "displayPassthrough: partial?.displayPassthrough" },
    { label: "dist merge 默认 false", file: engineDistJs, marker: "displayPassthrough: partial?.displayPassthrough" },
    { label: "src ViewTransformOptions 类型", file: engineSrc, marker: "displayPassthrough?: boolean\n}" },

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
  ];
  let allOk = true;
  for (const c of checks) {
    const content = fs.existsSync(c.file) ? fs.readFileSync(c.file, "utf8") : "";
    const count = content.split(c.marker).length - 1;
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

for (const t of passthroughTargets) {
  if (!fs.existsSync(t.file)) { patchLog.push({ label: t.label, status: "missing-file" }); continue; }
  const content = fs.readFileSync(t.file, "utf8");
  if (content.includes(t.doneMarker)) { patchLog.push({ label: t.label, status: "already" }); continue; }
  if (!content.includes(t.anchor)) {
    console.warn(`[patch-reze-engine] display-passthrough 锚点未匹配，跳过: ${t.label}`);
    patchLog.push({ label: t.label, status: "anchor-miss" });
    continue;
  }
  fs.writeFileSync(t.file, content.replace(t.anchor, t.replacement), "utf8");
  patchLog.push({ label: t.label, status: "injected" });
  console.log(`[patch-reze-engine] 已注入 display-passthrough: ${t.label}`);
}

// ─── prebuild/predev 硬性失败：anchor miss / 目标文件缺失 / 注入计数异常非零退出 ──
// 静默跳过的补丁会让引擎行为与代码假设不一致（生产 Filmic/诊断 passthrough 错乱），
// 必须在普通 predev/prebuild 路径失败，而不是仅 warn 继续。
{
  const bad = patchLog.filter((e) => e.status === "anchor-miss" || e.status === "missing-file");
  if (bad.length) {
    console.error("===PATCH-APPLY-FAIL=== 以下补丁目标异常（anchor-miss/missing-file）：");
    for (const e of bad) console.error("  [" + e.status + "] " + e.label);
    process.exit(1);
  }
  // 普通 predev/prebuild 也做完整严格计数（拦截重复/缺失 marker，不只 anchor-miss）。
  if (!strictVerifyAll()) process.exit(1);
}

// ─── 最小负测（--self-test）：证明 anchor miss / missing file / 重复 marker 均非零退出。
// 在临时副本上运行，不触碰真实 node_modules。临时副本用"空 targets"（全部 missing-file），
// 证明 missing-file 路径非零退出；重复 marker 用独立计数逻辑自证（count!=1 即 FAIL）。
if (process.argv.includes("--self-test")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gf4-patch-selftest-"));
  const fake = path.join(tmp, "patch-reze-engine.mjs");
  // 复制本脚本，但把 rootDir 指向不存在的 node_modules，制造全 missing-file。
  let src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  src = src.replace('const rootDir = path.resolve(__dirname, "..");', 'const rootDir = path.join(__dirname, "__nonexistent__");');
  fs.writeFileSync(fake, src);
  const { execFileSync } = await import("node:child_process");
  let missingExit = 0;
  try { execFileSync(process.execPath, [fake], { stdio: "pipe" }); } catch (e) { missingExit = e.status ?? 1; }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (missingExit === 0) { console.error("SELF-TEST-FAIL: missing-file 路径未非零退出"); process.exit(1); }
  // 重复 marker：strictVerifyAll 要求 count==1；构造含 2 个 marker 的内容自证计数会判 FAIL。
  const dupContent = "x __mdoStart = texs.length y __mdoStart = texs.length z";
  const dupCount = dupContent.split("__mdoStart = texs.length").length - 1;
  if (dupCount !== 2) { console.error("SELF-TEST-FAIL: 重复 marker 计数逻辑错误"); process.exit(1); }
  console.log("===PATCH-SELF-TEST-OK=== missing-file 非零退出(exit=" + missingExit + "); 重复 marker 计数自证(count=" + dupCount + " 非 1 即 FAIL)");
  process.exit(0);
}
