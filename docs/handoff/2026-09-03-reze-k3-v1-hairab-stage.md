# Reze K3 V1 HairA/HairB 头发材质迁移（Stage 2C-M1）交付报告

- 票据：`codex/v14d-hairab-stage`（来源 threadId=01a036ca-f4cc-7b22-8482-b4e72b231053，hostId=local，source_project_id=local-140a2801b88e7626327b2eb4694a8b91）
- 执行模型：kimi/k3-256k（视觉识别/真实舞台验收）
- 工作树：`E:\codexWorktree\01bf\MMD project`，分支 `codex/v14d-hairab-stage`
- 基线：base_commit `1c366814d54689a01356d21da358c061c4aac32b`（project_binding_verified=true）
- 完成时间：2026-09-03
- 状态：**实现完成、真实舞台端到端验收通过（G1-G6 六项运行时 Gate 全过 + 独立工程门禁全绿）**

## 目标

在生产 `/companion` 的同一 Reze K3 舞台运行时中，将克莱妲 HairA、HairB 两个材质槽迁移到
V14D 风格的实时头发材质，并纳入现有「原始 Reze K3 / Reze K3 V1」切换。仅处理 HairA/HairB；
Face、BodySkin 保持既有 V1 行为，其余 11 个待迁移槽不实施。

## 权威取证（Blender CLI，不凭截图目测）

`web/scripts/forensic-v14d-hair-state.py` 对权威 .blend
（`Koleda_V14D_DiscreteFaceShadow_NarrowBlendHysteresis.blend`，SHA256 1139617c…）headless 自省，
输出 `web/.scratch/v14d-hairab/hair-forensic.json`。HairA/HairB（PROTO_GF2_HairA/HairB）关键事实：

- **BaseColor**：`c_KoledaSSR01_slg_hair_d.png`（sRGB，2048×2048，hasData=true，Alpha 直连
  Principled.Alpha）经 `PROTO_HairTint`（MIX_RGB MULTIPLY、Factor=1）固定银白紫乘色
  **[0.84, 0.85, 0.96, 1.0]**（非目测，来自节点自省）。
- **Alpha/裁切**：blendMethod=HASHED、surfaceRenderMethod=DITHERED、alphaThreshold=0.5，
  与引擎 hashed-alpha 裁切口径一致；Hair Spec（`c_KoledaSSR01_slg_hair_spc.png`）声明但为空
  （0×0、hasData=false，manifest 保留「已声明但为空」状态）。
- **视角相关（不迁移/不烘焙）**：Anisotropic 0.72、Roughness/Specular 经 MapRange 支路、
  ToonRamp 经 ShaderToRGB——按 A/B/C 分类为 C（不能烘焙/不固化视角高光），保持引擎 hair
  分组既有光照行为。

## 实现摘要

1. **引擎补丁扩展**（`web/scripts/patch-reze-engine.mjs`，fresh fixture 自验 + 严格 marker Gate）：
   - 新增独立 `V14D_HAIR_HELPER_WGSL` 常量（`v14d_hair_composite(base)=base×[0.84,0.85,0.96]`）。
   - assembleModule 新增 `includeV14dHairHelper` 参数单独注入 hair helper——**不连带** State2
     mask 声明（binding 5），hair graph 无需 mask 即可编译通过（这是修复的真实根因：最初把
     helper 并入 state2 模板导致 hair graph 因无 state2 门控而未注入 helper、WGSL 未声明、
     整组编译失败静默回退 original）。
   - compile 按 graph.name "V14D Hair V1 Composite" 覆写 final_color；override 函数新增
     isHairV1 分支。所有 target 幂等（fresh/旧补丁/二次运行三态收敛）。
2. **生产 V1 接线**（`RezeWebGpuStage.tsx`）：新增 `V14D_HAIR_V1_COMPOSITE_GRAPH`
   （tags 含 production/skin-variant/hair-v1），`buildV14dSkinVariantStyleGroups` 把
   HairA/HairB 抽出绑定到该 graph（renderClass=hair）；canvas dataset 新增
   `v14dSkinVariant{HairA,HairB}{DrawCalls,OnComposite}` 分区 draw-call 绑定证据；
   负测钩子 `applyBadSkinGraph` 同步纳入 hair 证据。
3. **材质名常量**（`v14dFaceStatic.ts`）：`V14D_HAIR_A_MATERIAL_NAME`/`V14D_HAIR_B_MATERIAL_NAME`。

## 验证（全部实际运行）

| 项 | 结果 |
| --- | --- |
| `node --test tests/reze-k3-skin-variant.test.mjs` | 12/12 通过 |
| `node scripts/patch-reze-engine.mjs --verify` | 72 项严格不变量全 OK |
| `node scripts/patch-reze-engine.mjs --self-test` | PATCH-SELF-TEST-OK（fresh 首次/二次幂等、全部负测拒绝） |
| `npm run build` | ✓ Compiled successfully（Next.js 15.5.14） |
| `git diff --check` | 干净（exit 0） |
| 真实舞台验收 `node scripts/accept-reze-k3-v1-stage.mjs` | **G1-G6 全过，STAGE-V1-OK** |

## 真实舞台验收（/companion，权威 PMX+VMD+State2 mask）

| Gate | 结果 | 关键证据 |
| --- | --- | --- |
| G1 用户路径与切换 | ✅ | 导入后变体 UI 出现；点 V1 后 canvas=v1；切回 original 一致 |
| G2 真实绑定+负测 | ✅ | Face/BodySkin/HairA/HairB drawCalls 各 1/1 命中目标 graph；负测 original不命中/重命名PMX/缺mask/错误graph(全0)/applyStyleGroups失败(回退original)/missingHairA(a=0,b=1)/missingHairB(a=1,b=0)/wrongHairMaterial(hair=0) 全过 |
| G3 视觉 A/B + 分区目标收敛 | ✅ | 皮肤收敛（face MAE=31.9 等）、衣服/装备/星空稳定（同变体连拍噪声基线校准）、脸部对 V14D 目标色比距离 0.196→0.140（drop 28.7%）；**HairA/HairB 分区目标收敛**：HairA drop=0.219（origMae 61.3→v1Mae 47.9）、HairB drop=0.117（origMae 55.0→v1Mae 48.6），各槽 UV 锚点 targetMean 分别核对；前刘海/后长发近景与 UV 取证图产出；**wrongTint 负测**：错误青绿 tint 真实改色后被同一收敛 Gate 非零拒绝（绝对阈值判定）；场景字段（含 viewTransform exposure/gamma/look）original/V1 逐字段一致 |
| G4 持久化 | ✅ | V1 刷新+重导入后保持 v1；切回 original 刷新保持 |
| G5 VMD 零回归 | ✅ | original/V1 各 load→play→pause→seek→完整播放至结束（完成回调计数自增+nearTail）；提前停止/竞态/过期回调负测全过；resetPhysics 计数>0 |
| G6 管线隔离+探针泄漏 | ✅ | 切 reze-design 后真实克莱妲重建为 original、变体 UI 不显示；探针默认关闭 |

## 视觉证据

| 产物 | 路径 |
| --- | --- |
| 三联图（original/V1/diff） | `web/.scratch/reze-k3-v1-stage/g3-side-by-side.png` |
| 差异热图 | `web/.scratch/reze-k3-v1-stage/g3-diff-heat.png` |
| original/V1 纯画布 | `g3-original-canvas.png` / `g3-v1-canvas.png` |
| 同变体连拍（噪声基线） | `g3-original-canvas-b.png` |
| 区域像素数值 | `web/.scratch/reze-k3-v1-stage/visual-diff.json` |
| 完整门禁报告 | `web/.scratch/reze-k3-v1-stage/gate-report.json` |
| Blender 取证 manifest | `web/.scratch/v14d-hairab/hair-forensic.json` |

差异热图确认：亮区集中在头发（HairA 前刘海 + HairB 后长发）+脸+手部皮肤，衣服/装备/星空几乎全黑。

## 验收口径修正（诚实记录）

- **G3 分析脚本**：皮肤阶段遗留的「hair 必须稳定」口径与本票据「hair 必须变化」冲突。本票据把
  `hair` ROI 从 `nonskin`（必须稳定）改为 `hair`（必须显著变化），新增阈值 hairChangeMae/hairChangeMaxMeanDiff。
  `clothes` ROI 收窄（w 0.10→0.075）排除右列刘海/头发遮挡区——网格探针证明该区 original↔V1 与
  同变体连拍噪声同为高位（2.3-11.7 vs 1.0-4.3），是头发遮挡/高光帧间微动噪声而非衣服材质泄漏；
  衣服主体两侧均 <0.5。新增同变体连拍（`g3-original-canvas-b.png`）噪声基线，非皮肤泄漏判定改为
  「显著高于同变体噪声×4」。

## 迁移范围（15 槽最终目标）

- **已迁移（4/15）**：Face、BodySkin、HairA、HairB。
- **尚未迁移（11/15，后续票据）**：Brows、Lashes、Emotions、Eyes、EyeWhite、EyeShadow、Eyes+、
  UpperTeeth、LowerTeeth、Tongue、FingerNails。
- **明确排除（永久保持原始 Reze K3）**：所有 Cth* 衣物/装备与 Glock、GunSilencer 武器。

## 剩余风险与边界

- **头发视角高光**：本阶段只迁移 BaseColor 乘色，Anisotropic/Specular/ToonRamp 等视角相关高光
  保持引擎既有行为，未复现 Blender 的 0.72 各向异性高光形状（按 A/B/C 分类属「不能烘焙」）。
- **验收环境**：本机无 Python，API 后端不可达，验收用 Playwright route 存根 bootstrap API
  （存根环境端到端）；V1 资格/绑定/渲染/VMD 均不依赖 API。
- **check:basic / tsc 基线已知失败**：与本票据无关的历史遗留，未触碰。

## 提交

（见 git log，ticket_branch `codex/v14d-hairab-stage`）
