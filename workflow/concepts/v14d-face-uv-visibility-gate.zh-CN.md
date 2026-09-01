# V14D Face UV/可见性同口径对账

- 英文机器名：`v14d-face-uv-visibility`（contract id）、`gate-v14d-face-uv-visibility.mjs`（Gate 脚本）
- 所属阶段：Stage 2B-M2，承接 2B-M1（见 `v14d-face-state2-live-composite.zh-CN.md`）。

## 概念定义

在固定 frame120、Face State=2、BlendWeight=0 下，对脸部渲染建立 Blender 与 Web 的
「同 UV、同三角形、同可见性」三层离线对账，使两侧样本逐像素可比：

- **同 UV**：Web 侧由 Face 前景 UV pass 逐像素导出插值 UV（PMX 原始顶点属性），
  参考色用同一 UV 直采 face_d（sRGB→linear）与 State2 packed mask（Non-Color）。
- **同三角形**：Web 像素 UV 必须落在某个 Blender Face 三角形（raycast 导出的 loop UV
  集合，2738 个）的 UV 范围内；落不进任何三角形的样本拒绝（rejectedNoTri）。
- **同可见性**：正式样本 = Web UV 前景 pass 与 HDR 材质 pick **双方都判为 Face** 的像素交集，
  剔除被刘海/发绺/眼睛遮挡或材质归属不一致的边缘样本。

## 解决的问题

2B-M1 用整屏 PNG 直接套 Web Face mask 比较，没有 Face ID/UV 逐像素对应，Blender/Web 不可比，
完整 Face Gate MAE 无法收敛。本概念把对账粒度收紧到「逐 UV、逐三角形、双方一致可见」，
使三层（BaseColor/ShadowFactor/FinalComposite）可用权威公式直采参考色并量化 MAE。

## 核心不变量

- 参考色必须来自**同一 UV 直采**权威资产（face_d + State2 mask），不得反投影 atlas 当运行时材质。
- 不改变 State2 权威公式、阈值，不手调 RGB，不靠放宽 MAE 宣称通过。
- 诊断钩子（`exportFaceTriUv` / `readV14dFaceTriUvMask`）默认关闭；默认生产入口不泄漏，
  VMD runtime probe 必须保持通过。
- Gate 必须有判别力负测：错 UV（u→u+0.5 采到发/体区）与错三角形（UV 质心距离>0.25 远三角形）
  的 MAE 必须显著大于正式样本（本票 >7×）。

## 适用与不适用

- 适用：应用 face_d 纹理的**脸部皮肤**区域的三层对账。
- 不适用：刘海/发绺等虽属 Face 材质但使用独立发色纹理的几何——它们不适用 face_d 直采参考，
  强制纳入会使 FinalComposite MAE 高达 [193,106,93]。同口径必须圈定在 HDR 材质 pick 认可的
  脸部皮肤窄条。

## 证据口径

- 正式样本数、覆盖率、rejectedNoTri / rejectedMaskMismatch 记录于 gate-report.json。
- 三层分别输出每通道 MAE / P95；通过标准 FinalComposite 每通道 MAE ≤ 20/255。
- 本票实测：正式样本 938 像素，三层 MAE 全部达标，Gate 退出码 0。

## 相关脚本与 Gate

- `web/scripts/blender-face-uv-visibility.py`：Blender 侧 raycast 导出 Face 三角形 loop UV + triId/UV/深度图。
- `web/scripts/export-face-tri-uv.mjs`：Web 侧 Face 前景 UV pass + 三模式 pre-tonemap HDR 采集。
- `web/scripts/gate-v14d-face-uv-visibility.mjs`：离线对账 Gate（退出码与结果一致）。

## 失败修正路线

- Gate MAE 超标 → 先定位第一处分歧层（BaseColor/ShadowFactor/FinalComposite），不得手调颜色掩盖。
- 负测判别力不足（<1.5×）→ 检查负测变换是否真正改变了采样语义（单 texel 偏移在平滑肤色区无效）。
- 两 mask 重叠率异常低 → 区分「采集状态漂移」（可平移消除）与「可见性语义差异」（本票实测为后者）。

## 与现有概念的关系

- 承接 `v14d-face-state2-live-composite.zh-CN.md`（2B-M1 实时合成公式与本票参考色公式一致）。
- 复用 `project-local-blender-mcp.zh-CN.md` 的 Blender 侧导出约定。
