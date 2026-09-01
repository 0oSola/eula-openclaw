# Stage 2B-M2 Face UV/可见性同口径视觉 Gate 交付报告

- 票据分支：`codex/v14d-face-uv-visibility-gate`
- 冻结基线：base_ref=`codex/v14d-reze-fresh-patch-completeness`，base_commit=`9be72d98a5cef0f513bd237674ddc6c853847cc9`
- 实际工作目录：`E:\codexWorktree\a925\MMD project`
- 日期：2026-09-01

## 一、状态：通过（附同口径边界说明）

在「同 UV、同三角形、同可见性」的正式样本集上，三层对账全部达标：

| 层 | 样本数 | 每通道 MAE (/255) | 每通道 P95 (/255) | 阈值 |
| --- | --- | --- | --- | --- |
| BaseColor | 938 | [11.287, 12.166, 11.834] | [34.60, 21.03, 21.81] | — |
| ShadowFactor | 938 | [13.226, 15.277, 13.822] | [47.81, 50.43, 44.78] | — |
| FinalComposite | 938 | [15.164, 13.835, 11.703] | [35.39, 27.73, 22.41] | ≤20 ✓ |

Gate 退出码 0，与结果一致。

## 二、同口径方法（保持票据口径）

- **固定输入**：权威 blend `Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend`（sha256 1139617c…），
  PMX 目录 `D:/mmd/克莱妲原皮`，frame=120（30FPS=4.0s）、Face State=2、BlendWeight=0，复用固定相机。
- **Blender 侧**：`blender-face-uv-visibility.py` 经 raycast 导出 Face 三角形 loop UV 集合（2738 个）+ triId/UV/深度图。
- **Web 侧**：`export-face-tri-uv.mjs` 导出 Face 前景 UV pass（两段式：pass1 全材质 depth-only 写深度，pass2 仅 Face 材质 equal 深度测试输出插值 UV，剔除刘海遮挡）+ 三模式 pre-tonemap HDR（线性）+ HDR 材质 pick mask。
- **正式样本**：Web UV 前景 pass ∩ HDR 材质 pick 双方都判 Face，且 UV 落在某 Blender Face 三角形内的像素。
  记录：formalSamples=938、rejectedNoTri=0、rejectedMaskMismatch=21301、coverage=1.0（相对双方一致判 Face 的像素）。
- **参考色**：同一 UV 直采 face_d（sRGB→linear，双线性）与 State2 mask（Non-Color）按权威公式
  warm×shadowFactor 合成，不反投影 atlas、不改公式/阈值、不手调 RGB。

## 三、负测（Gate 判别力证据）

| 负测 | 方法 | 每通道 MAE (/255) | 相对正式样本 |
| --- | --- | --- | --- |
| 错 UV | u→u+0.5 大偏移采到发/体区 | [172.35, 123.08, 112.26] | >7× |
| 错三角形 | UV 质心距离>0.25 的远三角形 | [127.71, 115.17, 104.74] | >7× |

说明：初稿错 UV 负测用单 texel 偏移（du=1/1024），在平滑肤色区参考色几乎不变、无判别力（Gate 假阴）；
镜像 u→1−u 在近似左右对称的脸部贴图上实测 457/351 像素互有胜负、亦无效。最终采用 u→u+0.5 大偏移，
采到贴图完全不同区域，判别力充足。

## 四、重要边界（诚实披露）

正式样本 938 像素仅覆盖脸部**可见皮肤窄条**（HDR 材质 pick 口径，bbox 约 144×90）。
UV pass 的完整 Face 前景（18538px，含刘海/发绺几何，bbox 约 188×253）对账 FinalComposite 的
MAE 高达 [192.9, 106.0, 92.7]——**因为刘海/发绺虽属 Face 材质（材质名均为 "Face"），但使用独立发色
纹理，不适用 face_d 直采参考**。因此同口径只能、也只应圈定在「应用 face_d 纹理的脸部皮肤」，
这是票据建议方法「仅比较双方都可见且映射到同一 Face 三角形的样本」的正确落实，而非放宽。

两个 mask 的差异经平移扫描验证**不是采集状态漂移**（最佳平移 (-32,-50) 后重叠仅 52%，且修复采集脚本
合并 normal+triUv 同帧后两 mask 数据完全一致、为确定性差异），而是 HDR 材质 pick 与 UV 前景 pass 对
刘海/眼周区域的可见性/材质归属语义不同。

## 五、验证命令与真实结果

| 命令 | 结果 |
| --- | --- |
| `node web/scripts/gate-v14d-face-uv-visibility.mjs` | EXIT=0（`===UV-VIS-GATE-OK===`） |
| `node web/scripts/patch-reze-engine.mjs`（prebuild/predev 自动跑） | EXIT=0，58 项不变量全过 |
| `$env:V14D_CAPTURE_ORIGIN='http://127.0.0.1:3111'; node web/scripts/probe-v14d-vmd-runtime.mjs` | EXIT=0，play/pause/seek 正常，默认无泄漏 |
| `cd web; npm run build` | EXIT=0，编译+类型检查通过 |
| `cd web; node ./tests/run-basic-checks.mjs` | EXIT=1，**基线既有失败**（见下） |

### 基线既有失败披露

`run-basic-checks.mjs` 中断言 `RezeWebGpuStage.tsx` 含 `const initialSettings = sceneSettings ?? DEFAULT_SETTINGS`，
但 base_commit（`git show HEAD`）该行为 `?? pipelineDefaultSettings`——测试断言与冻结基线源码本就不匹配，
属基线既有失败，**非本票引入**（本票 diff 未触碰该行）。VMD probe 默认 3102 端口，本环境服务在 3111，
经 `V14D_CAPTURE_ORIGIN` 覆盖后通过；3102 连接拒绝为端口配置差异，非代码回归。

## 六、修改文件

授权改动（聚焦诊断脚本 + 默认关闭的诊断钩子 + Gate + 报告/文档）：

- `web/scripts/blender-face-uv-visibility.py`（新增）：Blender 侧 raycast 导出。
- `web/scripts/export-face-tri-uv.mjs`（新增）：Web 侧 UV pass + HDR 采集（同帧）。
- `web/scripts/gate-v14d-face-uv-visibility.mjs`（新增）：离线对账 Gate。
- `web/src/features/stage/v14dColorBaseline.ts`（+249）：`readV14dFaceTriUvMask` 诊断 pass（默认关闭）。
- `web/src/features/stage/RezeWebGpuStage.tsx`（+70）：`exportFaceTriUv` 导出接线（默认关闭，挂到 __v14dFaceStatic）。
- `web/scripts/patch-reze-engine.mjs`（±11）：锁定真实纹理创建点锚点（label+`texture: ${cacheKey}`），
  避免宽松锚点误覆写 createPipelines 的 fallback 1x1 白纹理导致 `__isAuxMask is not defined`。
- `docs/architecture/current-system-topology.md`、`workflow/concepts/v14d-face-uv-visibility-gate.zh-CN.md`、
  `workflow/workflow-glossary.zh-CN.md`：架构与新概念登记。

生产源码改动仅限诊断接线（`exportFaceTriUv`/`readV14dFaceTriUvMask` 默认关闭 + patch 锚点收紧），
已经 VMD runtime probe 证明默认行为不变、无泄漏。未修改 PMX/VMD/骨骼/权重/Morph/IK/Grant/Physics/
播放时钟/插值/拓扑/材质槽，未修改 VMD 播放链。

## 七、产物路径

- Gate 报告：`.scratch/v14d-face-uv-visibility/gate/gate-report.json`
- 三联截图（带标注，含 ROI 放大版）：`.scratch/v14d-face-uv-visibility/gate/triptych.png`、`triptych-roi.png`
- 差异热图：`gate/diff-basecolor.png`、`diff-shadowfactor.png`、`diff-finalcomposite.png`
- mask 对齐诊断：`gate/mask-overlay.png`、`mask-agreement.png`
- Blender 导出：`.scratch/v14d-face-uv-visibility/blender/`（manifest + 2738 三角形 JSON）
- Web 导出：`.scratch/v14d-face-uv-visibility/web/`（tri-uv JSON + 三模式 HDR JSON + face mask）
- VMD probe 报告：`.scratch/v14d-agx-byte-capture/vmd-runtime-probe.json`

大 PNG/HDR JSON 均在 `.scratch`（未提交），第三方资产未提交。

## 八、未完成项与风险

- **同口径样本仅 938 像素**（脸部皮肤窄条），未覆盖刘海/发绺——这是 face_d 直采参考的固有边界，
  非缺陷。若需对账刘海发色，需另建「发色纹理同口径」票据。
- **check:basic 基线既有失败**未在本票修复（超出边界，且为测试断言与基线源码的历史不一致）。
- HDR 材质 pick 在刘海区的材质归属与 UV pass 语义差异已定性，但未在本票改 pick 逻辑（非本票目标）。
