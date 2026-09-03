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
- 验收：G2 真实 draw-call/graph 绑定（两槽各 1/1 命中 "V14D Brows Lashes V1 Composite"）+ missing/swap 负测；G3 脸部特写（original/V1 对照）证明恒等 tint 不破坏渲染。

## 正例
- Brows/Lashes 在 V1 下经独立 graph 编译、绑定证据 1/1，且画面颜色与 original 一致（恒等正确）。
- wrongBrowsLashesTint 负测把恒等 tint 改为 [1.35,0.25,0.25]，真实改变运行时颜色。

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
- 若颜色异常（偏色/消失）：检查是否误用非恒等 tint 或 renderClass=hair。
- 若透明边缘破裂：检查 alphaMode 是否为 hashed、引擎 hashed-alpha 裁切是否生效。

## 与现有概念的关系
- 与 `reze-k3-skin-variant`（V1 切换总开关/资格/持久化）共用同一接线与回退路径。
- 与 `v14d-hair-triuv-pixel-gate`（HairA/HairB 逐像素目标收敛）不同：本概念不产生颜色变化，逐槽像素收敛 Gate 不适用，正式 Gate 由绑定证据 + 负测承担。
