# 头发同材质同三角形同 UV 逐像素门禁

- 中文名称：头发同材质同三角形同 UV 逐像素门禁
- 英文机器名：v14d-hair-triuv-pixel-gate
- 所属阶段：Stage 2C-M1.1
- 关联票据：codex/v14d-hairab-triuv-gate

## 概念定义

头发同材质同三角形同 UV 逐像素门禁，是对 Reze K3 V1 HairA/HairB BaseColor 迁移建立的真实屏幕样本门禁。每个正式样本必须同时具备：

1. 生产引擎 material-ID + depth 前景 pass 命中的 HairA 或 HairB 材质 ID；
2. 同一槽位非索引展开三角形 pass 给出的局部三角形 ID；
3. 该三角形插值出的 UV，且 UV 必须落在该局部三角形的 UV 重心范围内；
4. 用该 UV 对权威 hair_d 纹理按 WebGPU `REPEAT` 寻址做线性空间双线性采样，再乘唯一权威 V14D_HAIR_TINT，最后转换到显示字节比较。

ROI 只限制屏幕空间范围，不能赋予材质身份，也不能把整槽均值当作纹理目标。

## 解决的问题

早期 Hair Gate 用 HairA/HairB 的整槽 targetMean 或矩形 ROI 统计，无法证明某个屏幕像素对应了哪一个 PMX 材质、哪一个三角形和哪一个纹理位置。平滑或重复色块还可能让错误归属看起来收敛，形成计数恒等自证。

本门禁把身份和目标绑定到同一个屏幕像素：引擎前景材质 ID 决定槽位，展开 pass 决定 triId 与插值 UV，权威 hair_d 决定该 UV 的目标颜色。这样错槽、错三角形或错目标会改变正式目标语义并被门禁阻断。
此前采样器在纹理边缘把四邻域索引 clamp 到边界，导致 `u/v` 接近 0、1 或越界时丢失权威 `REPEAT` 首尾接缝；当前实现对宽、高方向分别做 modulo，红绿测试覆盖左右/上下边界和越界坐标。

## 适用范围

- 适用：/companion、reze-k3、权威克莱妲 PMX、HairA/HairB 的 V1 BaseColor 迁移验证。
- 适用：固定同一画布、相机、停帧的 original/V1 A/B 对比，以及真实运行时的绑定负测。
- 不适用：Face/BodySkin 的 State2 阴影公式、Cth* 衣物、装备、武器或其他尚未迁移的材质槽。
- 不适用：视角相关高光、各向异性、Roughness/Specular MapRange、ToonRamp、ShaderToRGB、Alpha 形状或完整 Blender 最终着色复现。本票只迁移 BaseColor。

## 核心不变量

- 正式 HairA/HairB 样本必须来自 engine-pick-material-id-depth 的对应材质 ID；矩形 ROI 不能代替身份证据。
- triId 必须属于对应槽的三角形范围，UV 必须有限，并通过对应三角形 UV 的 barycentricInside 校验。
- 正式目标必须使用 hair_d 同 UV、`REPEAT` modulo 寻址的线性双线性采样，再应用 v14dAuthority.js 导出的 V14D_HAIR_TINT；不能使用槽位 targetMean。
- HairA 与 HairB 分别计算 samples、coverage、origMae、v1Mae、drop 和 p95；每槽样本与 coverage 必须非零，且 v1Mae 小于 origMae、drop 达到冻结阈值。
- 目标来源槽、triUV 来源槽、材质 ID 必须一致；任何绑定不一致都使正式 Gate 为 false。
- `targetBinding.inputsValid` 只证明样本、triUV、材质 ID 和目标流合法；`metricGate` 才表示目标误差收敛，正式 verdict 必须同时组合绑定一致性与数值 Gate，不能用配置布尔值代替误差证据。
- 错槽负测为每个屏幕样本保留自身 UV 的同像素 canonical target 作权威基准，并把交换后的真实目标误差、v1Mae/drop/P95 penalty 写入报告；canonical target 只用于负测判别，不改变正常模式的目标公式。
- v14dAuthority.js 是 V14D_HAIR_TINT 的唯一权威来源。patch-reze-engine.mjs 只动态加载、验证并序列化该导出，不手写旧常量。
- captureHairTriUv 只在显式 acceptance probe 下暴露；采集前快照 VMD currentSeconds、playing/paused 和 render-loop 运行态，所有成功、提前返回和异常路径都在 finally 中恢复时间与播放状态，且只在采集前循环运行时恢复循环；默认生产入口不泄漏探针。
- 不修改 PMX、VMD、骨骼、权重、Morph、IK、Grant、Physics、拓扑、材质槽、K3 灯光、星空、自由相机或动态播放链。

## 证据与计算口径

实现位置：

- web/src/features/stage/RezeWebGpuStage.tsx：captureHairTriUv，同帧导出材质身份和 triUV 证据；
- web/src/features/stage/v14dHairPartition.js：颜色空间、双线性采样、目标转换和三角形重心校验；
- web/scripts/analyze-reze-k3-v1-diff.mjs：正式逐像素统计、热图、JSON 和负测协议；
- web/scripts/accept-reze-k3-v1-stage.mjs：G3 采集、运行 analyzer 和机器验收。

权威目标公式为：

targetLinear(uv) = bilinearRepeatLinear(hair_d, uv) × V14D_HAIR_TINT

其中 `bilinearRepeatLinear` 的四个邻近 texel 索引在宽/高方向按 modulo wrap；hair_d 文件以 sRGB 字节读取并先转换到线性空间；比较值是目标线性色经 sRGB OETF 转回的显示字节。origMae 与 v1Mae 是屏幕样本在 RGB 三通道绝对误差平均后的显示字节 MAE；p95 是该像素误差的 95 百分位。

当前冻结阈值：samples 至少 30、coverage 大于 0、v1Mae 小于 origMae、drop 大于 0.05、v1Mae 小于 90；另以原图到 V1 的材质变化 MAE 和最大平均通道差证明迁移确实生效。

## 正例

2026-09-03 真实 /companion G3 回放：

- HairA：materialId=24，samples=4185，coverage=0.037179，origMae=28.394，v1Mae=25.250，drop=0.1107，metricGate/formalGate=true，triUV 与目标来源均为 HairA，p95 orig=71.267、v1=71。
- HairB：materialId=25，samples=15503，coverage=0.096952，origMae=47.743，v1Mae=35.746，drop=0.2513，metricGate/formalGate=true，triUV 与目标来源均为 HairB，p95 orig=99.333、v1=89。
- 正式 visual-diff.json 不含 targetMean；逐槽目标由 triUV 同 UV 采样产生。

## 反例与负测

- 错槽/错目标：把 HairA 的 target/triUV 来源换成 HairB，同时把 HairB 换成 HairA；交换流仍有 HairA samples=4185/targetSamples=19538、HairB samples=15503/targetSamples=4289，两个槽的 inputsValid=true、triUV 拒绝计数全为 0。真实回放 analyzer exit=1，negativeVerdict.status=rejected，HairA/HairB formal/natural metric Gate 均为 false，analysisFailures=[]；HairA drop=0.0469、v1Mae=40.351 相对 canonical 25.250 的 penalty=15.100、P95=79>71，HairB penalty=4.185、P95=89.667>89。失败保留在正式 failures 中，证明正式 Gate 确实阻断且不是配置异常。
- wrongTint：只替换 HairA/HairB 的实际错误 tint 画布，其他 Gate 使用健康 V1。协议要求 analyzer exit=0、negativeVerdict.status=rejected、两槽正式 Gate 均为 false、failures=[] 且 analysisFailures=[]；本轮 HairA v1Mae=63.950、drop=-1.2522，HairB v1Mae=56.668、drop=-0.1869。任何配置缺失、样本不足或其他分析失败都不能算预期拒绝。
- 缺 material mask、缺 triUV、triId 越界、UV 非有限、UV 不在对应三角形内、目标纹理不存在：属于输入/分析失败，不得包装成语义负测通过。
- 使用整槽 targetMean、矩形 ROI 均值或单纯 materialId 计数恒等式：不是本门禁的正式证据。

## 相关 contract、Gate 与失败修正路线

- contract：v14d-hair-triuv-pixel-gate。
- 正式 Gate：web/scripts/analyze-reze-k3-v1-diff.mjs 的 HairA/HairB targetConvergence，以及 web/scripts/accept-reze-k3-v1-stage.mjs 的 G3。
- 绑定 Gate：G2 的 HairA/HairB draw-call graph.name 与 pipeline 命中证据；missingHairA、missingHairB、wrongHairMaterial、wrongGraph、failCompile 必须真实拒绝。
- 权威来源 Gate：web/scripts/patch-reze-engine.mjs --verify 与 --self-test；authority 导出缺失或数值非法时补丁必须失败。
- 修正轮闭合命令：`node --test tests/v14d-hair-partition.test.mjs tests/reze-k3-skin-variant.test.mjs` exit=0（29/29）；`node scripts/patch-reze-engine.mjs --self-test` exit=0；`node scripts/patch-reze-engine.mjs --verify` exit=0（72 项）；`npm run build` exit=0；正常 analyzer exit=0、错槽 analyzer exit=1、wrongTint analyzer exit=0；真实 `node scripts/accept-reze-k3-v1-stage.mjs` exit=0 且 G1-G6 全 pass；`git diff --check` exit=0。
- 失败修正顺序：先确认同一帧的画布、material mask、triUV 和 camera 状态；再检查 triId/重心校验；随后检查 hair_d 颜色空间与采样边界；最后检查 V1 graph 的真实 draw-call 绑定。不得先调阈值或改生产视觉公式。
- 若正式 Gate 失败但所有输入证据有效，应交付 HairA/HairB 的 JSON、热图和前后近景，明确是 BaseColor 公式、显示链或未迁移视角效果中的哪一类问题。

## 与现有概念的关系

- 承接 v14d-face-uv-visibility-gate 的同材质、同三角形、同 UV 证据思想，但 HairA/HairB 使用独立 hair_d 纹理和槽位级 target binding。
- 承接 v14d-body-skin-state2 的同 UV 逐像素参考原则；本概念进一步要求 HairA/HairB 的生产材质 ID 与 triUV 来源同槽一致。
- 属于 reze-k3-skin-variant 的 HairA/HairB Gate；不扩大 Reze K3 的迁移范围，不改变 Face、BodySkin 或未迁移槽的生产策略。
