# Stage 2C-M2a.3：Brows/Lashes 显示链诊断交付

## 1. 本轮结果

本票已闭合 Brows/Lashes `wrongTint` 的最小显示链诊断与 acceptance-only 回归：确认 graph/WGSL/pipeline 编译安装成功后，冻结 render loop 若没有下一次真实 `renderFrame`/command submission，最终 canvas 会继续显示上一帧；在正确接缝补充一次零增量帧提交后，sentinel tint `[0,1,1]` 能进入真实 Brows/Lashes draw，并在 pre-tonemap HDR、resolve/composite 后的最终 canvas 产生机器可拒绝的强差异。

这不是 Brows/Lashes 正式迁移 Gate 的整体完成声明：逐槽 identity-target、Lashes 透明边缘和动态 Morph Gate 仍未闭合。

## 2. 原问题与影响

Stage 2C-M2a 已证明 Brows/Lashes graph、WGSL 和 pipeline 安装成功，且两个槽各有 1/1 OnComposite；但 identity 与 `wrongBrowsLashesTint` 的 canvas 指标几乎相同。若只读取 graph、安装结果或分组计数，会把“前置状态变化”误报为“最终画布已变化”，无法区分旧 pipeline、重绑、后续 pass 覆盖和采集时序。

## 3. 根因

最小冻结帧复现的首个丢失边界是：

`applyStyleGroups` 返回之后 → 下一次 `renderFrame`/command submission 之前。

identity 实际 Brows/Lashes draw 使用 `gpu-1`；sentinel compile/install pipeline 变为 `gpu-36`，但旧路径冻结 render loop 后没有新的 `renderFrame`，所以实际 draw trace 仍是 identity，HDR resolve 与 canvas 仍是上一提交帧。已证伪 pipeline cache/signature 复用、draw range 变化、bind group 变化、compile/install 失败、HDR resolve/tone mapping 覆盖，以及 page error/WebGPU validation/HTTP 失败。

诊断开始前先固定了 5 个可证伪假设与预测：H1 为冻结帧缺少新的 `renderFrame`/command submission，预测补零增量帧后 draw/HDR/canvas 都变化；H2 为 pipeline cache/signature 复用，预测 identity 与 sentinel pipeline 身份相同；H3 为 apply 后 draw-call group/pipeline 未重建，预测实际 `setPipeline` 仍为 identity；H4 为后续 pass 覆盖，预测 HDR 变化而 resolve/canvas 不变；H5 为采集/重建撤销 sentinel，预测 graph/tint/pipeline 回退或出现请求错误。最终仅 H1 被确认，H2-H5 均由实际 trace、HDR/canvas 和错误计数证伪。

## 4. 解决方式

- 在 `?v14dAcceptanceProbe=1` 下增加默认关闭的 `installDisplayChainTrace`、`setDisplayChainTraceCapture`、`captureDisplayChainState`。它们只读记录真实 `setPipeline`、`setBindGroup(2)`、`drawIndexed`、draw range、bind group、compile/install pipeline、composite pipeline、HDR 和 canvas 统计。
- `applyBadSkinGraph()` 在 acceptance probe 内、应用成功且 render loop 已停止时提交一次 `engine.renderFrame(0)`；live loop 运行时不额外推进时间。
- 负测显式传 `render:false`，保留 stale-render 故障并要求 `renderObserved=false`、exit 1。
- 组件卸载时恢复被包装的 engine 方法，避免 probe wrapper 残留。

## 5. 修改前后行为

| 场景 | 修改前/故障注入 | 修正后 |
| --- | --- | --- |
| identity | pipeline `gpu-1`，真实 draw 可观察 | 保持健康 |
| sentinel `[0,1,1]` | compile/install 变化但冻结帧不提交，canvas no-effect | 实际 draw 使用 `gpu-36`，HDR 与 canvas 强变化 |
| pipeline/cache | 曾被怀疑复用旧对象 | identity `gpu-1` 与 sentinel `gpu-36` 不同，且实际 draw 等于 sentinel |
| stale rebind/未提交负测 | 可能被 `applied.ok=true` 包装 | `renderObserved=false` 机器拒绝，exit 1 |

## 6. 验证结果

权威输入固定为 Koleda PMX、4 秒、30 FPS、frame 120、face 相机；默认复现使用真实 `/companion`、VMD 和 reze-k3 WebGPU。

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node web/scripts/repro-v14d-brows-lashes-display-chain.mjs` | exit 0 | `final-green-5/report.json`；identity/sentinel 共用 captureId `v14d-bl-pair`；identity `gpu-1`，sentinel `gpu-36`；Brows HDR 红均值 `0.162728 -> 0.026098`，Lashes `0.077985 -> 0.018781`；目标像素 changedRatio `0.956458`，meanAbsRgbSum `46.339945`；page/HTTP/request errors 均 0；脚本同时校验 bind group、draw 顺序/范围/group 与实际 draw pipeline |
| `node web/scripts/repro-v14d-brows-lashes-display-chain.mjs --fault-no-render` | exit 1（预期） | `final-negative-5/report.json`；同一 captureId `v14d-bl-pair`；`applied.ok=true`、sentinel pipeline `gpu-36`，`renderObserved=false`，失败原因 `sentinel actual render/setPipeline was not observed` |
| `node --check web/scripts/repro-v14d-brows-lashes-display-chain.mjs` | exit 0 | 最小复现脚本语法检查通过 |
| `node --test tests/v14d-brows-lashes-partition.test.mjs tests/v14d-hair-partition.test.mjs tests/reze-k3-skin-variant.test.mjs`（在 `web/`） | exit 0 | 45 tests，44 pass，1 个既有 triUV 证据缺失测试按预期 skip，0 fail |
| `node scripts/patch-reze-engine.mjs --verify`（在 `web/`） | exit 0 | 基线 87 项严格不变量全部通过 |
| `node scripts/patch-reze-engine.mjs --self-test`（在 `web/`） | exit 0 | fresh fixture 首次/二次幂等、anchor-miss/missing-file/重复 marker 负测和真实 node_modules 不变全部通过 |
| `npm run build`（在 `web/`） | exit 0 | Next.js 编译、类型检查、静态页生成和优化全部通过；构建产生的 `web/next-env.d.ts` 生成物差异已移除 |
| `node scripts/probe-v14d-vmd-runtime.mjs`（在 `web/`，`V14D_CAPTURE_ORIGIN=http://127.0.0.1:3114`） | exit 0 | 默认非 acceptance 入口完成 VMD load→play→pause→seek，seek 到 `2.000s`，无 v14dFaceStatic/engine probe 泄漏；控制台既有 Three.js 属性警告不构成 page error |
| `npm run check:basic`（在 `web/`） | exit 1（基线既有） | `run-basic-checks.mjs` 仍要求 `const initialSettings = sceneSettings ?? DEFAULT_SETTINGS` 旧字面结构；冻结 base 与当前代码均使用 `sceneSettings ?? pipelineDefaultSettings`，本票未改该无关断言 |
| `git diff --check` | exit 0 | 无空白错误（仅有 Windows 换行提示） |

## 7. 范围边界与遗留风险

- 没有修改 `patch-reze-engine.mjs`、正式 Brows/Lashes identity tint、Face/BodySkin/HairA/HairB 公式、灯光、星空、曝光、gamma、tone mapping、相机、PMX/VMD/Morph/物理或 alpha analyzer。
- display-chain trace 和零增量补帧只在显式 acceptance probe 下生效；默认生产入口不挂载。
- full G1-G7/fast-bl 未作为本票通过证据；此前 fast-bl 的 Google Fonts 超时、字体 failed request 与既有 Lashes alpha-edge 负测属于独立问题，不能混入本票结论。
- Brows/Lashes 的逐槽原子 material-ID+triUV+pixel、Lashes 透明边缘和动态 Morph Gate 仍需后续独立票据。
- 不同浏览器/WebGPU 后端的 HDR readback 与队列时序矩阵尚未运行。

## 8. 可复用知识候选

本票新增“显示链提交边界”和“编译/安装非最终显示证明”两个稳定概念。后续任何“编译成功但画布无效果”的诊断，必须分别观察实际 draw pipeline、bind group/draw range、pre-tonemap HDR、resolve/composite 和最终 canvas；不能用 compile/install、OnComposite、样本计数或 analyzer 阈值替代。

## 证据路径

- 红灯（修复前）：`.scratch/repro-v14d-brows-lashes-display-chain/report-red-before-fix.json`。
- 健康绿测：`.scratch/repro-v14d-brows-lashes-display-chain/final-green-5/report.json`。
- stale-render 负测：`.scratch/repro-v14d-brows-lashes-display-chain/final-negative-5/report.json`。
- 相关代码：`web/src/features/stage/RezeWebGpuStage.tsx`、`web/scripts/repro-v14d-brows-lashes-display-chain.mjs`。
- 概念：`workflow/concepts/v14d-display-chain-commit-boundary.zh-CN.md`、`workflow/concepts/v14d-compile-install-not-display-proof.zh-CN.md`。
