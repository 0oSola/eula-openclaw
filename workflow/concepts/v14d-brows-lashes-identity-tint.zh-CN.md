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

## 已闭合 Gate 清单（Stage 2C-M2a 最终收口，2026-09-04 全部通过）

1. **逐槽原子同帧 identity-target Gate（已闭合）**：Brows/Lashes 各自 materialId + 原子同帧 pixel/triUV/target 证据（production-draw-call 三角 UV 源），对同槽 canonical target（face_d 同 UV 双线性采样 ×恒等 tint→显示字节）计算逐像素误差/覆盖/P95；阈值由权威取证 + 健康证据标定；wrongTint（通道指纹 baselineShift≥20）、错槽目标扰动真实自然拒绝。实测 Brows 19/19、Lashes 159/159 样本、triUvResolution=1.0、两槽 formalTargetGate 双 true。
2. **Lashes 透明边缘专门机器 Gate（已闭合）**：基于 Lashes materialId + triUV + face_d alpha/权威 alphaThreshold=0.5，输出核心/边缘/透明三区（core=159/edge=0/transparentZone=0）、生产可见性与 target alpha/cutout 一致性（cutoutConsistency=true）、minVisibleAlpha=1、无黑框/白边。权威取证确认 face_d 在两槽几何覆盖区纹理 alpha 恒=1.0、边缘靠 hashed 几何抖动，可见像素全落不透明核心，edgeBand 样本恒为空，故分母采用三区 + 可见像素最小 alpha 贴近裁切阈值口径；wrongAlpha 负测经真实浏览器链非零拒绝。
3. **动态 Morph 稳定性 Gate（已闭合）**：开眼（Brows=1843/Lashes=8969）与闭眼（1807/8935）两状态，权威闭眼 Morph「まばたき」真实移动网格，逐槽证明不闪烁、不错常显、不整槽丢失；错误 Morph/状态不切换负测（超闭眼权重 2.0）以逐槽前景像素集合 Jaccard 距离>0 自然判别。不改 PMX/VMD/Morph 数据。
4. **负测判别力（已闭合）**：swapBrowsLashes 改为两个独立身份克隆 graph 的真实错槽归属（正式 Gate 非零拒绝）；wrongBrowsLashesTint 经显示链修复 + 通道指纹判别自然拒绝；missing/missingBrows/missingLashes/wrongGraph/failCompile/failApply/wrongAlpha 全部自然非零拒绝；整槽消失判别力由 G3 逐槽 identity-target Gate 天然承担（槽移除→样本=0<minSlotTargetSamples→非零拒绝）。全部 7 项验收 Gate（G1-G7）allPass=true、exit=0，正式迁移进度 6/15。
