# Reze K3 V1（V14D）真实舞台视觉与 VMD 验收交付（第二轮修正）

**票据**：`codex/reze-k3-v1-stage-visual-acceptance`（来源 `codex/reze-k3-v1-acceptance-contract-cleanup`）
**执行模型**：kimi/k3-256k（视觉识别/真实浏览器验收）
**工作树**：`E:\codexWorktree\004b\MMD project`，分支 `codex/reze-k3-v1-stage-visual-acceptance`
**基线**：base_commit `6430ee11750c575620b70702ce755e99c9fad88e`
**完成时间**：2026-09-02（第二轮）

## 结论

**G1-G7 全部通过**。真实生产 `/companion` 舞台的「原始 Reze K3 / Reze K3 V1（V14D）」切换在
**保留 Reze K3 原有灯光与星空背景**的前提下端到端可用：V1 仅让 Face/BodySkin 材质响应接近
V14D State2 目标风格，用户相机、正常 VMD 播放、K3 灯光、星空背景与非皮肤材质外观全部保留。

> **撤回声明**：第一轮（本文件旧版）「G1-G7 全部通过」的结论被来源主会话撤回——彼时验收未在
> 原 K3 舞台环境约束下证明场景不变性，且缺少错误 graph / applyStyleGroups 失败负测、G3 仅算
> verdict 未硬阻断、G6 软通过、failedRequests 未入 Gate。本轮按新硬约束重做并加严，结论以本轮为准。

> **环境措辞**：本机无 Python，API 后端（127.0.0.1:8000）不可达，验收用 Playwright route 存根
> bootstrap API。因此本轮结论是「**存根环境端到端**」，不是真实部署生产端到端。V1 资格判定、
> graph 绑定、材质渲染、VMD 播放均不依赖 API（全部由前端 + 本地导入完成），API 仅服务于
> 会话/bootstrap 存根。

## 验收环境

| 项 | 值 |
| --- | --- |
| 页面 | 生产 `/companion`（非 `/mmd-calibration-render`），带 `?v14dAcceptanceProbe=1` 显式验收开关 |
| 端口 | 3114（本工作树独立 dev server） |
| 浏览器 | 系统 Chrome headless + Playwright（`--enable-unsafe-webgpu`） |
| 权威 PMX | `D:\mmd\克莱妲原皮\GirlsFrontline KoledaDefault.pmx` |
| 权威 VMD | `koleda-v14d-authoritative-pose-f120.vmd`（来源 `C:\w\rk3-face-v14d\web\public\assets\mmd\calibration\koleda-v14d\`），SHA256 `2536C886…` |
| State2 mask | `v14d-01234-face-shadow-state-2.png`，SHA256 `42D2F95AF877EBFA9D5266195742DCA95FE0463A8CB093B24A14717D2C33A103` |
| 导入方式 | 真实目录 `setInputFiles`（webkitdirectory），PMX/纹理/mask 同一 FileList |
| API 兜底 | Playwright route 拦截 `/api/backend/**` 与直连 `127.0.0.1:8000/**`（纹理从权威目录真实映射） |

## 门禁结果（gate-report.json）

| Gate | 状态 | 关键证据 |
| --- | --- | --- |
| G1 用户路径与切换 | ✅ pass | 导入后变体 UI 出现；点 V1 后 UI=v1、canvas=v1、faceGraph=V14D Face State2 Live Composite；切回 original 一致；failedRequests=0、httpBad=0（存根环境） |
| G2 真实绑定 + 负测 | ✅ pass | Face/BodySkin drawCalls 各 1/1 命中合成 graph；负测 original不命中/重命名PMX/缺mask/**错误graph(composite命中=0)**/**applyStyleGroups失败(回退original)** 全过 |
| G3 完整模型视觉 A/B | ✅ pass | 皮肤区（掩码采样）face MAE=31.4、neck=11.5、leftHand=23.6、rightHand=26.1 显著收敛；非皮肤/星空稳定；waist 标 occluded |
| G4 持久化 | ✅ pass | V1 刷新+重导入后 UI=v1、canvas=v1；切回 original 刷新保持 original |
| G5 VMD 零回归 | ✅ pass | original 与 V1 各 play→pause→seek→**完整播放至结束（endReached/fullPlayOk=true）**，覆盖结束/循环回调路径 |
| G6 管线隔离 | ✅ pass | 切 reze-design 后真实克莱妲导入重建为 original，变体 UI 不显示、无资产/variant 残留（硬阻断，非软通过） |
| G7 工程门禁 | ✅ pass | `node --test reze-k3-skin-variant` 12/12、`npm run build` 通过、patch `--self-test` 62 项、`git diff --check` 干净 |

## 新视觉 Gate（第二轮硬约束，全部由分析脚本以退出码硬阻断）

| Gate | 含义 | 结果 |
| --- | --- | --- |
| A Scene invariance | original/V1 用完全相同 K3 scene/灯光/星空/相机/Bloom/VMD frame | ✅ 星空背景暗空像素 maxMeanDiff=0.000（像素级一致），灯光未被改写 |
| B Material-only calibration | 只调 Face/BodySkin 的 V14D graph/参数；禁全局曝光/gamma/tone mapping/灯光/背景 | ✅ 仅 Face/BodySkin 走 V14D 合成 graph，其余材质/全局显示链不变 |
| C 同相机同帧三联图 | original K3 / V1 / diff | ✅ `g3-triptych-labeled.png`；diff 图仅脸部亮、手部微亮、其余全黑 |
| D 隔离 Gate | 头发/衣服/装备/星空保持 original；皮肤向目标收敛 | ✅ 非皮肤 meanMeanDiff 0.09–0.34（≪皮肤 25–36）；皮肤显著收敛 |
| E 自由相机与动态 VMD | 不带入固定相机/frame锁定/暂停/stopRenderLoop | ✅ 验收全程用户相机 + 正常 VMD 播放，未用任何诊断固定帧/锁相机 |

### 阈值（visual-diff.json 显式定义，脚本硬阻断）
- 皮肤收敛：掩码采样 MAE>1 且 maxMeanDiff>1，且掩码像素数 ≥20（防手部无皮肤假通过）。
- 非皮肤稳定：meanMeanDiff<1 且 maxMeanDiff<2。阈值依据实测噪声（同变体连拍 maxMeanDiff≈0.13–0.28）
  之上、真实成片改写（皮肤对照 25–36）之下，允许修票明示的「切换重建极小光栅噪声」。
- 星空背景：暗空多数像素（双图 lum<30，排除亮星闪烁）maxMeanDiff<0.5。
- pctOver2（|d|>2 像素占比）仅记录不判定：模型待机微动使含 specular/RMO 的衣服对高光角敏感，
  同变体连拍 pctOver2 即达 ~15%，无法区分真实改写与帧间噪声。

## 生产缺陷修复（本票据内最小修复）

### 1. reze-engine PMX 文本长度上限（阻断性）
- **根因**：引擎 `pmx-loader.ts` 的 `getText()` 硬编码 1000 字节上限，权威克莱妲 PMX offset 647 有合法
  超长注释，导致 `Suspicious string length: 1006` 拒绝加载。
- **修复**：`web/scripts/patch-reze-engine.mjs` 已有补丁；`npm ci` 后手动 `node scripts/patch-reze-engine.mjs`。
- **验证**：`patch --self-test` 62 项不变量通过；G1-G6 全过。

### 2. 验收探针 `__rezeStageProbe`（验收基建，默认关闭）
- **改动**：`RezeWebGpuStage.tsx` 探针仅在显式验收开关 `?v14dAcceptanceProbe=1` 下挂载，生产默认不暴露；
  rAF 进度镜像循环带 `cancelled` 标志 + `cancelAnimationFrame`，卸载时完整清理并删除 dataset。
- **新增负测钩子** `applyBadSkinGraph(kind)`（仅验收开关）：驱动「错误 graph」「applyStyleGroups 失败」
  真实负测，验证回退路径。

### 3. VMD 播放路径 `engine.resetPhysics()`（核实无需修复）
- 正常 VMD 加载路径（loadVmd 完成后，行 2787）对**所有**模式都调用 `engine.resetPhysics()`，
  诊断模式额外走 `stopRenderLoop`。G5 完整播放至结束（endReached/fullPlayOk=true）实证物理与播放正常。

## 视觉证据

| 产物 | 路径 |
| --- | --- |
| **带标注三联图（original/V1/diff）** | `.scratch/reze-k3-v1-stage/g3-triptych-labeled.png` |
| original/V1 全身（含 UI） | `.scratch/.../g3-original-full.png`、`g3-v1-full.png` |
| original/V1 纯画布 | `.scratch/.../g3-original-canvas.png`、`g3-v1-canvas.png` |
| 差异热图 | `.scratch/.../g3-diff-heat.png` |
| 区域像素数值 | `.scratch/.../visual-diff.json` |
| 完整门禁报告 | `.scratch/.../gate-report.json` |

差异热图（×6 放大）：仅脸部为亮区（V14D State2 合成），手部微弱，头发/衣服/装备/星空全黑——
证明 V1 零泄漏到非皮肤与背景。

## 可复验步骤

```powershell
cd "E:\codexWorktree\004b\MMD project\web"
npm ci --no-audit --no-fund
node scripts\patch-reze-engine.mjs   # 关键：移除 PMX 文本长度上限
node ./scripts/run-next.mjs dev -p 3114 -H 127.0.0.1
# 另一终端：
node scripts\accept-reze-k3-v1-stage.mjs    # G1-G6 真实浏览器验收（硬阻断）
node scripts\analyze-reze-k3-v1-diff.mjs    # G3 区域像素差异（退出码硬阻断）
node scripts\finalize-reze-k3-v1-report.mjs # 合并报告 + 生成三联/差异图
```

## 剩余风险与边界

- **API 依赖**：本轮为存根环境端到端。真实部署需 API 后端提供模型清单/会话；V1 资格与渲染不依赖 API。
- **纹理兜底**：验收 route 把 `127.0.0.1:8000/assets/mmd/models/<Textures|spa>/...` 从权威目录真实映射；
  真实部署由后端静态服务提供等价内容。
- **探针剥离**：`__rezeStageProbe` 已用 URL 开关门控（生产默认不挂载），彻底剥离可在构建期加 env 门控。
- **check:basic / tsc 基线已知失败**：`check:basic` 断言与代码现状不符、`app-routes-smoke.spec.ts` 的
  `__speechCancelCount` Window 类型缺失，均为基线历史遗留，与本票据无关。
- **next-env.d.ts**：`npm run build` 会改写其 routes.d.ts 引用路径（build 产物），不纳入提交。

