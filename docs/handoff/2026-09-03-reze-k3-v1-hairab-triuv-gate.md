# Reze K3 V1 HairA/HairB 同材质同三角形同 UV 逐像素门禁交付

- 票据：Stage 2C-M1.1
- 分支：codex/v14d-hairab-triuv-gate
- 来源任务：01a036ca-f4cc-7b22-8482-b4e72b231053，hostId=local
- 来源项目：local-140a2801b88e7626327b2eb4694a8b91，project_binding_verified=true
- 工作目录：E:\codexWorktree\a29b\MMD project
- 基线：base_ref=codex/v14d-hairab-stage，base_commit=b8b2b35c7f28510b8814e975c8602ea1081fd403
- 日期：2026-09-03
- 状态：实现完成；专项测试、补丁自测/验证、构建和真实 /companion G1-G6 均通过。

## 交付结论

HairA/HairB 正式 Gate 已从整槽 targetMean 改为真实逐屏幕 triUV 目标：每个样本同时绑定引擎 materialId、同槽局部 triId、插值 UV 和对应三角形 UV 重心合法性，再对权威 hair_d 做线性双线性采样、应用 V14D_HAIR_TINT、转显示字节比较。正式 visual-diff.json 不含 targetMean。

本票只迁移 HairA/HairB BaseColor。视角相关高光、各向异性、Roughness/Specular MapRange、ToonRamp、ShaderToRGB 和完整 Blender 最终着色不在本票范围。

## 正式逐槽结果

数据来自 web/.scratch/reze-k3-v1-stage/visual-diff.json：

| 槽位 | materialId | samples | coverage | origMae | v1Mae | drop | p95 | formalGate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| HairA | 24 | 4,185 | 0.037179 | 28.366 | 25.248 | 0.1099 | orig 71 / v1 71 | true |
| HairB | 25 | 15,502 | 0.096946 | 47.589 | 35.744 | 0.2489 | orig 99.333 / v1 89 | true |

两槽 target binding 均为 consistent=true：HairA 的 triUV/目标来源是 HairA，HairB 的 triUV/目标来源是 HairB。每槽 samples、coverage 非零，v1Mae 小于 origMae，drop 超过 0.05。

## 真实负测结果

### 错槽/错目标交换

命令：node scripts/analyze-reze-k3-v1-diff.mjs --neg-swap-slot-target

- analyzer exit=1，正式 Gate 确实被阻断；
- negativeVerdict.status=rejected，semanticMismatch=true；
- HairA/HairB formalTargetGate 均为 false；
- analysisFailures=[]；
- HairA target/triUV 来源被交换为 HairB，HairB 来源被交换为 HairA；
- 失败保留在正式 failures 中，证明不是配置缺失或样本不足造成的软拒绝。

### wrongTint

按既有协议，错误 tint 只替换 HairA/HairB 实际画布：

- analyzer exit=0；
- negativeVerdict.status=rejected；
- HairA/HairB formalTargetGate 均为 false；
- failures=[]、analysisFailures=[]。

实际错误画布误差为 HairA 28.366→63.999、drop=-1.2562，HairB 47.589→56.616、drop=-0.1897；两槽均未被错误颜色判为收敛。

G2 真实运行时还通过了 missingHairA、missingHairB、wrongHairMaterial、wrongGraph、failCompile、非权威 PMX、缺 mask 等负测。

## 实现摘要

- RezeWebGpuStage.tsx 新增仅 acceptance probe 可见的 captureHairTriUv：同一停帧导出生产等价 material-ID + depth 掩码、HairA/HairB 非索引展开 triId、插值 UV 和三角形 UV 表；读回后恢复渲染循环和原有动画状态。
- v14dHairPartition.js 新增线性纹理双线性采样、V14D 目标转换和 UV 三角形重心校验；类型声明同步更新。
- analyze-reze-k3-v1-diff.mjs 的正式 HairA/HairB 统计只消费同材质 triUV 证据，分别输出 samples、coverage、origMae、v1Mae、drop、p95、JSON 和热图；旧 targetMean 函数/正式逻辑已移除。
- accept-reze-k3-v1-stage.mjs 的 G3 使用 captureHairTriUv，写出 material mask、triUV JSON，传入当前 KOLEDA_DIR 下的 V14D_HAIR_TEX/V14D_HAIR_PMX，并机器核对正式 Gate、错槽交换和 wrongTint 协议。
- patch-reze-engine.mjs 动态加载 web/src/features/stage/v14dAuthority.js，校验 V14D_HAIR_TINT 为 3 个有限数值后生成补丁字符串；脚本源码不再手写旧 tint 数组，self-test fixture 同步复制 authority 模块。

## 实际验证

- node --test tests/v14d-hair-partition.test.mjs：14/14 通过。
- node --test tests/v14d-hair-partition.test.mjs tests/reze-k3-skin-variant.test.mjs：26/26 通过。
- node scripts/patch-reze-engine.mjs --self-test：通过；fresh 首次/二次幂等、anchor-miss、missing-file、重复 marker、断点 A/B 和 PMX anchor-miss 均按预期拒绝，真实依赖 hash 不变。
- node scripts/patch-reze-engine.mjs --verify：72 项严格 marker 不变量通过。
- npm run build：Next.js 15.5.14 编译、类型检查、静态页生成通过。
- node scripts/accept-reze-k3-v1-stage.mjs：G1、G2、G3、G4、G5、G6 全部通过，输出 STAGE-V1-OK。
- git diff --check：通过。

## 证据产物

以下产物位于忽略目录 web/.scratch/reze-k3-v1-stage，不提交大 PNG 或 111 MB triUV JSON：

- g3-hair-material-mask.png / g3-hair-material-mask.json
- g3-hair-tri-uv.json
- g3-hair-hairA-triuv-target.json / g3-hair-hairA-triuv-target-heat.png
- g3-hair-hairB-triuv-target.json / g3-hair-hairB-triuv-target-heat.png
- g3-hair-front-orig.png / g3-hair-front-v1.png
- g3-hair-back-orig.png / g3-hair-back-v1.png
- visual-diff.json
- visual-diff-swap-slot-target.json
- visual-diff-wrongtint.json
- gate-report.json

## 未运行项目与剩余风险

- 未运行全量 node tests；本票只运行 Hair/skin 相关聚焦测试，未把其他既有测试的状态外推为全量通过。
- 未迁移 Face/BodySkin 之外的其他材质槽；Cth* 衣物/装备、Glock、GunSilencer、PMX/VMD/骨骼/权重/Morph/IK/Grant/Physics/拓扑/材质槽均未修改。
- K3 灯光、星空、自由相机、动态 VMD、物理、播放和默认生产入口保持现有路径；诊断探针默认关闭。
- 目标 MAE 是显示字节域的屏幕样本误差，不能解释为视角相关高光或完整 Blender 最终着色已经对齐。

## 提交

提交哈希在最终 Git 提交后由来源任务交付消息记录；本报告不写自引用哈希。
