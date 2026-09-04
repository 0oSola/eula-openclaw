# V14D Brows/Lashes 恒等 tint 迁移（identity-tint）

## 中文名称
V14D 眉毛与睫毛恒等乘色迁移（Brows/Lashes identity tint）。

## 英文机器名
- 概念 id：`v14d-brows-lashes-identity-tint`
- 权威常量：`V14D_BROWS_MATERIAL_NAME`（"Brows"）、`V14D_LASHES_MATERIAL_NAME`（"Lashes"）、`V14D_BROWS_LASHES_TINT`（[1.0, 1.0, 1.0]），均导出自 `web/src/features/stage/v14dAuthority.js`（单一事实源）。
- 生产 graph：`V14D_BROWS_LASHES_V1_COMPOSITE_GRAPH`（graph.name "V14D Brows Lashes V1 Composite"，节点 id `v14d_brows_lashes_tint`），定义于 `web/src/features/stage/v14dSkinVariantGraphs.js`。

## 概念定义
把权威克莱妲 PMX 的 Brows（眉毛）与 Lashes（睫毛）两个材质槽从原 K3 face 分组抽出，在「原始 Reze K3 / Reze K3 V1」切换的 V1 侧绑定到独立的 V14D 合成 graph。与 HairA/HairB 的颜色迁移不同，Brows/Lashes 的 V1 语义目标是**原色通过 + 独立分组绑定**：权威取证（见下）证明两槽在 Blender 侧的 Principled BaseColor 与 Alpha 直连同一张脸部纹理 `c_Koleda_slg_face_d.png`，中间没有任何乘色/tint 节点，因此「V14D 风格目标色」就等于原始 BaseColor 颜色本身。

实现上复用引擎的 `v14d_hair_composite(base, tint)` WGSL helper（线性乘法），以恒等乘色 `tint = [1,1,1]` 达成原样通过：

  targetLinear(uv) = srgbToLinear(face_d(uv)) × [1,1,1] = srgbToLinear(face_d(uv))

恒等 tint 不是「没有迁移」，而是把「V1 公式 = 恒等」这一事实用与 Hair 完全同构的乘法口径表达，使两槽真实经过 V1 graph 编译与独立 draw-call 绑定，可被 Gate 区分「正确恒等」与「未生效/未绑定」。

## 解决的问题
在不改动 V14D 迁移主流程的前提下，把 Brows/Lashes 两槽纳入同一数据驱动的材质槽配置 seam，证明该 seam 能容纳「颜色目标 = 恒等」的槽，而不是只能表达「颜色目标 ≠ 原色」的槽。这为后续 Emotions/Eyes/口腔/指甲等槽（部分也可能是恒等或近恒等）提供了可复用的口径与 Gate 模式。

## 适用与不适用场景
- 适用：权威克莱妲 Brows/Lashes 槽的 V1 迁移；任何「Blender 侧 BaseColor 无额外乘色节点」的槽，其 V1 目标为原色通过。
- 不适用：需要真实颜色变化的槽（HairA/HairB 用 V14D_HAIR_TINT 非恒等乘色；Face/BodySkin 用 State2 mask 实时合成）。不要把恒等 tint 套到需要变色的槽上冒充「已迁移」。

## 核心不变量
1. 恒等 tint 常量 [1,1,1] 只从 `v14dAuthority.js` 的 `V14D_BROWS_LASHES_TINT` 读取，禁止复制字面量形成双权威。
2. V1 分组 renderClass=auto（**非 hair**：眉毛睫毛在眼睛前方，不能引入 hair 的 HAIR_OVER_EYES 半透 epilogue），alphaMode=hashed（与取证一致）。
3. 两槽各自有真实 draw-call/graph 绑定证据（canvas dataset `v14dSkinVariant{Brows,Lashes}{DrawCalls,OnComposite}`）。

## 证据或计算口径
- 权威取证：`web/scripts/forensic-v14d-brows-lashes.py` 对权威 .blend（SHA256 1139617c…）headless 自省，输出 `web/.scratch/v14d-brows-lashes/brows-lashes-forensic.json`。关键事实：BaseColor 与 Alpha 均直连 `c_Koleda_slg_face_d.png`（sRGB 1024×1024、hasData=true、alphaMode=STRAIGHT）；blendMethod=HASHED、surfaceRenderMethod=DITHERED、alphaThreshold=0.5、useBackfaceCulling=false；无 MIX/RGB tint 节点。
- 验收现状（Stage 2C-M2a.3，诚实标注）：G2 真实 draw-call/graph 绑定（两槽各 1/1 命中 "V14D Brows Lashes V1 Composite"）+ missing 负测已可检出。本票新增固定 frame120 的显示链最小复现：identity 与 sentinel 的编译/安装管线身份不同，sentinel 实际 Brows/Lashes draw 使用新管线，pre-tonemap HDR 与最终 canvas 均发生强差异；`--fault-no-render` 负测在 apply 成功但冻结帧未提交时以 `renderObserved=false` 机器拒绝。swapBrowsLashes 仍只在旧路径中交换 materials 数组顺序、不构成错槽拒绝；逐槽原子同帧 material-ID+triUV+pixel 正式 Gate、Lashes 透明边缘专门机器 Gate、动态 Morph 稳定性 Gate 均未闭合。G3 脸部特写（original/V1 对照）仅证明恒等 tint 不破坏渲染，不是正式 Gate。

## 正例
- Brows/Lashes 在 V1 下经独立 graph 编译、绑定证据 1/1，且画面颜色与 original 一致（恒等正确）。
- 显式 acceptance probe 的 wrongBrowsLashesTint 把恒等 tint 改为 [0,1,1]，真实提交后改变 Brows/Lashes 的 HDR 与最终 canvas；不提交新帧的故障注入必须被机器拒绝。

## 反例
- 把 Brows/Lashes 留在原 face 分组但声称「已迁移」（无独立绑定证据）。
- 给恒等槽套非恒等 tint 制造颜色变化冒充「迁移生效」。
- 用 renderClass=hair 渲染眉毛睫毛（引入 hair 半透高光 epilogue，视觉错误）。

## 相关 contract/gate
- 生产接线：`RezeWebGpuStage.tsx` 的 `buildV14dSkinVariantStyleGroups` 调用 + dataset 证据。
- 引擎补丁：`web/scripts/patch-reze-engine.mjs` 把 override guard/expr 与 compile helper 门控泛化识别该 graph（verify 78 项不变量）。
- 验收：`web/scripts/accept-reze-k3-v1-stage.mjs` 的 G2 绑定/负测、G3 脸部特写。

## 失败后的修正路线
- 若两槽 OnComposite=0：检查 `buildV14dSkinVariantStyleGroups` 是否把两槽从原 face 分组抽出、graph.name 是否与引擎补丁门控字符串精确一致、compile 的 helper 注入门控是否包含该 graph。
- 若 graph/WGSL/compile-install 已变化但最终画布不变：先沿“显示链提交边界”检查实际 `setPipeline`、bind group、draw range、HDR resolve、合成和 canvas；不要先修改 tint、阈值或 alpha analyzer。
- 若颜色异常（偏色/消失）：检查是否误用非恒等 tint 或 renderClass=hair。
- 若透明边缘破裂：检查 alphaMode 是否为 hashed、引擎 hashed-alpha 裁切是否生效。

## 与现有概念的关系
- 与 `reze-k3-skin-variant`（V1 切换总开关/资格/持久化）共用同一接线与回退路径。
- 与 `v14d-hair-triuv-pixel-gate`（HairA/HairB 逐像素目标收敛）的差异仅在于「恒等 tint 不需要 changed=true 这一颜色变化判据」；但逐槽原子同帧 material-ID+triUV+pixel 的 identity-target 收敛 Gate（对同槽 canonical target 计算逐像素误差/覆盖/P95，并以 wrongTint、错槽目标自然拒绝）仍是必须闭合的正式 Gate。不能用「恒等不适用」免除该 Gate。

## 待修正 Gate 清单（Stage 2C-M2a 修正轮，2026-09-04 主会话验收未通过）

本票自评 G1-G7 全过，但主会话最终验收未通过，以下 Gate 需修正后重新验收，修正交付前正式迁移进度仍为 4/15：

1. **逐槽原子同帧 identity-target Gate（自评闭合，待复验）**：Brows/Lashes 各自 materialId + 原子同帧 pixel/triUV/target 证据（production-draw-call 三角 UV 源），对同槽 canonical target 计算逐像素误差/覆盖/P95；实测 Brows 19/19、Lashes 159/159 样本、triUvResolution=1.0、两槽 formalTargetGate 双 true。主会话未对此项提阻断，但随本轮一并复验。
2. **Lashes 透明边缘 Gate（空分母软通过，阻断）**：当前健康报告 core=159/edge=0/transparentZone=0，代码只在 edge>=1 时统计黑框/白边，空 edge 时 edgeMae=0 并通过；wrongAlpha 又靠 --neg-wrong-alpha 修改 analyzer 阈值（0.5→1.0）保证失败，非运行时错误 alpha 自然拒绝。需改为有真实非空分母的屏幕空间边界 Gate：从 production material-ID/coverage mask 做形态学内外边界环，比较 Original/V1 边界覆盖、综合色、黑边/白边/整槽消失；纹理 alpha-edge 与几何/抗锯齿边界分开，正式「透明边缘」验收不能用 edge=0 通过。wrongAlpha/黑边/白边须真实运行时扰动产生画布/coverage 证据并自然非零拒绝，禁止修改 analyzer 阈值自证。
3. **动态 Morph Gate（判别力不足，阻断）**：当前仅把权威「まばたき」设超权重 2.0 并断言 Jaccard>0，只证明任意超权重会移动。需建立正常权威状态 0→1 的开眼/闭眼 Gate，固定 frame/camera，逐槽记录 production mask/triUV/边界/质心或 Jaccard，设实测健康裕量阈值；负测须真实覆盖错误 Morph 名、权重不切换/重复同状态、槽消失并自然拒绝；另需补一个非眨眼表情状态，或提供权威资产无适用表情的机器取证后诚实缩小范围。
4. **wrongTint 阈值健康标定（阻断）**：正式报告只有错误样本 baselineShift（Brows=48.632/Lashes=58.610），阈值 20 与「健康≈0」只在源码注释/.scratch 单次脚本。需把同一正式链的健康重复 identity/control 分数、错误 tint 分数、公式方向与阈值推导写入机器报告；至少两次独立健康采集均低于阈值、wrongTint 高于阈值，并增加边界/反向负测，证明 20 非按当前错误样本硬编码必过。
