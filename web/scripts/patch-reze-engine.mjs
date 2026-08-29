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
// 可重复验证：--verify 校验四处全部注入且各自恰好一次（幂等证据）。
if (process.argv.includes("--verify")) {
  const checks = [
    { label: "src/engine.ts 实现", file: overrideTargets[0].file, marker: "__mdoStart = texs.length" },
    { label: "dist/engine.js 实现", file: overrideTargets[1].file, marker: "__mdoStart = texs.length" },
    { label: "dist/engine.d.ts 类型", file: overrideTargets[2].file, marker: "materialDiffuseOverrides?: Record<string, string>;" },
    { label: "src/engine.ts 类型", file: overrideTargets[3].file, marker: "materialDiffuseOverrides?: Record<string, string>\n}" },
  ];
  let allOk = true;
  for (const c of checks) {
    const content = fs.existsSync(c.file) ? fs.readFileSync(c.file, "utf8") : "";
    const count = content.split(c.marker).length - 1;
    const ok = count === 1;
    if (!ok) allOk = false;
    console.log(`[verify] ${c.label}: marker 出现 ${count} 次 ${ok ? "OK" : "FAIL(应恰好1次)"}`);
  }
  if (!allOk) { console.error("===PATCH-VERIFY-FAIL==="); process.exit(1); }
  console.log("===PATCH-VERIFY-OK=== 四处全部恰好注入一次（首次完整注入 + 二次幂等）");
}
