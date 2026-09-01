// Stage 2B-M1 修正轮：断点 A（fsBody 覆写）+ 断点 B（binding(5) 重绑）红灯回归。
// 从仓库根运行。引擎 dist 为 ESM 且内部无扩展名 import，改为读取 dist 源文本做静态断言，
// 并用 new Function 执行 dist 实际接线的 override 函数、以编译器真实 fsBody 行格式做行为断言。
// 修复前必须 FAIL（红灯），修复后 PASS（转绿）。任一断言失败 exit 1。
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const slots = fs.readFileSync(path.join(root, "web", "node_modules", "reze-engine", "dist", "graph", "slots.js"), "utf8");
const slotsSrc = fs.readFileSync(path.join(root, "web", "node_modules", "reze-engine", "src", "graph", "slots.ts"), "utf8");
const compileSrc = fs.readFileSync(path.join(root, "web", "node_modules", "reze-engine", "src", "graph", "compile.ts"), "utf8");
const engine = fs.readFileSync(path.join(root, "web", "node_modules", "reze-engine", "dist", "engine.js"), "utf8");
const compile = fs.readFileSync(path.join(root, "web", "node_modules", "reze-engine", "dist", "graph", "compile.js"), "utf8");
const fails = [];
const ok = (cond, msg) => { if (cond) console.log("[ok] " + msg); else { fails.push(msg); console.error("[FAIL] " + msg); } };

// 断点 A0：fence 修正函数存在且被 compile 接线（运行时实际调用它）
const FIXED = "v14dState2OverrideFsBodyFixed";
ok(slots.indexOf("export function " + FIXED) >= 0, "断点A0 dist slots.js 存在 fence 修正函数 " + FIXED);
ok(compile.indexOf("const fsBodyLive = " + FIXED + "(graph.name, fsBody)") >= 0, "断点A0 compile.js 接线调用 fence 修正函数（运行时生效）");

// 断点 A0b：src 生效路径（Next transpilePackages 服务 reze-engine/src 的 TS 源，浏览器真正运行的代码）。
// 只修 dist 不改 src 时浏览器仍走旧 override——本票实际根因，必须断言 src 同步修复。
ok(slotsSrc.indexOf("export function " + FIXED + "(graphName: string, fsBody: string): string") >= 0, "断点A0b src slots.ts 存在带类型标注的 fence 修正函数（浏览器运行时生效路径）");
ok(compileSrc.indexOf("const fsBodyLive = " + FIXED + "(graph.name, fsBody)") >= 0, "断点A0b src compile.ts 接线调用 fence 修正函数（浏览器运行时生效路径）");
ok(compileSrc.indexOf("import { assembleModule, " + FIXED + " } from ") >= 0, "断点A0b src compile.ts import 接线 fence 修正函数");

// 断点 A1：fence 修正函数不得含调试残留 console.log
const fenceStart = slots.indexOf("// V14D_STATE2_OVERRIDE_FIX_BEGIN");
const fenceEnd = slots.indexOf("// V14D_STATE2_OVERRIDE_FIX_END", fenceStart);
const fenceBody = fenceStart >= 0 && fenceEnd > fenceStart ? slots.slice(fenceStart, fenceEnd) : "";
ok(fenceBody.length > 0, "断点A1 fence 块存在");
ok(fenceBody.indexOf("OVERRIDE-ENTRY") < 0 && fenceBody.indexOf("console.log") < 0, "断点A1 fence 修正函数无 console.log 调试残留");

// 断点 A2：fence 修正函数不再用「分号在注释后」的脆弱切片标记
ok(fenceBody.indexOf(" // @node:warm;") < 0, "断点A2 fence 不再寻找分号在注释后的错误标记");
// 断点 A2b：fence 必须以真实换行拆分/拼接（两字符转义是静默不生效的回归源）。
ok(fenceBody.indexOf("String.fromCharCode(10)") >= 0, "断点A2b fence 用真实换行（String.fromCharCode(10)）拆分/拼接 fsBody");
// 断点 A2c：fence 结束标记完整闭合（残缺 FIX_ENDD 会让后续 WGSL 函数体不闭合）。
ok(slots.indexOf("V14D_STATE2_OVERRIDE_FIX_ENDD") < 0, "断点A2c fence 结束标记无残缺变体（FIX_ENDD）");

// 断点 A3：fence 修正函数行为断言（编译器真实 fsBody 行格式，分号在注释前）
if (fenceBody.length > 0) {
  const fi = fenceBody.indexOf("export function " + FIXED);
  const fnText = fenceBody.slice(fi).replace("export function", "function");
  const impl = (new Function(fnText + ";return " + FIXED + ";"))();
  const realFsBody = "  let n_warm = vec3f(1.0, 0.935, 0.89); // @node:warm" + String.fromCharCode(10) + "  let final_color = n_warm; // @node:warm";
  const shadow = impl("V14D Face State2 Live ShadowFactor", realFsBody);
  const comp = impl("V14D Face State2 Live Composite", realFsBody);
  const normal = impl("V14D Material Unlit Diagnostic", realFsBody);
  ok(shadow.indexOf("let final_color = v14d_state2_shadow_factor(") >= 0, "断点A3 Shadow final_color 调 shadow_factor；末行=" + JSON.stringify(shadow.split(String.fromCharCode(10)).pop()));
  ok(comp.indexOf("let final_color = v14d_state2_composite(") >= 0, "断点A3 Composite final_color 调 composite；末行=" + JSON.stringify(comp.split(String.fromCharCode(10)).pop()));
  ok(normal === realFsBody, "断点A3 normal graph 保持不变 changed=false");
  // 边界：final_color 行尾无注释时也能覆写（用默认 warm tag），且不破坏其他行
  const noTag = "  let final_color = n_warm;";
  const shadow2 = impl("V14D Face State2 Live ShadowFactor", noTag);
  ok(shadow2.indexOf("let final_color = v14d_state2_shadow_factor(") >= 0, "断点A3 边界：无 @node 注释行也能覆写");
}

// 断点 B1：setup 把 __auxMaskView 写入 baseBindGroupEntries (binding 5)
const bIdx = engine.indexOf("baseBindGroupEntries = [");
const bSeg = bIdx >= 0 ? engine.slice(bIdx, bIdx + 700) : "";
ok(bSeg.indexOf("binding: 5, resource: __auxMaskView") >= 0, "断点B1 setup 把 __auxMaskView 写入 baseBindGroupEntries (binding 5)");
// 断点 B2：createMaterialBindGroup 仅在 baseEntries 无 binding5 时补 fallback
ok(engine.indexOf("!baseEntries.some((e) => e.binding === 5)") >= 0, "断点B2 createMaterialBindGroup 缺失 binding5 才补 fallback");
// 断点 B3：assignDrawCallGroups 重绑展开 dc.baseBindGroupEntries（自动携带 mask）
const aIdx = engine.indexOf("assignDrawCallGroups(inst, claimed) {");
const aSeg = aIdx >= 0 ? engine.slice(aIdx, aIdx + 1400) : "";
ok(aSeg.indexOf("...dc.baseBindGroupEntries") >= 0, "断点B3 assignDrawCallGroups 重绑展开 dc.baseBindGroupEntries");

if (fails.length) { console.error("===OVERRIDE-REGRESSION-FAIL===" + String.fromCharCode(10) + fails.join(String.fromCharCode(10))); process.exit(1); }
console.log("===OVERRIDE-REGRESSION-OK=== 断点A/B 全部通过");
