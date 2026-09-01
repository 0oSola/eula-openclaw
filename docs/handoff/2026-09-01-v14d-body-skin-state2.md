# Stage 2B-M3｜全身皮肤材质统一（BodySkin 接入 V14D State2 实时合成）

- 日期：2026-09-02
- 状态：完成（BodySkin 实时合成 + ROI 对账通过，候选阈值）
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
