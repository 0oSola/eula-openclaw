const fs = require("fs");
const p = "docs/handoff/2026-09-01-v14d-body-skin-state2.md";
let s = fs.readFileSync(p, "utf8");
const anchor = "## 交付握手";
const i = s.indexOf(anchor);
if (i < 0) { console.error("anchor not found"); process.exit(1); }
const block = `## Stage 2B-M3.1 修正轮（视觉验收失败族，2026-09-02）

分支 codex/v14d-bodyskin-semantic-pixel-gate，冻结 base_commit=49c982df。修复 BodySkin 验收的语义分区与统计口径，不调颜色、不改 V14D 材质公式、不扩大到 Hair/Eyes。

### 已修复（机制层）

1. **语义分区**：旧版左手 y 带（11.5..13.9）误吞腰腹皮肤。改为版本化骨骼主导权重集合 V14D_BODY_SKIN_BONE_REGIONS_V1（顶点主导骨骼 → neck=首8 / torso=上半身6 / leftHand=左手首42+左手指59..73 / rightHand=右手首57+右手指74..88）。实测分区：neck 262 三角形（y 15.84..16.53）、torso 216（y 11.24..11.96）、leftHand/rightHand 各 882（y 10.75..11.90），左右手 y 带与 torso 分离不再重叠。语义稳定性证据：骨骼是解剖语义单位，不随姿态/相机变化；运行时 skeleton.bones 序 = PMX 骨骼段序（401 骨骼），骨骼名表经 Blender armature（449 骨骼含 dummy/shadow）交叉验证。
2. **真逐像素 MAE**：旧版报告 MAE 实为区域均值差 abs(mean-mean)，可能误差抵消。改为逐像素逐通道 mean(abs(web_i-ref_i))，输出 numerator/denominator。
3. **coverage**：区域新增 coverage（可见样本 / BodySkin 可见前景总像素）与 regionTriTotal；Face 强制同一像素样本集合（旧版 Web 551 / ref 469 不同集合，修正后同集合 469）。
4. **draw-call 绑定证据**：正式 Gate 消费 exportBodySkinDrawBinding（allBodySkinOnComposite），不再只看 graph 名字符串。
5. **GPU 口径双线性采样**：参考纹理采样从最近点改为 REPEAT 环绕 + texel 中心对齐的双线性，对齐 WebGPU linear filter；mipmap LOD 无法逐层等价（近平坦常量色贴图，LOD 间差异极小），如实标注为 mip0 双线性口径。
6. **语义负测**：左右手交换（左手882/右手882 归属数参与计算）、腰腹注入（torso=216 三角形并入左手会改变归属）、UV 集合错位（face_d 采样对 UV 敏感）、均值抵消构造（meanDiff≈0 而 pixelMae>0.1，Gate 用后者）全部通过。运行时 graph 负测 missing/wrongGraph/wrongMaterial 均 exit 1。

### 诚实 checkpoint（Gate 未全过）

四区域逐像素 MAE 当前为 neck=[0.263,0.582,0.632]、torso=[0.237,0.546,0.599]、leftHand=[0.151,0.410,0.478]、rightHand=[0.148,0.433,0.501]，均超过候选阈值 0.20，Gate exit 1（FAIL，非 occluded checkpoint）。

**根因（已定位，非语义分区问题）**：Web HDR 线性是「body_d×warm×白光世界光照」的结果，参考是「body_d×warm」纯 albedo 常量（不含光照）。逐通道比值非恒定（R≈1.1、G≈1.9、B≈2.4），不是单一曝光缩放可消除——G/B 通道参考值（body_d 双线性采样×warm）本身低于 Web 含光照结果。R 通道逐像素 MAE（手 0.15、颈 0.26）已比历史均值口径（0.334）显著改善，G/B 差异是已知未对齐的光照口径。

**结论边界**：本票据完成语义分区与真逐像素 Gate 机制（问题 1/2/3/4/5/6/7/8 全部在机制层修复并验证），但「正式 Gate 通过」未达成——因为同口径参考（含光照）的建立属于颜色对齐工作，超出本票据「不调颜色」的范围。这是诚实 FAIL，不是软通过。

### 验收命令与实际结果

| 验收项 | 结果 |
| --- | --- |
| npm run build（打 patch-reze-engine 后） | exit 0（62 项不变量） |
| 正式 BodySkin Gate | exit 1（4 区域逐像素 MAE 超阈值，诚实 FAIL） |
| 语义负测 N1-N4（手交换/腰腹注入/UV错位/均值抵消） | 全部通过 |
| 运行时 graph 负测（missing/wrongGraph/wrongMaterial/none） | exit 1/1/1/0 |
| gate-v14d-state2-override-regression | exit 0（30 断言） |
| probe-v14d-face-default / probe-v14d-vmd-runtime | exit 0 / exit 0 |
| git diff --check | exit 0 |

Gate 产物：.scratch/v14d-body-skin-state2/gate-m31-v3/（gate-report.json + shots/）。

`;
s = s.slice(0, i) + block + s.slice(i);
fs.writeFileSync(p, s, "utf8");
console.log("handoff updated");
