# Stage 2B-M3｜全身皮肤材质统一（BodySkin 接入 V14D State2 实时合成）

- 日期：2026-09-02
- 状态：**视觉预览范围扩展（checkpoint）**——修正轮后 BodySkin 实时合成已接线、脖子/双手
  区域独立数值 Gate 通过（候选阈值），腰部在 frame120 叉腰姿势下被长袖/手臂全角度遮挡
  （真实几何）无可视样本，诚实标记 occluded。**不是**完整 V14D/Face Gate 已通过。
- 来源主会话：01a036ca-f4cc-7b22-8482-b4e72b231053，hostId=local
- 分支：codex/v14d-body-skin-state2
- 冻结基线：base_commit=653c6d99c9a77f9bcda07eab4b0870054e73ae00

## 结论

BodySkin 已接入 V14D 皮肤渲染体系。Blender 取证确认 BodySkin 无离散阴影 mask，身体是 body_d 线性 × 身体 warm=[1,0.945,0.905] 直出（与 Face 同 skin family、同乘法暖肤结构，但 warm 常量与 mask 均为脸部专用）。finalFaceComposite 模式下 BodySkin 切到 V14D Body Skin Composite graph（按 graph.name 覆写 final_color 为 v14d_skin_body_composite），仅 v14dFaceStatic=1 诊断入口生效，生产默认不变。

## Blender 取证

脚本 web/scripts/forensic-v14d-bodyskin-state2.py 输出 manifest 到 .scratch/v14d-body-skin-state2/forensic/bodyskin-manifest.json。关键事实：BodySkin 唯一扩散纹理 body_d.png（sRGB）；无离散阴影 mask；BodySkin warm=[1,0.945,0.905]，Face warm=[1,0.935,0.89]（不同，禁止复用）；Toon 分支 PROTO_ToonMix Factor=1.0 恒取 emission。

## 实现

引擎补丁（patch-reze-engine.mjs）：新增 WGSL helper v14d_skin_body_composite；v14dState2OverrideFsBodyFixed 新增 isBodySkin 分支；compile 门控扩展为 tag 含 v14d-state2-face 或 graph.name === V14D Body Skin Composite；strict verify 从 58 项升至 62 项。

页面（RezeWebGpuStage.tsx / v14dFaceStatic.ts）：新增 V14D_BODY_MATERIAL_NAME / V14D_BODY_BASE_TEXTURE_NAME / V14D_BODY_WARM 常量；新增 V14D_BODY_LIVE_COMPOSITE_GRAPH；finalFaceComposite 下 BodySkin 切身体合成 graph；dataset 新增 v14dBodySkinApplied；captureV14dFaceStatic 扩展 skinRoi；新增 exportMaterialHdrFloat 与 __v14dSetCamera。

Gate（gate-v14d-body-skin-state2.mjs）：绑定（faceApplied + bodyApplied）+ ROI（BodySkin HDR 线性均值 vs Blender 身体参考 exposure=-0.56 同口径，候选阈值 MAE ≤ 0.35）+ 浏览器（frame=120、paused=true、相机有效、无 pageError/4xx/5xx）+ 负测（错材质 null、HairA 与 BodySkin pickId 区分）+ 四区域近景截图。

## 验收结果

| 验收项 | 结果 |
| --- | --- |
| webgpuStatus / mode / frame / paused | ready / finalFaceComposite / 120 / true |
| Face / BodySkin graph 绑定 | true / true |
| 相机（自由/全身/重置） | 全部可点击 |
| BodySkin web 线性均值（847 样本） | [0.815, 0.454, 0.344] |
| Blender 身体参考（exposure=-0.56，1994 样本） | [0.481, 0.248, 0.196] |
| BodySkin MAE（候选阈值 0.35） | [0.334, 0.206, 0.148] 通过 |
| Face web 线性均值（547 样本） | [0.812, 0.514, 0.463] |
| 负测（错材质/漏材质） | 通过 |
| pageError / failedRequests / 4xx-5xx | 0 / 0 / 0 |
| patch-reze-engine --verify | exit 0（62 项） |
| gate-v14d-state2-override-regression | exit 0（30 项断言） |
| probe-v14d-face-default | exit 0（DEFAULT-GATING-OK） |
| probe-v14d-vmd-runtime | exit 0（VMD-RUNTIME-PROBE-OK） |
| npm run build | exit 0 |

## 修正轮（主会话验收修正，同 failure family 第一次修正）

初版被主会话验收驳回，修正以下 P0：

### P0-1 四区域独立数值 Gate

初版只算整块 BodySkin aggregate（~862 样本单组均值），不满足 neck/waist/leftHand/rightHand
分别对齐。修正后用 BodySkin 三角形展开 pass（`exportMaterialTriRegions`，复用
readV14dFaceExpandedTriUv 的 CPU 蒙皮 + 逐三角形 triId）得到每个 BodySkin 三角形的世界质心，
按 `V14D_BODY_SKIN_REGIONS`（世界 y 带 + x 符号，叉腰下左右手按 x 区分）把屏幕像素归属到
四区域，每区域独立输出：区域定义、有效 mask（triId 覆盖 + pick 前景）、样本数、覆盖率、
Web HDR 线性 RGB、Blender 同区域参考（body_d×warm 线性）、逐通道 MAE、通过状态。
不再用整块 BodySkin 均值替代各区域。

### P0-2 四区域截图命中

初版 neck 拍到胸口/腰带、左右手用同一 target。修正后每个区域用它自己世界质心自动定位相机
（不再手调屏幕坐标）：脖子从下方仰视（下巴与衣领间窄带），腰从侧腰看（前腹被裙覆盖），
手从正前方看（叉腰外露）。全身图叠加四区域轮廓 bbox（fullbody-finalFaceComposite-annotated.png）。
补真实侧面全身 side-{normal,finalFaceComposite}.png。

### P0-3 bodyApplied 真实 graph 绑定证据

初版 `bodyOk = faceResult.ok && 材质存在` 是自证。修正后三层核对：applyStyleGroups 组诊断
（groupId=v14d-body-skin-composite）ok 且引擎 getStyleGroups 中 BodySkin 实际绑定
graph.name === "V14D Body Skin Composite"。dataset 暴露 `v14dBodySkinGraph`/`v14dBodySkinGroupOk`
供 Gate 读取真实状态。负测 `web/scripts/gate-v14d-body-graph-negative.mjs` 覆盖漏绑 BodySkin、
BodySkin 错绑 Face graph、错材质（graph 绑到 HairA）、body 组编译失败，全部判 false。

### P0-4 验证承诺与概念登记

本概念登记为「视觉预览范围扩展」，不写成完整 V14D/Face Gate 已通过。新增概念文档
`workflow/concepts/v14d-body-skin-state2.zh-CN.md`，同步 `workflow/workflow-glossary.zh-CN.md`
与 `docs/architecture/current-system-topology.md`。

### 修正轮验收结果

| 验收项 | 结果 |
| --- | --- |
| 区域 neck（近景仰视，1853 样本） | MAE=[0.110,0.104,0.089] 通过（候选阈值 0.20） |
| 区域 leftHand（全身视角，374 样本） | MAE=[0.017,0.015,0.011] 通过 |
| 区域 rightHand（全身视角，198 样本） | MAE=[0.015,0.017,0.016] 通过 |
| 区域 waist | **occluded**（frame120 叉腰姿势被长袖/手臂全角度遮挡，无可视样本，诚实 checkpoint） |
| Face（593 样本） | 线性均值 [0.816,0.514,0.462] |
| bodyApplied 真实 graph 核对 | v14dBodySkinGraph="V14D Body Skin Composite"，组诊断 ok |
| 负测（不存在材质/HairA 不冒充/漏绑/错 graph/错材质） | 全部通过 |
| patch-reze-engine --verify | exit 0（62 项） |
| gate-v14d-state2-override-regression | exit 0（30 断言） |
| probe-v14d-face-default / probe-v14d-vmd-runtime | exit 0 / exit 0 |
| pageError / failedRequests / 4xx-5xx | 0 / 0 / 0 |

Gate 退出码：可见区域全过 + 无遮挡 = 0（OK）；有区域被诚实标记 occluded = 3（checkpoint）；
任一可见区域失败或 graph 证据不符 = 1（fail）。

## 二次修正（同 failure family 最后一次修正，2026-09-02）

主会话第二次验收仍驳回，修正以下四点。

### P0-1 同 UV 逐像素区域参考（替代整图均值）

初修四区域（neck/waist/leftHand/rightHand）共用一个整块 body_d×warm 全材质均值
`bodyDMeanLinear` 冒充各区域参考，`blenderTris` 只加载未参与颜色参考。本修正改为
每个正式 Web 像素带 triId+UV，在 body_d 同 UV 采样 × 身体 warm=[1,0.945,0.905] 得逐像素
参考，逐区域聚合出 refLinear/refSamples/逐像素 MAE/P95。同 UV 参考后四区域 MAE 显著下降：
neck 0.110→0.025，leftHand 0.017→0.042（绝对值仍低），rightHand 0.015→0.009。

### P0-2 Face 五区域统一 schema

Face 由「只有 samples/meanLinear」补齐为区域定义/有效 mask/coverage/同 UV 参考
refLinear/refSamples/逐通道 MAE/P95/状态，参考口径为 face_d×Face warm=[1,0.935,0.89]
基色×warm（不含脸部专用 State2 art/fringe）。

### P0-3 标注图证据修正

初修把 neck 近景 bbox 错叠到全身图（青色框落在大腿）。本修正全身图只对全身可见的左右手
用 triId+pick 重建真实 mask 提轮廓绘制；neck/waist 在全身图不可见，改为文字标注
"fullbody occluded / see closeup"。每张 closeup 在自身坐标系叠加真实 mask 轮廓+区域名+
样本数+状态，新增 closeup-*-finalFaceComposite-annotated.png。补侧面全身 side-normal/
side-finalFaceComposite.png。

### P0-4 draw-call 级绑定证据与真实运行时负测

`bodyApplied` 不再只读 getStyleGroups 配置。引擎新增 `exportBodySkinDrawBinding()`
（读 modelInstances→drawCalls→styleGroups→graph.name/pipeline），dataset 暴露
`v14dBodySkinDrawCalls`/`v14dBodySkinDrawOnComposite`；Gate 核对每个 BodySkin draw call
实际 graph.name 与 pipeline 命中 "V14D Body Skin Composite"。负测改为真实浏览器运行时
fault injection（URL 参数 `v14dBodyFault`=missing/wrongGraph/wrongMaterial，默认关闭），
见 `web/scripts/gate-v14d-body-graph-runtime-negative.mjs`：漏绑/错 graph/错材质 HairA
三种场景 Gate 均 exit 1，正确绑定 exit 0 且 drawOnComposite=1/1。
`web/scripts/gate-v14d-body-graph-negative.mjs` 保留为静态辅助核对（不再作为正式负测），
并改为基于 import.meta.url 解析路径（仓库根与 web/ 两种 cwd 均可运行）。

### 二次修正验收结果

| 验收项 | 结果 |
| --- | --- |
| 区域 neck（近景仰视，1853 样本，同 UV 参考） | MAE=[0.025,0.012,0.011] P95=0.096 通过（候选阈值 0.20） |
| 区域 leftHand（全身视角，374 样本，同 UV 参考） | MAE=[0.042,0.023,0.018] P95=0.354 通过 |
| 区域 rightHand（全身视角，191 样本，同 UV 参考） | MAE=[0.009,0.014,0.008] P95=0.386 通过 |
| 区域 waist | **occluded**（frame120 叉腰姿势被长袖/手臂全角度遮挡，无可视样本，诚实 checkpoint） |
| Face（551 样本，同 UV 参考） | meanLinear=[0.812,0.514,0.463] refLinear=[0.881,0.556,0.491] MAE=[0.069,0.042,0.028] P95=0.321 |
| bodyApplied draw-call 核对 | v14dBodySkinGraph="V14D Body Skin Composite"，drawOnComposite=1/1 |
| 真实运行时负测（missing/wrongGraph/wrongMaterial/none） | exit 1 / 1 / 1 / 0 |
| gate-v14d-body-graph-negative.mjs（仓库根与 web/ 两种 cwd） | exit 0 / 0 |
| patch-reze-engine --verify | exit 0（62 项） |
| gate-v14d-state2-override-regression | exit 0（30 断言） |
| probe-v14d-face-default / probe-v14d-vmd-runtime | exit 0 / 0 |
| npm run build | exit 0 |
| git diff --check | exit 0 |

Gate 产物目录：.scratch/v14d-body-skin-state2/gate/（gate-report.json + shots/ 含 annotated、side、closeup 全套，本轮重新生成）。

## 视觉证据

全身并排 .scratch/v14d-body-skin-state2/gate/shots/fullbody-side-by-side.png；近景并排 face-neck-closeup.png；四区域近景 closeup-{neck,waist,leftHand,rightHand}-{normal,composite}.png；Blender 身体参考 .scratch/v14d-body-skin-state2/ref/blender-ref-bodyskin-composite.png。

## 风险与未完成项

- 候选阈值非正式（0.35 标注候选）；Web 近景仅见脖子（847 样本）vs Blender 参考含脖子+嘴部（1994 样本），口径不完全对齐；G/B 差异由可见区域口径不同主导。
- 曝光口径已修正：faceStatic 显示 exposure=-0.56，Blender 参考统一为 -0.56 后 R 通道 MAE 从 0.027（exposure=0）→ 0.334（同口径真实差异）。
- 手/手指被黑手套覆盖，可见皮肤主要是手指根部与手背小片（BodySkin 承载）；手套不属皮肤。
- 腰部露肤在 composite 下明显更暖（视觉确认），与脸部同族。
- 未做 VMD 播放中的 BodySkin 动态阴影（BodySkin 无离散阴影 mask）。

## 交付握手

完成后停止写入、释放单写者租约，并向来源主会话发送结构化交付。
